import fs from "node:fs";
import path from "node:path";

export function defaultAgenticMyAppRoot(cwd: string): string {
  return path.join(cwd, ".agentic-my-app");
}

export function runDir(root: string, runId: string): string {
  return path.join(root, "runs", runId);
}

export function ensureRunLayout(runPath: string): void {
  fs.mkdirSync(path.join(runPath, "candidates"), { recursive: true });
  fs.mkdirSync(path.join(runPath, "verification"), { recursive: true });
  fs.mkdirSync(path.join(runPath, "artifacts"), { recursive: true });
  fs.mkdirSync(path.join(runPath, "logs"), { recursive: true });
}
