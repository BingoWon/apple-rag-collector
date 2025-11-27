/**
 * Cloudflare Worker entry point for Apple RAG Collector
 * Executes batch processing on cron schedule
 */

import postgres from "postgres";
import { AppleDocCollector } from "./AppleDocCollector.js";
import { PostgreSQLManager } from "./PostgreSQLManager.js";
import type { BatchConfig } from "./types/index.js";
import { logger } from "./utils/logger.js";
import { configureTelegram, notifyStats } from "./utils/telegram-notifier.js";

interface Env {
  DB_HOST: string;
  DB_PORT: string;
  DB_NAME: string;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_SSL: string;
  BATCH_SIZE: string;
  BATCH_COUNT: string;
  DEEPINFRA_API_KEY: string;

  FORCE_UPDATE_ALL?: string;
  TELEGRAM_STATS_BOT_URL?: string;
  TELEGRAM_ALERT_BOT_URL?: string;
}

export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    configureTelegram(env.TELEGRAM_STATS_BOT_URL, env.TELEGRAM_ALERT_BOT_URL);

    try {
      await processAppleContent(env);
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
      configureTelegram(env.TELEGRAM_STATS_BOT_URL, env.TELEGRAM_ALERT_BOT_URL);

      try {
        await processAppleContent(env);
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

async function processAppleContent(env: Env): Promise<void> {
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
    max: 3,
    idle_timeout: 30,
    connect_timeout: 60,
    transform: {
      undefined: null,
    },
    onnotice: () => {},
  });

  await sql`SET statement_timeout = '120s'`;
  await sql`SET lock_timeout = '60s'`;
  await sql`SET idle_in_transaction_session_timeout = '180s'`;

  const dbManager = new PostgreSQLManager(sql);
  const collector = new AppleDocCollector(
    dbManager,
    env.DEEPINFRA_API_KEY,
    config
  );

  const batchCount = parseInt(env.BATCH_COUNT || "30", 10);
  const startTime = Date.now();

  // Phase 1: Video Discovery and Processing
  try {
    const newVideos = await collector.discoverVideos();
    const videoResult = await collector.processVideos();

    if (newVideos > 0 || videoResult.processed > 0) {
      logger.info(
        `🎬 Videos: ${newVideos} discovered, ${videoResult.processed} processed, ${videoResult.chunks} chunks`
      );
    }
  } catch (error) {
    await logger.error(
      `🎬 Video processing failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Phase 2: Document Batch Processing
  logger.info(
    `Starting ${batchCount} batches × ${config.batchSize} URLs = ${config.batchSize * batchCount} total`
  );

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

      await logger.error(
        `🚨 Batch ${i + 1}/${batchCount} Failed\n` +
          `Error: ${errorMessage}\n` +
          `Stack: ${errorStack?.substring(0, 300) || "N/A"}\n` +
          `Status: Continuing...`
      );
    }
  }

  const endTime = Date.now();
  const durationMs = endTime - startTime;
  const durationMinutes = Math.floor(durationMs / 60000);
  const durationSeconds = Math.floor((durationMs % 60000) / 1000);

  logger.info(
    `Completed ${batchCount} batches in ${durationMinutes}m ${durationSeconds}s, ${totalChunksGenerated} chunks`
  );

  const now = new Date();
  const currentMinute = now.getMinutes();

  if (currentMinute < 6) {
    try {
      const stats = await dbManager.getStats();

      const statsMessage =
        `✅ Collector Completed\n` +
        `⏱️ ${durationMinutes}m ${durationSeconds}s | 📊 ${totalChunksGenerated} chunks\n\n` +
        `📄 Docs: ${stats.docs.total} | ${stats.docs.collectedPercentage} collected\n` +
        `🎬 Videos: ${stats.videos.total} | ${stats.videos.collectedPercentage} collected\n` +
        `📦 Chunks: ${stats.totalChunks} total | Avg collect: ${stats.avgCollectCount}\n` +
        `🔄 Range: ${stats.minCollectCount}-${stats.maxCollectCount}\n\n` +
        `⚙️ Config: ${config.batchSize}×${batchCount}=${config.batchSize * batchCount} URLs | Force: ${config.forceUpdateAll ? "Y" : "N"}`;

      logger.info(statsMessage);
      await notifyStats(statsMessage);
    } catch (error) {
      await logger.error(
        `Stats retrieval failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  await dbManager.close();
}
