import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function runDirPath(
  cwd: string,
  artifactsRootRelative: string,
  runId: string,
): string {
  return path.join(cwd, artifactsRootRelative, runId);
}

export function ensureRunDir(params: {
  cwd: string;
  artifactsRootRelative: string;
  runId: string;
}): string {
  const dir = runDirPath(
    params.cwd,
    params.artifactsRootRelative,
    params.runId,
  );
  fs.mkdirSync(path.join(dir, "logs"), { recursive: true });
  fs.mkdirSync(path.join(dir, "artifacts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "transcripts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
  fs.mkdirSync(path.join(dir, "candidates"), { recursive: true });
  fs.mkdirSync(path.join(dir, "verification"), { recursive: true });
  fs.mkdirSync(path.join(dir, "monitor"), { recursive: true });
  fs.mkdirSync(path.join(dir, "commands"), { recursive: true });
  fs.mkdirSync(path.join(dir, "prompts"), { recursive: true });
  const statePath = path.join(dir, "state.json");
  if (!fs.existsSync(statePath)) {
    fs.writeFileSync(
      statePath,
      `${JSON.stringify(
        {
          runId: params.runId,
          createdAt: new Date().toISOString(),
          phase: "NEW",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
  return dir;
}

export function newRunId(): string {
  return randomUUID();
}
