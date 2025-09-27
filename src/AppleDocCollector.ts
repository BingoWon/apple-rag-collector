import { AppleAPIClient } from "./AppleAPIClient.js";
import { ContentProcessor } from "./ContentProcessor.js";
import { Chunker } from "./Chunker.js";
import { createEmbeddings } from "./EmbeddingProvider.js";
import { KeyManager } from "./KeyManager.js";
import { PostgreSQLManager } from "./PostgreSQLManager.js";
import { type DatabaseRecord, type BatchConfig } from "./types/index.js";
import { logger } from "./utils/logger.js";
import { BatchErrorHandler } from "./utils/batch-error-handler.js";
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
  collectResult: any;
  hasChanged: boolean;
  newRawJson?: string;
  error?: string;
  isPermanentError?: boolean;
}

interface ComparisonResult {
  hasChanged: boolean;
  difference?: string;
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

  // Unified and simplified processing plan creation
  private async createProcessingPlan(
    records: DatabaseRecord[],
    collectResults: any[]
  ): Promise<ProcessingPlanItem[]> {
    if (this.config.forceUpdateAll) {
      logger.info(`🔄 Force Update: Processing all ${records.length} URLs`);
    }

    const planItems = await Promise.all(
      records.map(async (record, index) => {
        const collectResult = collectResults[index];

        if (!collectResult.data) {
          return this.createErrorPlanItem(record, collectResult);
        }

        return await this.createSuccessPlanItem(record, collectResult);
      })
    );

    return planItems;
  }

