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
 */

import { KeyManager } from "./KeyManager.js";
import { Logger } from "./utils/logger.js";

// ============================================================================
// Configuration
// ============================================================================

export interface EmbeddingConfig {
  readonly model: string;
  readonly dimension: number;
  readonly apiBaseUrl: string;
  readonly timeout: number;
}

export function createEmbeddingConfig(env?: {
  EMBEDDING_MODEL?: string;
  EMBEDDING_DIM?: string;
  EMBEDDING_API_BASE_URL?: string;
  EMBEDDING_API_TIMEOUT?: string;
}): EmbeddingConfig {
  return {
    model: env?.EMBEDDING_MODEL || "Qwen/Qwen3-Embedding-4B",
    dimension: parseInt(env?.EMBEDDING_DIM || "2560"),
    apiBaseUrl:
      env?.EMBEDDING_API_BASE_URL || "https://api.siliconflow.cn/v1/embeddings",
    timeout: parseInt(env?.EMBEDDING_API_TIMEOUT || "30") * 1000,
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
  private readonly logger: Logger;

  constructor(
    config: EmbeddingConfig,
    keyManager: KeyManager,
    logger?: Logger
  ) {
    this.config = config;
    this.keyManager = keyManager;
    this.logger = logger || new Logger();
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
        const apiKey = await this.keyManager.getCurrentKey();

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
            const errorMessage = (error as Error).message;

            // Enhanced error logging with specific handling
            if (this.isTimeoutError(error as Error)) {
              // Only log timeout warning on final retry attempt
              if (retry === 2) {
                await this.logger.warn(
                  `Embedding timeout (${this.config.timeout}ms) final attempt failed, batch size ${texts.length}: ${errorMessage}`
                );
              }
            } else if (this.isApiKeyError(error as Error)) {
              this.logger.info(
                `API key invalid, removing (attempt ${keyAttempt + 1}): ${errorMessage}`
              );
              await this.keyManager.removeKey(apiKey);
              break; // Try next key
            } else if (this.isRateLimitError(error as Error)) {
              this.logger.info(
                `Rate limit exceeded, switching key (attempt ${keyAttempt + 1}): ${errorMessage}`
              );
              break; // Try next key
            } else {
              await this.logger.warn(
                `Embedding error (retry ${retry + 1}, key ${keyAttempt + 1}, batch ${texts.length}): ${errorMessage}`
              );
            }

            if (this.isRateLimitError(error as Error)) {
              break; // Try next key
            }

            // Server error or timeout - retry with same key
            if (
              retry < 2 &&
              (this.isRetryableError(error as Error) ||
                this.isTimeoutError(error as Error))
            ) {
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

  private isTimeoutError(error: Error): boolean {
    const msg = error.message.toLowerCase();
    return (
      error.name === "AbortError" ||
      msg.includes("aborted") ||
      msg.includes("timeout") ||
      msg.includes("operation was aborted")
    );
  }

  private isRetryableError(error: Error): boolean {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("503") || msg.includes("504") || msg.includes("timeout")
    );
  }

  get embeddingDim(): number {
    return this.config.dimension;
  }

  get modelName(): string {
    return this.config.model;
  }
}

// ============================================================================
// Public API - Pure Batch Processing Only
// ============================================================================

/**
 * Create L2 normalized embeddings for batch of texts - True batch API call
 *
 * @param texts Array of texts to encode
 * @param keyManager KeyManager instance for API key management
 * @param logger Optional logger for enhanced error reporting
 * @param env Optional environment variables for configuration
 * @returns Array of L2 normalized embedding vectors
 */
export async function createEmbeddings(
  texts: string[],
  keyManager: KeyManager,
  logger?: Logger,
  env?: {
    EMBEDDING_MODEL?: string;
    EMBEDDING_DIM?: string;
    EMBEDDING_API_BASE_URL?: string;
    EMBEDDING_API_TIMEOUT?: string;
  }
): Promise<number[][]> {
  if (!texts.length) return [];

  const config = env ? createEmbeddingConfig(env) : createEmbeddingConfig();
  const provider = new BatchEmbeddingProvider(config, keyManager, logger);
  return await provider.encodeBatch(texts);
}
