/**
 * API Key管理器 - 最巧妙精简有效的实现
 * 
 * 一个文本文件，每行一个key，失效就删除。
 * 没有复杂的JSON，没有状态跟踪，没有冗余功能。
 */

import fs from 'fs';
import path from 'path';

export class KeyManager {
  /**
   * API Key管理器 - 优雅现代精简的全局最优解
   */
  
  private keysFile: string;
  private currentIndex: number = 0;
  private readonly lock = new Map<string, boolean>(); // Simple lock mechanism

  constructor(keysFile: string = "api_keys.txt") {
    this.keysFile = keysFile;
    
    // 确保文件存在
    if (!fs.existsSync(this.keysFile)) {
      const dir = path.dirname(this.keysFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.keysFile, "");
    }
  }

  /**
   * 获取当前索引的key
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
   * 读取所有keys
   */
  private readKeys(): string[] {
    try {
      const content = fs.readFileSync(this.keysFile, 'utf8').trim();
      if (!content) {
        return [];
      }
      return content.split('\n')
        .map(key => key.trim())
        .filter(key => key.length > 0);
    } catch (error) {
      return [];
    }
  }

  /**
   * 切换到下一个可用key
   */
  switchToNextKey(): string {
    this.acquireLock();
    try {
      const keys = this.readKeys();
      if (keys.length === 0) {
        throw new Error("No API keys available");
      }

      // 切换到下一个key
      this.currentIndex = (this.currentIndex + 1) % keys.length;

      const currentKey = keys[this.currentIndex];
      if (!currentKey) {
        throw new Error("Invalid key at switched index");
      }

      console.log(`🔄 Switched to next key: ${currentKey.slice(0, 20)}...`);
      return currentKey;
    } finally {
      this.releaseLock();
    }
  }

  /**
   * 删除失效的key
   */
  async removeKey(key: string): Promise<boolean> {
    this.acquireLock();
    try {
      const keys = this.readKeys();
      const keyIndex = keys.indexOf(key);
      
      if (keyIndex === -1) {
        return false;
      }

      // 删除失效key
      keys.splice(keyIndex, 1);

      // 调整当前索引
      if (keyIndex <= this.currentIndex && this.currentIndex > 0) {
        this.currentIndex -= 1;
      } else if (this.currentIndex >= keys.length && keys.length > 0) {
        this.currentIndex = 0;
      }

      // 写回文件
      fs.writeFileSync(this.keysFile, keys.join('\n'));

      console.log(`🗑️ Removed failed key: ${key.slice(0, 20)}...`);
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
   * 添加新key
   */
  async addKey(key: string): Promise<void> {
    this.acquireLock();
    try {
      const keys = this.readKeys();
      if (!keys.includes(key)) {
        keys.push(key);
        fs.writeFileSync(this.keysFile, keys.join('\n'));
      }
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Simple lock mechanism
   */
  private acquireLock(): void {
    const lockKey = 'keymanager';
    while (this.lock.get(lockKey)) {
      // Busy wait - in a real implementation, you might want to use a proper mutex
      // For this simple case, the synchronous nature of Node.js makes this sufficient
    }
    this.lock.set(lockKey, true);
  }

  private releaseLock(): void {
    const lockKey = 'keymanager';
    this.lock.delete(lockKey);
  }
}
