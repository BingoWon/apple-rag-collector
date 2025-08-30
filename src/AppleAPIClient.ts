import { type AppleAPIResponse, type BatchResult } from "./types/index.js";
import { BatchErrorHandler } from "./utils/batch-error-handler.js";
import { Logger } from "./utils/logger.js";

class AppleAPIClient {
  private static readonly JSON_API_BASE =
    "https://developer.apple.com/tutorials/data" as const;
  private logger = new Logger();

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

    // Log error (automatically sends Telegram notification)
    if (result.error) {
      await this.logger.error(`Apple Doc Fetch Failed: ${documentUrl}`, {
        error: result.error,
      });
    }

    return result;
  }

  private convertUrlToJsonApi(url: string): string {
    try {
      const urlObj = new URL(url);
      let path = urlObj.pathname;
      if (path.endsWith("/")) {
        path = path.slice(0, -1);
      }
      return `${AppleAPIClient.JSON_API_BASE}${path}.json`;
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
