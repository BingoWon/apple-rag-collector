import "dotenv/config";
import { Pool } from "pg";
import { AppleDocCollector } from "./AppleDocCollector.js";
import { PostgreSQLManager } from "./PostgreSQLManager.js";
import { type AppConfig } from "./types/index.js";
import { Logger, type LogLevel } from "./utils/logger.js";
import { telegramNotifier } from "./utils/telegram-notifier.js";

// Load configuration from environment variables
const appConfig: AppConfig = {
  database: {
    host: process.env["DB_HOST"] || "localhost",
    port: parseInt(process.env["DB_PORT"] || "5432"),
    database: process.env["DB_NAME"] || "apple_rag_collector",
    username: process.env["DB_USER"] || "postgres",
    password: process.env["DB_PASSWORD"] || "",
    ssl: process.env["DB_SSL"] === "true",
  },
  batchProcessing: {
    batchSize: parseInt(process.env["BATCH_SIZE"] || "25"),
    forceUpdateAll: process.env["FORCE_UPDATE_ALL"] === "true",
  },
  logging: {
    level: process.env["LOG_LEVEL"] || "info",
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
  const dbManager = new PostgreSQLManager(pool, logger);

  // Initialize database (create tables and indexes if they don't exist)
  logger.info("Initializing database...");
  await dbManager.initialize();
  logger.info("Database initialization completed");

  const collector = new AppleDocCollector(
    dbManager,
    logger,
    appConfig.batchProcessing
  );

  logger.info("Apple RAG Collector starting...", {
    version: "2.0.0",
    mode: "optimized-batch-processing",
    batchSize: appConfig.batchProcessing.batchSize,
    updateMode: appConfig.batchProcessing.forceUpdateAll
      ? "FORCE_UPDATE_ALL"
      : "SMART_UPDATE",
    database: `${appConfig.database.host}:${appConfig.database.port}/${appConfig.database.database}`,
    telegram: telegramNotifier.getConfig(),
  });

  // 发送启动通知
  if (telegramNotifier.isEnabled()) {
    await telegramNotifier.notifyInfo(
      "Apple RAG Collector started successfully"
    );
  }

  // Graceful shutdown handling
  process.on("SIGINT", async () => {
    logger.info("Received SIGINT, shutting down gracefully...");
    await shutdown();
  });

  process.on("SIGTERM", async () => {
    logger.info("Received SIGTERM, shutting down gracefully...");
    await shutdown();
  });

  async function shutdown(): Promise<void> {
    try {
      await dbManager.close();
      logger.info("Database connections closed");
      process.exit(0);
    } catch (error) {
      await logger.error("Error during shutdown", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      process.exit(1);
    }
  }

  // Main processing loop - continuous processing while data exists
  const PROGRESS_REPORT_INTERVAL = 500; // Send progress report every PROGRESS_REPORT_INTERVAL batches

  while (true) {
    try {
      const result = await collector.execute();

      // Note: hasData is always true in continuous processing system
      // Database queries always return existing URLs with incremented collect_count

      // Send progress report every PROGRESS_REPORT_INTERVAL batches, including the first batch
      if (result.batchNumber % PROGRESS_REPORT_INTERVAL === 1) {
        if (telegramNotifier.isEnabled()) {
          try {
            const stats = await dbManager.getStats();
            await telegramNotifier.notifyInfo(
              `📈 Progress Report - Batch ${result.batchNumber}\n\n` +
                `📊 Current Statistics:\n` +
                `• Total records: ${stats.total}\n` +
                `• Collected: ${stats.collectedCount} (${stats.collectedPercentage})\n` +
                `• Avg collect count: ${stats.avgCollectCount}\n` +
                `• Range: ${stats.minCollectCount} - ${stats.maxCollectCount}\n` +
                `• Total chunks: ${stats.totalChunks}\n\n` +
                `⚡ Batches processed: ${result.batchNumber}\n` +
                `🔧 Session chunks generated: ${result.totalChunks}`
            );
          } catch (statsError) {
            // Silent handling of stats errors, don't affect main flow
            await logger.warn("Failed to get stats for progress report", {
              error:
                statsError instanceof Error
                  ? statsError.message
                  : "Unknown error",
            });
          }
        }
      }

      // Continue to next batch immediately
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const isTimeoutError =
        error instanceof Error &&
        (error.name === "AbortError" ||
          errorMessage.toLowerCase().includes("aborted") ||
          errorMessage.toLowerCase().includes("timeout") ||
          errorMessage.toLowerCase().includes("operation was aborted"));

      if (isTimeoutError) {
        await logger.error("🚨 Batch processing failed due to API timeout", {
          error: errorMessage,
          timeout: process.env["EMBEDDING_API_TIMEOUT"] || "30",
          batchSize: appConfig.batchProcessing.batchSize,
          suggestion:
            "Consider increasing EMBEDDING_API_TIMEOUT or reducing BATCH_SIZE",
          stack: error instanceof Error ? error.stack : undefined,
        });
      } else {
        await logger.error("Batch processing failed", {
          error: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
        });
      }

      await dbManager.close();
      process.exit(1);
    }
  }
}

main().catch(async (error) => {
  // Create emergency logger for startup failures
  const emergencyLogger = new Logger("error" as LogLevel);
  await emergencyLogger.error("Failed to start Apple RAG Collector", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  process.exit(1);
});
