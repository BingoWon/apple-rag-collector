import { type AppleAPIResponse } from './types/index.js';

class AppleAPIClient {
  private static readonly JSON_API_BASE = 'https://developer.apple.com/tutorials/data' as const;

  async fetchDocumentJSON(documentUrl: string): Promise<AppleAPIResponse> {
    try {
      const url = this.convertUrlToJsonApi(documentUrl);

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
        },
      });

      // Handle permanent error status codes - these indicate URLs that should be deleted
      const PERMANENT_ERROR_CODES = [403, 404, 410];

      if (PERMANENT_ERROR_CODES.includes(response.status)) {
        throw new Error(`PERMANENT_ERROR:${response.status}:${documentUrl}`);
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as AppleAPIResponse;
      this.validateDocumentData(data);
      return data;
    } catch (error) {
      throw new Error(
        `Apple API fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private convertUrlToJsonApi(url: string): string {
    try {
      const urlObj = new URL(url);

      // Extract path after developer.apple.com
      let path = urlObj.pathname;

      // Remove trailing slash if present
      if (path.endsWith('/')) {
        path = path.slice(0, -1);
      }

      // Build JSON API URL: https://developer.apple.com/tutorials/data + path + .json
      return `${AppleAPIClient.JSON_API_BASE}${path}.json`;
    } catch (error) {
      throw new Error(`Invalid URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private validateDocumentData(data: any): void {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid response: not an object');
    }

    if (!data.metadata && !data.primaryContentSections) {
      throw new Error('Invalid response: missing required fields');
    }
  }
}

export { AppleAPIClient };
