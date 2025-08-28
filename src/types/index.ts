/**
 * Shared type definitions for the Apple RAG Collector
 */



// Application configuration interface
interface AppConfig {
  readonly database: {
    readonly host: string;
    readonly port: number;
    readonly database: string;
    readonly username: string;
    readonly password: string;
    readonly ssl: boolean;
  };
  readonly processing: {
    readonly batchSize: number;
  };

  readonly logging: {
    readonly level: string;
  };
}



// Database record interface
interface DatabaseRecord {
  readonly id: string;
  readonly source_url: string;
  readonly raw_json: string | null;
  readonly title: string | null;
  readonly content: string;
  readonly collect_count: number;
  readonly created_at: number;
  readonly updated_at: number | null;
}

// Processed document content interface
interface DocumentContent {
  readonly title: string | null;
  readonly content: string;
  readonly extractedUrls: readonly string[];
}

// Apple API content section interface
interface ContentSection {
  readonly type: string;
  readonly content?: string;
  readonly text?: string;
  readonly title?: string;
  readonly anchor?: string;
  readonly level?: number;
}

// Apple API response interface
interface AppleAPIResponse {
  readonly metadata: {
    readonly title?: string;
    readonly roleHeading?: string;
    readonly platforms?: ReadonlyArray<{
      readonly name: string;
      readonly introducedAt: string;
      readonly deprecatedAt?: string;
      readonly beta?: boolean;
    }>;
  };
  readonly abstract?: ReadonlyArray<{
    readonly text: string;
  }>;
  readonly primaryContentSections?: ReadonlyArray<ContentSection>;
  readonly references?: Record<
    string,
    {
      readonly title?: string;
      readonly url?: string;
    }
  >;
}

// Statistics interface
interface DatabaseStats {
  readonly total: number;
  readonly avgCollectCount: number;
  readonly collectedCount: number;        // CollectCount > 0 的记录数
  readonly collectedPercentage: string;   // CollectCount > 0 的比例（百分比格式）
  readonly maxCollectCount: number;       // collect_count 的最大值
  readonly minCollectCount: number;       // collect_count 的最小值
  readonly collectCountDistribution: Record<string, { count: number; percentage: string }>; // 每个collect_count值的分布
}



export type {
  AppConfig,
  DatabaseRecord,
  DocumentContent,
  ContentSection,
  AppleAPIResponse,
  DatabaseStats
};
