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

interface ProcessingPlanItem {
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
    batchNumber: number;
    totalChunks: number;
  }> {
    const records = await this.dbManager.getBatchRecords(this.config.batchSize);

    // Note: records.length === 0 never occurs in continuous processing
    // Database always contains URLs to process with incremented collect_count

    this.batchCounter++;
    const startTime = Date.now();

    this.logger.info(
      `\n🚀 Batch #${this.batchCounter}: Processing ${records.length} URLs`
    );

    const result = await this.processBatch(records);

    // Only call batchProcessRecords if there are records that need database updates
    // In Force Update mode, records are already updated via storeChunksAndUpdateRecords
    if (
      result.successRecords.length > 0 ||
      result.failureRecords.length > 0 ||
      result.deleteIds.length > 0
    ) {
      // Check if we need to update records in database
      const needsDatabaseUpdate =
        !this.config.forceUpdateAll ||
        result.failureRecords.length > 0 ||
        result.deleteIds.length > 0;

      if (needsDatabaseUpdate) {
        await this.dbManager.batchProcessRecords(
          result.successRecords,
          result.failureRecords,
          result.deleteIds
        );
      }
    }

    if (result.extractedUrls.size > 0) {
      await this.dbManager.batchInsertUrls([...result.extractedUrls]);
    }

    const duration = Date.now() - startTime;

    this.logger.info(
      `✅ Batch #${this.batchCounter} completed in ${duration}ms: ${result.totalChunks} chunks generated`
    );

    return {
      batchNumber: this.batchCounter,
      totalChunks: result.totalChunks,
    };
  }

  private async processBatch(
    records: DatabaseRecord[]
  ): Promise<ProcessBatchResult> {
    const urls = records.map((r) => r.url);
    const collectResults = await this.apiClient.fetchDocuments(urls);

    // Determine processing strategy and create processing plan
    const processingPlan = this.config.forceUpdateAll
      ? this.createForceUpdatePlan(records, collectResults)
      : this.compareContentChanges(records, collectResults);

    return await this.executeProcessingPlan(processingPlan);
  }

  private createForceUpdatePlan(
    records: DatabaseRecord[],
    collectResults: any[]
  ): ProcessingPlanItem[] {
    this.logger.info(`🔄 Force Update: Processing all ${records.length} URLs`);

    return records.map((record, index) => {
      const collectResult = collectResults[index];
      return {
        record,
        collectResult,
        hasChanged: true, // Force all records to be treated as changed
        newRawJson: collectResult?.data
          ? JSON.stringify(collectResult.data)
          : "",
        error: collectResult?.error,
      };
    });
  }

  private async executeProcessingPlan(
    processingPlan: ProcessingPlanItem[]
  ): Promise<ProcessBatchResult> {
    const changedRecords = processingPlan.filter(
      (r) => r.hasChanged && !r.error
    );
    const unchangedRecords = processingPlan.filter(
      (r) => !r.hasChanged && !r.error
    );

    // Process changed content
    const processResults =
      changedRecords.length > 0
        ? await this.contentProcessor.processDocuments(
            changedRecords.map((r) => r.collectResult)
          )
        : [];

    const { allChunks, embeddings } =
      await this.generateChunksAndEmbeddings(processResults);

    // Store changed chunks and update records
    if (changedRecords.length > 0) {
      this.logger.info(
        `📝 Content changed: ${changedRecords.length} URLs (full processing)`
      );
      await this.storeChunksAndUpdateRecords(
        allChunks,
        embeddings,
        changedRecords.map((r) => r.record)
      );
    }

    // Update unchanged records (count only)
    if (unchangedRecords.length > 0) {
      this.logger.info(
        `🔄 Content unchanged: ${unchangedRecords.length} URLs (skipping processing)`
      );
      await this.dbManager.batchUpdateCollectCountOnly(
        unchangedRecords.map((r) => ({
          id: r.record.id,
          collect_count: Number(r.record.collect_count) + 1,
        }))
      );
    }

    return this.buildProcessingResult(
      processingPlan,
      processResults,
      allChunks
    );
  }

  private async generateChunksAndEmbeddings(processResults: any[]): Promise<{
    allChunks: Array<{ url: string; chunk: string }>;
    embeddings: number[][];
  }> {
    // Generate chunks using the chunker
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

    const allChunks = chunkResults.flatMap((r) =>
      r.data ? r.data.map((chunk) => ({ url: r.url, chunk })) : []
    );

    // Generate embeddings
    const embeddingTexts = allChunks.map((c) => {
      try {
        const parsed = JSON.parse(c.chunk);
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
      embeddingTexts.length > 0
        ? await createEmbeddings(embeddingTexts, this.logger)
        : [];

    return { allChunks, embeddings };
  }

  private async storeChunksAndUpdateRecords(
    allChunks: Array<{ url: string; chunk: string }>,
    embeddings: number[][],
    records: DatabaseRecord[]
  ): Promise<void> {
    // Store chunks with embeddings
    if (allChunks.length > 0) {
      const chunksWithEmbeddings = allChunks.map((item, index) => ({
        url: item.url,
        content: item.chunk,
        embedding: embeddings[index] || [],
      }));
      await this.dbManager.insertChunks(chunksWithEmbeddings);
    }

    // Update collect_count for records
    if (records.length > 0) {
      await this.dbManager.batchUpdateCollectCountOnly(
        records.map((r) => ({
          id: r.id,
          collect_count: Number(r.collect_count) + 1,
        }))
      );
    }
  }

  private buildProcessingResult(
    processingPlan: ProcessingPlanItem[],
    processResults: any[],
    allChunks: Array<{ url: string; chunk: string }>
  ): ProcessBatchResult {
    const successRecords: DatabaseRecord[] = [];
    const failureRecords: DatabaseRecord[] = [];
    const extractedUrls = new Set<string>();

    let processIndex = 0;
    for (const planItem of processingPlan) {
      const { record, collectResult, hasChanged, error } = planItem;

      if (error) {
        failureRecords.push(record);
        continue;
      }

      // All non-error records are successful (either changed or unchanged)
      successRecords.push(record);

      // Extract URLs only from changed records that were processed
      if (
        hasChanged &&
        collectResult?.data &&
        processIndex < processResults.length
      ) {
        const processResult = processResults[processIndex++];
        if (processResult?.data?.urls) {
          processResult.data.urls.forEach((url: string) =>
            extractedUrls.add(url)
          );
        }
      }
    }

    return {
      successRecords,
      failureRecords,
      deleteIds: [], // No deletions in current implementation
      extractedUrls,
      totalChunks: allChunks.length,
    };
  }

  /**
   * Compare old and new raw JSON to determine content changes
   */
  private compareContentChanges(
    records: DatabaseRecord[],
    collectResults: any[]
  ): ProcessingPlanItem[] {
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

      // Direct string comparison for content changes
      const hasChanged = oldRawJson !== newRawJson;

      return {
        record,
        collectResult,
        hasChanged,
        newRawJson,
      };
    });
  }
}

export { AppleDocCollector };
