import { TelegramNotifier } from "./telegram-notifier.js";

const telegram = new TelegramNotifier();

class Logger {
  info(message: string): void {
    console.log(message);
  }

  async warn(message: string): Promise<void> {
    console.warn(message);
    await telegram.notify(message);
  }

  async error(message: string): Promise<void> {
    console.error(message);
    await telegram.notify(message);
  }
}

function setupTelegram(url?: string): void {
  telegram.setUrl(url);
}

export { Logger, setupTelegram };
