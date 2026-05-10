import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AgenticMyAppConfig } from "../config/types.js";
import { writeJsonFile } from "../runs/runWorkspace.js";
import { redactSecrets } from "../util/redact.js";

export type CheckResult = {
  name: string;
  command: string;
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export function runVerificationCommands(args: {
  cwd: string;
  config: AgenticMyAppConfig;
  runRoot: string;
  candidateId: string;
}): CheckResult[] {
  const results: CheckResult[] = [];
  const outDir = path.join(args.runRoot, "commands");
  fs.mkdirSync(outDir, { recursive: true });
  const redact = args.config.artifacts.redactSecrets;
  const entries = Object.entries(args.config.verification.commands);
  for (const [name, command] of entries) {
    if (!args.config.verification.require[name]) continue;
    const r = spawnSync(command, {
      cwd: args.cwd,
      encoding: "utf8",
      shell: true,
      env: process.env,
    });
    const row: CheckResult = {
      name,
      command,
      ok: !r.error && r.status === 0,
      exitCode: r.status,
      stdout: redact ? redactSecrets(r.stdout ?? "") : (r.stdout ?? ""),
      stderr: redact ? redactSecrets(r.stderr ?? "") : (r.stderr ?? ""),
    };
    results.push(row);
    writeJsonFile(path.join(outDir, `${args.candidateId}-${name}.json`), row);
  }
  return results;
}

export function allRequiredPassed(
  config: AgenticMyAppConfig,
  results: CheckResult[],
): boolean {
  const required = Object.entries(config.verification.require).filter(
    ([, v]) => v,
  );
  for (const [name] of required) {
    const row = results.find((r) => r.name === name);
    if (!row || !row.ok) return false;
  }
  return true;
}
