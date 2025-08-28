# Apple RAG Collector

**Modern Node.js Apple Developer Documentation Content Collector for RAG applications**

A production-ready system that continuously processes Apple Developer Documentation content, converting it into structured markdown format optimized for Retrieval-Augmented Generation (RAG) applications. Runs as a persistent Node.js process with PostgreSQL database backend.

> **🚀 Node.js + PostgreSQL**: This project runs as a long-running Node.js process with PostgreSQL database, managed by PM2 for production deployment.

## 🌟 Key Features

- **🔄 Continuous Processing**: Persistent Node.js process with configurable batch processing
- **📊 Structured Logging**: JSON-based logging with configurable levels (debug, info, warn, error)
- **🛡️ Robust Error Handling**: Permanent error detection with automatic URL cleanup
- **⚡ High Performance**: Batch processing with permanent error detection and connection pooling
- **📈 Production Ready**: PM2 process management with auto-restart and monitoring
- **🎯 Environment Configuration**: Flexible .env-based configuration for all settings
- **💾 PostgreSQL Storage**: Unlimited storage with JSONB support and advanced indexing
- **🔍 Content Processing**: Advanced HTML parsing and markdown conversion
- **🌐 URL Discovery**: Automatic extraction and queuing of referenced documentation
- **📋 Comprehensive Monitoring**: Built-in statistics view and health monitoring

## 🎯 System Status

**Current State**: Ready for PostgreSQL-based continuous processing
**Processing Mode**: Long-running Node.js process with configurable batching
**Architecture**: Node.js + PostgreSQL + PM2 process management

## 🏗️ System Architecture

### Data Flow Architecture
```
PostgreSQL Database ──▶ Node.js Process ──▶ PostgreSQL Database
        ↑                       ↑                         ↑
   URL 批量获取              Apple API调用            结构化数据存储
   Batch SELECT            JSON解析+清洗           JSONB+Indexes
```

### Core Components
```
src/
├── index.ts                    # Main entry point with environment-aware configuration
├── AppleDocCollector.ts        # Core processing logic with unlimited capabilities
├── AppleAPIClient.ts           # Apple API client for JSON data fetching
├── ContentProcessor.ts         # Content processing and markdown conversion
├── PostgreSQLManager.ts        # PostgreSQL operations with auto-initialization
├── types/index.ts              # TypeScript type definitions
└── utils/logger.ts             # Modern structured logging system

Configuration/
├── .env                        # Development environment configuration
├── .env.production             # Production environment configuration
├── .env.example                # Configuration template
├── ecosystem.config.js         # PM2 process management configuration
└── scripts/start.sh            # Production startup script

tests/
└── test-collector.js           # Content processing validation
└── output/                     # Test output directory
```

## 🛠️ Tech Stack

- **Runtime**: Node.js 18+ (persistent long-running process)
- **Language**: TypeScript (modern, type-safe)
- **Package Manager**: pnpm (fast, disk space efficient package manager)
- **Database**: PostgreSQL (production-grade with JSONB support)
- **Process Manager**: PM2 (production process management)
- **HTTP Client**: node-fetch (Apple API calls)
- **Content Processing**: cheerio (HTML parsing and content extraction)
- **Architecture**: Environment-configurable, production-ready system

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL database
- PM2 (for production deployment)

### Installation & Setup

1. **Clone and Install**
```bash
git clone <repository-url>
cd apple-rag-collector
pnpm install
```

2. **Configure Environment**
```bash
# Development: Copy template and configure
cp .env.example .env
# Edit .env with your development database settings

# Production: Use the production config
# The .env.production file contains production settings
# When deploying, rename it to .env:
# mv .env.production .env
```

3. **Build and Start**
```bash
# Development
pnpm run build
pnpm run pm2:start

# Production (after renaming .env.production to .env)
pnpm run build
pnpm run pm2:start
```

The application will automatically:
- Create database tables and indexes if they don't exist
- Start continuous processing
- Handle graceful shutdowns

### Environment Configuration

The application supports two environments with identical variable names:

**Development (.env)**
- Uses local PostgreSQL database
- Debug logging enabled
- Slower processing for development

**Production (.env.production)**
- Uses production PostgreSQL database
- Info logging level
- Optimized processing speed

## 📊 Monitoring

Use PM2 commands to monitor the application:

