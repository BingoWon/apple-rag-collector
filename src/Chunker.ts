/**
 * Apple Documentation Smart Chunker - Title + Content Architecture (TypeScript Implementation)
 *
 * === TITLE + CONTENT CHUNKING STRATEGY ===
 *
 * This module implements an optimized chunking strategy specifically designed for Apple Developer
 * Documentation, featuring title-aware semantic chunking for superior embedding quality.
 *
 * 【Core Features】
 * - Title Integration: Each chunk includes document title for complete semantic context
 * - Dynamic Chunk Size: Recalculate chunk size before each split, adaptive to remaining content
 * - Smart Split Points: Find best semantic boundaries near target position by priority
 * - Quality Assurance: Auto-filter invalid chunks, ensure output quality
 * - Unified JSON Output: All chunks use consistent {"title", "content"} structure
 *
 * 【Algorithm Flow】
 * 1. Accept title parameter from ContentProcessor (document metadata)
 * 2. Dynamic calculation: target_chunk_count = total_length ÷ 2500
 * 3. Before each split: chunk_size = remaining_length ÷ remaining_chunks
 * 4. Find best split point near target position by priority
 * 5. Last chunk contains all remaining content with auto quality assurance
 * 6. Generate JSON chunks with title + content structure
 *
 * 【JSON Output Format】
 * ```json
 * {
 *   "title": "Article: Xcode 26 Beta 7 Release Notes\nUpdate your apps...",
 *   "content": "## Overview\nXcode 26 beta 7 includes SDKs..."
 * }
 * ```
 *
 * 【Design Principles】
 * - Semantic Completeness: Title provides document context for every chunk
 * - Dynamic Adaptive: Combine mathematical precision with semantic reasonableness
 * - Smart Optimization: Priority-based split point selection for better chunk quality
 * - Embedding Optimized: Title + content structure ideal for vector embeddings
 */

import { type BatchConfig, type BatchResult } from "./types/index.js";
import { BatchErrorHandler } from "./utils/batch-error-handler.js";

export class Chunker {
  // Core configuration constants (matching Python implementation)
  private static readonly TARGET_CHUNK_SIZE = 2500;
  private static readonly SEARCH_RANGE = 250;

  // Smart split priority patterns (matching Python implementation)
  private static readonly SPLIT_PATTERNS: Array<[string, number]> = [
    ["# ", 2], // H1 header (highest priority)
    ["## ", 3], // H2 header
    ["### ", 4], // H3 header
    ["\n\n", 2], // Double newline
    ["\n", 1], // Single newline
    [".", 1], // Period (lowest priority)
  ];

  constructor(private readonly config: BatchConfig) {}

  /**
   * Batch chunking framework with title support
   */
  chunkTexts(
    contentResults: Array<{
      url: string;
      title: string | null;
      content: string;
    }>
  ): BatchResult<string[]>[] {
    const results: BatchResult<string[]>[] = [];

    for (let i = 0; i < contentResults.length; i += this.config.batchSize) {
      const batch = contentResults.slice(i, i + this.config.batchSize);
      const batchResults = batch.map((item) => this.chunkSingleText(item));
      results.push(...batchResults);
    }

    return results;
  }

  private chunkSingleText(item: {
    url: string;
    title: string | null;
    content: string;
  }): BatchResult<string[]> {
    try {
      // Use title as context for all chunks
      const chunks = this.chunkText(item.content, item.title || "");
      return BatchErrorHandler.success(item.url, chunks);
    } catch (error) {
      return BatchErrorHandler.failure(item.url, error);
    }
  }

  /**
   * Smart chunking main entry - Dynamic adaptive strategy
   */
  chunkText(text: string, title: string = ""): string[] {
    if (!text.trim()) {
      return [];
    }

    console.log(
      `Starting smart chunking, document length: ${text.length} characters`
    );

    if (text.length <= Chunker.TARGET_CHUNK_SIZE) {
      return [this._createChunkJson(title, text)];
    }

    // Execute dynamic adaptive splitting with title
    return this._adaptiveSplit(text, title);
  }

  /**
   * Dynamic adaptive splitting strategy - Combine dynamic calculation and smart split points
   */
  private _adaptiveSplit(content: string, title: string): string[] {
    const targetChunkCount = Math.max(
      1,
      Math.floor(content.length / Chunker.TARGET_CHUNK_SIZE)
    );
    console.log(
      `Dynamic calculation: ${content.length} characters → ${targetChunkCount} chunks`
    );

    const chunks: string[] = [];
    let start = 0;

    for (
      let currentChunkNum = 1;
      currentChunkNum <= targetChunkCount;
      currentChunkNum++
    ) {
      if (currentChunkNum === targetChunkCount) {
        // Last chunk: include all remaining content
        const chunkContent = content.slice(start);
        if (chunkContent.trim()) {
          chunks.push(this._createChunkJson(title, chunkContent));
        }
        break;
      }

      // Dynamic calculation of target split position
      const remainingLength = content.length - start;
      const remainingChunks = targetChunkCount - currentChunkNum + 1;
      const dynamicSize = Math.floor(remainingLength / remainingChunks);
      const targetPos = start + dynamicSize;

      // Find best split point
      const splitPos = this._findBestSplit(content, targetPos);

      // Create chunk
      const chunkContent = content.slice(start, splitPos);
      chunks.push(this._createChunkJson(title, chunkContent));
      start = splitPos;
    }

    console.log(
      `Adaptive splitting completed: generated ${chunks.length} chunks (target: ${targetChunkCount})`
    );
    return chunks;
  }

  /**
   * Find best split point near target position by priority (matching Python implementation)
   */
  private _findBestSplit(content: string, targetPos: number): number {
    const searchStart = Math.max(0, targetPos - Chunker.SEARCH_RANGE);
    const searchEnd = Math.min(
      content.length,
      targetPos + Chunker.SEARCH_RANGE
    );
    const searchText = content.slice(searchStart, searchEnd);

    // Search by priority order, return first match found
    for (const [pattern, offset] of Chunker.SPLIT_PATTERNS) {
      const pos = searchText.lastIndexOf(pattern);
      if (pos !== -1) {
        return searchStart + pos + offset;
      }
    }

    // If no pattern found, return target position
    return targetPos;
  }

  /**
   * Create JSON format chunk with title and content
   */
  private _createChunkJson(title: string, content: string): string {
    return JSON.stringify(
      {
        title: title,
        content: content.trim(),
      },
      null,
      2
    );
  }
}
