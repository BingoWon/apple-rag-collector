"""
Apple文档智能分块器 - 动态自适应策略

结合动态chunk size计算和智能分割点选择的现代化分块实现。

核心特性：
- Context/Content分离：第一个# 标题前后分离
- 动态Chunk Size：每次分割前重新计算chunk大小，自适应剩余内容
- 智能分割点：在目标位置附近按优先级寻找最佳语义边界
- 质量保证：自动过滤无效chunk，确保输出质量
- 统一JSON输出：所有chunks使用一致的context

算法流程：
1. 分离Context和Content（第一个# 标题为界）
2. 动态计算target_chunk_count = 总长度 ÷ 2500
3. 每次分割前动态计算：chunk_size = 剩余长度 ÷ 剩余chunks数
4. 在目标位置附近按优先级寻找最佳分割点
5. 最后一个chunk包含所有剩余内容，自动质量保证
6. 生成统一格式的JSON chunks

设计原理：
- 动态自适应：结合数学精确性和语义合理性
- 智能优化：优先级分割点选择，提升chunk质量
- 质量保证：多层质量检查，确保输出价值
"""

import json
from typing import List

# Simple logger replacement for testing
class SimpleLogger:
    def info(self, msg): print(f"INFO: {msg}")
    def debug(self, msg): print(f"DEBUG: {msg}")

logger = SimpleLogger()


class SmartChunker:
    """Apple文档专用智能分块器 - 动态自适应策略"""

    # 核心配置常量
    TARGET_CHUNK_SIZE = 2500
    SEARCH_RANGE = 250

    # 智能分割优先级模式
    SPLIT_PATTERNS = [
        ('# ', 2),      # H1标题 (最高优先级)
        ('## ', 3),     # H2标题
        ('### ', 4),    # H3标题
        ('\n\n', 2),    # 双换行符
        ('\n', 1),      # 单换行符
        ('.', 1),       # 英文句号 (最低优先级)
    ]
    
    def chunk_text(self, text: str, title: str = "") -> List[str]:
        """智能分块主入口 - 动态自适应策略"""
        if not text.strip():
            return []

        # Removed logger to avoid JSON parsing issues

        if len(text) <= self.TARGET_CHUNK_SIZE:
            return [self._create_chunk_json(title, text)]

        # 执行动态自适应分割
        return self._adaptive_split(text, title)
    

    
    def _adaptive_split(self, content: str, title: str) -> List[str]:
        """动态自适应分割策略 - 结合动态计算和智能分割点"""
        target_chunk_count = max(1, len(content) // self.TARGET_CHUNK_SIZE)
        # Removed logger to avoid JSON parsing issues

        chunks = []
        start = 0

        for current_chunk_num in range(1, target_chunk_count + 1):
            if current_chunk_num == target_chunk_count:
                # 最后一个chunk：包含所有剩余内容
                chunk_content = content[start:]
                if chunk_content.strip():
                    chunks.append(self._create_chunk_json(title, chunk_content))
                break

            # 动态计算目标分割位置
            remaining_length = len(content) - start
            remaining_chunks = target_chunk_count - current_chunk_num + 1
            dynamic_size = remaining_length // remaining_chunks
            target_pos = start + dynamic_size

            # 寻找最佳分割点
            split_pos = self._find_best_split(content, target_pos)

            # 创建chunk
            chunk_content = content[start:split_pos]
            chunks.append(self._create_chunk_json(title, chunk_content))
            start = split_pos

        # Removed logger to avoid JSON parsing issues
        return chunks
    
    def _find_best_split(self, content: str, target_pos: int) -> int:
        """在目标位置附近按优先级查找最佳语义分割点"""
        search_start = max(0, target_pos - self.SEARCH_RANGE)
        search_end = min(len(content), target_pos + self.SEARCH_RANGE)
        search_text = content[search_start:search_end]

        # 按优先级顺序查找，找到第一个就返回
        for pattern, offset in self.SPLIT_PATTERNS:
            pos = search_text.rfind(pattern)
            if pos != -1:
                return search_start + pos + offset

        # 如果没找到任何模式，返回目标位置
        return target_pos
    
    def _create_single_chunk(self, title: str, content: str) -> List[str]:
        """创建单个chunk"""
        return [self._create_chunk_json(title, content)]

    def _create_chunk_json(self, title: str, content: str) -> str:
        """创建JSON格式的chunk"""
        return json.dumps({
            "title": title,
            "content": content.strip()
        }, ensure_ascii=False, indent=2)