```bash
# View real-time logs
pnpm run pm2:logs

# Check application status
pm2 status apple-rag-collector

# View detailed process info
pm2 show apple-rag-collector

# Restart application
pnpm run pm2:restart

# Stop application
pnpm run pm2:stop
```

**Database Statistics**
The application automatically creates a `apple_docs_stats` view for monitoring:
```sql
SELECT * FROM apple_docs_stats;
```

**Log Output Example**
```json
{
  "timestamp": "2025-08-28T10:30:15.123Z",
  "level": "INFO",
  "message": "Batch completed",
  "data": {
    "recordsProcessed": 50,
    "batchDurationMs": 12500,
    "avgTimePerRecordMs": 250,
    "successfulRecords": 48,
    "failedRecords": 2,
    "extractedUrls": 156
  }
}
```

## 🔄 Core Processing Logic

### 1. Automatic Database Initialization
**On Startup**:
```sql
-- Auto-create tables, indexes, and views
CREATE TABLE IF NOT EXISTS apple_docs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_url TEXT NOT NULL UNIQUE,
  raw_json JSONB,
  title TEXT,
  content TEXT,
  collect_count INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  updated_at BIGINT
);
```

### 2. Continuous Processing Engine
**Processing Cycle**:
```typescript
while (true) {
  const records = await dbManager.getRecordsForCollection(batchSize);
  if (records.length === 0) {
    logger.info('No records to process, waiting...');
    await delay(processingDelayMs);
    continue;
  }

  const { records: processed, extractedUrls } = await collectDocuments(records);

  if (processed.length > 0) {
    await dbManager.batchInsert(processed);
  }

  if (extractedUrls.length > 0) {
    await dbManager.addNewUrls(extractedUrls);
  }

  await delay(processingDelayMs);
}
```

**Key Features**:
- **Configurable Batch Size**: Environment-controlled processing batches
- **Smart Prioritization**: URLs with lower collect_count processed first
- **Rate Limiting**: Configurable delays between API calls and batches
- **Unlimited Processing**: No time or API call limits
- **PostgreSQL Storage**: JSONB support with unlimited size
- **Graceful Shutdown**: Proper signal handling for clean exits

### 3. Data Integrity & Reliability
**Robust Data Protection**:
- **Database Constraints**: PostgreSQL UNIQUE constraints on source_url prevent duplicates
- **Transaction Safety**: PostgreSQL transactions ensure complete data consistency
- **Smart Prioritization**: collect_count ensures fair processing of all URLs
- **Error Isolation**: Single URL failures don't affect entire batch
- **Connection Pooling**: Efficient database connection management

**Production-Ready Design**:
- **No Time Limits**: Continuous processing without artificial restrictions
- **PM2 Management**: Automatic restart and process monitoring
- **Graceful Shutdown**: Proper signal handling for clean exits
- **Zero Data Loss**: ACID transactions guarantee data integrity
- **Scalable Architecture**: PostgreSQL supports unlimited growth
- **Environment Flexibility**: Seamless development to production deployment

## 📊 Apple Documentation JSON Structure

This section explains the JSON data structure returned by Apple's documentation API and how our system processes it.

### API Endpoint Pattern

Apple's documentation JSON API follows this pattern:
```
https://developer.apple.com/tutorials/data{original_path}.json
```

**Examples:**
- `https://developer.apple.com/documentation/visionos/` → `https://developer.apple.com/tutorials/data/documentation/visionos.json`
- `https://developer.apple.com/documentation/watchos-release-notes/watchos-26-release-notes/` → `https://developer.apple.com/tutorials/data/documentation/watchos-release-notes/watchos-26-release-notes.json`
- `https://developer.apple.com/design/human-interface-guidelines/designing-for-ios` → `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/designing-for-ios.json`

### JSON Structure Overview

The returned JSON contains several main sections:

```json
{
  "metadata": { ... },
  "abstract": [ ... ],
  "primaryContentSections": [ ... ],
  "topicSections": [ ... ],
  "references": { ... },
  "seeAlsoSections": [ ... ],
  "relationshipsSections": [ ... ]
}
```

### Field Usage Analysis

#### ✅ **Used Fields**

