# Apple RAG Collector - 架构文档

## 概述

Apple RAG Collector 是一个智能文档收集和处理系统，采用批处理模式从 Apple Developer 网站收集文档，进行内容处理、分块、向量化，并存储到 PostgreSQL 数据库中。

## 核心架构

### 主要组件

- **AppleDocCollector**: 核心协调器，管理整个批处理流程
- **PostgreSQLManager**: 数据库管理器，负责所有数据库操作
- **AppleAPIClient**: API 客户端，负责从 Apple 网站获取文档
- **ContentProcessor**: 内容处理器，提取和清理文档内容
- **Chunker**: 文本分块器，将长文档分割成小块
- **EmbeddingProvider**: 向量生成器，为文本块生成嵌入向量

## 完整逻辑链路

### 1. 主执行流程 (`execute()`)

```
execute()
├── getBatchRecords(batchSize) → 获取待处理记录
├── processBatch(records) → 处理批次
├── batchInsertUrls(extractedUrls) → 插入新发现的 URLs
└── 返回批次结果
```

**关键特点：**
- 按 `collect_count ASC, url ASC` 排序获取记录
- 确保优先处理较少被处理的记录
- 支持连续处理，无需担心记录耗尽

### 2. 批次处理流程 (`processBatch()`)

```
processBatch(records)
├── fetchDocuments(urls) → API 获取文档数据
├── createProcessingPlan(records, collectResults) → 创建处理计划
└── executeProcessingPlan(processingPlan) → 执行处理计划
```

### 3. 处理计划创建 (`createProcessingPlan()`)

**统一逻辑：**
```typescript
const hasChanged = this.config.forceUpdateAll || (oldRawJson !== newRawJson);
```

**三种记录类型：**
1. **错误记录**: `!collectResult.data` → `hasChanged: false, error: "..."`
2. **变化记录**: `hasChanged: true`
3. **未变化记录**: `hasChanged: false`

**Force Update 模式：**
- `forceUpdateAll = true`: 所有成功记录标记为已变化
- `forceUpdateAll = false`: 通过 JSON 比较确定是否变化

### 4. 处理计划执行 (`executeProcessingPlan()`)

#### 4.1 记录分类
```
processingPlan
├── changedRecords: hasChanged && !error
├── unchangedRecords: !hasChanged && !error
└── errorRecords: error
```

#### 4.2 内容处理（仅变化记录）
```
changedRecords → processDocuments() → generateChunksAndEmbeddings()
```

#### 4.3 智能字段更新策略

**变化记录 - 完整更新：**
```sql
UPDATE pages SET 
  raw_json = $2,
  title = $3, 
  content = $4,
  collect_count = $5,
  updated_at = $6
WHERE id = $1
```

**未变化/错误记录 - 仅更新计数：**
```sql
UPDATE pages SET 
  collect_count = CASE 
    WHEN id = $1 THEN $2::integer
    ...
  END
WHERE id = ANY($n)
```

## 数据库更新策略

### 智能字段更新的核心优势

1. **语义准确性**
   - `updated_at` 只在内容真正变化时更新
   - 保持时间戳的业务意义
   - 便于监控和分析

2. **性能优化**
   - 避免不必要的字段更新
   - 减少数据库写入开销
   - 保持索引效率

3. **数据一致性**
   - 所有记录都会更新 `collect_count`
   - 确保系统能够推进到下一批记录
   - 防止无限循环处理失败记录

### 更新方法对比

| 记录类型 | 更新方法 | 更新字段 | updated_at |
|---------|---------|---------|-----------|
| 内容变化 | `batchUpdateFullRecords` | raw_json, title, content, updated_at | ✅ 更新 |
| 内容未变化 | 无数据库操作 | collect_count 已在 getBatchRecords 中更新 | ❌ 保持不变 |
| 获取失败 | 无数据库操作 | collect_count 已在 getBatchRecords 中更新 | ❌ 保持不变 |

## 数据流图

```
[数据库记录] 
    ↓ getBatchRecords()
[待处理记录]
    ↓ fetchDocuments()
[API 响应结果]
    ↓ createProcessingPlan()
[处理计划]
    ↓ executeProcessingPlan()
    ├── [变化记录] → 内容处理 → 分块 → 向量化 → 存储 chunks → 完整更新 pages
    ├── [未变化记录] → 无数据库操作 (collect_count 已在 getBatchRecords 中更新)
    └── [错误记录] → 无数据库操作 (collect_count 已在 getBatchRecords 中更新)
```

## 关键设计决策

### 1. 统一处理架构
- 消除了 Force Update 和 Smart Update 的重复代码
- 通过简单的布尔逻辑实现模式切换
- 保持错误处理的一致性

### 2. 智能字段更新
- 区分内容更新和计数更新
- 保持时间戳的语义准确性
- 优化数据库性能

### 3. 防止无限循环
- 所有记录（包括失败记录）都会更新 collect_count
- 确保系统能够推进到下一批记录
- 避免重复处理相同的失败 URL

## 配置选项

### BatchConfig
- `batchSize`: 每批处理的记录数量
- `forceUpdateAll`: 是否强制更新所有记录
  - `true`: 跳过内容比较，处理所有记录
  - `false`: 进行内容比较，只处理变化的记录

## 性能特点

1. **批处理优化**: 减少数据库连接开销
2. **智能更新**: 避免不必要的字段更新
3. **向量化处理**: 批量生成嵌入向量
4. **事务安全**: 确保数据一致性
5. **错误恢复**: 失败记录不会阻塞系统推进

## 监控和日志

系统提供详细的日志输出，包括：
- 批次处理进度
- 内容变化统计
- 错误记录统计
- 性能指标（处理时间、生成的 chunks 数量）

这种架构设计确保了系统的可靠性、性能和可维护性。
