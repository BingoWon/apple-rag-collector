class TelegramNotifier {
  private url = "";

  setUrl(url?: string): void {
    this.url = url || "";
  }

  async notify(message: string): Promise<void> {
    if (!this.url) return;
    await this.send(message);
  }

  private async send(text: string): Promise<void> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Telegram] HTTP ${response.status}: ${errorText}`);
        throw new Error(
          `Telegram API error: ${response.status} - ${errorText}`
        );
      }

      const result = (await response.json()) as any;
      if (!result.ok) {
        console.error(`[Telegram] API error:`, result);
        throw new Error(
          `Telegram API error: ${result.description || "Unknown error"}`
        );
      }

      console.log(`[Telegram] Message sent successfully`);
    } catch (error) {
      console.error(
        `[Telegram] Send failed:`,
        error instanceof Error ? error.message : String(error)
      );
      // Don't re-throw to avoid breaking the main process
    }
  }
}

export { TelegramNotifier };
