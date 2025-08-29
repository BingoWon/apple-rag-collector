// Apple Documentation Batch Chunker Comparison Test Script
// This script tests multiple URLs to ensure Python and TypeScript chunking implementations are identical

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

// Import our unified processors and chunker
import { AppleAPIClient } from '../src/AppleAPIClient.js';
import { ContentProcessor } from '../src/ContentProcessor.js';
import { Chunker } from '../src/Chunker.js';

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const OUTPUT_DIR = path.join(__dirname, 'batch-chunker-comparison-output');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5) + 'Z';
const SESSION_DIR = path.join(OUTPUT_DIR, TIMESTAMP);
const TEST_URLS_FILE = path.join(__dirname, 'test_urls.txt');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}
if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
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

// Read test URLs
function readTestUrls() {
  try {
    const content = fs.readFileSync(TEST_URLS_FILE, 'utf8');
    const urls = content.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .filter((url, index, array) => array.indexOf(url) === index); // Remove duplicates
    
    logInfo(`Loaded ${urls.length} unique test URLs`);
    return urls;
  } catch (error) {
    logError('Failed to read test URLs file', error);
    throw error;
  }
}

// Collect content using TypeScript implementation
async function collectContent(url) {
  try {
    const apiClient = new AppleAPIClient();
    const contentProcessor = new ContentProcessor();
    
    const apiResult = await apiClient.fetchDocuments([url]);
    console.log(`API Result for ${url}:`, apiResult[0]?.data ? 'success' : 'failed', apiResult[0]?.error);

    if (!apiResult[0]?.data) {
      throw new Error(`Failed to fetch document: ${apiResult[0]?.error || 'Unknown error'}`);
    }

    const processedResult = await contentProcessor.processDocuments(apiResult);
    console.log(`Processed Result for ${url}:`, processedResult[0]?.data ? 'success' : 'failed', processedResult[0]?.error);
    console.log(`Processed Result structure:`, JSON.stringify(processedResult[0], null, 2));

    if (!processedResult[0]?.data) {
      throw new Error(`Failed to process document: ${processedResult[0]?.error || 'Unknown error'}`);
    }

    const processedContent = processedResult[0].data;

    return processedContent;
  } catch (error) {
    logError(`Content collection failed for ${url}`, error);
    throw error;
  }
}

// Run TypeScript chunking
function runTypeScriptChunking(processedData) {
  try {
    const chunker = new Chunker({ batchSize: 1 });
    // Use batch processing interface - this is the correct pure batch architecture
    const batchResults = chunker.chunkTexts([{
      url: 'test-url',
      title: processedData.title,
      content: processedData.content
    }]);

    if (batchResults.length > 0 && batchResults[0].data) {
      return batchResults[0].data;
    } else {
      throw new Error(batchResults[0]?.error || 'Chunking failed');
    }
  } catch (error) {
    logError('TypeScript chunking failed', error);
    throw error;
  }
}

