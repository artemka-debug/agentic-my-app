import fs from "node:fs";
import path from "node:path";
import { loadConfig, resolveArtifactsRoot } from "../config/loadConfig.js";
import { createLogger } from "../logging/logger.js";
import { ensureRunDir, newRunId } from "../runs/paths.js";
import { ensureRunLayout } from "../runs/runWorkspace.js";
import {
  buildStubTaskInput,
  buildTaskInputFromGhJson,
  persistTaskInput,
  tryFetchGitHubIssueViaGh,
} from "./githubIssue.js";
import { parseGitHubIssueRef } from "./parseIssueRef.js";
import { buildTaskInputFromMarkdownFile } from "./taskFromFile.js";

/** Create a new run from a GitHub issue ref (same intake as `agentic-my-app full --issue`). */
export function createRunFromIssueSpec(args: {
  cwd: string;
  spec: string;
  repo?: string;
  /** Logger component; default matches `full` intake. */
  logComponent?: string;
}): { runId: string; taskDir: string; title: string; via: "gh_cli" | "stub" } {
  const loaded = loadConfig(args.cwd);
  const repoHint =
    args.repo?.trim() || loaded.config.github.defaultRepo.trim() || undefined;
  const parsed = parseGitHubIssueRef(args.spec, repoHint);
  if (!parsed) {
    throw new Error(
      `Could not parse GitHub issue reference: "${args.spec}". Try owner/repo#123 or a full issues URL.`,
    );
  }

  const runId = newRunId();
  const { relativeRoot } = resolveArtifactsRoot(loaded);
  const taskDir = ensureRunDir({
    cwd: args.cwd,
    artifactsRootRelative: relativeRoot,
    runId,
  });
  ensureRunLayout(taskDir);

  const jsonlPath = path.join(taskDir, "logs", "events.jsonl");
  const log = createLogger({
    runId,
    component: args.logComponent ?? "intake.full_issue",
    jsonlPath,
  });
  log.log("info", "full_intake_started", { parsed });

  const fetched = tryFetchGitHubIssueViaGh({
    owner: parsed.owner,
    name: parsed.name,
    number: parsed.number,
    cwd: args.cwd,
  });
  const ghRecord =
    fetched.ok &&
    fetched.rawJson &&
    typeof fetched.rawJson === "object" &&
    !Array.isArray(fetched.rawJson)
      ? (fetched.rawJson as Record<string, unknown>)
      : null;
  const task = ghRecord
    ? buildTaskInputFromGhJson({
        parsed,
        ghJson: ghRecord,
        loaded,
        runId,
        ...(fetched.ok && fetched.defaultBranch
          ? { defaultBranchOverride: fetched.defaultBranch }
          : {}),
      })
    : buildStubTaskInput({
        parsed,
        loaded,
        runId,
        reason: fetched.ok ? "invalid gh json payload" : fetched.reason,
      });

  persistTaskInput(taskDir, task);
  fs.writeFileSync(
    path.join(taskDir, "config.resolved.json"),
    `${JSON.stringify(loaded.config, null, 2)}\n`,
    "utf8",
  );
  const via = fetched.ok ? "gh_cli" : "stub";
  log.log("info", "full_intake_persisted", {
    taskDir,
    title: task.title,
    via,
  });
  return { runId, taskDir, title: task.title, via };
}

/** Create a new run from a markdown task file (`agentic-my-app full --task`). */
export function createRunFromTaskFile(args: {
  cwd: string;
  taskFile: string;
}): { runId: string; taskDir: string; title: string } {
  const loaded = loadConfig(args.cwd);
  const runId = newRunId();
  const { relativeRoot } = resolveArtifactsRoot(loaded);
  const taskDir = ensureRunDir({
    cwd: args.cwd,
    artifactsRootRelative: relativeRoot,
    runId,
  });
  ensureRunLayout(taskDir);
  const task = buildTaskInputFromMarkdownFile({
    filePath: path.resolve(args.cwd, args.taskFile),
    loaded,
    runId,
  });
  persistTaskInput(taskDir, task);
  fs.writeFileSync(
    path.join(taskDir, "config.resolved.json"),
    `${JSON.stringify(loaded.config, null, 2)}\n`,
    "utf8",
  );
  return { runId, taskDir, title: task.title };
}
