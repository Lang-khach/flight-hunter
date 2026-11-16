import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

interface AdminRecord {
  username: string;
  salt: string;
  hash: string;
  updatedAt: string;
}

const FILE = path.join(process.env.DATA_DIR ?? "data", "auth.json");
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS ?? 12) * 3600_000;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;

const scrypt = (pw: string, salt: string) => crypto.scryptSync(pw, salt, 64, { N: 16384 }).toString("hex");

function readAdmin(): AdminRecord | null {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return null;
  }
}

export const hasAdmin = () => readAdmin() !== null;

export function validatePassword(pw: string): string | null {
  if (pw.length < 8) return "Mật khẩu tối thiểu 8 ký tự";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Mật khẩu cần có cả chữ và số";
  return null;
}

export function setAdmin(username: string, password: string) {
  const err = validatePassword(password);
  if (err) throw new Error(err);
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) throw new Error("Tên đăng nhập 3–32 ký tự (chữ, số, _ . -)");
  const salt = crypto.randomBytes(16).toString("hex");
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const rec: AdminRecord = { username, salt, hash: scrypt(password, salt), updatedAt: new Date().toISOString() };
  fs.writeFileSync(FILE, JSON.stringify(rec, null, 2), { mode: 0o600 });
  sessions.clear(); // đổi mật khẩu → đăng xuất mọi phiên
}

function verify(username: string, password: string): boolean {
  const a = readAdmin();
  if (!a) return false;
  const h = Buffer.from(scrypt(password, a.salt), "hex");
  const ok = crypto.timingSafeEqual(h, Buffer.from(a.hash, "hex"));
  const userOk = crypto.timingSafeEqual(
    crypto.createHash("sha256").update(username).digest(),
    crypto.createHash("sha256").update(a.username).digest(),
  );
  return ok && userOk;
}

// ---------- Phiên đăng nhập (lưu RAM; khởi động lại server = đăng nhập lại) ----------
const sessions = new Map<string, { user: string; exp: number }>();

export function getSession(token?: string) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.exp < Date.now()) {
    sessions.delete(token);
    return null;
  }
  s.exp = Date.now() + SESSION_TTL_MS; // gia hạn khi còn hoạt động
  return s;
}

export const destroySession = (token?: string) => token && sessions.delete(token);

// ---------- Chống dò mật khẩu ----------
const attempts = new Map<string, { fails: number; until: number }>();

export type LoginResult = { ok: true; token: string; maxAgeSec: number } | { ok: false; error: string; status: number };

export function login(ip: string, username: string, password: string): LoginResult {
  const a = attempts.get(ip);
  if (a && a.until > Date.now()) {
    const mins = Math.ceil((a.until - Date.now()) / 60_000);
    return { ok: false, status: 429, error: `Sai quá nhiều lần. Thử lại sau ${mins} phút` };
  }
  if (!verify(String(username ?? ""), String(password ?? ""))) {
    const lockExpired = a && a.until !== 0 && a.until <= Date.now();
    const fails = (lockExpired ? 0 : a?.fails ?? 0) + 1;
    attempts.set(ip, { fails, until: fails >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
    console.warn(`[auth] Đăng nhập sai từ ${ip} (lần ${fails})`);
    return { ok: false, status: 401, error: "Sai tên đăng nhập hoặc mật khẩu" };
  }
  attempts.delete(ip);
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { user: username, exp: Date.now() + SESSION_TTL_MS });
  console.log(`[auth] ${username} đăng nhập từ ${ip}`);
  return { ok: true, token, maxAgeSec: SESSION_TTL_MS / 1000 };
}

export function changePassword(user: string, current: string, next: string) {
  if (!verify(user, current)) throw new Error("Mật khẩu hiện tại không đúng");
  setAdmin(user, next);
}
