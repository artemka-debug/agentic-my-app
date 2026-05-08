import fs from 'node:fs';
import path from 'node:path';

export const AGENTIC_DIR = '.agentic';
export const CONFIG_NAME = 'config.yaml';
export const RUNS_SUBDIR = 'runs';

/** Resolve `.agentic` directory for the harness (nearest from cwd upward). */
export function resolveAgenticRoot(startDir = process.cwd()): string {
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, AGENTIC_DIR);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(path.resolve(startDir), AGENTIC_DIR);
}

export function configPath(agenticRoot: string): string {
  return path.join(agenticRoot, CONFIG_NAME);
}

export function runsDir(agenticRoot: string): string {
  return path.join(agenticRoot, RUNS_SUBDIR);
}

export function runDir(agenticRoot: string, runId: string): string {
  return path.join(runsDir(agenticRoot), runId);
}
