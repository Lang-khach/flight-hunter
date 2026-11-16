import fs from "node:fs";
import path from "node:path";

/** Cài đặt bí mật chỉnh được từ giao diện web (lưu data/settings.json, quyền 600) */
export interface Settings {
  telegram: { botToken?: string; chatId?: string };
}

const FILE = path.join(process.env.DATA_DIR ?? "data", "settings.json");

export function getSettings(): Settings {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return { telegram: s.telegram ?? {} };
  } catch {
    return { telegram: {} };
  }
}

export function saveSettings(s: Settings) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
}

/** Ưu tiên cấu hình trên web, sau đó tới .env */
export function telegramCreds() {
  const t = getSettings().telegram;
  return {
    token: t.botToken || process.env.TELEGRAM_BOT_TOKEN || "",
    chatId: t.chatId || process.env.TELEGRAM_CHAT_ID || "",
  };
}

export const maskSecret = (s: string) => (s ? s.slice(0, 4) + "••••••" + s.slice(-4) : "");
