/**
 * Apple Documentation Intelligent Chunking Implementation - Unified JSON Output
 *
 * === CHUNKING STRATEGY OVERVIEW ===
 *
 * This module implements a five-tier priority intelligent chunking strategy specifically designed
 * for Apple Developer Documentation structure characteristics. All strategies output unified JSON
 * format to ensure system consistency and processing simplification.
 *
 * 【Unified Header-Based Splitting Framework】
 * - Core method: `_chunkByHeader(text, level)` handles all header levels
 * - Hardcoded design: No configuration, all parameters directly hardcoded
 * - Complete unification: H1/H2/H3 use identical processing logic
 * - Unified algorithm: All levels use TARGET_CHUNK_SIZE target greedy merging
 * - Unified format: All outputs use the same JSON structure
 *
 * 【Completely Unified Processing Logic】
 * - Trigger condition: ≥2 headers of corresponding level
 * - Section splitting: Each header as independent section, excluding preceding content
 * - Context extraction: Content before first header as context
 * - Clear separation: Context and content completely separated, no overlap
 * - Output format: {"context": "content before first header", "content": "merged header sections"}
 *
 * 【Three Priority Levels Completely Unified】
 * - First priority: H1 splitting (≥2 H1 headers)
 * - Second priority: H2 splitting (≥2 H2 headers)
 * - Third priority: H3 splitting (≥2 H3 headers)
 *
 * 【Fourth Priority: Smart Newline Splitting】
 * - Trigger condition: Long documents when first three priorities don't qualify
 * - Processing logic: Dynamic chunk size calculation, split by newline boundaries
 * - Algorithm steps:
 *   1. Calculate chunk count: total length ÷ TARGET_CHUNK_SIZE, floor
 *   2. Calculate adjusted chunk size: total length ÷ chunk count
 *   3. Find nearest newline around adjusted size as split point
 * - Output format: {"context": "content before first H header", "content": "split content"}
 *
 * 【Short Document Special Handling】
 * - Trigger condition: Document length ≤ TARGET_CHUNK_SIZE
 * - Processing logic: Return complete content directly, no splitting
 * - Output format: {"context": "content before first H header", "content": "complete content"}
 */

import { type BatchConfig, type BatchResult } from './types/index.js';
import { BatchErrorHandler } from './utils/batch-error-handler.js';

interface ChunkData {
  context: string;
  content: string;
}

export class Chunker {
  /**
   * Apple Documentation Specialized Chunker - Header-based splitting
   *
   * Hyperparameter configuration:
   * - TARGET_CHUNK_SIZE: Target chunk size (character count)
   * - MAX_CHUNK_SIZE: Maximum chunk size (character count)
   */

  // Hyperparameter definitions
  private static readonly TARGET_CHUNK_SIZE = 2500;
  private static readonly MAX_CHUNK_SIZE = 3000;

  constructor(private readonly config: BatchConfig) {}

  /**
   * Unified header splitting framework: H1 → H2 → H3 → Complete content
   */
  chunkTexts(contentResults: Array<{ url: string; content: string }>): BatchResult<string[]>[] {
    const results: BatchResult<string[]>[] = [];

    for (let i = 0; i < contentResults.length; i += this.config.batchSize) {
      const batch = contentResults.slice(i, i + this.config.batchSize);
      const batchResults = batch.map(item => this.chunkSingleText(item));
      results.push(...batchResults);
    }

    return results;
  }

  private chunkSingleText(item: { url: string; content: string }): BatchResult<string[]> {
    try {
      const chunks = this.performChunking(item.content);
      return BatchErrorHandler.success(item.url, chunks);
    } catch (error) {
      return BatchErrorHandler.failure(item.url, error);
    }
  }