**1. `metadata` (Object)**
- **Purpose**: Contains document metadata and platform information
- **Usage**: Extract `title` for document title, `platforms` for version info
- **Example**:
```json
{
  "title": "visionOS",
  "platforms": [
    {
      "name": "visionOS",
      "introducedAt": "1.0",
      "beta": false
    }
  ]
}
```
- **Output**: Used in `title.txt` as main title and platform version

**2. `abstract` (Array)**
- **Purpose**: Brief description of the document
- **Usage**: Extract `text` from each item for document summary
- **Example**:
```json
[
  {
    "type": "text",
    "text": "Create a new universe of apps and games for Apple Vision Pro."
  }
]
```
- **Output**: Used in `title.txt` as document description

**3. `primaryContentSections` (Array)**
- **Purpose**: Main content sections of the document
- **Usage**: Convert to markdown for detailed content
- **Structure**: Contains `kind`, `content` with nested inline elements
- **Output**: Used in `content.md` as main document content

**4. `references` (Object)**
- **Purpose**: Dictionary of all referenced documents and resources
- **Usage**: Extract URLs for related documentation
- **Key Pattern**: `doc://...` identifiers or direct URLs
- **Filtering**: Only include URLs starting with `/documentation` or `/design`
- **Output**: Used in `urls.txt` for related links

**5. `topicSections` (Array) - *Framework pages only*
- **Purpose**: Organized topics and their related documents
- **Usage**: Extract `identifiers` to find related documentation
- **Note**: Not present in specific document pages (e.g., release notes)
- **Output**: Contributes to `urls.txt` via reference lookup

#### ❌ **Ignored Fields**

**1. `seeAlsoSections` (Array)**
- **Reason**: Redundant with information already in `references`
- **Content**: Additional related links that are typically covered by other sections

**2. `relationshipsSections` (Array)**
- **Reason**: Complex relationship data not needed for basic content extraction
- **Content**: Inheritance, conformance, and other API relationships

**3. `schemaVersion` (String)**
- **Reason**: Internal versioning not relevant for content processing
- **Content**: API schema version identifier

**4. `identifier` (String)**
- **Reason**: Internal document identifier not needed for output
- **Content**: Unique document identifier in Apple's system

**5. `kind` (String) - *Document level*
- **Reason**: Document type classification not used in current processing
- **Content**: Values like "article", "symbol", "technology"

**6. `role` (String)**
- **Reason**: Document role classification not used
- **Content**: Values like "collection", "article", "symbol"

### Page Type Differences

#### Framework Overview Pages
- **Has `topicSections`**: ✅ Contains organized topic categories
- **Content Depth**: Moderate - overview and topic organization
- **URL Count**: High - many related documents
- **Example**: `visionos.json` (68 URLs, organized topics)

#### Specific Document Pages
- **Has `topicSections`**: ❌ No topic organization
- **Content Depth**: High - detailed specific content
- **URL Count**: Low - fewer related documents
- **Example**: `watchos-26-release-notes.json` (6 URLs, detailed release notes)

### Content Processing Strategy

1. **Title Generation**: `metadata.title` + `abstract.text` + `platforms` info
2. **URL Extraction**: `topicSections.identifiers` + `references` (filtered)
3. **Content Generation**: `primaryContentSections` converted to markdown
4. **Media Handling**: Images and videos with abstracts become `[Image: description]` or `[Video: description]`

## 🗄️ Database Architecture

### PostgreSQL Database
**Architecture**: High-performance PostgreSQL with optimized batch processing
**Processing**: Real-time URL discovery with intelligent priority system

### Core Table

**Apple Documentation**: `apple_docs`
```sql
CREATE TABLE apple_docs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_url TEXT NOT NULL UNIQUE,              -- Original Apple URL
  raw_json JSONB,                               -- Apple API JSON (structured)
  title TEXT,                                   -- Extracted document title
  content TEXT,                                 -- Processed markdown content
  collect_count INTEGER NOT NULL DEFAULT 0,     -- Processing priority counter
  created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  updated_at BIGINT                             -- Last processing timestamp
);
```

### Optimized Indexing
```sql
-- Performance-critical indexes
CREATE INDEX idx_apple_docs_collect_count_url ON apple_docs(collect_count, source_url);
CREATE INDEX idx_apple_docs_updated_at ON apple_docs(updated_at);
CREATE INDEX idx_apple_docs_raw_json ON apple_docs USING GIN (raw_json);
```

