import { AppleAPIClient } from './AppleAPIClient.js';
import { ContentProcessor } from './ContentProcessor.js';
import { PostgreSQLManager } from './PostgreSQLManager.js';
import { type DatabaseRecord } from './types/index.js';
import { Logger } from './utils/logger.js';

interface BatchResult {
  successRecords: DatabaseRecord[];
  failureRecords: DatabaseRecord[];
  deleteIds: string[];
  extractedUrls: Set<string>;
}

class AppleDocCollector {
  private readonly apiClient: AppleAPIClient;
  private readonly contentProcessor: ContentProcessor;
  private readonly dbManager: PostgreSQLManager;
  private readonly logger: Logger;

  constructor(dbManager: PostgreSQLManager, logger: Logger) {
    this.dbManager = dbManager;
    this.logger = logger;
    this.apiClient = new AppleAPIClient();
    this.contentProcessor = new ContentProcessor();
  }

  async execute(batchSize: number = 25): Promise<boolean> {
    const batchStartTime = Date.now();
    const records = await this.dbManager.getBatchRecords(batchSize);

    if (records.length === 0) {
      this.logger.info('🏁 Processing Complete - No more records found');
      return false;
    }

    this.logBatchStart(records);
    const result = await this.processBatchRecords(records);
    await this.dbManager.batchProcessRecords(result.successRecords, result.failureRecords, result.deleteIds);

    if (result.extractedUrls.size > 0) {
      await this.dbManager.batchInsertUrls([...result.extractedUrls]);
    }

    this.logBatchSummary(records, result, batchStartTime);
    return true;
  }

  private logBatchStart(records: DatabaseRecord[]): void {
    const minCollectCount = Math.min(...records.map(r => r.collect_count));
    const maxCollectCount = Math.max(...records.map(r => r.collect_count));

    this.logger.info('🚀 Starting Batch Processing', {
      batchSize: records.length,
      collectCountRange: `${minCollectCount}-${maxCollectCount}`,
      timestamp: new Date().toISOString(),
    });
  }

  private async processBatchRecords(records: DatabaseRecord[]): Promise<BatchResult> {
    const successRecords: DatabaseRecord[] = [];
    const failureRecords: DatabaseRecord[] = [];
    const deleteIds: string[] = [];
    const extractedUrls = new Set<string>();

    for (const record of records) {
      try {
        const result = await this.processRecord(record);
        successRecords.push(result.record);
        result.extractedUrls.forEach(url => extractedUrls.add(url));
      } catch (error) {
        const failureResult = await this.handleRecordFailure(record, error);
        if (failureResult.shouldDelete) {
          deleteIds.push(record.id);
        } else if (failureResult.record) {
          failureRecords.push(failureResult.record);
        }
      }
    }

    return { successRecords, failureRecords, deleteIds, extractedUrls };
  }

  private async processRecord(record: DatabaseRecord): Promise<{
    record: DatabaseRecord;
    extractedUrls: string[];
  }> {
    const apiData = await this.apiClient.fetchDocumentJSON(record.source_url);
    const processed = this.contentProcessor.processDocument(apiData);

    const updatedRecord: DatabaseRecord = {
      id: record.id,
      source_url: record.source_url,
      raw_json: JSON.stringify(apiData),
      title: processed.title,
      content: processed.content,
      collect_count: record.collect_count + 1,
      created_at: record.created_at,
      updated_at: Date.now(),
    };

    return {
      record: updatedRecord,
      extractedUrls: [...processed.extractedUrls],
    };
  }

  private async handleRecordFailure(record: DatabaseRecord, error: unknown): Promise<{
    shouldDelete: boolean;
    record?: DatabaseRecord;
  }> {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    this.logger.error('Document processing failed', {
      url: record.source_url,
      collect_count: record.collect_count + 1,
      error: errorMessage,
      error_type: error instanceof Error ? error.constructor.name : 'UnknownError'
    });

    // 永久错误：标记删除
    if (errorMessage.includes('PERMANENT_ERROR:')) {
      const permanentErrorMatch = errorMessage.match(/PERMANENT_ERROR:(\d+):/);
      const statusCode = permanentErrorMatch ? permanentErrorMatch[1] : 'unknown';
      this.logger.info('Record marked for deletion due to permanent error', {
        url: record.source_url,
        reason: `Permanent Error ${statusCode}`,
        record_id: record.id
      });
      return { shouldDelete: true };
    }

    // 临时错误：创建失败记录
    return {
      shouldDelete: false,
      record: {
        id: record.id,
        source_url: record.source_url,
        raw_json: null,
        title: null,
        content: `ERROR: ${errorMessage}`,
        collect_count: record.collect_count + 1,
        created_at: record.created_at,
        updated_at: Date.now(),
      }
    };
  }

  private logBatchSummary(records: DatabaseRecord[], result: BatchResult, batchStartTime: number): void {
    const batchDuration = Date.now() - batchStartTime;
    const successCount = result.successRecords.length;
    const failureCount = result.failureRecords.length;
    const deleteCount = result.deleteIds.length;
    const totalProcessed = successCount + failureCount + deleteCount;

    const successRate = Math.round((successCount / totalProcessed) * 100);
    const avgTimePerRecord = Math.round(batchDuration / records.length);
    const recordsPerSecond = Math.round((records.length / batchDuration) * 1000);

    this.logger.info('📊 Batch Processing Summary', {
      batchSize: records.length,
      processingTime: `${batchDuration}ms`,
      successful: successCount,
      failed: failureCount,
      deleted: deleteCount,
      successRate: `${successRate}%`,
      avgTimePerRecord: `${avgTimePerRecord}ms`,
      recordsPerSecond: recordsPerSecond,
      newUrlsDiscovered: result.extractedUrls.size,
      timestamp: new Date().toISOString(),
    });
  }
}

export { AppleDocCollector };
