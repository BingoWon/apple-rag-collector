/**
 * Telegram Notifier - 简单的Telegram通知系统
 */

class TelegramNotifier {
  private readonly url: string;
  private readonly enabled: boolean;

  constructor() {
    this.url = process.env["TELEGRAM_BOT_URL"] || "";
    this.enabled = Boolean(this.url);
  }

  async notifyError(error: Error): Promise<void> {
    if (!this.enabled) return;
    const text = `🚨 <b>Apple RAG Collector Error:</b> ${error.message}`;
    await this.send(text);
  }

  async notifyWarning(message: string): Promise<void> {
    if (!this.enabled) return;
    const text = `⚠️ <b>Apple RAG Collector Warning:</b> ${message}`;
    await this.send(text);
  }

  async notifyInfo(message: string): Promise<void> {
    if (!this.enabled) return;
    const text = `ℹ️ <b>Apple RAG Collector:</b> ${message}`;
    await this.send(text);
  }

  private async send(text: string): Promise<void> {
    try {
      await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, parse_mode: "HTML" }),
      });
    } catch (error) {
      // 静默处理错误
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getConfig(): { enabled: boolean; hasUrl: boolean } {
    return {
      enabled: this.enabled,
      hasUrl: Boolean(this.url),
    };
  }
}

// 创建全局实例
const telegramNotifier = new TelegramNotifier();

export { TelegramNotifier, telegramNotifier };
