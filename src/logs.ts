/** Lưu ~400 dòng log gần nhất để xem trên web */
export interface LogLine {
  at: string;
  level: "info" | "warn" | "error";
  msg: string;
}

const buf: LogLine[] = [];
const MAX = 400;

export function installLogCapture() {
  const wrap = (level: LogLine["level"], orig: (...a: unknown[]) => void) =>
    (...args: unknown[]) => {
      orig(...args);
      const msg = args.map((a) => (typeof a === "string" ? a : a instanceof Error ? a.message : JSON.stringify(a))).join(" ");
      buf.push({ at: new Date().toISOString(), level, msg });
      if (buf.length > MAX) buf.splice(0, buf.length - MAX);
    };
  console.log = wrap("info", console.log.bind(console));
  console.warn = wrap("warn", console.warn.bind(console));
  console.error = wrap("error", console.error.bind(console));
}

export const recentLogs = (n = 200) => buf.slice(-n);
