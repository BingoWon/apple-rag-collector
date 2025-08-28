/**
 * Embedding Core - 统一的 Embedding 接口实现
 *
 * 提供进程安全的云端 API embedding 服务，专为 Apple Developer Documentation 优化。
 *
 * Features:
 * - 云端 API 集成，永不使用本地模型
 * - 进程安全的单例模式
 * - 智能 API Key 管理和自动轮换
 * - L2 标准化的 2560 维度向量
 * - 自动重试和错误恢复机制
 * 
 * Usage:
 * ```typescript
 * import { createEmbedding } from './EmbeddingCore.js';
 * const embedding = await createEmbedding("Your text here");
 * ```
 */

import fetch from 'node-fetch';
import { KeyManager } from './KeyManager.js';

// ============================================================================
// Configuration
// ============================================================================

export interface EmbeddingConfig {
  readonly provider: 'api'; // Always use API, never local
  readonly model: string;
  readonly dimension: number;
  readonly maxLength: number;
  readonly apiBaseUrl: string;
  readonly timeout: number;
}

export function createEmbeddingConfig(): EmbeddingConfig {
  return {
    provider: 'api', // Always use API
    model: process.env['EMBEDDING_MODEL'] || 'Qwen/Qwen3-Embedding-4B',
    dimension: parseInt(process.env['EMBEDDING_DIM'] || '2560'),
    maxLength: parseInt(process.env['EMBEDDING_MAX_LENGTH'] || '32000'),
    apiBaseUrl: process.env['EMBEDDING_API_BASE_URL'] || 'https://api.siliconflow.cn/v1/embeddings',
    timeout: parseInt(process.env['EMBEDDING_API_TIMEOUT'] || '10') * 1000 // Convert to milliseconds
  };
}

// ============================================================================
// Abstract Provider Interface
// ============================================================================

/**
 * Abstract base class for all embedding providers
 */
export abstract class EmbeddingProvider {
  protected config: EmbeddingConfig;

  constructor(config: EmbeddingConfig) {
    this.config = config;
  }

  /**
   * Encode single text to embedding with L2 normalization
   */
  abstract encodeSingle(text: string, isQuery?: boolean): Promise<number[]>;

  /**
   * Get embedding dimension
   */
  abstract get embeddingDim(): number;

  /**
   * Get model name
   */
  abstract get modelName(): string;

  /**
   * L2 normalize a vector
   */
  protected l2Normalize(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (norm === 0) return vector;
    return vector.map(val => val / norm);
  }
}

// ============================================================================
// Cloud API Provider Implementation
// ============================================================================

/**
 * Cloud API Provider - 云端 embedding 服务实现
 */
export class CloudEmbeddingProvider extends EmbeddingProvider {
  private keyManager: KeyManager;

  constructor(config: EmbeddingConfig) {
    super(config);
    this.keyManager = new KeyManager();
  }

  async encodeSingle(text: string, _isQuery: boolean = false): Promise<number[]> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const apiKey = this.keyManager.getCurrentKey();
        const response = await this.makeApiRequest(text, apiKey);
        
        if (response.data && response.data.length > 0) {
          const embedding = response.data[0].embedding;
          return this.l2Normalize(embedding);
        } else {
          throw new Error('No embedding data in response');
        }
      } catch (error) {
        lastError = error as Error;
        console.error(`Embedding attempt ${attempt + 1} failed:`, error);

        // If it's an API key error, remove the key and try next one
        if (this.isApiKeyError(error as Error)) {
          const currentKey = this.keyManager.getCurrentKey();
          await this.keyManager.removeKey(currentKey);
          
          // Try next key if available
          try {
            this.keyManager.switchToNextKey();
          } catch (switchError) {
            throw new Error('No more API keys available');
          }
        } else {
          // For other errors, wait a bit before retry
          await this.sleep(1000 * (attempt + 1));
        }
      }
    }

    throw lastError || new Error('Failed to generate embedding after all retries');
  }

  private async makeApiRequest(text: string, apiKey: string): Promise<any> {
    const requestBody = {
      model: this.config.model,
      input: text,
      encoding_format: 'float'
    };

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(this.config.apiBaseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private isApiKeyError(error: Error): boolean {
    const errorMessage = error.message.toLowerCase();
    return errorMessage.includes('unauthorized') || 
           errorMessage.includes('invalid api key') ||
           errorMessage.includes('403') ||
           errorMessage.includes('401');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  get embeddingDim(): number {
    return this.config.dimension;
  }

  get modelName(): string {
    return this.config.model;
  }
}

// ============================================================================
// Global Provider Management
// ============================================================================

// Process-safe global embedding provider instance
let globalEmbedder: EmbeddingProvider | null = null;
let currentPid: number | null = null;

/**
 * Get or create process-safe global embedding provider instance
 */
export function getEmbedder(config?: EmbeddingConfig): EmbeddingProvider {
  // Check if we're in a different process (after fork)
  const currentProcessPid = process.pid;

  if (globalEmbedder === null || currentPid !== currentProcessPid) {
    currentPid = currentProcessPid;
    
    const finalConfig = config || createEmbeddingConfig();

    // Always use cloud API provider
    globalEmbedder = new CloudEmbeddingProvider(finalConfig);
  }

  return globalEmbedder;
}

/**
 * Reset the global embedder instance (for testing only)
 */
export function resetEmbedder(): void {
  globalEmbedder = null;
  currentPid = null;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create L2 normalized embedding for single text
 * 
 * @param text Text to encode
 * @param isQuery Whether text is a query
 * @returns L2 normalized embedding vector as array of numbers
 */
export async function createEmbedding(text: string, isQuery: boolean = false): Promise<number[]> {
  const embedder = getEmbedder();
  return await embedder.encodeSingle(text, isQuery);
}
