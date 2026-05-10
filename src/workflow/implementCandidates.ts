import fs from "node:fs";
import path from "node:path";
import type { LoadedConfig } from "../config/loadConfig.js";
import { resolveCursorApiKey } from "../config/loadConfig.js";
import {
  logWorkflowStepSkipped,
  workflowSkips,
} from "../config/workflowSkipSteps.js";
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
import { gitTopLevel } from "../util/git.js";
import {
  addWorktree,
  candidateBranchName,
  removeWorktreeIfPresent,
  worktreeAbsolutePath,
} from "../worktree/manager.js";
import type { DecompositionDoc } from "./decompositionTypes.js";

/** Parallel worktrees + test writer + implementer agents (no HumanConsultHooks — matches CLI; planning owns consult). */
type Paths = ReturnType<typeof runPaths>;

function apiKey(loaded: LoadedConfig): string {
  const k = resolveCursorApiKey(loaded);
  if (!k)
    throw new Error(
      `Missing Cursor API key (set ${loaded.config.runtime.cursor.apiKeyEnv}).`,
    );
  return k;
}

export function pickCandidateTaskIds(doc: DecompositionDoc, max: number): string[] {
  const flat = doc.parallelBatches.flat();
  const ids = flat.length ? flat : doc.tasks.map((t) => t.id);
  if (!ids.length) return ["impl-01"];
  const uniq: string[] = [];
  for (const id of ids) {
    if (!uniq.includes(id)) uniq.push(id);
    if (uniq.length >= max) break;
  }
  while (uniq.length < max && ids.length) {
    uniq.push(ids[uniq.length % ids.length]);
  }
  return uniq.slice(0, max);
}

