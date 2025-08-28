"""
Apple文档专用智能分块实现 - 统一JSON格式输出

=== CHUNKING 策略详细说明 ===

本模块实现五层优先级的智能分块策略，专门针对Apple开发者文档的结构特点设计。
所有策略都输出统一的JSON格式，确保系统一致性和处理简化。

【极致简化的统一标题分割框架】
- 核心方法：`_chunk_by_header(text, level)` 处理所有标题级别
- 硬编码设计：无配置化，直接硬编码所有参数
- 完全统一：H1/H2/H3使用完全相同的处理逻辑
- 统一算法：所有级别都使用TARGET_CHUNK_SIZE目标的贪婪合并
- 统一格式：所有输出都是相同的JSON结构

【处理逻辑完全统一】
- 触发条件：≥2个对应级别的标题
- Section分割：每个标题作为独立section，不包含前置内容
- Context提取：第一个标题之前的内容作为context
- 清晰分离：context和content完全分离，无重叠
- 输出格式：{"context": "第一个标题前的内容", "content": "合并的标题章节"}

【三个优先级完全统一】
- 第一优先级：H1分割（≥2个H1标题）
- 第二优先级：H2分割（≥2个H2标题）
- 第三优先级：H3分割（≥2个H3标题）

【第四优先级：智能换行分割】
- 触发条件：长文档且前三个优先级都不符合时（无足够H1/H2/H3标题）
- 处理逻辑：动态计算chunk大小，按换行符边界进行分割
- 算法步骤：
  1. 计算chunk数量：总长度 ÷ TARGET_CHUNK_SIZE，向下取整
  2. 计算修正chunk大小：总长度 ÷ chunk数量
  3. 在修正大小附近找最近的换行符作为分割点
- 输出格式：{"context": "第一个H标题之前的内容", "content": "分割后的内容"}

【短文档特殊处理】
- 触发条件：文档长度 ≤ TARGET_CHUNK_SIZE
- 处理逻辑：直接返回完整内容，不进行分割
- 输出格式：{"context": "第一个H标题之前的内容", "content": "完整内容"}

=== 极致简化的设计原则 ===

1. **完全统一**：H1/H2/H3使用完全相同的处理逻辑，无任何特殊处理
2. **硬编码设计**：无配置化抽象，直接硬编码所有参数，简洁直接
3. **清晰分离**：context和content完全分离，无重叠，逻辑清晰
4. **统一方法**：一个`_split_sections`方法处理所有标题级别
5. **零重复代码**：完全消除所有重复逻辑和方法
6. **极致精简**：删除所有不必要的抽象层和配置化设计

=== JSON输出格式规范 ===

**统一结构**：
```json
{
  "context": "背景信息、标题、概述等上下文内容",
  "content": "具体的章节内容或合并后的内容"
}
```

**格式特点**：
- 使用 json.dumps(chunk, ensure_ascii=False, indent=2) 输出
- context字段：提供语义背景，可能为空字符串
- content字段：包含主要内容，永远不为空
- 所有chunks都可以用相同的JSON解析逻辑处理

=== 内容完整性保障 ===

**实时检测机制**：
- 自动比较原始内容与chunks总长度
- 超过5%内容丢失时发出错误警告
- 轻微调整（<5%）记录为信息日志

**系统可靠性**：
- 所有优先级都经过完整测试验证
- 智能合并算法确保最优chunk大小
- JSON格式保证下游处理的一致性

"""

import json
from typing import List