  private performChunking(text: string): string[] {
    if (!text.trim()) {
      return [];
    }

    if (text.length <= Chunker.TARGET_CHUNK_SIZE) {
      return this._chunkComplete(text);
    }

    // Unified header splitting: H1 → H2 → H3
    for (const level of [1, 2, 3]) {
      const chunks = this._chunkByHeader(text, level);
      if (chunks.length > 0) {
        return chunks;
      }
    }

    // Fourth priority: Smart newline splitting
    return this._chunkByNewlines(text);
  }

  /**
   * Optimized single-pass framework
   */
  private _chunkByHeader(text: string, level: number): string[] {
    const prefixMap: Record<number, string> = { 1: '# ', 2: '## ', 3: '### ' };
    const prefix = prefixMap[level];

    if (!prefix) {
      return [];
    }

    // Single pass to get both context and remaining text
    const [context, remainingText] = this._splitContextAndRemaining(text, prefix);
    if (!remainingText) {
      return [];
    }

    // Simple split of remaining sections
    const sections = this._simpleSplitSections(remainingText, prefix);
    if (sections.length < 2) {
      return [];
    }

    console.log(`Detected ${sections.length} H${level} headers, starting H${level} splitting`);
    const chunks = this._greedyMergeWithJsonSize(sections, context);
    console.log(`H${level} chunking completed: ${chunks.length} chunks`);
    return chunks;
  }

