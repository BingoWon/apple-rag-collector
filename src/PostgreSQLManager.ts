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
          title TEXT,
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
      // Only count Apple Developer URLs
      const appleUrlFilter = "WHERE url LIKE 'https://developer.apple.com/%'";

      const [
        totalResult,
        collectedResult,
        avgResult,
        minMaxResult,
        distributionResult,
        chunksResult,
        pagesQualityResult,
        chunksQualityResult,
      ] = await Promise.all([
        client.query(`SELECT COUNT(*) as count FROM pages ${appleUrlFilter}`),
        client.query(
          `SELECT COUNT(*) as count FROM pages ${appleUrlFilter} AND collect_count > 0`
        ),
        client.query(
          `SELECT AVG(collect_count) as avg FROM pages ${appleUrlFilter}`
        ),
        client.query(
          `SELECT MIN(collect_count) as min, MAX(collect_count) as max FROM pages ${appleUrlFilter}`
        ),
        client.query(
          `SELECT collect_count, COUNT(*) as count FROM pages ${appleUrlFilter} GROUP BY collect_count ORDER BY collect_count`
        ),
        client.query(`SELECT COUNT(*) as count FROM chunks ${appleUrlFilter}`),
        // Pages missing data statistics
        client.query(`
          SELECT
            COUNT(CASE WHEN content IS NULL OR content = '' THEN 1 END) as missing_content_count,
            COUNT(CASE WHEN title IS NULL OR title = '' THEN 1 END) as missing_title_count
          FROM pages ${appleUrlFilter}
        `),
        // Chunks missing data statistics
        client.query(`
          SELECT
            COUNT(CASE WHEN content IS NULL OR content = '' THEN 1 END) as missing_content_count,
            COUNT(CASE WHEN title IS NULL OR title = '' THEN 1 END) as missing_title_count
          FROM chunks ${appleUrlFilter}
        `),
      ]);

      const total = parseInt(totalResult.rows[0]?.count || "0");
      const collected = parseInt(collectedResult.rows[0]?.count || "0");
      const avgCollectCount = parseFloat(avgResult.rows[0]?.avg || "0");
      const minCollectCount = parseInt(minMaxResult.rows[0]?.min || "0");
      const maxCollectCount = parseInt(minMaxResult.rows[0]?.max || "0");
      const totalChunks = parseInt(chunksResult.rows[0]?.count || "0");

      // Extract missing data statistics
      const pagesMissingContentCount = parseInt(pagesQualityResult.rows[0]?.missing_content_count || "0");
      const pagesMissingTitleCount = parseInt(pagesQualityResult.rows[0]?.missing_title_count || "0");
      const chunksMissingContentCount = parseInt(chunksQualityResult.rows[0]?.missing_content_count || "0");
      const chunksMissingTitleCount = parseInt(chunksQualityResult.rows[0]?.missing_title_count || "0");

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
        pagesMissingData: {
          missingContentCount: pagesMissingContentCount,
          missingContentPercentage: total > 0
            ? `${Math.round((pagesMissingContentCount / total) * 10000) / 100}%`
            : "0%",
          missingTitleCount: pagesMissingTitleCount,
          missingTitlePercentage: total > 0
            ? `${Math.round((pagesMissingTitleCount / total) * 10000) / 100}%`
            : "0%",
        },
        chunksMissingData: {
          missingContentCount: chunksMissingContentCount,
          missingContentPercentage: totalChunks > 0
            ? `${Math.round((chunksMissingContentCount / totalChunks) * 10000) / 100}%`
            : "0%",
          missingTitleCount: chunksMissingTitleCount,
          missingTitlePercentage: totalChunks > 0
            ? `${Math.round((chunksMissingTitleCount / totalChunks) * 10000) / 100}%`
            : "0%",
        },
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
        ORDER BY
          collect_count ASC,
          CASE WHEN content IS NULL OR content = '' THEN 0 ELSE 1 END ASC,
          CASE WHEN title IS NULL OR title = '' THEN 0 ELSE 1 END ASC,
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

  async batchUpdateFullRecords(records: DatabaseRecord[]): Promise<void> {
    if (records.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      for (const record of records) {
        await client.query(
          `
          UPDATE pages
          SET raw_json = $2,
              title = $3,
              content = $4,
              collect_count = $5,
              updated_at = $6
          WHERE id = $1
        `,
          [
            record.id,
            record.raw_json,
            record.title,
            record.content,
            record.collect_count,
            record.updated_at,
          ]
        );
      }

      await client.query("COMMIT");
      this.logger.info(`📝 Updated full records: ${records.length} records`);
    } catch (error) {
      await client.query("ROLLBACK");
      this.logger.error("Failed to update full records", {
        error: error instanceof Error ? error.message : String(error),
        recordsCount: records.length,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteRecords(recordIds: string[]): Promise<void> {
    if (recordIds.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Delete from chunks table first (foreign key constraint)
      const chunksDeleteResult = await client.query(
        `DELETE FROM chunks WHERE url IN (SELECT url FROM pages WHERE id = ANY($1))`,
        [recordIds]
      );

      // Delete from pages table
      const pagesDeleteResult = await client.query(
        `DELETE FROM pages WHERE id = ANY($1)`,
        [recordIds]
      );

      await client.query("COMMIT");

      this.logger.info(
        `🗑️ Deleted permanent error records: ${pagesDeleteResult.rowCount} pages, ${chunksDeleteResult.rowCount} chunks`
      );
    } catch (error) {
      await client.query("ROLLBACK");
      this.logger.error("Failed to delete permanent error records", {
        error: error instanceof Error ? error.message : String(error),
        recordIds: recordIds.length,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Replace chunks with embeddings using atomic "delete-then-insert" strategy
   * Ensures each URL only has the latest chunks, preventing data accumulation
   */
  async insertChunks(
    chunks: Array<{
      url: string;
      title: string | null;
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
        values.push(
          `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3})`
        );
        const vectorString = `[${chunk.embedding.join(",")}]`;
        params.push(chunk.url, chunk.title, chunk.content, vectorString);
        paramIndex += 4;
      }

      const insertQuery = `
        INSERT INTO chunks (url, title, content, embedding)
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
        "SELECT id, url, title, content, created_at, embedding FROM chunks WHERE url = $1 ORDER BY created_at",
        [url]
      );

      return result.rows.map((row: any) => ({
        id: row.id,
        url: row.url,
        title: row.title,
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
