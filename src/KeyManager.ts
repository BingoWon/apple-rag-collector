/**
 * API Key Manager - Elegant and efficient implementation
 *
 * Simple text file with one key per line, remove failed keys.
 * No complex JSON, no state tracking, no redundant features.
 */

import fs from "fs";
import path from "path";
import { Logger } from "./utils/logger.js";

export class KeyManager {
  /**
   * API Key Manager - Elegant modern minimal global optimal solution
   */

  private keysFile: string;
  private currentIndex: number = 0;
  private readonly lock = new Map<string, boolean>(); // Simple lock mechanism
  private readonly logger: Logger;

  constructor(keysFile: string = "api_keys.txt", logger?: Logger) {
    this.keysFile = keysFile;
    this.logger = logger || new Logger("info");

    // Ensure file exists
    if (!fs.existsSync(this.keysFile)) {
      const dir = path.dirname(this.keysFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.keysFile, "");
    }
  }

  /**
   * Get current key by index
   */
  getCurrentKey(): string {
    this.acquireLock();
    try {
      if (!fs.existsSync(this.keysFile)) {
        throw new Error("No API keys file found");
      }

      const keys = this.readKeys();
      if (keys.length === 0) {
        throw new Error("No API keys available");
      }

      // 确保索引有效
      if (this.currentIndex >= keys.length) {
        this.currentIndex = 0;
      }

      const currentKey = keys[this.currentIndex];
      if (!currentKey) {
        throw new Error("Invalid key at current index");
      }

      return currentKey;
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Read all keys from file
   */
  private readKeys(): string[] {
    try {
      const content = fs.readFileSync(this.keysFile, "utf8").trim();
      if (!content) {
        return [];
      }
      return content
        .split("\n")
        .map((key) => key.trim())
        .filter((key) => key.length > 0);
    } catch (error) {
      return [];
    }
  }

  /**
   * Switch to next available key
   */
  switchToNextKey(): string {
    this.acquireLock();
    try {
      const keys = this.readKeys();
      if (keys.length === 0) {
        throw new Error("No API keys available");
      }

      // Switch to next key
      this.currentIndex = (this.currentIndex + 1) % keys.length;

      const currentKey = keys[this.currentIndex];
      if (!currentKey) {
        throw new Error("Invalid key at switched index");
      }

      this.logger.debug(
        `🔄 Switched to next key: ${currentKey.slice(0, 20)}...`
      );
      return currentKey;
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Remove failed key
   */
  async removeKey(key: string): Promise<boolean> {
    this.acquireLock();
    try {
      const keys = this.readKeys();
      const keyIndex = keys.indexOf(key);

      if (keyIndex === -1) {
        return false;
      }

      // Remove failed key
      keys.splice(keyIndex, 1);

      // Adjust current index
      if (keyIndex <= this.currentIndex && this.currentIndex > 0) {
        this.currentIndex -= 1;
      } else if (this.currentIndex >= keys.length && keys.length > 0) {
        this.currentIndex = 0;
      }

      // 写回文件
      fs.writeFileSync(this.keysFile, keys.join("\n"));

      this.logger.debug(`🗑️ Removed failed key: ${key.slice(0, 20)}...`);
      return true;
    } finally {
      this.releaseLock();
    }
  }

  /**
   * 获取简单统计
   */
  getStats(): { totalKeys: number } {
    this.acquireLock();
    try {
      const keys = this.readKeys();
      return { totalKeys: keys.length };
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Add new key
   */
  async addKey(key: string): Promise<void> {
    this.acquireLock();
    try {
      const keys = this.readKeys();
      if (!keys.includes(key)) {
        keys.push(key);
        fs.writeFileSync(this.keysFile, keys.join("\n"));
      }
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Simple lock mechanism
   */
  private acquireLock(): void {
    const lockKey = "keymanager";
    while (this.lock.get(lockKey)) {
      // Busy wait - in a real implementation, you might want to use a proper mutex
      // For this simple case, the synchronous nature of Node.js makes this sufficient
    }
    this.lock.set(lockKey, true);
  }

  private releaseLock(): void {
    const lockKey = "keymanager";
    this.lock.delete(lockKey);
  }
}