  private createErrorPlanItem(
    record: DatabaseRecord,
    collectResult: any
  ): ProcessingPlanItem {
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

  private async createSuccessPlanItem(
    record: DatabaseRecord,
    collectResult: any
  ): Promise<ProcessingPlanItem> {
    const newRawJson = JSON.stringify(collectResult.data);
    const comparison = this.compareContent(record.raw_json, collectResult.data);

    // Log differences for debugging (now async)
    await this.logContentChanges(record.url, comparison);

    return {
      record,
      collectResult,
      hasChanged: comparison.hasChanged,
      newRawJson,
    };
  }

  // Unified content comparison logic
  private compareContent(oldRawJson: any, newData: any): ComparisonResult {
    if (this.config.forceUpdateAll) {
      return { hasChanged: true };
    }

    const oldObj = this.parseRawJson(oldRawJson);
    const hasChanged = !this.deepEqual(oldObj, newData);

    if (hasChanged) {
      const oldJsonStr = this.normalizeRawJson(oldRawJson);
      const newJsonStr = JSON.stringify(newData);
      const difference = this.findFirstJsonDifference(oldJsonStr, newJsonStr);
      return { hasChanged, difference };
    }

    return { hasChanged: false };
  }

  // Unified data normalization methods
  private parseRawJson(rawJson: any): any | null {
    if (rawJson === null || rawJson === undefined) return null;
    return typeof rawJson === "string" ? JSON.parse(rawJson) : rawJson;
  }

  private normalizeRawJson(rawJson: any): string | null {
    if (rawJson === null || rawJson === undefined) return null;
    return typeof rawJson === "string" ? rawJson : JSON.stringify(rawJson);
  }

  private async logContentChanges(
    url: string,
    comparison: ComparisonResult
  ): Promise<void> {
    if (
      comparison.hasChanged &&
      !this.config.forceUpdateAll &&
      comparison.difference
    ) {
      const message = `📝 Content change detected for ${url}:\n${comparison.difference}`;
      logger.info(message);
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
      logger.info(
        `📝 Content changed: ${changedRecords.length} URLs (full processing)`
      );

      // Send notification when content changes are detected (only when not in force update mode)
      if (!this.config.forceUpdateAll) {
        const changedUrls = changedRecords.map((r) => r.record.url).join("\n");
        const message = `📝 Content updated: ${changedRecords.length} URLs changed\n\nUpdated URLs:\n${changedUrls}`;
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
        changedRecords.map((r, index) => {
          const processResult = processResults[index];
          return {
            ...r.record,
            updated_at: new Date(),
            raw_json: r.newRawJson || JSON.stringify(r.collectResult.data),
            title:
              processResult?.data?.title ||
              r.collectResult.data?.metadata?.title ||
              r.collectResult.data?.title ||
              null,
            content: processResult?.data?.content || "",
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
      deleteIds: [],
      extractedUrls,
      totalChunks: allChunks.length,
    };
  }

  // Simplified and unified difference detection
  private findFirstJsonDifference(
    oldJson: string | null,
    newJson: string
  ): string {
    try {
      const oldObj = oldJson ? JSON.parse(oldJson) : null;
      const newObj = JSON.parse(newJson);
      const difference = this.findObjectDifference(oldObj, newObj, "");
      return difference || "No specific difference found (possibly formatting)";
    } catch (error) {
      return this.findStringDifference(oldJson, newJson);
    }
  }

  private findObjectDifference(
    oldObj: any,
    newObj: any,
    path: string
  ): string | null {
    if (oldObj === null && newObj === null) return null;
    if (oldObj === null)
      return `${path}: null → ${JSON.stringify(newObj).substring(0, 100)}...`;
    if (newObj === null)
      return `${path}: ${JSON.stringify(oldObj).substring(0, 100)}... → null`;

    if (typeof oldObj !== "object" || typeof newObj !== "object") {
      if (oldObj !== newObj) {
        const oldStr = JSON.stringify(oldObj).substring(0, 50);
        const newStr = JSON.stringify(newObj).substring(0, 50);
        return `${path}: ${oldStr}... → ${newStr}...`;
      }
      return null;
    }

    if (Array.isArray(oldObj) && Array.isArray(newObj)) {
      if (oldObj.length !== newObj.length) {
        return `${path}: Array length ${oldObj.length} → ${newObj.length}`;
      }
      for (let i = 0; i < oldObj.length; i++) {
        const diff = this.findObjectDifference(
          oldObj[i],
          newObj[i],
          `${path}[${i}]`
        );
        if (diff) return diff;
      }
      return null;
    }

    const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
    for (const key of allKeys) {
      const currentPath = path ? `${path}.${key}` : key;

      if (!(key in oldObj)) {
        const newValue = JSON.stringify(newObj[key]).substring(0, 50);
        return `${currentPath}: (new) → ${newValue}...`;
      }
      if (!(key in newObj)) {
        const oldValue = JSON.stringify(oldObj[key]).substring(0, 50);
        return `${currentPath}: ${oldValue}... → (deleted)`;
      }

      const diff = this.findObjectDifference(
        oldObj[key],
        newObj[key],
        currentPath
      );
      if (diff) return diff;
    }

    return null;
  }

  private findStringDifference(oldStr: string | null, newStr: string): string {
    if (!oldStr) return `Length difference: 0 → ${newStr.length}`;

    const maxLength = Math.min(oldStr.length, newStr.length, 200);

    for (let i = 0; i < maxLength; i++) {
      if (oldStr[i] !== newStr[i]) {
        const start = Math.max(0, i - 20);
        const oldContext = oldStr.substring(start, i + 20);
        const newContext = newStr.substring(start, i + 20);
        return `Character difference at position ${i}:\nOld: ...${oldContext}...\nNew: ...${newContext}...`;
      }
    }

    if (oldStr.length !== newStr.length) {
      return `Length difference: ${oldStr.length} → ${newStr.length}`;
    }

    return "Strings appear identical in first 200 characters";
  }

  // Optimized deep equality check
  private deepEqual(obj1: any, obj2: any): boolean {
    if (obj1 === obj2) return true;
    if (obj1 == null || obj2 == null) return obj1 === obj2;
    if (typeof obj1 !== typeof obj2) return false;
    if (typeof obj1 !== "object") return obj1 === obj2;
    if (Array.isArray(obj1) !== Array.isArray(obj2)) return false;

    if (Array.isArray(obj1)) {
      if (obj1.length !== obj2.length) return false;
      for (let i = 0; i < obj1.length; i++) {
        if (!this.deepEqual(obj1[i], obj2[i])) return false;
      }
      return true;
    }

    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) return false;

    for (const key of keys1) {
      if (!keys2.includes(key)) return false;
      if (!this.deepEqual(obj1[key], obj2[key])) return false;
    }

    return true;
  }
}

export { AppleDocCollector };
