import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

let satisfied = false;

/** Common install locations when `rg` is not on PATH under a resolvable name. */
const COMMON_RG_PATHS =
  process.platform === "darwin"
    ? ["/opt/homebrew/bin/rg", "/usr/local/bin/rg"]
    : process.platform === "linux"
      ? ["/usr/bin/rg", "/usr/local/bin/rg"]
      : [];

function resolveRgFromPath(): string | undefined {
  for (const candidate of COMMON_RG_PATHS) {
    if (candidate && fs.existsSync(candidate)) return path.resolve(candidate);
  }
  try {
    const cmd = process.platform === "win32" ? "where rg" : "command -v rg";
    const shell =
      process.platform === "win32"
        ? process.env.ComSpec || "cmd.exe"
        : "/bin/sh";
    const out = execSync(cmd, {
      encoding: "utf8",
      shell,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)[0];
    if (out && fs.existsSync(out)) return path.resolve(out);
  } catch {
    /* not on PATH */
  }
  return undefined;
}

/**
 * @cursor/sdk local runtime needs an absolute ripgrep binary path
 * (CURSOR_RIPGREP_PATH). When only `rg` is on PATH without a resolved path,
 * the SDK can throw "Ripgrep path not configured".
 */
export function ensureCursorRipgrepPathEnv(): void {
  if (satisfied) return;

  const existing = process.env.CURSOR_RIPGREP_PATH;
  if (
    existing &&
    path.isAbsolute(existing) &&
    fs.existsSync(existing) &&
    fs.statSync(existing).isFile()
  ) {
    satisfied = true;
    return;
  }

  const resolved = resolveRgFromPath();
  if (!resolved) {
    throw new Error(
      "Ripgrep (rg) is required for Cursor SDK local agents. Install it (e.g. `brew install ripgrep`) " +
        "or set CURSOR_RIPGREP_PATH to the absolute path of the rg binary.",
    );
  }

  process.env.CURSOR_RIPGREP_PATH = resolved;
  satisfied = true;
}