### Processing Logic
```sql
-- Intelligent batch record selection
SELECT * FROM apple_docs
WHERE updated_at IS NULL
ORDER BY collect_count ASC, source_url ASC
LIMIT 25;
```

**Key Features:**
- **Smart Processing**: `updated_at IS NULL` identifies unprocessed records
- **Priority System**: Lower `collect_count` = higher priority
- **Automatic URL Discovery**: Extracted URLs automatically added as new records
- **JSONB Storage**: Structured JSON with GIN indexing for fast queries
- **Batch Operations**: True PostgreSQL batch inserts for maximum performance
- **Real-time Updates**: `updated_at` set to current timestamp on successful processing
- `idx_apple_docs_title` - Title search optimization

## ⚠️ Important: pnpm Only

**This project exclusively uses pnpm as the package manager. npm is strictly prohibited.**

- ✅ Use `pnpm install` instead of `npm install`
- ✅ Use `pnpm run` instead of `npm run`
- ✅ Use `pnpm add` instead of `npm install package`
- ❌ Never use npm commands in this project

## 📦 Installation and Setup

### 1. Install Dependencies
**MANDATORY: Use pnpm only. npm is strictly prohibited.**
```bash
pnpm install
```

### 2. Database Setup

**PostgreSQL Database Configuration**

Set up your PostgreSQL database connection in the environment files:

```bash
# Database connection settings
DB_HOST=localhost
DB_PORT=5432
DB_NAME=apple_rag_collector
DB_USER=your_username
DB_PASSWORD=your_password
DB_SSL=false
```

**Database Initialization:**
- Tables and indexes are automatically created on first run
- No manual schema setup required
- Supports both local development and production databases

### 3. Application Configuration

**Environment Variables:**
```bash
# Application Settings
LOG_LEVEL=info
BATCH_SIZE=25

# Database Connection
DB_HOST=localhost
DB_PORT=5432
DB_NAME=apple_rag_collector
DB_USER=postgres
DB_PASSWORD=your_password
DB_SSL=false
```

**Configuration Features:**
- ✅ Configurable batch size for optimal performance
- ✅ Intelligent error handling with permanent error detection
- ✅ Flexible database connection settings
- ✅ Environment-specific configurations (dev/prod)

### 4. Development and Deployment
```bash
# Build project
pnpm run build

# Start development server
pnpm run dev

# Run in production
pnpm start

# Format code
pnpm run fmt
```

## 🚀 Processing System

### Intelligent Continuous Processing Architecture
High-performance batch processing system that continuously re-processes all records to ensure data stays up-to-date.

**Processing Mode**: Continuous processing while data exists
**Batch Size**: Configurable (default: 25 records per batch)
**Exit Strategy**: Graceful exit when no more data to process

### Processing Flow
```
CONTINUOUS LOOP (while data exists):
AppleDocCollector.execute()
    ↓
PostgreSQL Batch Record Retrieval (by collect_count ASC)
    ↓
Check if records found
    ↓
IF NO RECORDS: Exit gracefully
    ↓
IF RECORDS FOUND: Process batch
    ↓
Apple API Data Fetching (with real browser User-Agent)
    ↓
Content Processing & Markdown Conversion
    ↓
PostgreSQL Batch Insert with URL Discovery
    ↓
Increment collect_count & updated_at
    ↓
CONTINUE TO NEXT BATCH (while data exists)
    ↓
Re-process records with lowest collect_count
    ↓
REPEAT until no more data, then exit
```

**🔄 WHY CONTINUOUS PROCESSING?**
- **Data Freshness**: Apple documentation changes frequently
- **Content Updates**: Re-collecting ensures latest content
- **New URL Discovery**: Each re-processing may discover new URLs
- **Quality Assurance**: Multiple collections improve data quality
- **Efficient Resource Usage**: Exits when no data to process
### Execution Logging
Structured logging provides detailed progress information:
```json
{
  "level": "INFO",
  "message": "Batch completed",
  "data": {
    "batchSize": 25,
    "successCount": 23,
    "errorCount": 2,
    "extractedUrls": 47,
    "durationMs": 12500
  }
}
```

## 🎯 Design Principles

