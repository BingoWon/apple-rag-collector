import { AppleAPIClient } from "./AppleAPIClient.js";
import { ContentProcessor } from "./ContentProcessor.js";
import { Chunker } from "./Chunker.js";
import { createEmbeddings } from "./EmbeddingProvider.js";
import { PostgreSQLManager } from "./PostgreSQLManager.js";
import { type DatabaseRecord, type BatchConfig } from "./types/index.js";
import { Logger } from "./utils/logger.js";

interface BatchResult {
  successRecords: DatabaseRecord[];
  failureRecords: DatabaseRecord[];
  deleteIds: string[];
  extractedUrls: Set<string>;
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

  private readonly config: BatchConfig;

  constructor(
    dbManager: PostgreSQLManager,
    _logger: Logger,
    config: BatchConfig
  ) {
    this.dbManager = dbManager;
    this.config = config;
    this.apiClient = new AppleAPIClient();
    this.contentProcessor = new ContentProcessor();
    this.chunker = new Chunker(config);
  }

  async execute(): Promise<boolean> {
    const records = await this.dbManager.getBatchRecords(this.config.batchSize);

    if (records.length === 0) {
      return false;
    }

    const result = await this.processBatch(records);
    await this.dbManager.batchProcessRecords(
      result.successRecords,
      result.failureRecords,
      result.deleteIds
    );

    if (result.extractedUrls.size > 0) {
      await this.dbManager.batchInsertUrls([...result.extractedUrls]);
    }

    return true;
  }

  private async processBatch(records: DatabaseRecord[]): Promise<BatchResult> {
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
      console.log(
        `🔄 Content unchanged: ${unchangedResults.length} URLs (skipping processing)`
      );
    }
    if (changedResults.length > 0) {
      console.log(
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
        console.warn("Failed to parse chunk JSON, using raw chunk:", error);
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

    return this.buildBatchResult(comparisonResults, processResults);
  }

  /**
   * 智能内容比较：比较新旧 raw json 判断内容是否变化
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

      // 深度内容比较
      const hasChanged = this.isContentChanged(oldRawJson, newRawJson);

      return {
        record,
        collectResult,
        hasChanged,
        newRawJson,
      };
    });
  }

  /**
   * 判断内容是否真正发生变化
   */
  private isContentChanged(
    oldRawJson: string | null,
    newRawJson: string
  ): boolean {
    if (!oldRawJson) return true; // 首次收集，认为有变化

    try {
      const oldData = JSON.parse(oldRawJson);
      const newData = JSON.parse(newRawJson);

      // 比较关键内容字段，忽略可能的时间戳等元数据变化
      return (
        !this.deepEqual(
          oldData.primaryContentSections,
          newData.primaryContentSections
        ) ||
        !this.deepEqual(oldData.metadata, newData.metadata) ||
        !this.deepEqual(oldData.abstract, newData.abstract)
      );
    } catch {
      return true; // JSON解析失败时认为有变化
    }
  }

  /**
   * 深度比较两个对象是否相等
   */
  private deepEqual(obj1: any, obj2: any): boolean {
    if (obj1 === obj2) return true;
    if (obj1 == null || obj2 == null) return obj1 === obj2;
    if (typeof obj1 !== typeof obj2) return false;

    if (Array.isArray(obj1)) {
      if (!Array.isArray(obj2) || obj1.length !== obj2.length) return false;
      return obj1.every((item, index) => this.deepEqual(item, obj2[index]));
    }

    if (typeof obj1 === "object") {
      const keys1 = Object.keys(obj1);
      const keys2 = Object.keys(obj2);
      if (keys1.length !== keys2.length) return false;
      return keys1.every((key) => this.deepEqual(obj1[key], obj2[key]));
    }

    return false;
  }

  private buildBatchResult(
    comparisonResults: ContentComparisonResult[],
    processResults: any[]
  ): BatchResult {
    const successRecords: DatabaseRecord[] = [];
    const failureRecords: DatabaseRecord[] = [];
    const deleteIds: string[] = [];
    const extractedUrls = new Set<string>();

    let processIndex = 0; // 用于跟踪 processResults 的索引

    for (const comparison of comparisonResults) {
      const { record, collectResult, hasChanged, error } = comparison;

      if (collectResult?.error?.includes("PERMANENT_ERROR:")) {
        deleteIds.push(record.id);
      } else if (hasChanged && collectResult?.data) {
        // 只有内容变化的记录才有对应的 processResult
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
        // 收集失败的记录
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
      // 注意：内容未变化的记录已经在 processBatch 中通过 batchUpdateCollectCountOnly 处理
    }

    return { successRecords, failureRecords, deleteIds, extractedUrls };
  }
}

export { AppleDocCollector };
