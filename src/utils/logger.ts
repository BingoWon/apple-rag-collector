/**
 * Modern logging system for Node.js applications
 * Supports structured logging with configurable levels and webhook notifications
 */

import { telegramNotifier } from "./telegram-notifier.js";

type LogLevel = "debug" | "info" | "warn" | "error";

class Logger {
  private level: LogLevel;
  private levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(level: LogLevel = "info") {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.level];
  }

  private formatMessage(
    message: string,
    data?: Record<string, unknown>
  ): string {
    // Unified simple text format - infrastructure handles timestamps
    if (data && Object.keys(data).length > 0) {
      return `${message} ${JSON.stringify(data)}`;
    }
    return message;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog("debug")) {
      console.log(this.formatMessage(message, data));
    }
  }

  info(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog("info")) {
      console.log(this.formatMessage(message, data));
    }
  }

  async warn(message: string, data?: Record<string, unknown>): Promise<void> {
    if (this.shouldLog("warn")) {
      const fullMessage = this.formatMessage(message, data);
      console.warn(fullMessage);
      try {
        await telegramNotifier.notifyWarning(fullMessage);
      } catch {}
    }
  }

  async error(message: string, data?: Record<string, unknown>): Promise<void> {
    if (this.shouldLog("error")) {
      const fullMessage = this.formatMessage(message, data);
      console.error(fullMessage);
      try {
        await telegramNotifier.notifyError(new Error(fullMessage));
      } catch {}
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }
}

export { Logger, type LogLevel };