### 1. High-Performance Architecture
- **PostgreSQL Optimization**: JSONB storage with GIN indexing
- **Batch Processing**: True database batch operations
- **Intelligent Querying**: Optimized record selection with proper indexing
- **Connection Pooling**: Efficient database connection management

### 2. Modern Node.js Design
- **TypeScript**: Full type safety and modern language features
- **ESM Modules**: Modern JavaScript module system
- **Structured Logging**: JSON-formatted logs for monitoring
- **Error Handling**: Comprehensive error recovery and reporting

### 3. Scalable Processing
- **Configurable Batching**: Adjustable batch sizes for different environments
- **Priority System**: Intelligent record processing based on collect_count
- **Automatic URL Discovery**: Dynamic expansion of processing scope
- **Graceful Exit**: Clean shutdown when processing is complete

### 4. Production Ready
- **Environment Configuration**: Separate dev/prod configurations
- **Database Migrations**: Automatic table and index creation
- **Error Recovery**: Robust error handling with permanent error detection
- **Performance Monitoring**: Detailed metrics and timing information

## 🏆 System Benefits

### Performance Advantages
- **High-Speed Processing**: PostgreSQL with optimized indexing
- **Batch Operations**: True database batch inserts for maximum throughput
- **Intelligent Querying**: Priority-based record selection
- **Connection Efficiency**: Optimized connection pooling

### Reliability Features
- **Robust Error Handling**: Comprehensive error recovery mechanisms
- **Automatic Recovery**: System continues from where it left off
- **Error Isolation**: Single failures don't cascade to other operations
- **Graceful Exit**: Clean shutdown when processing is complete

### Operational Benefits
- **Configurable**: Environment-specific settings for dev/prod
- **Observable**: Structured JSON logging for monitoring
- **Maintainable**: Clean TypeScript codebase with full type safety
- **Scalable**: Efficient batch processing handles large datasets

## 📋 Available Commands

**Development**:
- `pnpm run dev` - Development server with hot reload
- `pnpm run build` - Build TypeScript project
- `pnpm run fmt` - Format code with Prettier

**Production**:
- `pnpm start` - Run production build

## 📊 Project Status

### Production Ready
- **✅ Modern Architecture**: TypeScript + PostgreSQL + Batch Processing
- **✅ Performance Optimized**: True batch operations with indexing
- **✅ Error Handling**: Comprehensive error recovery and logging
- **✅ Configurable**: Environment-specific configurations

### Processing Features
- **🔄 Continuous Processing**: Processes data continuously while records exist
- **🚀 Smart Re-collection**: Re-processes all records to keep data fresh
- **🎯 Priority-based Processing**: Always processes lowest collect_count first
- **📊 Real-time Logging**: Detailed progress and performance metrics
- **� URL Discovery**: Automatic expansion during each processing cycle
- **⚡ Data Freshness**: Ensures Apple documentation is always up-to-date
- **🛑 Graceful Exit**: Exits cleanly when no more data to process

## ⚠️ Important System Architecture

### Intelligent Processing System
- **🔄 Continuous Operation**: Processes data continuously while records exist
- **🔄 Smart Re-collection**: Re-processes all records to keep data fresh
- **🎯 Priority Processing**: Always processes records with lowest collect_count first
- **📈 Incremental Updates**: Each processing increments collect_count and updated_at
- **🔄 Cycling Logic**: When all records processed, starts over with lowest collect_count
- **⚡ Data Freshness**: Ensures Apple documentation is always current
- **🛑 Smart Exit**: Exits gracefully when no data exists in database

### Data Integrity Guarantees
- **No Duplicates**: UNIQUE constraints prevent duplicate processing
- **Automatic Recovery**: System continues from where it left off
- **Error Isolation**: Single URL failures don't affect other URLs
- **Transaction Safety**: Database transactions ensure data consistency
- **🔄 Continuous Updates**: Records are re-processed while data exists to stay fresh
- **🛑 Resource Efficiency**: Exits when no more data to process

## 🔗 References

- [Apple Developer Documentation](https://developer.apple.com/documentation/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Node.js Documentation](https://nodejs.org/docs/)
- [TypeScript Documentation](https://www.typescriptlang.org/)

---

**Compliance**: This project respects Apple's Terms of Service and API usage guidelines.
**⚠️ IMPORTANT**: This system processes data continuously while records exist, then exits gracefully to ensure efficient resource usage.

