import { AppleAPIClient } from "./AppleAPIClient.js";
import { ContentProcessor } from "./ContentProcessor.js";
import { Chunker } from "./Chunker.js";
import { createEmbeddings } from "./EmbeddingProvider.js";
import { PostgreSQLManager } from "./PostgreSQLManager.js";
import { type DatabaseRecord, type BatchConfig } from "./types/index.js";
import { Logger } from "./utils/logger.js";
import { BatchErrorHandler } from "./utils/batch-error-handler.js";

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
  isPermanentError?: boolean;
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

    // Records are updated via intelligent field update strategy:
    // - Changed records: full update via batchUpdateFullRecords (including updated_at)
    // - Unchanged/Error records: count-only update via batchUpdateCollectCountOnly

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

    // Unified processing plan creation
    const processingPlan = this.createProcessingPlan(records, collectResults);

    return await this.executeProcessingPlan(processingPlan);
  }

  private createProcessingPlan(
    records: DatabaseRecord[],
    collectResults: any[]
  ): ProcessingPlanItem[] {
    if (this.config.forceUpdateAll) {
      this.logger.info(
        `🔄 Force Update: Processing all ${records.length} URLs`
      );
    }

    return records.map((record, index) => {
      const collectResult = collectResults[index];

      if (!collectResult.data) {
        const isPermanent = BatchErrorHandler.isPermanentError(
          collectResult.error || ""
        );
        return {
          record,
          collectResult,
          hasChanged: false,
          error: collectResult.error,
          isPermanentError: isPermanent,
        };
      }

      const newRawJson = JSON.stringify(collectResult.data);
      const oldRawJson = record.raw_json;

      // Unified logic: Force Update overrides comparison, otherwise compare JSON
      const hasChanged =
        this.config.forceUpdateAll || oldRawJson !== newRawJson;

      return {
        record,
        collectResult,
        hasChanged,
        newRawJson,
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
    const errorRecords = processingPlan.filter((r) => r.error);

    // Process changed content
    const processResults =
      changedRecords.length > 0
        ? await this.contentProcessor.processDocuments(
            changedRecords.map((r) => r.collectResult)
          )
        : [];

    const { allChunks, embeddings } =
      await this.generateChunksAndEmbeddings(processResults);

    // Store changed chunks and update records with full content
    if (changedRecords.length > 0) {
      this.logger.info(
        `📝 Content changed: ${changedRecords.length} URLs (full processing)`
      );
      if (allChunks.length > 0) {
        const chunksWithEmbeddings = allChunks.map((item, index) => ({
          url: item.url,
          title: item.chunk.title,
          content: item.chunk.content,
          embedding: embeddings[index] || [],
        }));
        await this.dbManager.insertChunks(chunksWithEmbeddings);
      }

      // Update changed records with full content and updated_at
      await this.dbManager.batchUpdateFullRecords(
        changedRecords.map((r, index) => {
          const processResult = processResults[index];
          return {
            ...r.record,
            collect_count: Number(r.record.collect_count) + 1,
            updated_at: new Date(),
            raw_json: r.newRawJson || JSON.stringify(r.collectResult.data),
            title:
              processResult?.data?.title ||
              r.collectResult.data?.metadata?.title ||
              r.collectResult.data?.title ||
              null,
            content: processResult?.data?.content || "", // 🔧 使用处理后的内容
          };
        })
      );
    }

    // Update unchanged records (count only, preserve updated_at)
    if (unchangedRecords.length > 0) {
      this.logger.info(
        `🔄 Content unchanged: ${unchangedRecords.length} URLs (updating count only)`
      );
      await this.dbManager.batchUpdateCollectCountOnly(
        unchangedRecords.map((r) => ({
          id: r.record.id,
          collect_count: Number(r.record.collect_count) + 1,
        }))
      );
    }

    // Separate permanent and temporary errors
    const permanentErrorRecords = errorRecords.filter(
      (r) => r.isPermanentError
    );
    const temporaryErrorRecords = errorRecords.filter(
      (r) => !r.isPermanentError
    );

    // Delete permanent error records (404, 403, 410)
    if (permanentErrorRecords.length > 0) {
      const permanentUrls = permanentErrorRecords
        .map((r) => `${r.record.url} (${r.error})`)
        .join("\n");
      this.logger.error(
        `🗑️ Permanent errors: ${permanentErrorRecords.length} URLs (deleting records)\nDeleted URLs:\n${permanentUrls}`
      );

      await this.dbManager.deleteRecords(
        permanentErrorRecords.map((r) => r.record.id)
      );
    }

    // Update temporary error records (count only, preserve updated_at)
    if (temporaryErrorRecords.length > 0) {
      const temporaryUrls = temporaryErrorRecords
        .map((r) => `${r.record.url} (${r.error})`)
        .join("\n");
      this.logger.error(
        `⏳ Temporary errors: ${temporaryErrorRecords.length} URLs (updating count only)\nFailed URLs:\n${temporaryUrls}`
      );

      await this.dbManager.batchUpdateCollectCountOnly(
        temporaryErrorRecords.map((r) => ({
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
    allChunks: Array<{
      url: string;
      chunk: { title: string | null; content: string };
    }>;
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
      return c.chunk.title
        ? `${c.chunk.title}\n\n${c.chunk.content}`
        : c.chunk.content;
    });

    const embeddings =
      embeddingTexts.length > 0
        ? await createEmbeddings(embeddingTexts, this.logger)
        : [];

    return { allChunks, embeddings };
  }

  private buildProcessingResult(
    processingPlan: ProcessingPlanItem[],
    processResults: any[],
    allChunks: Array<{
      url: string;
      chunk: { title: string | null; content: string };
    }>
  ): ProcessBatchResult {
    const successRecords: DatabaseRecord[] = [];
    const failureRecords: DatabaseRecord[] = [];
    const extractedUrls = new Set<string>();

    let processIndex = 0;
    for (const planItem of processingPlan) {
      const { record, collectResult, hasChanged, error } = planItem;

      if (error) {
        // Error records updated via batchUpdateCollectCountOnly, return original for result tracking
        failureRecords.push(record);
        continue;
      }

      // Success records updated via appropriate method, return original for result tracking
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
}

export { AppleDocCollector };
