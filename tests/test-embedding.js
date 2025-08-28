// Embedding System Test Script
// This script tests the SiliconFlow API embedding functionality

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Import our embedding system
import { createEmbedding, getEmbedder, resetEmbedder } from '../dist/EmbeddingProvider.js';
import { KeyManager } from '../dist/KeyManager.js';

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const OUTPUT_DIR = path.join(__dirname, 'embedding-test-output');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5) + 'Z';
const SESSION_DIR = path.join(OUTPUT_DIR, TIMESTAMP);

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}
if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

// Test texts
const TEST_TEXTS = [
  "This is a simple test text for embedding generation.",
  "Apple Developer Documentation provides comprehensive guides for iOS development.",
  "Swift is a powerful programming language for building iOS, macOS, watchOS, and tvOS applications.",
  "The UIKit framework provides the required infrastructure for your iOS or tvOS apps."
];

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

// Test Key Manager
async function testKeyManager() {
  logInfo('Testing Key Manager functionality');
  
  try {
    const keyManager = new KeyManager();
    const stats = keyManager.getStats();
    
    logInfo('Key Manager Stats', stats);
    
    if (stats.totalKeys === 0) {
      logError('No API keys found. Please add keys to config/api_keys.txt');
      return false;
    }
    
    const currentKey = keyManager.getCurrentKey();
    logInfo(`Current API key: ${currentKey.slice(0, 20)}...`);
    
    logSuccess('Key Manager test passed');
    return true;
    
  } catch (error) {
    logError('Key Manager test failed', error);
    return false;
  }
}

// Test single embedding generation
async function testSingleEmbedding(text, index) {
  logInfo(`Testing embedding generation for text ${index + 1}`);
  
  try {
    const startTime = Date.now();
    const embedding = await createEmbedding(text);
    const endTime = Date.now();
    
    const duration = endTime - startTime;
    
    // Validate embedding
    if (!Array.isArray(embedding)) {
      throw new Error('Embedding is not an array');
    }
    
    if (embedding.length !== 2560) {
      throw new Error(`Expected embedding dimension 2560, got ${embedding.length}`);
    }
    
    // Check if normalized (L2 norm should be close to 1)
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (Math.abs(norm - 1.0) > 0.01) {
      throw new Error(`Embedding not properly normalized. L2 norm: ${norm}`);
    }
    
    const result = {
      text: text,
      embedding_length: embedding.length,
      l2_norm: norm,
      duration_ms: duration,
      first_5_values: embedding.slice(0, 5),
      last_5_values: embedding.slice(-5)
    };
    
    // Save embedding to file
    const embeddingFile = path.join(SESSION_DIR, `embedding_${index + 1}.json`);
    fs.writeFileSync(embeddingFile, JSON.stringify({
      text: text,
      embedding: embedding,
      metadata: {
        dimension: embedding.length,
        l2_norm: norm,
        duration_ms: duration,
        timestamp: new Date().toISOString()
      }
    }, null, 2));
    
    logSuccess(`Embedding ${index + 1} generated successfully`, result);
    return result;
    
  } catch (error) {
    logError(`Embedding generation failed for text ${index + 1}`, error);
    throw error;
  }
}

// Test batch embedding generation
async function testBatchEmbedding() {
  logInfo('Testing batch embedding generation');
  
  const results = [];
  const startTime = Date.now();
  
  for (let i = 0; i < TEST_TEXTS.length; i++) {
    const result = await testSingleEmbedding(TEST_TEXTS[i], i);
    results.push(result);
    
    // Add small delay between requests to be respectful to the API
    if (i < TEST_TEXTS.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  const endTime = Date.now();
  const totalDuration = endTime - startTime;
  
  // Calculate statistics
  const stats = {
    total_texts: results.length,
    total_duration_ms: totalDuration,
    average_duration_ms: totalDuration / results.length,
    min_duration_ms: Math.min(...results.map(r => r.duration_ms)),
    max_duration_ms: Math.max(...results.map(r => r.duration_ms)),
    all_normalized: results.every(r => Math.abs(r.l2_norm - 1.0) < 0.01),
    embedding_dimension: results[0]?.embedding_length || 0
  };
  
  // Save batch results
  const batchFile = path.join(SESSION_DIR, 'batch_results.json');
  fs.writeFileSync(batchFile, JSON.stringify({
    statistics: stats,
    results: results
  }, null, 2));
  
  logSuccess('Batch embedding generation completed', stats);
  return stats;
}

// Test embedding provider info
async function testProviderInfo() {
  logInfo('Testing embedding provider information');
  
  try {
    const embedder = getEmbedder();
    
    const info = {
      model_name: embedder.modelName,
      embedding_dimension: embedder.embeddingDim,
      provider_type: embedder.constructor.name
    };
    
    logSuccess('Provider information retrieved', info);
    return info;
    
  } catch (error) {
    logError('Failed to get provider information', error);
    throw error;
  }
}

// Main test function
async function runEmbeddingTests() {
  logInfo('Embedding System Test Started');
  
  try {
    // Test 1: Key Manager
    const keyManagerOk = await testKeyManager();
    if (!keyManagerOk) {
      throw new Error('Key Manager test failed');
    }
    
    // Test 2: Provider Info
    const providerInfo = await testProviderInfo();
    
    // Test 3: Batch Embedding
    const batchStats = await testBatchEmbedding();
    
    // Generate summary report
    const summary = {
      test_session: TIMESTAMP,
      provider_info: providerInfo,
      batch_statistics: batchStats,
      all_tests_passed: true,
      session_directory: SESSION_DIR
    };
    
    // Save summary
    const summaryFile = path.join(SESSION_DIR, 'test_summary.json');
    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
    
    // Display results
    console.log('\n' + '='.repeat(80));
    console.log('EMBEDDING SYSTEM TEST RESULTS');
    console.log('='.repeat(80));
    console.log(`Provider: ${providerInfo.provider_type}`);
    console.log(`Model: ${providerInfo.model_name}`);
    console.log(`Embedding Dimension: ${providerInfo.embedding_dimension}`);
    console.log(`Total Texts Processed: ${batchStats.total_texts}`);
    console.log(`Average Duration: ${batchStats.average_duration_ms.toFixed(2)}ms`);
    console.log(`All Embeddings Normalized: ${batchStats.all_normalized ? 'YES' : 'NO'}`);
    console.log(`Session Directory: ${SESSION_DIR}`);
    console.log('='.repeat(80));
    
    logSuccess('All embedding tests passed successfully!');
    return true;
    
  } catch (error) {
    logError('Embedding tests failed', error);
    return false;
  }
}

// Run the tests
if (import.meta.url === `file://${process.argv[1]}`) {
  runEmbeddingTests().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    logError('Unhandled error in embedding tests', error);
    process.exit(1);
  });
}

export { runEmbeddingTests, testSingleEmbedding, testKeyManager };
