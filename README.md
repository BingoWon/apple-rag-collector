# Apple RAG Collector

Cloudflare Worker-based batch processing system for Apple Developer Documentation with intelligent content comparison and automated scheduling.

## Features

- **Cloudflare Worker Deployment**: Serverless execution with automatic scaling
- **Cron-based Scheduling**: Automated batch processing at configurable intervals
- **Smart Content Comparison**: 70-75% resource savings through intelligent change detection
- **Batch Processing**: Configurable batch sizes optimized for Cloudflare Workers request limits
- **Apple Developer Focus**: Specialized URL filtering for Apple documentation
- **Vector Embeddings**: PostgreSQL + pgvector storage for semantic search
- **Real-time Monitoring**: Telegram Bot notifications for errors and status updates
- **Production Ready**: TypeScript, error handling, and transaction safety

## 🚀 Quick Start

### 1. Configuration Setup

Copy the configuration template and customize for your environment:

```bash
cp wrangler.toml.example wrangler.toml
```

Configure your environment variables including database connection, API keys, and batch processing parameters. See [CONFIGURATION.md](CONFIGURATION.md) for detailed setup instructions.

### 2. Deploy to Cloudflare Workers

```bash
pnpm install
pnpm run deploy
```

The system will automatically:
- Deploy the worker to Cloudflare
- Set up cron triggers for scheduled execution
- Configure batch processing based on your Cloudflare Workers plan limits

## 🏗️ Architecture

### Cloudflare Worker Execution Model

The system operates as a scheduled Cloudflare Worker that processes Apple Developer documentation in configurable batches:

```
Cron Trigger → Worker Execution → Batch Processing → Database Storage
     ↓              ↓                    ↓                ↓
Scheduled      Fetch URLs         Smart Content      PostgreSQL
Intervals      from Database      Comparison         + Vector Store
```

### Processing Pipeline

1. **Batch Collection**: Retrieve URLs from database ordered by processing priority
2. **Content Comparison**: Intelligent change detection to skip unchanged content
3. **Conditional Processing**: Only process documents with content changes
4. **Embedding Generation**: Create vector embeddings for changed content
5. **Database Storage**: Store processed content and embeddings


## 🧠 Intelligent Content Comparison

The system features advanced content comparison that dramatically improves performance:

### Smart Change Detection
- **Deep JSON Comparison**: Compares content sections, metadata, and abstracts
- **First-time Processing**: Automatically processes new URLs
- **Change Identification**: Precisely identifies content changes to avoid unnecessary processing

### Performance Benefits
- **70-75% Resource Savings**: Skip processing for unchanged content
- **Optimized Database Operations**: Only update necessary records
- **Cloudflare Workers Efficiency**: Maximizes request limits through intelligent processing

## 📁 Project Structure

```
src/
├── index.ts                    # Cloudflare Worker entry point and cron handler
├── AppleDocCollector.ts        # Core batch processing orchestrator
├── AppleAPIClient.ts           # Apple Developer API client
├── ContentProcessor.ts         # Content processing and markdown conversion
├── Chunker.ts                  # Intelligent content chunking
├── EmbeddingProvider.ts        # Vector embedding generation
├── PostgreSQLManager.ts        # PostgreSQL operations with pgvector
├── KeyManager.ts               # API key management and rotation
├── types/index.ts              # TypeScript type definitions
└── utils/logger.ts             # Logging system

Configuration/
├── wrangler.toml.example       # Cloudflare Workers configuration template
└── CONFIGURATION.md            # Detailed setup instructions
```

## 🗄️ Database Schema

The system uses PostgreSQL with pgvector extension for storing documentation and vector embeddings:

### Core Tables
- **`pages`**: Stores Apple Developer documentation URLs, content, and processing metadata
- **`chunks`**: Stores chunked content with vector embeddings for semantic search

### Key Features
- **pgvector Extension**: Half-precision vectors (HALFVEC) for memory efficiency
- **HNSW Indexing**: Optimized vector similarity search
- **JSONB Storage**: Structured JSON data with GIN indexing
- **Processing Counters**: Priority-based batch processing with `collect_count`

## 📊 Monitoring & Notifications

### Telegram Bot Integration
Real-time monitoring with instant notifications for:
- Processing errors and warnings
- System status updates
- Batch completion summaries

### Data Integrity
- **Transaction Safety**: PostgreSQL ACID transactions
- **Duplicate Prevention**: UNIQUE constraints on URLs
- **Error Isolation**: Single URL failures don't affect batch processing
- **Automatic Recovery**: System continues from last processed state

## � Available Commands

**Development & Deployment**:
- `pnpm run dev` - Local development with hot reload
- `pnpm run build` - Build TypeScript project
- `pnpm run deploy` - Deploy to Cloudflare Workers
- `pnpm run fmt` - Format code with Prettier

## 🔧 Configuration

The system processes Apple Developer documentation through configurable batch processing:

### Key Configuration Areas
- **Batch Processing**: Configurable batch sizes and counts optimized for Cloudflare Workers limits
- **Cron Scheduling**: Automated execution intervals
- **Database Connection**: PostgreSQL with pgvector for embeddings
- **API Keys**: Embedding providers and Telegram notifications
- **URL Filtering**: Apple Developer documentation focus

### Package Manager
**This project exclusively uses pnpm as the package manager.**

For detailed configuration instructions, see [CONFIGURATION.md](CONFIGURATION.md).
