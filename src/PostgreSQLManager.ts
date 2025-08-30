import { Pool } from "pg";
import {
  type DatabaseRecord,
  type DatabaseStats,
  type ChunkRecord,
} from "./types/index.js";
import { Logger } from "./utils/logger.js";

class PostgreSQLManager {
  private pool: Pool;
  private readonly logger: Logger;

  constructor(pool: Pool, logger?: Logger) {
    this.pool = pool;
    this.logger = logger || new Logger("info");
  }

  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      // Enable required extensions
      await client.query('CREATE EXTENSION IF NOT EXISTS "vector"');

      // Migrate existing table structure if needed
      await this.migrateDatabase(client);

      // Create pages table if it doesn't exist
      await client.query(`
        CREATE TABLE IF NOT EXISTS pages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          url TEXT NOT NULL UNIQUE,
          raw_json JSONB,
          title TEXT,
          content TEXT,
          collect_count INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE
        )
      `);

      // Create chunks table if it doesn't exist
      await client.query(`
        CREATE TABLE IF NOT EXISTS chunks (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          url TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          embedding HALFVEC(2560)
        )
      `);

      // Create indexes for pages table
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_pages_collect_count_url ON pages(collect_count, url)"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_pages_created_at ON pages(created_at)"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_pages_updated_at ON pages(updated_at)"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_pages_title ON pages(title)"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_pages_url ON pages(url)"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_pages_raw_json ON pages USING GIN (raw_json)"
      );

      // Create indexes for chunks table
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_chunks_url ON chunks(url)"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_chunks_created_at ON chunks(created_at)"
      );

      // Create stats view if it doesn't exist
      await client.query(`
        CREATE OR REPLACE VIEW pages_stats AS
        SELECT
          COUNT(*) as total_records,
          COUNT(*) FILTER (WHERE collect_count > 0) as collected_records,
          ROUND(AVG(collect_count), 4) as avg_collect_count,
          MIN(collect_count) as min_collect_count,
          MAX(collect_count) as max_collect_count,
          COUNT(*) FILTER (WHERE title IS NOT NULL) as records_with_title,
          COUNT(*) FILTER (WHERE content IS NOT NULL AND content != '') as records_with_content,
          COUNT(*) FILTER (WHERE raw_json IS NOT NULL) as records_with_raw_json
        FROM pages
      `);
    } finally {
      client.release();
    }
  }

  /**
   * Migrate existing database structure to match current schema
   */
  private async migrateDatabase(client: any): Promise<void> {
    try {
      // Check if pages table exists and get its structure
      const tableExists = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'pages'
        );
      `);

      if (tableExists.rows[0].exists) {
        // Check for missing columns and add them
        const columns = await client.query(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_name = 'pages' AND table_schema = 'public';
        `);

        const existingColumns = columns.rows.map((row: any) => row.column_name);

        // Add missing columns
        if (!existingColumns.includes("collect_count")) {
          await client.query(
            "ALTER TABLE pages ADD COLUMN collect_count INTEGER NOT NULL DEFAULT 0"
          );
          this.logger.info("Added collect_count column to pages table");
        }

        if (!existingColumns.includes("raw_json")) {
          await client.query("ALTER TABLE pages ADD COLUMN raw_json JSONB");
          this.logger.info("Added raw_json column to pages table");
        }

        if (!existingColumns.includes("title")) {
          await client.query("ALTER TABLE pages ADD COLUMN title TEXT");
          this.logger.info("Added title column to pages table");
        }

        if (!existingColumns.includes("updated_at")) {
          await client.query(
            "ALTER TABLE pages ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE"
          );
          this.logger.info("Added updated_at column to pages table");
        }
      }
    } catch (error) {
      this.logger.debug("Database migration check completed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async batchInsertUrls(urls: string[]): Promise<number> {
    if (urls.length === 0) return 0;

    const client = await this.pool.connect();
    try {
      // True batch processing: insert all URLs at once, using database-generated UUIDs
      const values = urls
        .map((_, index) => {
          const offset = index * 2;
          return `($${offset + 1}, $${offset + 2})`;
        })
        .join(", ");

      const params = urls.flatMap((url) => [url, 0]);

      const result = await client.query(
        `
        INSERT INTO pages (url, collect_count)
        VALUES ${values}
        ON CONFLICT (url) DO NOTHING
        RETURNING url
      `,
        params
      );

      return result.rowCount || 0;
    } finally {
      client.release();
    }
  }

  async getStats(): Promise<DatabaseStats> {
    const client = await this.pool.connect();
    try {
      const [
        totalResult,
        collectedResult,
        avgResult,
        minMaxResult,
        distributionResult,
        chunksResult,
      ] = await Promise.all([
        client.query("SELECT COUNT(*) as count FROM pages"),
        client.query(
          "SELECT COUNT(*) as count FROM pages WHERE collect_count > 0"
        ),
        client.query("SELECT AVG(collect_count) as avg FROM pages"),
        client.query(
          "SELECT MIN(collect_count) as min, MAX(collect_count) as max FROM pages"
        ),
        client.query(
          "SELECT collect_count, COUNT(*) as count FROM pages GROUP BY collect_count ORDER BY collect_count"
        ),
        client.query("SELECT COUNT(*) as count FROM chunks"),
      ]);

      const total = parseInt(totalResult.rows[0]?.count || "0");
      const collected = parseInt(collectedResult.rows[0]?.count || "0");
      const avgCollectCount = parseFloat(avgResult.rows[0]?.avg || "0");
      const minCollectCount = parseInt(minMaxResult.rows[0]?.min || "0");
      const maxCollectCount = parseInt(minMaxResult.rows[0]?.max || "0");
      const totalChunks = parseInt(chunksResult.rows[0]?.count || "0");

      const collectCountDistribution: Record<
        string,
        { count: number; percentage: string }
      > = {};
      distributionResult.rows.forEach((row: any) => {
        const collectCount = String(row.collect_count);
        const count = parseInt(row.count);
        const percentage =
          total > 0 ? `${Math.round((count / total) * 10000) / 100}%` : "0%";
        collectCountDistribution[collectCount] = { count, percentage };
      });

      return {
        total,
        avgCollectCount: Math.round(avgCollectCount * 10000) / 10000,
        collectedCount: collected,
        collectedPercentage:
          total > 0
            ? `${Math.round((collected / total) * 10000) / 100}%`
            : "0%",
        maxCollectCount,
        minCollectCount,
        collectCountDistribution,
        totalChunks,
      };
    } finally {
      client.release();
    }
  }

  async getBatchRecords(batchSize: number): Promise<DatabaseRecord[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
        SELECT * FROM pages
        WHERE url LIKE 'https://developer.apple.com/%'
        ORDER BY collect_count ASC, url ASC
        LIMIT $1
      `,
        [batchSize]
      );

      return result.rows.map((row: any) => ({
        ...row,
        collect_count: Number(row.collect_count), // Ensure collect_count is a number
        created_at: row.created_at,
        updated_at: row.updated_at,
      })) as DatabaseRecord[];
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
    if (
      successRecords.length === 0 &&
      failureRecords.length === 0 &&
      deleteIds.length === 0
    ) {
      return;
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Delete records that need to be deleted first
      if (deleteIds.length > 0) {
        const deleteParams = deleteIds
          .map((_, index) => `$${index + 1}`)
          .join(", ");
        await client.query(
          `DELETE FROM pages WHERE id IN (${deleteParams})`,
          deleteIds
        );
      }

      // 2. Batch insert success and failure records
      const allRecords = [...successRecords, ...failureRecords];
      if (allRecords.length > 0) {
        await this.batchInsertRecordsInTransaction(client, allRecords);
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Lightweight batch update: only update collect_count, keep other fields unchanged
   */
  async batchUpdateCollectCountOnly(
    updates: Array<{ id: string; collect_count: number }>
  ): Promise<void> {
    if (updates.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Build CASE WHEN statement for batch update
      const caseStatements = updates
        .map(
          (_, index) =>
            `WHEN id = $${index * 2 + 1} THEN $${index * 2 + 2}::integer`
        )
        .join(" ");

      const ids = updates.map((u) => u.id);
      // Ensure collect_count is always a number
      const params = updates.flatMap((u) => [u.id, Number(u.collect_count)]);

      await client.query(
        `
        UPDATE pages
        SET collect_count = CASE ${caseStatements} END
        WHERE id = ANY($${params.length + 1})
      `,
        [...params, ids]
      );

      await client.query("COMMIT");
      this.logger.info(
        `📊 Updated collect_count for ${updates.length} records`
      );
    } catch (error) {
      await client.query("ROLLBACK");
      await this.logger.error("Failed to update collect counts", {
        error: error instanceof Error ? error.message : String(error),
        updatesCount: updates.length,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Batch insert records within existing transaction
   *
   * This method is specifically for complex transaction scenarios, such as delete+insert operations in batchProcessRecords.
   * Does not manage database connections and transactions, caller is responsible for transaction begin, commit and rollback.
   *
   * @param client - Connected database client (must already be in transaction)
   * @param records - Array of database records to insert
   */
  private async batchInsertRecordsInTransaction(
    client: any,
    records: DatabaseRecord[]
  ): Promise<void> {
    for (const record of records) {
      await client.query(
        `
        INSERT INTO pages
        (id, url, raw_json, title, content, collect_count, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (url)
        DO UPDATE SET
          raw_json = EXCLUDED.raw_json,
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          collect_count = EXCLUDED.collect_count,
          updated_at = EXCLUDED.updated_at
      `,
        [
          record.id,
          record.url,
          record.raw_json,
          record.title,
          record.content,
          record.collect_count,
          record.created_at,
          record.updated_at,
        ]
      );
    }
  }

  /**
   * Replace chunks with embeddings using atomic "delete-then-insert" strategy
   * Ensures each URL only has the latest chunks, preventing data accumulation
   */
  async insertChunks(
    chunks: Array<{
      url: string;
      content: string;
      embedding: number[];
    }>
  ): Promise<void> {
    if (chunks.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Step 1: Batch delete existing chunks for all URLs in this batch
      const urls = [...new Set(chunks.map((c) => c.url))];
      if (urls.length > 0) {
        const urlParams = urls.map((_, index) => `$${index + 1}`).join(", ");
        const deleteResult = await client.query(
          `DELETE FROM chunks WHERE url IN (${urlParams})`,
          urls
        );
        this.logger.info(
          `🗑️ Deleted ${deleteResult.rowCount || 0} existing chunks for ${urls.length} URLs`
        );
      }

      // Step 2: Batch insert new chunks
      const values: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      for (const chunk of chunks) {
        values.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2})`);
        const vectorString = `[${chunk.embedding.join(",")}]`;
        params.push(chunk.url, chunk.content, vectorString);
        paramIndex += 3;
      }

      const insertQuery = `
        INSERT INTO chunks (url, content, embedding)
        VALUES ${values.join(", ")}
      `;

      await client.query(insertQuery, params);
      await client.query("COMMIT");

      this.logger.debug(
        `✅ Replaced chunks: ${urls.length} URLs, ${chunks.length} new chunks`
      );
    } catch (error) {
      await client.query("ROLLBACK");
      await this.logger.error("Failed to replace chunks", {
        error: error instanceof Error ? error.message : String(error),
        chunksCount: chunks.length,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get chunks by URL
   */
  async getChunksByUrl(url: string): Promise<ChunkRecord[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        "SELECT id, url, content, created_at, embedding FROM chunks WHERE url = $1 ORDER BY created_at",
        [url]
      );

      return result.rows.map((row: any) => ({
        id: row.id,
        url: row.url,
        content: row.content,
        created_at: row.created_at,
        // Convert HALFVEC back to number array
        embedding: row.embedding ? Array.from(row.embedding) : null,
      }));
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export { PostgreSQLManager };