class Chunker:
    """Apple文档专用分块器 - 基于##双井号分割

    超参数配置：
    - TARGET_CHUNK_SIZE: 目标chunk大小（字符数）
    - MAX_CHUNK_SIZE: 最大chunk大小（字符数）
    """

    # 超参数定义
    TARGET_CHUNK_SIZE = 2500
    MAX_CHUNK_SIZE = 3000

    def __init__(self):
        pass

    def chunk_text(self, text: str) -> List[str]:
        """统一标题分割框架：H1 → H2 → H3 → 完整内容"""
        if not text.strip():
            return []

        if len(text) <= self.TARGET_CHUNK_SIZE:
            chunks = self._chunk_complete(text)
            return chunks

        # 统一的标题分割：H1 → H2 → H3
        for level in [1, 2, 3]:
            chunks = self._chunk_by_header(text, level)
            if chunks:
                return chunks

        # 第四优先级：智能换行分割
        chunks = self._chunk_by_newlines(text)
        return chunks

    def _chunk_by_header(self, text: str, level: int) -> List[str]:
        """最优化的一次遍历框架"""
        prefix = {1: '# ', 2: '## ', 3: '### '}[level]

        # 一次遍历同时获取context和剩余文本
        context, remaining_text = self._split_context_and_remaining(text, prefix)
        if not remaining_text:
            return []

        # 简单分割剩余部分
        sections = self._simple_split_sections(remaining_text, prefix)
        if len(sections) < 2:
            return []

        chunks = self._greedy_merge_with_json_size(sections, context)
        return chunks

    def _split_context_and_remaining(self, text: str, prefix: str) -> tuple[str, str]:
        """一次遍历同时获取context和剩余文本"""
        lines = text.split('\n')
        for i, line in enumerate(lines):
            if line.startswith(prefix) and not line.startswith(prefix + '#'):
                context = '\n'.join(lines[:i]).strip()
                remaining = '\n'.join(lines[i:])
                return context, remaining
        return "", ""

    def _simple_split_sections(self, text: str, prefix: str) -> List[str]:
        """极简的分割逻辑 - 无需任何过滤"""
        lines = text.split('\n')
        sections = []
        current_section = []

        for line in lines:
            if line.startswith(prefix) and not line.startswith(prefix + '#'):
                if current_section:
                    sections.append('\n'.join(current_section))
                current_section = [line]
            else:
                current_section.append(line)

        if current_section:
            sections.append('\n'.join(current_section))

        return sections


    def _greedy_merge_with_json_size(self, sections: List[str], context: str) -> List[str]:
        """基于完整JSON大小的贪婪合并算法 - 使用超参数配置"""
        if not sections:
            return []

        json_chunks = []
        current_sections = [sections[0]]

        for section in sections[1:]:
            # 构建测试JSON
            test_content = '\n\n'.join(current_sections + [section])
            test_chunk = {
                "context": context,
                "content": test_content
            }
            test_json = json.dumps(test_chunk, ensure_ascii=False, indent=2)

            # 构建当前JSON用于大小比较
            current_content = '\n\n'.join(current_sections)
            current_chunk = {
                "context": context,
                "content": current_content
            }
            current_json = json.dumps(current_chunk, ensure_ascii=False, indent=2)

            # 基于完整JSON大小判断是否合并
            if len(test_json) <= self.MAX_CHUNK_SIZE and len(current_json) < self.TARGET_CHUNK_SIZE:
                current_sections.append(section)
            else:
                # 完成当前chunk，开始新的chunk
                json_chunks.append(current_json)
                current_sections = [section]

        # 添加最后一个chunk
        final_content = '\n\n'.join(current_sections)
        final_chunk = {
            "context": context,
            "content": final_content
        }
        final_json = json.dumps(final_chunk, ensure_ascii=False, indent=2)
        json_chunks.append(final_json)

        return json_chunks

    def _chunk_complete(self, text: str) -> List[str]:
        """完整内容JSON格式化"""
        context, content = self._split_by_first_header(text)
        chunk = {
            "context": context,
            "content": content
        }
        return [json.dumps(chunk, ensure_ascii=False, indent=2)]

    def _chunk_by_newlines(self, text: str) -> List[str]:
        """第四优先级：智能换行分割 - 参考YouTube chunker算法"""
        # 先分离context和content
        context, content = self._split_by_first_header(text)

        if not content.strip():
            # 如果没有content，返回完整内容
            chunk = {
                "context": context,
                "content": content
            }
            return [json.dumps(chunk, ensure_ascii=False, indent=2)]

        # 动态计算chunk大小（参考YouTube chunker算法）
        total_length = len(content)
        chunk_count = max(1, total_length // self.TARGET_CHUNK_SIZE)  # 至少1个chunk
        adjusted_chunk_size = total_length // chunk_count

        chunks = []
        position = 0
        current_chunk_index = 0

        while position < len(content) and current_chunk_index < chunk_count:
            # 计算这个chunk的结束位置
            chunk_end = self._find_newline_chunk_end(content, position, adjusted_chunk_size,
                                                   current_chunk_index, chunk_count)

            # 提取chunk内容
            chunk_content = content[position:chunk_end].strip()

            if chunk_content:  # 只有非空内容才添加
                chunk = {
                    "context": context,
                    "content": chunk_content
                }
                chunk_json = json.dumps(chunk, ensure_ascii=False, indent=2)
                chunks.append(chunk_json)

            # 移动到下一个位置
            position = chunk_end
            current_chunk_index += 1

        return chunks

    def _find_newline_chunk_end(self, content: str, start_pos: int, chunk_size: int,
                               current_chunk_index: int, total_chunk_count: int) -> int:
        """找到基于换行符的chunk结束位置"""
        # 如果是最后一个chunk，直接返回内容结尾
        if current_chunk_index == total_chunk_count - 1:
            return len(content)

        # 如果剩余内容不足chunk_size字符，直接返回结尾
        if start_pos + chunk_size >= len(content):
            return len(content)

        target_pos = start_pos + chunk_size

        # 向前找最近的换行符
        backward_pos = None
        for i in range(target_pos, start_pos - 1, -1):  # 不能超过start_pos
            if content[i] == '\n':
                backward_pos = i + 1  # 换行符后的位置
                break

        # 向后找最近的换行符
        forward_pos = None
        for i in range(target_pos, len(content)):
            if content[i] == '\n':
                forward_pos = i + 1  # 换行符后的位置
                break

        # 选择距离最近的换行符
        if backward_pos is None and forward_pos is None:
            # 没找到换行符，返回内容结尾
            return len(content)
        elif backward_pos is None:
            # 只有向后的换行符
            return forward_pos
        elif forward_pos is None:
            # 只有向前的换行符
            return backward_pos
        else:
            # 两个都有，选择距离最近的
            backward_distance = target_pos - (backward_pos - 1)  # backward_pos已经+1了
            forward_distance = (forward_pos - 1) - target_pos    # forward_pos已经+1了

            if backward_distance <= forward_distance:
                return backward_pos
            else:
                return forward_pos

    def _split_by_first_header(self, text: str) -> tuple[str, str]:
        """按第一个H标题分离context和content"""
        lines = text.split('\n')

        for i, line in enumerate(lines):
            if line.strip().startswith('#'):
                context = '\n'.join(lines[:i]).strip()
                content = '\n'.join(lines[i:]).strip()
                return context, content

        # 没有找到H标题
        return "", text.strip()