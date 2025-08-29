import { AppleAPIClient } from "./AppleAPIClient.js";
import { ContentProcessor } from "./ContentProcessor.js";
import { Chunker } from "./Chunker.js";
import { createEmbeddings } from "./EmbeddingProvider.js";
import { PostgreSQLManager } from "./PostgreSQLManager.js";
import { type DatabaseRecord, type BatchConfig } from "./types/index.js";
import { Logger } from "./utils/logger.js";

interface ProcessBatchResult {
  successRecords: DatabaseRecord[];
  failureRecords: DatabaseRecord[];
  deleteIds: string[];
  extractedUrls: Set<string>;
  totalChunks: number;
}

interface ContentComparisonResult {
  record: DatabaseRecord;
  collectResult: any;
  hasChanged: boolean;
  newRawJson?: string;
  error?: string;
}

class AppleDocCollector {
  private readonly apiClient: AppleAPIClient;
  private readonly contentProcessor: ContentProcessor;
  private readonly chunker: Chunker;
  private readonly dbManager: PostgreSQLManager;
  private readonly logger: Logger;
  private readonly config: BatchConfig;
  private batchCounter: number = 0;

  constructor(
    dbManager: PostgreSQLManager,
    logger: Logger,
    config: BatchConfig
  ) {
    this.dbManager = dbManager;
    this.logger = logger;
    this.config = config;
    this.apiClient = new AppleAPIClient();
    this.contentProcessor = new ContentProcessor();
    this.chunker = new Chunker(config);
  }

  async execute(): Promise<{
    hasData: boolean;
    batchNumber: number;
    totalChunks: number;
  }> {
    const records = await this.dbManager.getBatchRecords(this.config.batchSize);

    if (records.length === 0) {
      return { hasData: false, batchNumber: this.batchCounter, totalChunks: 0 };
    }

    this.batchCounter++;
    const startTime = Date.now();

    this.logger.info(`\n${"=".repeat(30)}`);
    this.logger.info(
      `🚀 Batch #${this.batchCounter}: Processing ${records.length} URLs`
    );

    const result = await this.processBatch(records);
    await this.dbManager.batchProcessRecords(
      result.successRecords,
      result.failureRecords,
      result.deleteIds
    );

    if (result.extractedUrls.size > 0) {
      await this.dbManager.batchInsertUrls([...result.extractedUrls]);
    }

    const duration = Date.now() - startTime;

    this.logger.info(
      `✅ Batch #${this.batchCounter} completed in ${duration}ms: ${result.totalChunks} chunks generated`
    );

    return {
      hasData: true,
      batchNumber: this.batchCounter,
      totalChunks: result.totalChunks,
    };
  }

  private async processBatch(
    records: DatabaseRecord[]
  ): Promise<ProcessBatchResult> {
    const urls = records.map((r) => r.url);

    // Stage 1: Batch Collecting
    const collectResults = await this.apiClient.fetchDocuments(urls);

    // Stage 2: Intelligent Content Comparison
    const comparisonResults = this.compareContentChanges(
      records,
      collectResults
    );

    // Separate changed and unchanged records
    const changedResults = comparisonResults.filter((r) => r.hasChanged);
    const unchangedResults = comparisonResults.filter(
      (r) => !r.hasChanged && !r.error
    );

    // Log intelligent comparison results
    if (unchangedResults.length > 0) {
      this.logger.info(
        `🔄 Content unchanged: ${unchangedResults.length} URLs (skipping processing)`
      );
    }
    if (changedResults.length > 0) {
      this.logger.info(
        `📝 Content changed: ${changedResults.length} URLs (full processing)`
      );
    }

    // Stage 3: Process Only Changed Content
    const processResults =
      changedResults.length > 0
        ? await this.contentProcessor.processDocuments(
            changedResults.map((r) => r.collectResult)
          )
        : [];

    // Stage 4: Chunk Only Changed Content
    const chunkResults =
      processResults.length > 0
        ? this.chunker.chunkTexts(
            processResults
              .filter((r) => r.data)
              .map((r) => ({
                url: r.url,
                title: r.data!.title,
                content: r.data!.content,
              }))
          )
        : [];

    // Stage 5: Embed Only Changed Content
    const allChunks = chunkResults.flatMap((r) =>
      r.data ? r.data.map((chunk) => ({ url: r.url, chunk })) : []
    );

    // Parse JSON chunks and combine title + content for embedding
    const embeddingTexts = allChunks.map((c) => {
      try {
        const parsed = JSON.parse(c.chunk);
        // Combine title and content for optimal semantic representation
        return parsed.title
          ? `${parsed.title}\n\n${parsed.content}`
          : parsed.content;
      } catch (error) {
        this.logger.warn("Failed to parse chunk JSON, using raw chunk", {
          error: error instanceof Error ? error.message : String(error),
          chunk: c.chunk.substring(0, 100) + "...",
        });
        return c.chunk;
      }
    });

    const embeddings =
      embeddingTexts.length > 0 ? await createEmbeddings(embeddingTexts) : [];

    // Stage 6: Batch Storage for Changed Content
    if (allChunks.length > 0) {
      const chunksWithEmbeddings = allChunks.map((item, index) => ({
        url: item.url,
        content: item.chunk,
        embedding: embeddings[index] || [],
      }));
      await this.dbManager.insertChunks(chunksWithEmbeddings);
    }

    // Stage 7: Lightweight Update for Unchanged Content
    if (unchangedResults.length > 0) {
      await this.dbManager.batchUpdateCollectCountOnly(
        unchangedResults.map((r) => ({
          id: r.record.id,
          collect_count: r.record.collect_count + 1,
        }))
      );
    }

    return this.buildBatchResult(comparisonResults, processResults, allChunks);
  }

