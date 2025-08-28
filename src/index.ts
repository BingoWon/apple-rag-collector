import 'dotenv/config';
import { Pool } from 'pg';
import { AppleDocCollector } from './AppleDocCollector.js';
import { PostgreSQLManager } from './PostgreSQLManager.js';
import { type AppConfig } from './types/index.js';
import { Logger, type LogLevel } from './utils/logger.js';

// Load configuration from environment variables
const appConfig: AppConfig = {
  database: {
    host: process.env['DB_HOST'] || 'localhost',
    port: parseInt(process.env['DB_PORT'] || '5432'),
    database: process.env['DB_NAME'] || 'apple_rag_collector',
    username: process.env['DB_USER'] || 'postgres',
    password: process.env['DB_PASSWORD'] || '',
    ssl: process.env['DB_SSL'] === 'true',
  },
  processing: {
    batchSize: parseInt(process.env['BATCH_SIZE'] || '25'),
  },
  logging: {
    level: process.env['LOG_LEVEL'] || 'info',
  },
};

// Create PostgreSQL connection pool with optimal defaults
const pool = new Pool({
  host: appConfig.database.host,
  port: appConfig.database.port,
  database: appConfig.database.database,
  user: appConfig.database.username,
  password: appConfig.database.password,
  ssl: appConfig.database.ssl,
  // Use PostgreSQL defaults: max=10, min=0, idleTimeoutMillis=10000
});

async function main(): Promise<void> {
  const logger = new Logger(appConfig.logging.level as LogLevel);
  const dbManager = new PostgreSQLManager(pool);

  // Initialize database (create tables and indexes if they don't exist)
  logger.info('Initializing database...');
  await dbManager.initialize();
  logger.info('Database initialization completed');

  const collector = new AppleDocCollector(dbManager, logger);

  logger.info('Apple RAG Collector starting...', {
    version: '2.0.0',
    mode: 'optimized-batch-processing',
    batchSize: appConfig.processing.batchSize,
    database: `${appConfig.database.host}:${appConfig.database.port}/${appConfig.database.database}`,
  });

  // Graceful shutdown handling
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    await shutdown();
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    await shutdown();
  });

  async function shutdown(): Promise<void> {
    try {
      await dbManager.close();
      logger.info('Database connections closed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error: error instanceof Error ? error.message : 'Unknown error' });
      process.exit(1);
    }
  }

  // Main processing loop - continuous processing while data exists
  while (true) {
    try {
      const hasData = await collector.execute(appConfig.processing.batchSize);

      // No data found - exit immediately
      if (!hasData) {
        logger.info('No more data to process, exiting...');
        await dbManager.close();
        process.exit(0);
      }
      // If data was processed, immediately continue to next batch

    } catch (error) {
      logger.error('Batch processing failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      // Exit immediately on error
      await dbManager.close();
      process.exit(1);
    }
  }
}

// Start the application
main().catch((error) => {
  console.error('Failed to start Apple RAG Collector:', error);
  process.exit(1);
});
