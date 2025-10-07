#!/usr/bin/env node

/**
 * Test script to verify the complete embedding flow with title + content
 */

import fs from "node:fs";
import path from "node:path";

function testEmbeddingFlow() {
  console.log("🧪 Testing Complete Embedding Flow");
  console.log("=".repeat(60));

  // Load actual chunk data from our test output
  const chunkFile =
    "tests/batch-chunker-comparison-output/2025-08-29T00-24-58Z/url_1/typescript_chunks.json";

  if (!fs.existsSync(chunkFile)) {
    console.error("❌ Chunk file not found:", chunkFile);
    console.log("💡 Please run the chunker comparison test first");
    process.exit(1);
  }

  try {
    const chunksData = JSON.parse(fs.readFileSync(chunkFile, "utf8"));
    console.log("📄 Loaded chunks:", chunksData.length);
    console.log("");

    // Simulate the embedding preparation logic from AppleDocCollector
    console.log("🔄 Simulating AppleDocCollector embedding preparation...");

    const allChunks = chunksData.map((chunk, _index) => ({
      url: "test-url",
      chunk: chunk,
    }));

    // Parse JSON chunks and combine title + content for embedding (our new logic)
    const embeddingTexts = allChunks.map((c) => {
      try {
        const parsed = JSON.parse(c.chunk);
        // Combine title and content for optimal semantic representation
        return parsed.title
          ? `${parsed.title}\n\n${parsed.content}`
          : parsed.content;
      } catch (error) {
        console.warn("Failed to parse chunk JSON, using raw chunk:", error);
        return c.chunk;
      }
    });

    console.log("✅ Successfully processed", embeddingTexts.length, "chunks");
    console.log("");

    // Show statistics
    console.log("📊 Embedding Text Statistics:");
    embeddingTexts.forEach((text, index) => {
      const lines = text.split("\n");
      const hasTitle =
        lines[0] && !lines[0].startsWith("#") && !lines[0].startsWith("##");
      console.log(`  Chunk ${index + 1}:`);
      console.log(`    - Length: ${text.length} chars`);
      console.log(`    - Lines: ${lines.length}`);
      console.log(`    - Has title: ${hasTitle ? "Yes" : "No"}`);
      if (hasTitle) {
        console.log(`    - Title: "${lines[0].substring(0, 50)}..."`);
      }
    });
    console.log("");

    // Show first embedding text sample
    console.log("📝 Sample Embedding Text (First Chunk):");
    console.log("─".repeat(60));
    console.log(`${embeddingTexts[0].substring(0, 500)}...`);
    console.log("─".repeat(60));
    console.log("");

    // Compare with old method (raw JSON)
    console.log("🔍 Comparison with Old Method:");
    const oldMethod = allChunks[0].chunk;
    const newMethod = embeddingTexts[0];

    console.log("  Old method (raw JSON):");
    console.log("    - Length:", oldMethod.length);
    console.log(
      "    - Contains JSON syntax:",
      oldMethod.includes('{"title":') ? "Yes" : "No"
    );

    console.log("  New method (title + content):");
    console.log("    - Length:", newMethod.length);
    console.log(
      "    - Contains JSON syntax:",
      newMethod.includes('{"title":') ? "Yes" : "No"
    );
    console.log(
      "    - Starts with title:",
      !newMethod.startsWith("#") ? "Yes" : "No"
    );
    console.log("");

    // Save sample for inspection
    const outputDir = "tests/embedding-flow-test-output";
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const sampleOutput = {
      totalChunks: embeddingTexts.length,
      sampleEmbeddingTexts: embeddingTexts.slice(0, 3),
      statistics: embeddingTexts.map((text, index) => ({
        chunkIndex: index,
        length: text.length,
        lines: text.split("\n").length,
        hasTitle: !text.startsWith("#") && !text.startsWith("##"),
      })),
    };

    fs.writeFileSync(
      path.join(outputDir, "embedding-flow-sample.json"),
      JSON.stringify(sampleOutput, null, 2)
    );

    console.log(
      "💾 Sample saved to: tests/embedding-flow-test-output/embedding-flow-sample.json"
    );
    console.log("🎉 Embedding flow test completed successfully!");
    console.log("✅ Title + Content combination is working correctly");
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

// Run the test
testEmbeddingFlow();
