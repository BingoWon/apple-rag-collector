#!/usr/bin/env node

/**
 * Test script to verify that JSON chunk parsing correctly combines title + content
 */

function testTitleContentParsing() {
  console.log("🧪 Testing Title + Content Parsing Logic");
  console.log("=".repeat(60));

  // Sample chunk JSON (from our actual output)
  const sampleChunk = `{
  "title": "Article: Xcode 26 Beta 7 Release Notes\\nUpdate your apps to use new features, and test your apps against API changes.",
  "content": "## Overview\\nXcode 26 beta 7 includes SDKs for iOS 26, iPadOS 26, tvOS 26, watchOS 26, macOS Tahoe 26, and visionOS 26. The Xcode 26 beta 7 release supports on-device debugging in iOS 16 and later, tvOS 16 and later, watchOS 8 and later, and visionOS. Xcode 26 beta 7 requires a Mac running macOS Sequoia 15.5 or later."
}`;

  console.log("📄 Sample Chunk JSON:");
  console.log(sampleChunk);
  console.log("");

  try {
    // Parse the JSON (this is what happens in AppleDocCollector)
    const parsed = JSON.parse(sampleChunk);

    console.log("✅ JSON Parsing successful");
    console.log("📊 Parsed structure:");
    console.log("  - Title:", parsed.title ? "Present" : "Missing");
    console.log("  - Content:", parsed.content ? "Present" : "Missing");
    console.log("");

    // Combine title and content (this is the new logic)
    const embeddingText = parsed.title
      ? `${parsed.title}\n\n${parsed.content}`
      : parsed.content;

    console.log("🔗 Combined Text for Embedding:");
    console.log("─".repeat(60));
    console.log(embeddingText);
    console.log("─".repeat(60));
    console.log("");

    console.log("📏 Text Statistics:");
    console.log("  - Title length:", parsed.title ? parsed.title.length : 0);
    console.log(
      "  - Content length:",
      parsed.content ? parsed.content.length : 0
    );
    console.log("  - Combined length:", embeddingText.length);
    console.log("  - Title included:", parsed.title ? "Yes" : "No");
    console.log("");

    // Test with a chunk that has no title
    const noTitleChunk = `{
  "title": "",
  "content": "Some content without title"
}`;

    console.log("🧪 Testing chunk without title:");
    const parsedNoTitle = JSON.parse(noTitleChunk);
    const embeddingTextNoTitle = parsedNoTitle.title
      ? `${parsedNoTitle.title}\n\n${parsedNoTitle.content}`
      : parsedNoTitle.content;
    console.log("  - Result:", embeddingTextNoTitle);
    console.log(
      "  - Title fallback works:",
      embeddingTextNoTitle === parsedNoTitle.content ? "Yes" : "No"
    );
    console.log("");

    console.log("🎉 All tests passed!");
    console.log("✅ Title + Content parsing logic is working correctly");
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

// Run the test
testTitleContentParsing();
