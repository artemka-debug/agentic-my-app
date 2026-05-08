import fs from 'node:fs';
import path from 'node:path';
import { runsDir } from './paths.js';

const RUN_ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

export function slugTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function randomSuffix(len = 5): string {
  let out = '';
  for (let i = 0; i < len; i++) out += RUN_ID_CHARS[Math.floor(Math.random() * RUN_ID_CHARS.length)];
  return out;
}

/** Default run ID when issue number unknown: timestamp + short random segment. */
export function newGenericRunId(): string {
  return `${slugTimestamp()}-${randomSuffix()}`;
}

export function issueRunSlug(issueNumber: number): string {
  return `issue-${issueNumber}-${slugTimestamp()}-${randomSuffix(3)}`;
}

export interface RunLayout {
  runId: string;
  runPath: string;
}

export function ensureRunDirectories(runPath: string): void {
  fs.mkdirSync(path.join(runPath, 'candidates'), { recursive: true });
  fs.mkdirSync(path.join(runPath, 'final'), { recursive: true });
  fs.mkdirSync(path.join(runPath, 'logs'), { recursive: true });
}

export function listRunIds(agenticRoot: string): string[] {
  const rd = runsDir(agenticRoot);
  if (!fs.existsSync(rd)) return [];
  return fs
    .readdirSync(rd, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => {
      const sa = fs.statSync(path.join(rd, a)).mtimeMs;
      const sb = fs.statSync(path.join(rd, b)).mtimeMs;
      return sb - sa;
    });
}

export function latestRunId(agenticRoot: string): string | undefined {
  return listRunIds(agenticRoot)[0];
}
