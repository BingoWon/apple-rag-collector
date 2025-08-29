/**
 * Pure Batch Embedding Provider - Global Optimal Solution
 *
 * Implements true batch API calls for embedding generation, designed specifically
 * for Apple Developer Documentation processing. Zero single processing methods.
 *
 * Features:
 * - True batch API calls: 1 request processes N texts
 * - Multi-key management with automatic failover
 * - L2 normalized 2560-dimension vectors
 * - Atomic batch error handling
 * - Zero code redundancy
 *
 * Usage:
 * ```typescript
 * import { createEmbeddings } from './EmbeddingProvider.js';
 * const embeddings = await createEmbeddings(["text1", "text2", "text3"]);
 * ```
 */

import { KeyManager } from "./KeyManager.js";

// ============================================================================
// Configuration
// ============================================================================

export interface EmbeddingConfig {
  readonly model: string;
  readonly dimension: number;
  readonly apiBaseUrl: string;
  readonly timeout: number;
}

export function createEmbeddingConfig(): EmbeddingConfig {
  return {
    model: process.env["EMBEDDING_MODEL"] || "Qwen/Qwen3-Embedding-4B",
    dimension: parseInt(process.env["EMBEDDING_DIM"] || "2560"),
    apiBaseUrl:
      process.env["EMBEDDING_API_BASE_URL"] ||
      "https://api.siliconflow.cn/v1/embeddings",
    timeout: parseInt(process.env["EMBEDDING_API_TIMEOUT"] || "30") * 1000,
  };
}

// ============================================================================
// Pure Batch Embedding Provider
// ============================================================================

/**
 * Pure batch embedding provider - zero single processing methods
 */
export class BatchEmbeddingProvider {
  private readonly config: EmbeddingConfig;
  private readonly keyManager: KeyManager;

  constructor(config: EmbeddingConfig) {
    this.config = config;
    this.keyManager = new KeyManager();
  }

  /**
   * True batch encoding: 1 API call processes all texts
   */
  async encodeBatch(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];

    const maxKeyAttempts = 3;
    let lastError: Error | null = null;

    for (let keyAttempt = 0; keyAttempt < maxKeyAttempts; keyAttempt++) {
      try {
        const apiKey = this.keyManager.getCurrentKey();

        for (let retry = 0; retry < 3; retry++) {
          try {
            const response = await this.makeBatchApiRequest(texts, apiKey);

            if (response.data && response.data.length === texts.length) {
              return response.data.map((item: any) =>
                this.l2Normalize(item.embedding)
              );
            } else {
              throw new Error(
                `Invalid response: expected ${texts.length} embeddings, got ${response.data?.length || 0}`
              );
            }
          } catch (error) {
            lastError = error as Error;

            if (this.isApiKeyError(error as Error)) {
              await this.keyManager.removeKey(apiKey);
              break; // Try next key
            }

            if (this.isRateLimitError(error as Error)) {
              this.keyManager.switchToNextKey();
              break; // Try next key
            }

            // Server error - retry with same key
            if (retry < 2 && this.isRetryableError(error as Error)) {
              await this.sleep(1000 * (retry + 1));
              continue;
            }

            throw error;
          }
        }
      } catch (error) {
        if ((error as Error).message.includes("No API keys available")) {
          throw new Error("All API keys exhausted");
        }
        lastError = error as Error;
      }
    }

    throw lastError || new Error("Batch embedding failed after all attempts");
  }

  private async makeBatchApiRequest(
    texts: string[],
    apiKey: string
  ): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(this.config.apiBaseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          input: texts, // True batch: all texts in single request
          encoding_format: "float",
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private l2Normalize(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return norm === 0 ? vector : vector.map((val) => val / norm);
  }

  private isApiKeyError(error: Error): boolean {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("401") || msg.includes("403") || msg.includes("unauthorized")
    );
  }

  private isRateLimitError(error: Error): boolean {
    return error.message.toLowerCase().includes("429");
  }

  private isRetryableError(error: Error): boolean {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("503") || msg.includes("504") || msg.includes("timeout")
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

// Process-safe global batch embedding provider instance
let globalBatchProvider: BatchEmbeddingProvider | null = null;
let currentPid: number | null = null;

/**
 * Get or create process-safe global batch embedding provider
 */
function getBatchProvider(config?: EmbeddingConfig): BatchEmbeddingProvider {
  const currentProcessPid = process.pid;

  if (globalBatchProvider === null || currentPid !== currentProcessPid) {
    currentPid = currentProcessPid;
    const finalConfig = config || createEmbeddingConfig();
    globalBatchProvider = new BatchEmbeddingProvider(finalConfig);
  }

  return globalBatchProvider;
}

// ============================================================================
// Public API - Pure Batch Processing Only
// ============================================================================

/**
 * Create L2 normalized embeddings for batch of texts - True batch API call
 *
 * @param texts Array of texts to encode
 * @returns Array of L2 normalized embedding vectors
 */
export async function createEmbeddings(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];

  const provider = getBatchProvider();
  return await provider.encodeBatch(texts);
}
