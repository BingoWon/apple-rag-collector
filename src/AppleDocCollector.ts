import { AppleAPIClient } from "./AppleAPIClient.js";
import { Chunker } from "./Chunker.js";
import { ContentProcessor } from "./ContentProcessor.js";
import { createEmbeddings } from "./EmbeddingProvider.js";
import type { KeyManager } from "./KeyManager.js";
import type { PostgreSQLManager } from "./PostgreSQLManager.js";
import type {
  BatchConfig,
  BatchResult,
  DatabaseRecord,
  DocumentContent,
} from "./types/index.js";
import { BatchErrorHandler } from "./utils/batch-error-handler.js";
import { logger } from "./utils/logger.js";
import { notifyTelegram } from "./utils/telegram-notifier.js";

interface ProcessBatchResult {
  successRecords: DatabaseRecord[];
  failureRecords: DatabaseRecord[];
  deleteIds: string[];
  extractedUrls: Set<string>;
  totalChunks: number;
}

interface ProcessingPlanItem {
  record: DatabaseRecord;
  collectResult: BatchResult<any>;
  hasChanged: boolean;
  newRawJson?: string;
  processResult?: BatchResult<DocumentContent> | undefined;
  error?: string;
  isPermanentError?: boolean;
}

interface ComparisonResult {
  hasChanged: boolean;
  difference?: string;
  oldContent?: string | null;
  newContent?: string;
}

class AppleDocCollector {
  private readonly apiClient: AppleAPIClient;
  private readonly contentProcessor: ContentProcessor;
  private readonly chunker: Chunker;
  private readonly dbManager: PostgreSQLManager;
  private readonly keyManager: KeyManager;
  private readonly config: BatchConfig;
  private readonly env:
    | {
        EMBEDDING_MODEL?: string;
        EMBEDDING_DIM?: string;
        EMBEDDING_API_BASE_URL?: string;
        EMBEDDING_API_TIMEOUT?: string;
      }
    | undefined;
  private batchCounter: number = 0;

