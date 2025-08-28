/**
 * Apple文档专用智能分块实现 - 统一JSON格式输出
 * 
 * === CHUNKING 策略详细说明 ===
 * 
 * 本模块实现五层优先级的智能分块策略，专门针对Apple开发者文档的结构特点设计。
 * 所有策略都输出统一的JSON格式，确保系统一致性和处理简化。
 * 
 * 【极致简化的统一标题分割框架】
 * - 核心方法：`_chunkByHeader(text, level)` 处理所有标题级别
 * - 硬编码设计：无配置化，直接硬编码所有参数
 * - 完全统一：H1/H2/H3使用完全相同的处理逻辑
 * - 统一算法：所有级别都使用TARGET_CHUNK_SIZE目标的贪婪合并
 * - 统一格式：所有输出都是相同的JSON结构
 * 
 * 【处理逻辑完全统一】
 * - 触发条件：≥2个对应级别的标题
 * - Section分割：每个标题作为独立section，不包含前置内容
 * - Context提取：第一个标题之前的内容作为context
 * - 清晰分离：context和content完全分离，无重叠
 * - 输出格式：{"context": "第一个标题前的内容", "content": "合并的标题章节"}
 * 
 * 【三个优先级完全统一】
 * - 第一优先级：H1分割（≥2个H1标题）
 * - 第二优先级：H2分割（≥2个H2标题）
 * - 第三优先级：H3分割（≥2个H3标题）
 * 
 * 【第四优先级：智能换行分割】
 * - 触发条件：长文档且前三个优先级都不符合时（无足够H1/H2/H3标题）
 * - 处理逻辑：动态计算chunk大小，按换行符边界进行分割
 * - 算法步骤：
 *   1. 计算chunk数量：总长度 ÷ TARGET_CHUNK_SIZE，向下取整
 *   2. 计算修正chunk大小：总长度 ÷ chunk数量
 *   3. 在修正大小附近找最近的换行符作为分割点
 * - 输出格式：{"context": "第一个H标题之前的内容", "content": "分割后的内容"}
 * 
 * 【短文档特殊处理】
 * - 触发条件：文档长度 ≤ TARGET_CHUNK_SIZE
 * - 处理逻辑：直接返回完整内容，不进行分割
 * - 输出格式：{"context": "第一个H标题之前的内容", "content": "完整内容"}
 */

interface ChunkData {
  context: string;
  content: string;
}

export class Chunker {
  /**
   * Apple文档专用分块器 - 基于##双井号分割
   * 
   * 超参数配置：
   * - TARGET_CHUNK_SIZE: 目标chunk大小（字符数）
   * - MAX_CHUNK_SIZE: 最大chunk大小（字符数）
   */
  
  // 超参数定义
  private static readonly TARGET_CHUNK_SIZE = 2500;
  private static readonly MAX_CHUNK_SIZE = 3000;

  constructor() {}

  /**
   * 统一标题分割框架：H1 → H2 → H3 → 完整内容
   */
  public chunkText(text: string): string[] {
    console.log(`开始分块，文档长度: ${text.length} 字符，前100字符: ${text.slice(0, 100)}`);

    if (!text.trim()) {
      return [];
    }

    if (text.length <= Chunker.TARGET_CHUNK_SIZE) {
      console.log(`文本长度小于${Chunker.TARGET_CHUNK_SIZE}字符，直接返回完整内容`);
      const chunks = this._chunkComplete(text);
      return chunks;
    }

    // 统一的标题分割：H1 → H2 → H3
    for (const level of [1, 2, 3]) {
      const chunks = this._chunkByHeader(text, level);
      if (chunks.length > 0) {
        return chunks;
      }
    }

    // 第四优先级：智能换行分割
    console.log("使用第四优先级：智能换行分割");
    const chunks = this._chunkByNewlines(text);
    return chunks;
  }

  /**
   * 最优化的一次遍历框架
   */
  private _chunkByHeader(text: string, level: number): string[] {
    const prefixMap: Record<number, string> = { 1: '# ', 2: '## ', 3: '### ' };
    const prefix = prefixMap[level];

    if (!prefix) {
      return [];
    }

    // 一次遍历同时获取context和剩余文本
    const [context, remainingText] = this._splitContextAndRemaining(text, prefix);
    if (!remainingText) {
      return [];
    }

    // 简单分割剩余部分
    const sections = this._simpleSplitSections(remainingText, prefix);
    if (sections.length < 2) {
      return [];
    }

    console.log(`检测到${sections.length}个H${level}标题，开始H${level}分割`);
    const chunks = this._greedyMergeWithJsonSize(sections, context);
    console.log(`H${level}分块完成: ${chunks.length} chunks`);
    return chunks;
  }

