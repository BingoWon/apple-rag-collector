/**
 * 统一的批处理错误处理工具
 * 消除各组件中的重复错误处理代码
 */

import { type BatchResult } from "../types/index.js";

export class BatchErrorHandler {
  /**
   * 创建成功的批处理结果
   */
  static success<T>(url: string, data: T): BatchResult<T> {
    return { url, data };
  }

  /**
   * 创建失败的批处理结果
   */
  static failure<T>(url: string, error: unknown): BatchResult<T> {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return { url, data: null, error: errorMessage };
  }

  /**
   * 安全执行函数并返回批处理结果
   */
  static async safeExecute<T>(
    url: string,
    fn: () => Promise<T> | T
  ): Promise<BatchResult<T>> {
    try {
      const data = await fn();
      return this.success(url, data);
    } catch (error) {
      return this.failure<T>(url, error);
    }
  }

  /**
   * 检查是否为永久错误
   */
  static isPermanentError(error: string): boolean {
    return error.includes("PERMANENT_ERROR:");
  }

  /**
   * 提取永久错误状态码
   */
  static extractPermanentErrorCode(error: string): string {
    const match = error.match(/PERMANENT_ERROR:(\d+):/);
    return match?.[1] || "unknown";
  }
}
