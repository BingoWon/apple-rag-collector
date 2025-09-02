export class KeyManager {
  private readonly db: D1Database;
  private cachedKey: string | null = null;

  constructor(db: D1Database) {
    this.db = db;
  }

  async getCurrentKey(): Promise<string> {
    if (this.cachedKey) return this.cachedKey;

    const result = await this.db
      .prepare(
        "SELECT api_key FROM siliconflow_api_keys ORDER BY id ASC LIMIT 1"
      )
      .first();
    if (!result) throw new Error("No API keys available");

    this.cachedKey = result["api_key"] as string;
    return this.cachedKey;
  }

  async removeKey(key: string): Promise<boolean> {
    const result = await this.db
      .prepare("DELETE FROM siliconflow_api_keys WHERE api_key = ?")
      .bind(key)
      .run();

    if (this.cachedKey === key) this.cachedKey = null;

    return result.success && result.meta.changes > 0;
  }
}
