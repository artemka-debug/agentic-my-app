import fs from "node:fs";
import path from "node:path";
import type { LoadedConfig } from "../config/loadConfig.js";
import { resolveArtifactsRoot } from "../config/loadConfig.js";

export function resolveTelegramSessionFilePath(loaded: LoadedConfig): string {
  const { absoluteRoot } = resolveArtifactsRoot(loaded);
  return path.join(absoluteRoot, "telegram-sessions.json");
}

export type TelegramSessionRecord = {
  taskId: string;
  runId: string;
  chatId: number;
  userId: number;
  updatedAt: string;
  /** Working directory for this bot deployment (avoids cross-repo collisions). */
  cwd?: string;
};

export type TelegramSessionFile = {
  version: 1;
  runs: TelegramSessionRecord[];
};

export function readTelegramSessionFile(filePath: string): TelegramSessionFile {
  if (!fs.existsSync(filePath)) {
    return { version: 1, runs: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as TelegramSessionFile;
    if (raw.version !== 1 || !Array.isArray(raw.runs)) {
      return { version: 1, runs: [] };
    }
    return raw;
  } catch {
    return { version: 1, runs: [] };
  }
}

export function upsertTelegramSession(
  filePath: string,
  rec: TelegramSessionRecord,
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const cur = readTelegramSessionFile(filePath);
  const next = cur.runs.filter((r) => r.taskId !== rec.taskId);
  next.push(rec);
  fs.writeFileSync(
    filePath,
    `${JSON.stringify({ version: 1, runs: next }, null, 2)}\n`,
    "utf8",
  );
}

export function writeTelegramSessionFile(
  filePath: string,
  runs: TelegramSessionRecord[],
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify({ version: 1, runs }, null, 2)}\n`,
    "utf8",
  );
}

export function removeTelegramSession(filePath: string, taskId: string): void {
  if (!fs.existsSync(filePath)) return;
  const cur = readTelegramSessionFile(filePath);
  const next = cur.runs.filter((r) => r.taskId !== taskId);
  fs.writeFileSync(
    filePath,
    `${JSON.stringify({ version: 1, runs: next }, null, 2)}\n`,
    "utf8",
  );
}

/** Drop any telegram session row pointing at this run (after cancel / dismiss). */
export function removeTelegramSessionRowsForRunId(
  filePath: string,
  runId: string,
): number {
  if (!fs.existsSync(filePath)) return 0;
  const cur = readTelegramSessionFile(filePath);
  const next = cur.runs.filter((r) => r.runId !== runId);
  const removed = cur.runs.length - next.length;
  if (removed === 0) return 0;
  writeTelegramSessionFile(filePath, next);
  return removed;
}

export function findRunIdForTask(
  file: TelegramSessionFile,
  taskId: string,
): string | undefined {
  return file.runs.find((r) => r.taskId === taskId)?.runId;
}

export function findSessionRecordForRunId(
  file: TelegramSessionFile,
  runId: string,
): TelegramSessionRecord | undefined {
  return file.runs.find((r) => r.runId === runId);
}
