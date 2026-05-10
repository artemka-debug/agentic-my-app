import path from "node:path";
import {
  parseGitHubIssueRef,
  type ParsedGitHubIssueRef,
} from "../intake/parseIssueRef.js";

/** Canonical task id for a GitHub issue (lowercased owner/repo). */
export function issueTaskId(parsed: ParsedGitHubIssueRef): string {
  return `${parsed.owner.toLowerCase()}/${parsed.name.toLowerCase()}#${parsed.number}`;
}

/**
 * Stable task id for a local markdown task file (under cwd).
 * Prefix `task:` + posix relative path without leading `../`.
 */
export function taskFileTaskId(cwd: string, filePath: string): string {
  const abs = path.resolve(cwd, filePath);
  const rel = path.relative(cwd, abs).replace(/\\/g, "/");
  const safe = rel.replace(/^(\.\.\/)+/, "") || path.basename(abs);
  return `task:${safe}`;
}

/**
 * Normalize user-supplied task id for comparisons (issue forms + `task:` paths).
 */
export function normalizeUserTaskId(
  raw: string,
  repoHint?: string,
): string | null {
  const t = raw.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  if (lower.startsWith("task:")) {
    return `task:${t.slice("task:".length).trim()}`;
  }
  const parsed = parseGitHubIssueRef(t, repoHint);
  if (parsed) return issueTaskId(parsed);
  return null;
}
