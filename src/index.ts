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
  const dbManager = new PostgreSQLManager(pool);

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
      logger.error("Error during shutdown", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      process.exit(1);
    }
  }

  // Main processing loop - continuous processing while data exists
  let batchCount = 0;
  const PROGRESS_REPORT_INTERVAL = 1000; // 每1000个批次发送一次进度报告

  while (true) {
    try {
      const hasData = await collector.execute();

      // No data found - exit immediately
      if (!hasData) {
        logger.info("No more data to process, exiting...");

        // 发送最终统计信息
        if (telegramNotifier.isEnabled()) {
          const finalStats = await dbManager.getStats();
          await telegramNotifier.notifyInfo(
            `🏁 Processing completed after ${batchCount} batches\n\n` +
              `📊 Final Statistics:\n` +
              `• Total records: ${finalStats.total}\n` +
              `• Collected: ${finalStats.collectedCount} (${finalStats.collectedPercentage})\n` +
              `• Avg collect count: ${finalStats.avgCollectCount}\n` +
              `• Range: ${finalStats.minCollectCount} - ${finalStats.maxCollectCount}`
          );
        }

        await dbManager.close();
        process.exit(0);
      }

      // 增加批次计数
      batchCount++;

      // 每1000个批次发送进度报告
      if (batchCount % PROGRESS_REPORT_INTERVAL === 0) {
        if (telegramNotifier.isEnabled()) {
          try {
            const stats = await dbManager.getStats();
            await telegramNotifier.notifyInfo(
              `📈 Progress Report - Batch ${batchCount}\n\n` +
                `📊 Current Statistics:\n` +
                `• Total records: ${stats.total}\n` +
                `• Collected: ${stats.collectedCount} (${stats.collectedPercentage})\n` +
                `• Avg collect count: ${stats.avgCollectCount}\n` +
                `• Range: ${stats.minCollectCount} - ${stats.maxCollectCount}\n\n` +
                `⚡ Batches processed: ${batchCount}`
            );
          } catch (statsError) {
            // 静默处理统计获取错误，不影响主流程
            logger.warn("Failed to get stats for progress report", {
              error:
                statsError instanceof Error
                  ? statsError.message
                  : "Unknown error",
            });
          }
        }
      }

      // If data was processed, immediately continue to next batch
    } catch (error) {
      logger.error("Batch processing failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });

      // Exit immediately on error
      await dbManager.close();
      process.exit(1);
    }
  }
}

// Start the application
main().catch(async (error) => {
  console.error("Failed to start Apple RAG Collector:", error);

  // 发送启动失败通知
  if (telegramNotifier.isEnabled()) {
    await telegramNotifier.notifyError(
      error instanceof Error ? error : new Error(String(error))
    );
  }

  process.exit(1);
});
