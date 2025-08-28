import { Pool } from 'pg';
import { type DatabaseRecord, type DatabaseStats } from './types/index.js';

class PostgreSQLManager {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      // Enable UUID extension
      await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

      // Create apple_docs table if it doesn't exist
      await client.query(`
        CREATE TABLE IF NOT EXISTS apple_docs (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          source_url TEXT NOT NULL UNIQUE,
          raw_json JSONB,
          title TEXT,
          content TEXT,
          collect_count INTEGER NOT NULL DEFAULT 0,
          created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
          updated_at BIGINT
        )
      `);

      // Create indexes if they don't exist
      await client.query('CREATE INDEX IF NOT EXISTS idx_apple_docs_collect_count_url ON apple_docs(collect_count, source_url)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_apple_docs_created_at ON apple_docs(created_at)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_apple_docs_updated_at ON apple_docs(updated_at)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_apple_docs_title ON apple_docs(title)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_apple_docs_source_url ON apple_docs(source_url)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_apple_docs_raw_json ON apple_docs USING GIN (raw_json)');

      // Create stats view if it doesn't exist
      await client.query(`
        CREATE OR REPLACE VIEW apple_docs_stats AS
        SELECT
          COUNT(*) as total_records,
          COUNT(*) FILTER (WHERE collect_count > 0) as collected_records,
          ROUND(AVG(collect_count), 4) as avg_collect_count,
          MIN(collect_count) as min_collect_count,
          MAX(collect_count) as max_collect_count,
          COUNT(*) FILTER (WHERE title IS NOT NULL) as records_with_title,
          COUNT(*) FILTER (WHERE content IS NOT NULL AND content != '') as records_with_content,
          COUNT(*) FILTER (WHERE raw_json IS NOT NULL) as records_with_raw_json
        FROM apple_docs
      `);

    } finally {
      client.release();
    }
  }

  async batchInsertRecords(records: DatabaseRecord[]): Promise<void> {
    if (records.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 真正的批量插入 - 一次SQL操作
      const values = records.map((_, index) => {
        const offset = index * 8;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`;
      }).join(', ');

      const params = records.flatMap(record => [
        record.id,
        record.source_url,
        record.raw_json,
        record.title,
        record.content,
        record.collect_count,
        record.created_at,
        record.updated_at
      ]);

      await client.query(`
        INSERT INTO apple_docs
        (id, source_url, raw_json, title, content, collect_count, created_at, updated_at)
        VALUES ${values}
        ON CONFLICT (source_url)
        DO UPDATE SET
          raw_json = EXCLUDED.raw_json,
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          collect_count = EXCLUDED.collect_count,
          updated_at = EXCLUDED.updated_at
      `, params);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async batchInsertUrls(urls: string[]): Promise<number> {
    if (urls.length === 0) return 0;

    const client = await this.pool.connect();
    try {
      const currentTime = Math.floor(Date.now() / 1000);

      // 真正的批处理：一次性插入所有URL
      const values = urls.map((_, index) => {
        const offset = index * 4;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
      }).join(', ');

      const params = urls.flatMap(url => [
        crypto.randomUUID(),
        url,
        0,
        currentTime
      ]);

      const result = await client.query(`
        INSERT INTO apple_docs (id, source_url, collect_count, created_at)
        VALUES ${values}
        ON CONFLICT (source_url) DO NOTHING
        RETURNING source_url
      `, params);

      return result.rowCount || 0;
    } finally {
      client.release();
    }
  }



  async getStats(): Promise<DatabaseStats> {
    const client = await this.pool.connect();
    try {
      const [totalResult, collectedResult, avgResult, minMaxResult, distributionResult] = await Promise.all([
        client.query('SELECT COUNT(*) as count FROM apple_docs'),
        client.query('SELECT COUNT(*) as count FROM apple_docs WHERE collect_count > 0'),
        client.query('SELECT AVG(collect_count) as avg FROM apple_docs'),
        client.query('SELECT MIN(collect_count) as min, MAX(collect_count) as max FROM apple_docs'),
        client.query('SELECT collect_count, COUNT(*) as count FROM apple_docs GROUP BY collect_count ORDER BY collect_count')
      ]);

      const total = parseInt(totalResult.rows[0]?.count || '0');
      const collected = parseInt(collectedResult.rows[0]?.count || '0');
      const avgCollectCount = parseFloat(avgResult.rows[0]?.avg || '0');
      const minCollectCount = parseInt(minMaxResult.rows[0]?.min || '0');
      const maxCollectCount = parseInt(minMaxResult.rows[0]?.max || '0');

      const collectCountDistribution: Record<string, { count: number; percentage: string }> = {};
      distributionResult.rows.forEach(row => {
        const collectCount = String(row.collect_count);
        const count = parseInt(row.count);
        const percentage = total > 0 ? `${Math.round((count / total) * 10000) / 100}%` : '0%';
        collectCountDistribution[collectCount] = { count, percentage };
      });

      return {
        total,
        avgCollectCount: Math.round(avgCollectCount * 10000) / 10000,
        collectedCount: collected,
        collectedPercentage: total > 0 ? `${Math.round((collected / total) * 10000) / 100}%` : '0%',
        maxCollectCount,
        minCollectCount,
        collectCountDistribution
      };
    } finally {
      client.release();
    }
  }

  async getBatchRecords(batchSize: number): Promise<DatabaseRecord[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT * FROM apple_docs
        ORDER BY collect_count ASC, source_url ASC
        LIMIT $1
      `, [batchSize]);

      return result.rows as DatabaseRecord[];
    } finally {
      client.release();
    }
  }

  async updateRecord(record: DatabaseRecord): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        UPDATE apple_docs
        SET raw_json = $1, title = $2, content = $3, collect_count = $4, updated_at = $5
        WHERE id = $6
      `, [
        record.raw_json,
        record.title,
        record.content,
        record.collect_count,
        record.updated_at,
        record.id
      ]);
    } finally {
      client.release();
    }
  }

  async deleteRecord(recordId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('DELETE FROM apple_docs WHERE id = $1', [recordId]);
    } finally {
      client.release();
    }
  }

  /**
   * 原子批处理：先删除，再插入成功和失败记录
   * 解决删除后被重新插入的问题
   */
  async batchProcessRecords(
    successRecords: DatabaseRecord[],
    failureRecords: DatabaseRecord[],
    deleteIds: string[]
  ): Promise<void> {
    if (successRecords.length === 0 && failureRecords.length === 0 && deleteIds.length === 0) {
      return;
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. 先删除需要删除的记录
      if (deleteIds.length > 0) {
        const deleteParams = deleteIds.map((_, index) => `$${index + 1}`).join(', ');
        await client.query(`DELETE FROM apple_docs WHERE id IN (${deleteParams})`, deleteIds);
      }

      // 2. 批量插入成功和失败记录
      const allRecords = [...successRecords, ...failureRecords];
      if (allRecords.length > 0) {
        await this.batchInsertRecordsInTransaction(client, allRecords);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 在事务内批量插入记录
   */
  private async batchInsertRecordsInTransaction(client: any, records: DatabaseRecord[]): Promise<void> {
    const values = records.map((_, index) => {
      const offset = index * 8;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`;
    }).join(', ');

    const params = records.flatMap(record => [
      record.id,
      record.source_url,
      record.raw_json,
      record.title,
      record.content,
      record.collect_count,
      record.created_at,
      record.updated_at
    ]);

    await client.query(`
      INSERT INTO apple_docs
      (id, source_url, raw_json, title, content, collect_count, created_at, updated_at)
      VALUES ${values}
      ON CONFLICT (source_url)
      DO UPDATE SET
        raw_json = EXCLUDED.raw_json,
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        collect_count = EXCLUDED.collect_count,
        updated_at = EXCLUDED.updated_at
    `, params);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export { PostgreSQLManager };
