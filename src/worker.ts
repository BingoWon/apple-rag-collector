/**
 * Cloudflare Worker entry point for Apple RAG Collector
 * Executes batch processing on cron schedule (every 5 minutes)
 */

import postgres from "postgres";
import { AppleDocCollector } from "./AppleDocCollector.js";
import type { KeyManager } from "./KeyManager.js";
import { PostgreSQLManager } from "./PostgreSQLManager.js";
import type { BatchConfig } from "./types/index.js";
import { logger } from "./utils/logger.js";
import {
  configureTelegram,
  notifyTelegram,
} from "./utils/telegram-notifier.js";

interface Env {
  DB: D1Database;
  DB_HOST: string;
  DB_PORT: string;
  DB_NAME: string;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_SSL: string;
  BATCH_SIZE: string;
  BATCH_COUNT: string;

  FORCE_UPDATE_ALL?: string;
  TELEGRAM_BOT_URL?: string;
  EMBEDDING_MODEL?: string;
  EMBEDDING_DIM?: string;
  EMBEDDING_API_BASE_URL?: string;
  EMBEDDING_API_TIMEOUT?: string;
}

export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    configureTelegram(env.TELEGRAM_BOT_URL);

    try {
      await processAppleDocuments(env);
    } catch (error) {
      await logger.error(
        `Worker execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    if (url.pathname === "/trigger" && request.method === "POST") {
      configureTelegram(env.TELEGRAM_BOT_URL);

      try {
        await processAppleDocuments(env);
        return new Response("Processing completed", { status: 200 });
      } catch (error) {
        await logger.error(
          `Manual trigger failed: ${error instanceof Error ? error.message : String(error)}`
        );
        return new Response("Processing failed", { status: 500 });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};

async function processAppleDocuments(env: Env): Promise<void> {
  const config: BatchConfig = {
    batchSize: parseInt(env.BATCH_SIZE || "30", 10),
    forceUpdateAll: env.FORCE_UPDATE_ALL === "true",
  };

  logger.info(
    `Database connecting: ${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`
  );

  const sql = postgres({
    host: env.DB_HOST,
    port: parseInt(env.DB_PORT || "5432", 10),
    database: env.DB_NAME,
    username: env.DB_USER,
    password: env.DB_PASSWORD || "",
    ssl: env.DB_SSL === "true",
    max: 3, // Increased from 1 to reduce connection bottleneck
    idle_timeout: 30, // Increased from 20 to 30 seconds
    connect_timeout: 15, // Increased from 10 to 15 seconds
    transform: {
      undefined: null,
    },
    onnotice: () => {}, // Suppress PostgreSQL notices
  });

  // Configure PostgreSQL session-level timeouts to prevent lock timeouts
  await sql`SET statement_timeout = '120s'`; // 120 second statement timeout
  await sql`SET lock_timeout = '60s'`; // 60 second lock timeout to prevent "canceling statement due to lock timeout"
  await sql`SET idle_in_transaction_session_timeout = '180s'`; // 3 minute idle transaction timeout

  const dbManager = new PostgreSQLManager(sql);

  // Create KeyManager with D1 database
  let keyManager: KeyManager;
  try {
    const KeyManagerClass = (await import("./KeyManager.js")).KeyManager;
    keyManager = new KeyManagerClass(env.DB);
    logger.info("KeyManager initialized");
  } catch (error) {
    await logger.error(
      `KeyManager initialization failed: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }

  const collector = new AppleDocCollector(dbManager, keyManager, config, env);

  const batchCount = parseInt(env.BATCH_COUNT || "30", 10);

  logger.info(
    `Starting ${batchCount} batches × ${config.batchSize} URLs = ${config.batchSize * batchCount} total`
  );

  const startTime = Date.now();
  let totalChunksGenerated = 0;

  for (let i = 0; i < batchCount; i++) {
    try {
      const result = await collector.execute();
      totalChunksGenerated += result.totalChunks;

      if (i === 0 || (i + 1) % 10 === 0 || i === batchCount - 1) {
        logger.info(
          `Batch ${i + 1}/${batchCount} completed: ${result.totalChunks} chunks`
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      // Send compact error notification
      await logger.error(
        `🚨 Batch ${i + 1}/${batchCount} Failed\n` +
          `Error: ${errorMessage}\n` +
          `Stack: ${errorStack?.substring(0, 300) || "N/A"}\n` +
          `Status: Continuing...`
      );
      // Continue with next batch instead of failing completely
    }
  }

  const endTime = Date.now();
  const durationMs = endTime - startTime;
  const durationMinutes = Math.floor(durationMs / 60000);
  const durationSeconds = Math.floor((durationMs % 60000) / 1000);

  logger.info(
    `Completed ${batchCount} batches in ${durationMinutes}m ${durationSeconds}s, ${totalChunksGenerated} chunks`
  );

  // Send comprehensive completion notification (only in first 2 minutes of each hour)
  const now = new Date();
  const currentMinute = now.getMinutes();

  if (currentMinute < 2) {
    try {
      const stats = await dbManager.getStats();

      // Compact statistics message with essential metrics only
      const statsMessage =
        `✅ Collector Completed\n` +
        `⏱️ ${durationMinutes}m ${durationSeconds}s | 📊 ${totalChunksGenerated} chunks\n\n` +
        `📈 Database: ${stats.total} records | ${stats.collectedPercentage} collected\n` +
        `📦 Chunks: ${stats.totalChunks} total | Avg collect: ${stats.avgCollectCount}\n` +
        `🔄 Range: ${stats.minCollectCount}-${stats.maxCollectCount}\n\n` +
        `⚠️ Missing Data:\n` +
        `Pages: ${stats.pagesMissingData.missingContentPercentage} content, ${stats.pagesMissingData.missingTitlePercentage} title\n` +
        `Chunks: ${stats.chunksMissingData.missingContentPercentage} content, ${stats.chunksMissingData.missingTitlePercentage} title\n\n` +
        `⚙️ Config: ${config.batchSize}×${batchCount}=${config.batchSize * batchCount} URLs | Force: ${config.forceUpdateAll ? "Y" : "N"}`;

      logger.info(statsMessage);
      await notifyTelegram(statsMessage);
    } catch (error) {
      await logger.error(
        `Stats retrieval failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Close database connection
  await dbManager.close();
}
