/**
 * Cloudflare Worker entry point for Apple RAG Collector
 * Executes batch processing on cron schedule (every 5 minutes)
 */

import { AppleDocCollector } from "./AppleDocCollector.js";
import { PostgreSQLManager } from "./PostgreSQLManager.js";
import { logger } from "./utils/logger.js";
import {
  configureTelegram,
  notifyTelegram,
} from "./utils/telegram-notifier.js";
import type { BatchConfig } from "./types/index.js";
import postgres from "postgres";

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
    batchSize: parseInt(env.BATCH_SIZE || "30"),
    forceUpdateAll: env.FORCE_UPDATE_ALL === "true",
  };

  logger.info(
    `Database connecting: ${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`
  );

  const sql = postgres({
    host: env.DB_HOST,
    port: parseInt(env.DB_PORT || "5432"),
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
  let keyManager: any;
  try {
    const KeyManager = (await import("./KeyManager.js")).KeyManager;
    keyManager = new KeyManager(env.DB);
    logger.info("KeyManager initialized");
  } catch (error) {
    await logger.error(
      `KeyManager initialization failed: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }

  const collector = new AppleDocCollector(dbManager, keyManager, config, env);

  const batchCount = parseInt(env.BATCH_COUNT || "30");

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
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      // Send detailed error notification to Telegram
      await notifyTelegram(
        `🚨 Batch Processing Error!\n\n` +
        `**Batch**: ${i + 1}/${batchCount}\n` +
        `**Error**: ${errorMessage}\n` +
        `**Stack**: ${errorStack ? errorStack.substring(0, 500) : 'N/A'}\n\n` +
        `Continuing with next batch...`
      );

      await logger.error(
        `Batch ${i + 1} failed: ${errorMessage}`
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

  // Send comprehensive completion notification with statistics (only in first 3 minutes of each hour)
  const now = new Date();
  const currentMinute = now.getMinutes();

  // Only send notification if current time is within first XX minutes of the hour (0, 1, or 2)
  if (currentMinute < 12) {
    try {
      const finalStats = await dbManager.getStats();
      const statsMessage =
        `✅ Apple RAG Collector Completed\n\n` +
        `⏱️ Runtime: ${durationMinutes} minutes ${durationSeconds} seconds\n` +
        `📊 Results: ${totalChunksGenerated} chunks generated\n\n` +
        `📈 Current Statistics:\n` +
        `• Total records: ${finalStats.total}\n` +
        `• Collected: ${finalStats.collectedCount} (${finalStats.collectedPercentage})\n` +
        `• Avg collect count: ${finalStats.avgCollectCount}\n` +
        `• Range: ${finalStats.minCollectCount} - ${finalStats.maxCollectCount}\n` +
        `• Total chunks: ${finalStats.totalChunks}\n\n` +
        `📋 Pages Missing Data:\n` +
        `• Missing content: ${finalStats.pagesMissingData.missingContentCount} (${finalStats.pagesMissingData.missingContentPercentage})\n` +
        `• Missing title: ${finalStats.pagesMissingData.missingTitleCount} (${finalStats.pagesMissingData.missingTitlePercentage})\n\n` +
        `🧩 Chunks Missing Data:\n` +
        `• Missing content: ${finalStats.chunksMissingData.missingContentCount} (${finalStats.chunksMissingData.missingContentPercentage})\n` +
        `• Missing title: ${finalStats.chunksMissingData.missingTitleCount} (${finalStats.chunksMissingData.missingTitlePercentage})\n\n` +
        `⚙️ Configuration:\n` +
        `• Batch size: ${config.batchSize}\n` +
        `• Batch count: ${batchCount}\n` +
        `• Total URLs this run: ${config.batchSize * batchCount}\n` +
        `• Force update: ${config.forceUpdateAll ? "Yes" : "No"}`;

      logger.info(statsMessage);
      await notifyTelegram(statsMessage);
    } catch (error) {
      await logger.error(
        `Failed to get final stats: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Close database connection
  await dbManager.close();
}
