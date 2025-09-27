// Apple Documentation Collector Test Script
// This script tests the unified AppleDocProcessor implementation

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Import our unified processors
import { AppleAPIClient } from "../dist/AppleAPIClient.js";
import { ContentProcessor } from "../dist/ContentProcessor.js";

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const OUTPUT_DIR = path.join(__dirname, "output");
const TIMESTAMP =
  new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5) + "Z";
const SESSION_DIR = path.join(OUTPUT_DIR, TIMESTAMP);

// Test URL
const TEST_URL =
  "https://developer.apple.com/documentation/xcode/formatting-your-documentation-content";

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}
if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

// Custom Error Classes
class ProcessingError extends Error {
  constructor(stage, message, context = {}) {
    super(`[${stage}] ${message}`);
    this.name = "ProcessingError";
    this.stage = stage;
    this.context = context;
    this.timestamp = new Date().toISOString();
  }
}

class ValidationError extends Error {
  constructor(field, value, expected) {
    super(
      `Validation failed for ${field}: expected ${expected}, got ${typeof value}`
    );
    this.name = "ValidationError";
    this.field = field;
    this.value = value;
    this.expected = expected;
  }
}

// Logging utilities
function logInfo(message, data = null) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] INFO: ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

function logError(message, error = null) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ERROR: ${message}`);
  if (error) {
    console.error(error.stack || error.message || error);
  }
}

function logSuccess(message, data = null) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] SUCCESS: ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

// Validation functions
function validateApiResponse(data) {
  if (!data || typeof data !== "object") {
    throw new ValidationError("apiResponse", data, "object");
  }

  if (!data.metadata || typeof data.metadata !== "object") {
    throw new ValidationError("metadata", data.metadata, "object");
  }

  if (!data.metadata.title || typeof data.metadata.title !== "string") {
    throw new ValidationError("metadata.title", data.metadata.title, "string");
  }

  return true;
}

function validateProcessedContent(content) {
  if (!content || typeof content !== "object") {
    throw new ValidationError("processedContent", content, "object");
  }

  if (typeof content.title !== "string" && content.title !== null) {
    throw new ValidationError("title", content.title, "string or null");
  }

  if (typeof content.content !== "string") {
    throw new ValidationError("content", content.content, "string");
  }

  if (!Array.isArray(content.extractedUrls)) {
    throw new ValidationError("extractedUrls", content.extractedUrls, "array");
  }

  return true;
}

// Main processing function using unified processors
async function processAppleDocument(url) {
  logInfo("Starting Apple document processing", { url });

  try {
    // Step 1: Initialize processors
    logInfo("Initializing processors");
    const apiClient = new AppleAPIClient();
    const contentProcessor = new ContentProcessor();

    // Step 2: Fetch document data (using batch API with single URL)
    logInfo("Fetching document data from Apple API");
    const apiResults = await apiClient.fetchDocuments([url]);
    const apiResult = apiResults[0];

    if (!apiResult.data) {
      throw new ProcessingError(
        "API_FETCH",
        apiResult.error || "Failed to fetch document data"
      );
    }

    // Step 3: Validate API response
    logInfo("Validating API response");
    validateApiResponse(apiResult.data);

    // Step 4: Process content (using batch API with single result)
    logInfo("Processing document content");
    const processResults = await contentProcessor.processDocuments([apiResult]);
    const processResult = processResults[0];

    if (!processResult.data) {
      throw new ProcessingError(
        "CONTENT_PROCESSING",
        processResult.error || "Failed to process content"
      );
    }

    // Step 5: Validate processed content
    logInfo("Validating processed content");
    validateProcessedContent(processResult.data);

    logSuccess("Document processing completed");

    return {
      success: true,
      data: {
        apiData: apiResult.data,
        processedContent: processResult.data,
      },
    };
  } catch (error) {
    logError("Document processing failed", error);

    return {
      success: false,
      error: {
        message: error.message,
        stage: error.stage || "unknown",
        context: error.context || {},
        timestamp: new Date().toISOString(),
      },
    };
  }
}

// File output functions
function saveResults(results, sessionDir) {
  try {
    if (!results.success) {
      // Save error information
      const errorFile = path.join(sessionDir, "error.json");
      fs.writeFileSync(errorFile, JSON.stringify(results.error, null, 2));
      logInfo("Error information saved", { file: errorFile });
      return;
    }

    const { apiData, processedContent } = results.data;

    // Save original JSON (unprocessed)
    const originalFile = path.join(sessionDir, "original.json");
    fs.writeFileSync(originalFile, JSON.stringify(apiData, null, 2));

    // Save URLs to txt file
    const urlsFile = path.join(sessionDir, "urls.txt");
    fs.writeFileSync(urlsFile, processedContent.extractedUrls.join("\n"));

    // Save title to txt file
    const titleFile = path.join(sessionDir, "title.txt");
    fs.writeFileSync(titleFile, processedContent.title || "");

    // Save content to markdown file
    const contentFile = path.join(sessionDir, "content.md");
    fs.writeFileSync(contentFile, processedContent.content);

    logSuccess("All results saved to session directory", {
      sessionDir,
      files: ["original.json", "urls.txt", "title.txt", "content.md"],
    });
  } catch (error) {
    logError("Failed to save results", error);
  }
}

// Main execution
async function main() {
  logInfo("Apple Documentation Collector Test Started");
  logInfo("Using unified AppleDocProcessor implementation");

  const results = await processAppleDocument(TEST_URL);

  saveResults(results, SESSION_DIR);

  if (results.success) {
    logSuccess("Test completed successfully");
    console.log("\n" + "=".repeat(60));
    console.log("PROCESSING SUMMARY");
    console.log("=".repeat(60));
    console.log(`Title: ${results.data.processedContent.title}`);
    console.log(
      `Content Length: ${results.data.processedContent.content.length} characters`
    );
    console.log(
      `Extracted URLs: ${results.data.processedContent.extractedUrls.length}`
    );
    console.log(`Session Directory: ${SESSION_DIR}`);
    console.log("=".repeat(60));
  } else {
    logError("Test failed");
    process.exit(1);
  }
}

// Run the test (ES module equivalent of require.main === module)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logError("Unhandled error in main execution", error);
    process.exit(1);
  });
}

export {
  processAppleDocument,
  validateApiResponse,
  validateProcessedContent,
  ProcessingError,
  ValidationError,
};