export async function runImplementCandidates(args: {
  loaded: LoadedConfig;
  paths: Paths;
  /** When set (e.g. Telegram), tool consult + stream hooks for implementation agents. */
  consult?: HumanConsultHooks;
  onAgentStreamChunk?: (text: string) => void;
}): Promise<void> {
  const state = readState(args.paths);
  if (state.cancelRequested) {
    state.phase = "CANCELLED";
    writeState(args.paths, state);
    return;
  }
  const doc = readJsonFile<DecompositionDoc>(args.paths.decomposition);
  const max = Math.max(
    1,
    args.loaded.config.workflow.parallelism.implementationCandidates,
  );
  const candidateIds = pickCandidateTaskIds(doc, max);
  const taskInput = readTaskInput(args.paths);
  const gitRoot = gitTopLevel(taskInput.repo.localPath);
  state.gitRoot = gitRoot;
  state.phase = "IMPLEMENTING_PARALLEL";
  writeState(args.paths, state);

  const requirements = fs.readFileSync(args.paths.requirements, "utf8");
  const template = readPromptFile("implement.md");
  const testTemplate = readPromptFile("testWriter.md");
  const verification = JSON.stringify(args.loaded.config.verification.commands, null, 2);
  const verificationPlan =
    doc.verificationPlan?.trim() || "(No explicit verification plan was generated.)";
  const key = apiKey(args.loaded);
  const settingSources = args.loaded.config.runtime.cursor.settingSources;

  const concurrency = Math.max(
    1,
    args.loaded.config.workflow.parallelism.maxConcurrentAgents,
  );
  const issueNum = state.issueNumber ?? taskInput.issueNumber ?? 0;

  const work = async (candidateId: string) => {
    const throwIfCancelled = () => {
      if (!readState(args.paths).cancelRequested) return;
      const s = readState(args.paths);
      s.phase = "CANCELLED";
      writeState(args.paths, s);
      throw new WorkflowCancelledError();
    };
    throwIfCancelled();
    const task = doc.tasks.find((t) => t.id === candidateId) ?? doc.tasks[0];
    if (!task) throw new Error("decomposition has no tasks");
    const branch = candidateBranchName({
      issueNumber: issueNum,
      runId: state.runId,
      candidateId,
    });
    const segment = `${taskInput.repo.name}-${state.runId}-${candidateId}`;
    const wt = worktreeAbsolutePath({
      cwd: args.loaded.cwd,
      worktreeRootRelative: args.loaded.config.repo.worktreeRoot,
      segment,
    });
    const existing = path.join(args.paths.candidatesDir, `${candidateId}.json`);
    if (fs.existsSync(existing)) {
      const prev = readJsonFile<{ worktreePath?: string }>(existing);
      if (prev.worktreePath && !args.loaded.config.repo.preserveFailedWorktrees) {
        removeWorktreeIfPresent({ gitRoot, path: prev.worktreePath });
      }
    }
    removeWorktreeIfPresent({ gitRoot, path: wt });
    const start = `origin/${taskInput.repo.defaultBranch}`;
    const added = addWorktree({
      gitRoot,
      worktreePath: wt,
      branch,
      startPoint: start,
    });
    if (!added.ok) {
      writeJsonFile(path.join(args.paths.candidatesDir, `${candidateId}.json`), {
        candidateId,
        branch,
        worktreePath: wt,
        error: added.stderr,
      });
      return;
    }
    writeJsonFile(path.join(args.paths.candidatesDir, `${candidateId}.json`), {
      candidateId,
      branch,
      worktreePath: wt,
      base: start,
    });
    state.phase = "WRITING_TESTS";
    writeState(args.paths, state);
    let testWriterOutput: string;
    let testWriterAgentId: string | undefined;
    let testWriterRunId: string | undefined;
    let testWriterStatus: string | undefined;
    const skipTw = workflowSkips("testWriter", args.loaded.config.workflow);
    if (skipTw) {
      logWorkflowStepSkipped("testWriter");
      testWriterOutput =
        "(Test writer agent skipped: workflow.skipSteps includes testWriter.)";
      testWriterStatus = "skipped_config";
    } else {
      const testPrompt = interpolate(testTemplate, {
        CANDIDATE_ID: candidateId,
        TASK_TITLE: task.title,
        TASK_BRIEF: task.brief,
        REQUIREMENTS: requirements.slice(0, 12000),
        VERIFICATION_PLAN: verificationPlan.slice(0, 8000),
        VERIFICATION_COMMANDS: verification,
      });
      const testTurn = await runAgentTurn({
        apiKey: key,
        modelId: args.loaded.config.runtime.cursor.models.testWriter,
        cwd: wt,
        prompt: withWorkflowStepPrompt(
          testPrompt,
          args.loaded,
          "testWriter",
        ),
        settingSources,
        transcriptPath: path.join(args.paths.transcriptDir, `test-writer-${candidateId}.txt`),
        streamStdout: envStreamExplicitlyEnabled(),
        consult: args.consult,
        onStreamChunk: args.onAgentStreamChunk,
        shouldAbort: () => readState(args.paths).cancelRequested,
      });
      testWriterOutput =
        typeof testTurn.result.result === "string" && testTurn.result.result.trim()
          ? testTurn.result.result
          : testTurn.transcript;
      testWriterAgentId = testTurn.agentId;
      testWriterRunId = testTurn.runId;
      testWriterStatus = testTurn.result.status;
    }

    throwIfCancelled();
    state.phase = "IMPLEMENTING_PARALLEL";
    writeState(args.paths, state);
    const skipImpl = workflowSkips("implementer", args.loaded.config.workflow);

    let implementerAgentId: string | undefined;
    let implementerRunId: string | undefined;
    let implementerStatus: string | undefined;

    if (skipImpl) {
      logWorkflowStepSkipped("implementer");
      implementerStatus = "skipped_config";
    } else {
      const implPrompt = interpolate(template, {
        CANDIDATE_ID: candidateId,
        TASK_TITLE: task.title,
        TASK_BRIEF: task.brief,
        REQUIREMENTS: requirements.slice(0, 12000),
        VERIFICATION_PLAN: verificationPlan.slice(0, 8000),
        VERIFICATION_COMMANDS: verification,
        TEST_WRITER_OUTPUT: testWriterOutput.slice(0, 12000),
      });
      const turn = await runAgentTurn({
        apiKey: key,
        modelId: args.loaded.config.runtime.cursor.models.implementer,
        cwd: wt,
        prompt: withWorkflowStepPrompt(
          implPrompt,
          args.loaded,
          "implementer",
        ),
        settingSources,
        transcriptPath: path.join(args.paths.transcriptDir, `implement-${candidateId}.txt`),
        streamStdout: envStreamExplicitlyEnabled(),
        consult: args.consult,
        onStreamChunk: args.onAgentStreamChunk,
        shouldAbort: () => readState(args.paths).cancelRequested,
      });
      implementerAgentId = turn.agentId;
      implementerRunId = turn.runId;
      implementerStatus = turn.result.status;
    }

    const metaOut: Record<string, unknown> = {
      candidateId,
      branch,
      worktreePath: wt,
      base: start,
    };
    if (testWriterAgentId !== undefined) metaOut.testWriterAgentId = testWriterAgentId;
    if (testWriterRunId !== undefined) metaOut.testWriterRunId = testWriterRunId;
    if (testWriterStatus !== undefined) metaOut.testWriterStatus = testWriterStatus;
    if (implementerAgentId !== undefined) metaOut.implementerAgentId = implementerAgentId;
    if (implementerRunId !== undefined) metaOut.implementerRunId = implementerRunId;
    if (implementerStatus !== undefined) metaOut.status = implementerStatus;

    writeJsonFile(path.join(args.paths.candidatesDir, `${candidateId}.json`), metaOut);
  };

  try {
    for (let i = 0; i < candidateIds.length; i += concurrency) {
      const chunk = candidateIds.slice(i, i + concurrency);
      await Promise.all(chunk.map((id) => work(id)));
    }
  } catch (e) {
    if (e instanceof WorkflowCancelledError) {
      const s = readState(args.paths);
      if (s.phase !== "CANCELLED") {
        s.phase = "CANCELLED";
        writeState(args.paths, s);
      }
      return;
    }
    throw e;
  }

  state.phase = "VERIFYING_CANDIDATES";
  writeState(args.paths, state);
}
