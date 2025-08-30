import { type AppleAPIResponse, type BatchResult } from "./types/index.js";
import { BatchErrorHandler } from "./utils/batch-error-handler.js";

class AppleAPIClient {
  async fetchDocuments(
    urls: string[]
  ): Promise<BatchResult<AppleAPIResponse>[]> {
    // Direct concurrent fetching - no sub-batching needed
    return await Promise.all(urls.map((url) => this.fetchSingleDocument(url)));
  }

  private async fetchSingleDocument(
    documentUrl: string
  ): Promise<BatchResult<AppleAPIResponse>> {
    const result = await BatchErrorHandler.safeExecute(
      documentUrl,
      async () => {
        const url = this.convertUrlToJsonApi(documentUrl);

        const response = await fetch(url, {
          headers: {
            Accept: "application/json",
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
          },
        });

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
      }
    );

    // Fetch fails will be packed into the result.error field and notified via Telegram.
    // No need to log error here.
    return result;
  }

  private convertUrlToJsonApi(url: string): string {
    try {
      const urlObj = new URL(url);
      let path = urlObj.pathname;
      if (path.endsWith("/")) {
        path = path.slice(0, -1);
      }

      // DocC special handling: use Swift.org API endpoint
      if (url.startsWith("https://developer.apple.com/documentation/docc")) {
        return `https://www.swift.org/data/documentation${path}.json`;
      }

      // Default handling: use Apple's tutorials API
      return `https://developer.apple.com/tutorials/data${path}.json`;
    } catch (error) {
      throw new Error(
        `Invalid URL: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  private validateDocumentData(data: any): void {
    if (!data || typeof data !== "object") {
      throw new Error("Invalid response: not an object");
    }
    if (!data.metadata && !data.primaryContentSections) {
      throw new Error("Invalid response: missing required fields");
    }
  }
}

export { AppleAPIClient };
