import fs from "node:fs";
import path from "node:path";
import { envLogStdoutEnabled } from "../util/agenticEnv.js";
import { redactSecrets } from "../util/redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEvent = {
  timestamp: string;
  runId: string;
  level: LogLevel;
  component: string;
  event: string;
  data?: unknown;
};

export type Logger = {
  log: (level: LogLevel, event: string, data?: unknown) => void;
};

export function createLogger(args: {
  runId: string;
  component: string;
  jsonlPath?: string;
  /** Merged into every log event `data` for Telegram (and similar) correlation. */
  telegramContext?: {
    telegramChatId?: number;
    telegramUserId?: number;
    taskId?: string;
  };
}): Logger {
  const tg = args.telegramContext;
  const mergeData = (data: unknown | undefined): unknown | undefined => {
    if (!tg) return data;
    const base = {
      ...(tg.telegramChatId !== undefined
        ? { telegramChatId: tg.telegramChatId }
        : {}),
      ...(tg.telegramUserId !== undefined
        ? { telegramUserId: tg.telegramUserId }
        : {}),
      ...(tg.taskId !== undefined ? { taskId: tg.taskId } : {}),
    };
    if (data === undefined) return base;
    if (typeof data === "object" && data !== null && !Array.isArray(data)) {
      return { ...base, ...(data as Record<string, unknown>) };
    }
    return { ...base, detail: data };
  };
  const writeLine = (ev: LogEvent) => {
    const payload = { ...ev };
    if (payload.data !== undefined) {
      try {
        const s = JSON.stringify(payload.data);
        payload.data = JSON.parse(redactSecrets(s)) as unknown;
      } catch {
        payload.data = redactSecrets(String(payload.data)) as unknown;
      }
    }
    const line = `${JSON.stringify(payload)}\n`;
    if (args.jsonlPath) {
      fs.mkdirSync(path.dirname(args.jsonlPath), { recursive: true });
      fs.appendFileSync(args.jsonlPath, line, "utf8");
    }
    if (ev.level === "error" || ev.level === "warn") {
      process.stderr.write(line);
    } else if (envLogStdoutEnabled()) {
      process.stdout.write(line);
    }
  };

  return {
    log(level, event, data) {
      const merged = mergeData(data);
      const payload: LogEvent = {
        timestamp: new Date().toISOString(),
        runId: args.runId,
        level,
        component: args.component,
        event,
        ...(merged !== undefined ? { data: merged } : {}),
      };
      writeLine(payload);
    },
  };
}