  /**
   * Intelligent content comparison: compare old and new raw json to determine content changes
   */
  private compareContentChanges(
    records: DatabaseRecord[],
    collectResults: any[]
  ): ContentComparisonResult[] {
    return records.map((record, index) => {
      const collectResult = collectResults[index];

      if (!collectResult.data) {
        return {
          record,
          collectResult,
          hasChanged: false,
          error: collectResult.error,
        };
      }

      const newRawJson = JSON.stringify(collectResult.data);
      const oldRawJson = record.raw_json;

      // Direct string comparison - most efficient and accurate
      const hasChanged = oldRawJson !== newRawJson;

      return {
        record,
        collectResult,
        hasChanged,
        newRawJson,
      };
    });
  }

  private buildBatchResult(
    comparisonResults: ContentComparisonResult[],
    processResults: any[],
    allChunks: Array<{ url: string; chunk: string }>
  ): ProcessBatchResult {
    const successRecords: DatabaseRecord[] = [];
    const failureRecords: DatabaseRecord[] = [];
    const deleteIds: string[] = [];
    const extractedUrls = new Set<string>();

    let processIndex = 0; // Track processResults index

    for (const comparison of comparisonResults) {
      const { record, collectResult, hasChanged, error } = comparison;

      if (collectResult?.error?.includes("PERMANENT_ERROR:")) {
        deleteIds.push(record.id);
      } else if (hasChanged && collectResult?.data) {
        // Only records with content changes have corresponding processResult
        const processResult = processResults[processIndex++];

        if (processResult?.data) {
          const updatedRecord: DatabaseRecord = {
            id: record.id,
            url: record.url,
            raw_json: comparison.newRawJson!,
            title: processResult.data.title,
            content: processResult.data.content,
            collect_count: record.collect_count + 1,
            created_at: record.created_at,
            updated_at: new Date(),
          };
          successRecords.push(updatedRecord);

          processResult.data.extractedUrls.forEach((url: string) =>
            extractedUrls.add(url)
          );
        } else {
          const errorMessage = processResult?.error || "Processing failed";
          const failureRecord: DatabaseRecord = {
            id: record.id,
            url: record.url,
            raw_json: null,
            title: null,
            content: `ERROR: ${errorMessage}`,
            collect_count: record.collect_count + 1,
            created_at: record.created_at,
            updated_at: new Date(),
          };
          failureRecords.push(failureRecord);
        }
      } else if (error) {
        // Failed collection records
        const failureRecord: DatabaseRecord = {
          id: record.id,
          url: record.url,
          raw_json: null,
          title: null,
          content: `ERROR: ${error}`,
          collect_count: record.collect_count + 1,
          created_at: record.created_at,
          updated_at: new Date(),
        };
        failureRecords.push(failureRecord);
      }
      // Note: Records with unchanged content are already handled in processBatch via batchUpdateCollectCountOnly
    }

    return {
      successRecords,
      failureRecords,
      deleteIds,
      extractedUrls,
      totalChunks: allChunks.length,
    };
  }
}

export { AppleDocCollector };