  /**
   * 一次遍历同时获取context和剩余文本
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
   * 极简的分割逻辑 - 无需任何过滤
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
   * 基于完整JSON大小的贪婪合并算法 - 使用超参数配置
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

      // 基于完整JSON大小判断是否合并
      if (testJson.length <= Chunker.MAX_CHUNK_SIZE && currentJson.length < Chunker.TARGET_CHUNK_SIZE) {
        currentSections.push(section);
      } else {
        // 完成当前chunk，开始新的chunk
        jsonChunks.push(currentJson);
        currentSections = [section];
      }
    }

    // 添加最后一个chunk
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
   * 完整内容JSON格式化
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
   * 第四优先级：智能换行分割 - 参考YouTube chunker算法
   */
  private _chunkByNewlines(text: string): string[] {
    // 先分离context和content
    const [context, content] = this._splitByFirstHeader(text);

    if (!content.trim()) {
      // 如果没有content，返回完整内容
      const chunk: ChunkData = {
        context: context,
        content: content
      };
      return [JSON.stringify(chunk, null, 2)];
    }

    // 动态计算chunk大小（参考YouTube chunker算法）
    const totalLength = content.length;
    const chunkCount = Math.max(1, Math.floor(totalLength / Chunker.TARGET_CHUNK_SIZE)); // 至少1个chunk
    const adjustedChunkSize = Math.floor(totalLength / chunkCount);

    console.log(`智能换行分割: 总长度=${totalLength}, chunk数量=${chunkCount}, 调整后chunk大小=${adjustedChunkSize}`);

    const chunks: string[] = [];
    let position = 0;
    let currentChunkIndex = 0;

    while (position < content.length && currentChunkIndex < chunkCount) {
      // 计算这个chunk的结束位置
      const chunkEnd = this._findNewlineChunkEnd(content, position, adjustedChunkSize, currentChunkIndex, chunkCount);

      // 提取chunk内容
      const chunkContent = content.slice(position, chunkEnd).trim();

      if (chunkContent) { // 只有非空内容才添加
        const chunk: ChunkData = {
          context: context,
          content: chunkContent
        };
        const chunkJson = JSON.stringify(chunk, null, 2);
        chunks.push(chunkJson);
      }

      // 移动到下一个位置
      position = chunkEnd;
      currentChunkIndex++;
    }

    return chunks;
  }

  /**
   * 找到基于换行符的chunk结束位置
   */
  private _findNewlineChunkEnd(content: string, startPos: number, chunkSize: number, currentChunkIndex: number, totalChunkCount: number): number {
    // 如果是最后一个chunk，直接返回内容结尾
    if (currentChunkIndex === totalChunkCount - 1) {
      return content.length;
    }

    // 如果剩余内容不足chunkSize字符，直接返回结尾
    if (startPos + chunkSize >= content.length) {
      return content.length;
    }

    const targetPos = startPos + chunkSize;

    // 向前找最近的换行符
    let backwardPos: number | null = null;
    for (let i = targetPos; i > startPos; i--) { // 不能超过startPos
      if (content[i] === '\n') {
        backwardPos = i + 1; // 换行符后的位置
        break;
      }
    }

    // 向后找最近的换行符
    let forwardPos: number | null = null;
    for (let i = targetPos; i < content.length; i++) {
      if (content[i] === '\n') {
        forwardPos = i + 1; // 换行符后的位置
        break;
      }
    }

    // 选择距离最近的换行符
    if (backwardPos === null && forwardPos === null) {
      // 没找到换行符，返回内容结尾
      return content.length;
    } else if (backwardPos === null) {
      // 只有向后的换行符
      return forwardPos!;
    } else if (forwardPos === null) {
      // 只有向前的换行符
      return backwardPos;
    } else {
      // 两个都有，选择距离最近的
      const backwardDistance = targetPos - (backwardPos - 1); // backwardPos已经+1了
      const forwardDistance = (forwardPos - 1) - targetPos;    // forwardPos已经+1了

      if (backwardDistance <= forwardDistance) {
        return backwardPos;
      } else {
        return forwardPos;
      }
    }
  }

  /**
   * 按第一个H标题分离context和content
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

    // 没有找到H标题
    return ["", text.trim()];
  }
}