  constructor(
    dbManager: PostgreSQLManager,
    keyManager: KeyManager,
    config: BatchConfig,
    env?: {
      EMBEDDING_MODEL?: string;
      EMBEDDING_DIM?: string;
      EMBEDDING_API_BASE_URL?: string;
      EMBEDDING_API_TIMEOUT?: string;
    }
  ) {
    this.dbManager = dbManager;
    this.keyManager = keyManager;
    this.config = config;
    this.env = env;
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

    logger.info(
      `\n🚀 Batch #${this.batchCounter}: Processing ${records.length} URLs`
    );

    const result = await this.processBatch(records);

    // Records are updated via intelligent field update strategy:
    // - Changed records: full update via batchUpdateFullRecords (including updated_at)
    // - Unchanged/Error records: no database update needed (collect_count already updated in getBatchRecords)

    if (result.extractedUrls.size > 0) {
      await this.dbManager.batchInsertUrls([...result.extractedUrls]);
    }

    const duration = Date.now() - startTime;

    logger.info(
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

    // Unified processing plan creation (now async)
    const processingPlan = await this.createProcessingPlan(
      records,
      collectResults
    );
    return await this.executeProcessingPlan(processingPlan);
  }

  // Optimized processing plan creation - process only valid data, then compare
  private async createProcessingPlan(
    records: DatabaseRecord[],
    collectResults: BatchResult<any>[]
  ): Promise<ProcessingPlanItem[]> {
    if (this.config.forceUpdateAll) {
      logger.info(`🔄 Force Update: Processing all ${records.length} URLs`);
    }

    // Create index mapping for valid results only
    const validIndices: number[] = [];
    const validCollectResults = collectResults.filter((result, index) => {
      if (result.data) {
        validIndices.push(index);
        return true;
      }
      return false;
    });

    // Process only valid results
    const processResults =
      validCollectResults.length > 0
        ? await this.contentProcessor.processDocuments(validCollectResults)
        : [];

    // Create result mapping
    const processResultMap = new Map<number, any>();
    validIndices.forEach((originalIndex, processIndex) => {
      processResultMap.set(originalIndex, processResults[processIndex]);
    });

    const planItems = records.map((record, index) => {
      const collectResult = collectResults[index];

      if (!collectResult || !collectResult.data) {
        return this.createErrorPlanItem(
          record,
          collectResult || {
            url: record.url,
            data: null,
            error: "Missing collect result",
          }
        );
      }

      const processResult = processResultMap.get(index);
      return this.createSuccessPlanItem(record, collectResult, processResult);
    });

    return planItems;
  }

  private createErrorPlanItem(
    record: DatabaseRecord,
    collectResult: BatchResult<any>
  ): ProcessingPlanItem {
    const isPermanent = BatchErrorHandler.isPermanentError(
      collectResult.error || ""
    );
    return {
      record,
      collectResult,
      hasChanged: false,
      error: collectResult.error || "Unknown error",
      isPermanentError: isPermanent,
    };
  }

  private createSuccessPlanItem(
    record: DatabaseRecord,
    collectResult: BatchResult<any>,
    processResult?: BatchResult<DocumentContent>
  ): ProcessingPlanItem {
    const newRawJson = JSON.stringify(collectResult.data);
    const comparison = this.compareContent(record, processResult);

    // Log differences for debugging
    this.logContentChanges(record.url, comparison);

    return {
      record,
      collectResult,
      hasChanged: comparison.hasChanged,
      newRawJson,
      processResult, // Add processed result to plan item
    };
  }

  // Optimized content comparison - based on processed results
  private compareContent(
    oldRecord: DatabaseRecord,
    processResult?: BatchResult<DocumentContent>
  ): ComparisonResult {
    if (this.config.forceUpdateAll) {
      return { hasChanged: true };
    }

    // Compare with already processed content (no duplicate processing)
    if (!processResult?.data) {
      return { hasChanged: false };
    }

    const newTitle = processResult.data.title;
    const newContent = processResult.data.content;

    // Compare actual content fields
    const titleChanged = oldRecord.title !== newTitle;
    const contentChanged = oldRecord.content !== newContent;
    const hasChanged = titleChanged || contentChanged;

    if (hasChanged) {
      const changes = [];
      if (titleChanged)
        changes.push(`Title: "${oldRecord.title}" → "${newTitle}"`);
      if (contentChanged)
        changes.push(
          `Content: ${oldRecord.content.length} → ${newContent.length} chars`
        );

      return {
        hasChanged,
        difference: changes.join(", "),
        oldContent: `Title: ${oldRecord.title}\nContent: ${oldRecord.content.substring(0, 200)}...`,
        newContent: `Title: ${newTitle}\nContent: ${newContent.substring(0, 200)}...`,
      };
    }

    return { hasChanged: false };
  }

  private logContentChanges(url: string, comparison: ComparisonResult): void {
    if (
      comparison.hasChanged &&
      !this.config.forceUpdateAll &&
      comparison.difference
    ) {
      // Consolidated debug output in a single log entry
      const consolidatedMessage = [
        `📝 Content change detected for ${url}:`,
        `${comparison.difference}`,
        ``,
        `🔍 DEBUG - Complete content comparison:`,
        `📄 OLD CONTENT:`,
        `${comparison.oldContent || "null"}`,
        ``,
        `📄 NEW CONTENT:`,
        `${comparison.newContent || "null"}`,
        `🔚 END DEBUG for ${url}`,
      ].join("\n");

      logger.info(consolidatedMessage);
    }
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

    // Use already processed results (no duplicate processing)
    const processResults = changedRecords
      .map((r) => r.processResult)
      .filter(Boolean);

    const { allChunks, embeddings } =
      await this.generateChunksAndEmbeddings(processResults);

    // Store changed chunks and update records with full content
    if (changedRecords.length > 0) {
      logger.info(
        `📝 Content changed: ${changedRecords.length} URLs (full processing)`
      );

      // Send compact notification when content changes are detected (only when not in force update mode)
      if (!this.config.forceUpdateAll) {
        const MAX_URLS_DISPLAY = 10;
        const urlsToShow = changedRecords.slice(0, MAX_URLS_DISPLAY);
        const remaining = changedRecords.length - MAX_URLS_DISPLAY;

        const urlList = urlsToShow.map((r) => r.record.url).join("\n");
        const remainingText = remaining > 0 ? `\n...and ${remaining} more` : "";

        const message =
          `📝 Content Updated: ${changedRecords.length} URLs\n\n` +
          `${urlList}${remainingText}`;

        await notifyTelegram(message);
      }

      if (allChunks.length > 0) {
        const chunksWithEmbeddings = allChunks.map((item, index) => ({
          url: item.url,
          title: item.chunk.title,
          content: item.chunk.content,
          embedding: embeddings[index] || [],
          chunk_index: item.chunk.chunk_index,
          total_chunks: item.chunk.total_chunks,
        }));
        await this.dbManager.insertChunks(chunksWithEmbeddings);
      }

      // Update changed records with full content and updated_at
      // Note: collect_count already incremented in getBatchRecords() and doesn't need updating
      await this.dbManager.batchUpdateFullRecords(
        changedRecords.map((r) => {
          return {
            ...r.record,
            updated_at: new Date(),
            raw_json: r.newRawJson || JSON.stringify(r.collectResult.data),
            title: r.processResult?.data?.title || null,
            content: r.processResult?.data?.content || "",
          };
        })
      );
    }

    // Unchanged records: no database update needed
    // Note: collect_count already incremented in getBatchRecords() for concurrency safety
    if (unchangedRecords.length > 0) {
      logger.info(
        `🔄 Content unchanged: ${unchangedRecords.length} URLs (no database update needed)`
      );
    }

    // Separate permanent and temporary errors
    const permanentErrorRecords = errorRecords.filter(
      (r) => r.isPermanentError
    );
    const temporaryErrorRecords = errorRecords.filter(
      (r) => !r.isPermanentError
    );

    // Delete permanent error records (404, 403, 410), no primary content
    if (permanentErrorRecords.length > 0) {
      const permanentUrls = permanentErrorRecords
        .map((r) => `${r.record.url} (${r.error})`)
        .join("\n");
      logger.info(
        `🗑️ Permanent errors: ${permanentErrorRecords.length} URLs (deleting records)\nDeleted URLs:\n${permanentUrls}`
      );

      await this.dbManager.deleteRecords(
        permanentErrorRecords.map((r) => r.record.id)
      );
    }

    // Temporary error records: no database update needed
    // Note: collect_count already incremented in getBatchRecords() for concurrency safety
    if (temporaryErrorRecords.length > 0) {
      const temporaryUrls = temporaryErrorRecords
        .map((r) => `${r.record.url} (${r.error})`)
        .join("\n");
      await logger.warn(
        `Temporary errors: ${temporaryErrorRecords.length} URLs in batch ${this.batchCounter}\n${temporaryUrls}`
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
      chunk: {
        title: string | null;
        content: string;
        chunk_index: number;
        total_chunks: number;
      };
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
        ? await createEmbeddings(embeddingTexts, this.keyManager, this.env)
        : [];

    return { allChunks, embeddings };
  }

  private buildProcessingResult(
    processingPlan: ProcessingPlanItem[],
    processResults: any[],
    allChunks: Array<{
      url: string;
      chunk: {
        title: string | null;
        content: string;
        chunk_index: number;
        total_chunks: number;
      };
    }>
  ): ProcessBatchResult {
    const successRecords: DatabaseRecord[] = [];
    const failureRecords: DatabaseRecord[] = [];
    const extractedUrls = new Set<string>();

    let processIndex = 0;
    for (const planItem of processingPlan) {
      const { record, collectResult, hasChanged, error } = planItem;

      if (error) {
        // Error records: collect_count already updated in getBatchRecords, return original for result tracking
        failureRecords.push(record);
        continue;
      }

      // Success records: updated via appropriate method, return original for result tracking
      successRecords.push(record);

      // Extract URLs only from changed records that were processed
      if (
        hasChanged &&
        collectResult?.data &&
        processIndex < processResults.length
      ) {
        const processResult = processResults[processIndex++];
        if (processResult?.data?.extractedUrls) {
          processResult.data.extractedUrls.forEach((url: string) =>
            extractedUrls.add(url)
          );
        }
      }
    }

    return {
      successRecords,
      failureRecords,
      deleteIds: [],
      extractedUrls,
      totalChunks: allChunks.length,
    };
  }
}

export { AppleDocCollector };