  /**
   * Single pass to get both context and remaining text
   */
  private _splitContextAndRemaining(text: string, prefix: string): [string, string] {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line && line.startsWith(prefix) && !line.startsWith(prefix + '#')) {
        const context = lines.slice(0, i).join('\n').trim();
        const remaining = lines.slice(i).join('\n');
        return [context, remaining];
      }
    }
    return ["", ""];
  }

  /**
   * Minimal splitting logic - no filtering needed
   */
  private _simpleSplitSections(text: string, prefix: string): string[] {
    const lines = text.split('\n');
    const sections: string[] = [];
    let currentSection: string[] = [];

    for (const line of lines) {
      if (line.startsWith(prefix) && !line.startsWith(prefix + '#')) {
        if (currentSection.length > 0) {
          sections.push(currentSection.join('\n'));
        }
        currentSection = [line];
      } else {
        currentSection.push(line);
      }
    }

    if (currentSection.length > 0) {
      sections.push(currentSection.join('\n'));
    }

    return sections;
  }

  /**
   * Greedy merging algorithm based on complete JSON size - using hyperparameter configuration
   */
  private _greedyMergeWithJsonSize(sections: string[], context: string): string[] {
    if (sections.length === 0) {
      return [];
    }

    const jsonChunks: string[] = [];
    let currentSections = [sections[0]];

    for (let i = 1; i < sections.length; i++) {
      const section = sections[i];
      
      // 构建测试JSON
      const testContent = currentSections.concat([section]).join('\n\n');
      const testChunk: ChunkData = {
        context: context,
        content: testContent
      };
      const testJson = JSON.stringify(testChunk, null, 2);

      // 构建当前JSON用于大小比较
      const currentContent = currentSections.join('\n\n');
      const currentChunk: ChunkData = {
        context: context,
        content: currentContent
      };
      const currentJson = JSON.stringify(currentChunk, null, 2);

      // Judge whether to merge based on complete JSON size
      if (testJson.length <= Chunker.MAX_CHUNK_SIZE && currentJson.length < Chunker.TARGET_CHUNK_SIZE) {
        currentSections.push(section);
      } else {
        // Complete current chunk, start new chunk
        jsonChunks.push(currentJson);
        currentSections = [section];
      }
    }

    // Add the last chunk
    const finalContent = currentSections.join('\n\n');
    const finalChunk: ChunkData = {
      context: context,
      content: finalContent
    };
    const finalJson = JSON.stringify(finalChunk, null, 2);
    jsonChunks.push(finalJson);

    return jsonChunks;
  }

  /**
   * Complete content JSON formatting
   */
  private _chunkComplete(text: string): string[] {
    const [context, content] = this._splitByFirstHeader(text);
    const chunk: ChunkData = {
      context: context,
      content: content
    };
    return [JSON.stringify(chunk, null, 2)];
  }

  /**
   * Fourth priority: Smart newline splitting - inspired by YouTube chunker algorithm
   */
  private _chunkByNewlines(text: string): string[] {
    // First separate context and content
    const [context, content] = this._splitByFirstHeader(text);

    if (!content.trim()) {
      // If no content, return complete content
      const chunk: ChunkData = {
        context: context,
        content: content
      };
      return [JSON.stringify(chunk, null, 2)];
    }

    // Dynamic chunk size calculation (inspired by YouTube chunker algorithm)
    const totalLength = content.length;
    const chunkCount = Math.max(1, Math.floor(totalLength / Chunker.TARGET_CHUNK_SIZE)); // At least 1 chunk
    const adjustedChunkSize = Math.floor(totalLength / chunkCount);

    console.log(`Smart newline splitting: total length=${totalLength}, chunk count=${chunkCount}, adjusted chunk size=${adjustedChunkSize}`);

    const chunks: string[] = [];
    let position = 0;
    let currentChunkIndex = 0;

    while (position < content.length && currentChunkIndex < chunkCount) {
      // Calculate end position for this chunk
      const chunkEnd = this._findNewlineChunkEnd(content, position, adjustedChunkSize, currentChunkIndex, chunkCount);

      // Extract chunk content
      const chunkContent = content.slice(position, chunkEnd).trim();

      if (chunkContent) { // Only add non-empty content
        const chunk: ChunkData = {
          context: context,
          content: chunkContent
        };
        const chunkJson = JSON.stringify(chunk, null, 2);
        chunks.push(chunkJson);
      }

      // Move to next position
      position = chunkEnd;
      currentChunkIndex++;
    }

    return chunks;
  }

  /**
   * Find newline-based chunk end position
   */
  private _findNewlineChunkEnd(content: string, startPos: number, chunkSize: number, currentChunkIndex: number, totalChunkCount: number): number {
    // If last chunk, return content end directly
    if (currentChunkIndex === totalChunkCount - 1) {
      return content.length;
    }

    // If remaining content less than chunkSize characters, return end directly
    if (startPos + chunkSize >= content.length) {
      return content.length;
    }

    const targetPos = startPos + chunkSize;

    // Search backward for nearest newline
    let backwardPos: number | null = null;
    for (let i = targetPos; i > startPos; i--) { // Cannot exceed startPos
      if (content[i] === '\n') {
        backwardPos = i + 1; // Position after newline
        break;
      }
    }

    // Search forward for nearest newline
    let forwardPos: number | null = null;
    for (let i = targetPos; i < content.length; i++) {
      if (content[i] === '\n') {
        forwardPos = i + 1; // Position after newline
        break;
      }
    }

    // Choose nearest newline
    if (backwardPos === null && forwardPos === null) {
      // No newline found, return content end
      return content.length;
    } else if (backwardPos === null) {
      // Only forward newline
      return forwardPos!;
    } else if (forwardPos === null) {
      // Only backward newline
      return backwardPos;
    } else {
      // Both exist, choose nearest
      const backwardDistance = targetPos - (backwardPos - 1); // backwardPos already +1
      const forwardDistance = (forwardPos - 1) - targetPos;    // forwardPos already +1

      if (backwardDistance <= forwardDistance) {
        return backwardPos;
      } else {
        return forwardPos;
      }
    }
  }

  /**
   * Split context and content by first H header
   */
  private _splitByFirstHeader(text: string): [string, string] {
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line && line.trim().startsWith('#')) {
        const context = lines.slice(0, i).join('\n').trim();
        const content = lines.slice(i).join('\n').trim();
        return [context, content];
      }
    }

    // No H header found
    return ["", text.trim()];
  }
}
