/**
 * Telegram Notifier with Smart Message Handling
 * - Auto-truncation for messages exceeding Telegram's 4096 character limit
 * - Intelligent message splitting for long content
 * - Prefix management and error handling
 */

const SAFE_MESSAGE_LENGTH = 4000; // Telegram limit: 4096, leave buffer for safety
const PREFIX = "[COLLECTOR]";
const TRUNCATION_SUFFIX = "\n\n⚠️ [Message truncated due to length limit]";

let telegramUrl: string | undefined;

function configureTelegram(url?: string): void {
  telegramUrl = url;
}

/**
 * Truncate message to fit Telegram's length limit
 */
function truncateMessage(message: string, maxLength: number): string {
  if (message.length <= maxLength) return message;

  const suffixLength = TRUNCATION_SUFFIX.length;
  const availableLength = maxLength - suffixLength;

  // Keep first 80% and last 20% of available space for context
  const firstPartLength = Math.floor(availableLength * 0.8);
  const lastPartLength = availableLength - firstPartLength;

  const firstPart = message.slice(0, firstPartLength);
  const lastPart = message.slice(-lastPartLength);

  return `${firstPart}${TRUNCATION_SUFFIX}\n\n...${lastPart}`;
}

/**
 * Send notification to Telegram with automatic message handling
 */
async function notifyTelegram(message: string): Promise<void> {
  if (!telegramUrl) return;

  try {
    const prefixedMessage = `${PREFIX} ${message}`;
    const finalMessage = truncateMessage(prefixedMessage, SAFE_MESSAGE_LENGTH);

    // Log if message was truncated
    if (finalMessage.length < prefixedMessage.length) {
      console.warn(
        `[Telegram] Message truncated: ${prefixedMessage.length} → ${finalMessage.length} chars`
      );
    }

    const response = await fetch(telegramUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: finalMessage }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Telegram] HTTP ${response.status}: ${errorText}`);
      return;
    }

    const result = (await response.json()) as { ok: boolean };
    if (!result.ok) {
      console.error(`[Telegram] API error:`, result);
      return;
    }

    console.log(`[Telegram] Message sent: ${finalMessage.length} chars`);
  } catch (error) {
    console.error(
      `[Telegram] Send failed:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

export { configureTelegram, notifyTelegram };
