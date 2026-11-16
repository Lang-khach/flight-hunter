import { telegramCreds } from "./settings.js";

export async function tgCall<T = any>(token: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(json.description ?? `HTTP ${res.status}`);
  return json.result as T;
}

export async function sendTelegram(text: string, token: string, chatId: string) {
  await tgCall(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

export class Notifier {
  constructor(private telegramEnabled: boolean) {}

  async send(text: string): Promise<{ ok: boolean; error?: string }> {
    console.log("🔔 " + text.replace(/<[^>]+>/g, ""));
    if (!this.telegramEnabled) return { ok: false, error: "Telegram đang tắt" };
    const { token, chatId } = telegramCreds();
    if (!token || !chatId) {
      console.warn("[notify] Bật Telegram nhưng chưa có Bot token / Chat ID (vào web → Telegram để cấu hình)");
      return { ok: false, error: "Thiếu Bot token / Chat ID" };
    }
    try {
      await sendTelegram(text, token, chatId);
      return { ok: true };
    } catch (e) {
      const error = (e as Error).message;
      console.warn("[notify] Không gửi được Telegram:", error);
      return { ok: false, error };
    }
  }
}