// Run Python chunking
function runPythonChunking(processedData) {
  return new Promise((resolve, reject) => {
    const pythonScript = `
import sys
import json
sys.path.append('${__dirname}')
from chunker import SmartChunker

# Read input from stdin
input_data = json.loads(sys.stdin.read())
content = input_data['content']
title = input_data.get('title', '')

# Initialize chunker and process
chunker = SmartChunker()
chunks = chunker.chunk_text(content, title)

# Output results as JSON
result = {
    "chunks": chunks,
    "chunk_count": len(chunks)
}
print(json.dumps(result, ensure_ascii=False))
`;

    const tempScriptPath = path.join(SESSION_DIR, `temp_chunker_${Date.now()}.py`);
    fs.writeFileSync(tempScriptPath, pythonScript);
    
    const pythonProcess = spawn('python3', [tempScriptPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    pythonProcess.on('close', (code) => {
      // Clean up temp file
      try {
        fs.unlinkSync(tempScriptPath);
      } catch (e) {
        // Ignore cleanup errors
      }
      
      if (code !== 0) {
        reject(new Error(`Python process exited with code ${code}: ${stderr}`));
        return;
      }
      
      try {
        const result = JSON.parse(stdout);
        resolve(result.chunks);
      } catch (error) {
        reject(new Error(`Failed to parse Python output: ${error.message}`));
      }
    });
    
    // Send processed data to Python process
    pythonProcess.stdin.write(JSON.stringify(processedData));
    pythonProcess.stdin.end();
  });
}

// Compare chunks for a single URL
function compareChunks(tsChunks, pyChunks, url) {
  const comparison = {
    url: url,
    typescript: {
      count: tsChunks.length,
      totalLength: tsChunks.join('').length
    },
    python: {
      count: pyChunks.length,
      totalLength: pyChunks.join('').length
    },
    identical: false,
    differences: []
  };
  
  // Check if counts match
  if (tsChunks.length !== pyChunks.length) {
    comparison.differences.push(`Chunk count mismatch: TS=${tsChunks.length}, Python=${pyChunks.length}`);
  }
  
  // Check if chunks are identical
  const maxChunks = Math.max(tsChunks.length, pyChunks.length);
  let identicalChunks = 0;
  
  for (let i = 0; i < maxChunks; i++) {
    const tsChunk = tsChunks[i] || '';
    const pyChunk = pyChunks[i] || '';
    
    if (tsChunk === pyChunk) {
      identicalChunks++;
    } else {
      comparison.differences.push(`Chunk ${i} differs (TS: ${tsChunk.length} chars, Python: ${pyChunk.length} chars)`);
    }
  }
  
  comparison.identical = identicalChunks === maxChunks && tsChunks.length === pyChunks.length;
  comparison.identicalChunks = identicalChunks;
  
  return comparison;
}

// Test a single URL
async function testSingleUrl(url, index, total) {
  logInfo(`Testing URL ${index + 1}/${total}: ${url}`);
  
  try {
    // Step 1: Collect content
    const processedData = await collectContent(url);
    logInfo(`Content collected (${processedData.content.length} characters)`);

    // Step 2: Run TypeScript chunking
    const tsChunks = runTypeScriptChunking(processedData);
    logInfo(`TypeScript chunking completed (${tsChunks.length} chunks)`);

    // Step 3: Run Python chunking
    const pyChunks = await runPythonChunking(processedData);
    logInfo(`Python chunking completed (${pyChunks.length} chunks)`);
    
    // Step 4: Compare results
    const comparison = compareChunks(tsChunks, pyChunks, url);
    
    // Step 5: Save individual results
    const urlDir = path.join(SESSION_DIR, `url_${index + 1}`);
    if (!fs.existsSync(urlDir)) {
      fs.mkdirSync(urlDir, { recursive: true });
    }
    
    fs.writeFileSync(path.join(urlDir, 'url.txt'), url);
    fs.writeFileSync(path.join(urlDir, 'content.md'), processedData.content);
    fs.writeFileSync(path.join(urlDir, 'processed_result.json'), JSON.stringify(processedData, null, 2));
    fs.writeFileSync(path.join(urlDir, 'typescript_chunks.json'), JSON.stringify(tsChunks, null, 2));
    fs.writeFileSync(path.join(urlDir, 'python_chunks.json'), JSON.stringify(pyChunks, null, 2));
    fs.writeFileSync(path.join(urlDir, 'comparison.json'), JSON.stringify(comparison, null, 2));
    
    if (comparison.identical) {
      logSuccess(`URL ${index + 1}/${total} PASSED: Results are identical`);
    } else {
      logError(`URL ${index + 1}/${total} FAILED: Results differ`, { differences: comparison.differences });
    }
    
    return comparison;
    
  } catch (error) {
    logError(`URL ${index + 1}/${total} ERROR: ${error.message}`, error);
    return {
      url: url,
      error: error.message,
      identical: false,
      differences: [`Error: ${error.message}`]
    };
  }
}

// Main batch testing function
async function runBatchTest() {
  logInfo('Apple Documentation Batch Chunker Comparison Test Started');
  
  try {
    // Read test URLs
    const urls = readTestUrls();
    
    if (urls.length === 0) {
      throw new Error('No test URLs found');
    }
    
    // Test each URL
    const results = [];
    for (let i = 0; i < urls.length; i++) {
      const result = await testSingleUrl(urls[i], i, urls.length);
      results.push(result);
      
      // Add a small delay between tests to avoid overwhelming the server
      if (i < urls.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Generate summary report
    const summary = {
      totalUrls: urls.length,
      passedUrls: results.filter(r => r.identical).length,
      failedUrls: results.filter(r => !r.identical).length,
      results: results
    };
    
    // Save summary report
    fs.writeFileSync(path.join(SESSION_DIR, 'batch_test_summary.json'), JSON.stringify(summary, null, 2));
    
    // Display results
    console.log('\n' + '='.repeat(100));
    console.log('BATCH CHUNKING COMPARISON RESULTS');
    console.log('='.repeat(100));
    console.log(`Total URLs Tested: ${summary.totalUrls}`);
    console.log(`Passed (Identical): ${summary.passedUrls}`);
    console.log(`Failed (Different): ${summary.failedUrls}`);
    console.log(`Success Rate: ${((summary.passedUrls / summary.totalUrls) * 100).toFixed(1)}%`);
    
    if (summary.failedUrls > 0) {
      console.log('\nFailed URLs:');
      results.filter(r => !r.identical).forEach((result, index) => {
        console.log(`  ${index + 1}. ${result.url}`);
        if (result.differences) {
          result.differences.slice(0, 3).forEach(diff => console.log(`     - ${diff}`));
        }
      });
    }
    
    console.log(`\nSession Directory: ${SESSION_DIR}`);
    console.log('='.repeat(100));
    
    if (summary.failedUrls === 0) {
      logSuccess('All tests passed! Python and TypeScript implementations are identical across all URLs.');
      return true;
    } else {
      logError(`${summary.failedUrls} out of ${summary.totalUrls} tests failed.`);
      return false;
    }
    
  } catch (error) {
    logError('Batch test failed', error);
    return false;
  }
}

// Run the batch test
if (import.meta.url === `file://${process.argv[1]}`) {
  runBatchTest().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    logError('Unhandled error in batch test execution', error);
    process.exit(1);
  });
}

export { runBatchTest, testSingleUrl, compareChunks };
