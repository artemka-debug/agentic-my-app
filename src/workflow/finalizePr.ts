import fs from "node:fs";
import path from "node:path";
import type { LoadedConfig } from "../config/loadConfig.js";
import { resolveCursorApiKey } from "../config/loadConfig.js";
import { logWorkflowStepSkipped, workflowSkips } from "../config/workflowSkipSteps.js";
import { ghOk } from "../util/gh.js";
import { interpolate, readPromptFile } from "../prompts/loadPrompt.js";
import { withWorkflowStepPrompt } from "../prompts/stepPrompt.js";
import {
  readJsonFile,
  readState,
  readTaskInput,
  runPaths,
  writeJsonFile,
  writeState,
} from "../runs/runWorkspace.js";
import { runAgentTurn, type HumanConsultHooks, WorkflowCancelledError } from "../sdk/runAgentTurn.js";
import { envStreamExplicitlyEnabled } from "../util/agenticEnv.js";
import { execGit, gitDiffRange } from "../util/git.js";

type Paths = ReturnType<typeof runPaths>;

function apiKey(loaded: LoadedConfig): string {
  const k = resolveCursorApiKey(loaded);
  if (!k)
    throw new Error(
      `Missing Cursor API key (set ${loaded.config.runtime.cursor.apiKeyEnv}).`,
    );
  return k;
}

export async function runFinalizeAndCreatePr(args: {
  loaded: LoadedConfig;
  paths: Paths;
  consult?: HumanConsultHooks;
  onAgentStreamChunk?: (text: string) => void;
}): Promise<void> {
  const state = readState(args.paths);
  if (state.cancelRequested) {
    state.phase = "CANCELLED";
    writeState(args.paths, state);
    return;
  }
  const candId = state.selectedCandidateId;
  if (!candId) {
    state.phase = "BLOCKED_NEEDS_USER";
    state.lastError = "No selected candidate";
    writeState(args.paths, state);
    return;
  }
  const meta = readJsonFile<{
    worktreePath: string;
    branch: string;
  }>(path.join(args.paths.candidatesDir, `${candId}.json`));
  if (!meta.worktreePath)
    throw new Error(`Candidate ${candId} missing worktreePath`);

  state.phase = "FINALIZING";
  writeState(args.paths, state);

  const task = readTaskInput(args.paths);
  const requirements = fs.readFileSync(args.paths.requirements, "utf8");
  const diff = gitDiffRange({
    cwd: meta.worktreePath,
    base: `origin/${task.repo.defaultBranch}`,
  });
  const prompt = interpolate(readPromptFile("finalize.md"), {
    REQUIREMENTS: requirements.slice(0, 8000),
    DIFF_SUMMARY: diff.slice(0, 12000),
    ISSUE: `${task.title}\n\n${task.description}`.slice(0, 6000),
  });

  if (workflowSkips("finalizer", args.loaded.config.workflow)) {
    logWorkflowStepSkipped("finalizer");
  } else {
    try {
      await runAgentTurn({
        apiKey: apiKey(args.loaded),
        modelId: args.loaded.config.runtime.cursor.models.finalizer,
        cwd: meta.worktreePath,
        prompt: withWorkflowStepPrompt(
          prompt,
          args.loaded,
          "finalizer",
        ),
        settingSources: args.loaded.config.runtime.cursor.settingSources,
        transcriptPath: path.join(args.paths.transcriptDir, "finalize.txt"),
        streamStdout: envStreamExplicitlyEnabled(),
        consult: args.consult,
        onStreamChunk: args.onAgentStreamChunk,
        shouldAbort: () => readState(args.paths).cancelRequested,
      });
    } catch (e) {
      if (e instanceof WorkflowCancelledError) {
        state.phase = "CANCELLED";
        writeState(args.paths, state);
        return;
      }
      throw e;
    }
  }

  const push = execGit({
    cwd: meta.worktreePath,
    argv: ["push", "-u", "origin", meta.branch],
  });
  if (!push.ok) {
    state.lastError = push.stderr || "git push failed";
    state.phase = "BLOCKED_NEEDS_USER";
    writeState(args.paths, state);
    return;
  }

  const prBodyPath = path.join(args.paths.artifactsDir, "pr-body.md");
  const closes = task.issueNumber ? `Closes #${task.issueNumber}` : "";
  fs.writeFileSync(
    prBodyPath,
    `## Summary\n\nOrchestrated change for: ${task.title}\n\n## Requirements\n\nSee requirements artifact in run folder.\n\n## Verification\n\nSee verification/*.json in run folder.\n\n${closes}\n`,
    "utf8",
  );

  state.phase = "CREATING_PR";
  writeState(args.paths, state);

  const draftFlag = args.loaded.config.github.prDraft ? ["--draft"] : [];
  const pr = ghOk({
    cwd: args.loaded.cwd,
    argv: [
      "pr",
      "create",
      "--repo",
      `${task.repo.owner}/${task.repo.name}`,
      "--base",
      task.repo.defaultBranch,
      "--head",
      meta.branch,
      "--title",
      task.title,
      "--body-file",
      prBodyPath,
      ...draftFlag,
    ],
  });
  if (!pr.ok) {
    state.lastError = pr.stderr || "gh pr create failed";
    state.phase = "BLOCKED_NEEDS_USER";
    writeState(args.paths, state);
    return;
  }

  const url = pr.stdout.trim().split("\n").pop()?.trim() ?? pr.stdout.trim();
  state.prUrl = url;
  state.phase = args.loaded.config.monitoring.enabled
    ? "MONITORING_PR"
    : "COMPLETED";
  writeState(args.paths, state);

  writeJsonFile(path.join(args.paths.artifactsDir, "pr-create.json"), {
    stdout: pr.stdout,
    branch: meta.branch,
    url,
  });
}
