#!/usr/bin/env node

/**
 * Test script to verify that embedding generation correctly uses title + content
 */

import { AppleDocCollector } from "../src/AppleDocCollector.js";
import fs from "fs";
import path from "path";

const TEST_URLS = [
  "https://developer.apple.com/documentation/xcode-release-notes/xcode-26-release-notes",
];

async function testEmbeddingWithTitle() {
  console.log("🧪 Testing Embedding Generation with Title + Content");
  console.log("=".repeat(60));

  try {
    const collector = new AppleDocCollector({
      batchSize: 1,
      maxRetries: 3,
      retryDelay: 1000,
    });

    console.log("📥 Processing URL:", TEST_URLS[0]);

    // Process the URL
    const results = await collector.collectBatch(TEST_URLS);

    if (results.length === 0) {
      console.error("❌ No results returned");
      return;
    }

    const result = results[0];
    if (!result.success) {
      console.error("❌ Processing failed:", result.error);
      return;
    }

    console.log("✅ Processing successful");
    console.log("📊 Results:", {
      url: result.url,
      chunksCount: result.data?.chunks || 0,
      embeddingsCount: result.data?.embeddings || 0,
    });

    // Create output directory
    const outputDir = path.join("tests", "embedding-title-test-output");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Save results
    const outputFile = path.join(outputDir, "embedding-test-result.json");
    fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));

    console.log("💾 Results saved to:", outputFile);
    console.log("🎉 Test completed successfully!");
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

// Run the test
testEmbeddingWithTitle().catch(console.error);
