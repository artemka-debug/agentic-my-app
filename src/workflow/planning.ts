import fs from "node:fs";
import path from "node:path";
import readlinePromises from "node:readline/promises";
import type { LoadedConfig } from "../config/loadConfig.js";
import { resolveCursorApiKey } from "../config/loadConfig.js";
import { workflowSkips } from "../config/workflowSkipSteps.js";
import { interpolate, readPromptFile } from "../prompts/loadPrompt.js";
import { withWorkflowStepPrompt } from "../prompts/stepPrompt.js";
import { runAgentTurn, type HumanConsultHooks, WorkflowCancelledError } from "../sdk/runAgentTurn.js";
import type { TaskInput } from "../intake/taskTypes.js";
import {
  readApprovals,
  readState,
  runPaths,
  writeApprovals,
  writeJsonFile,
  writeState,
  type RunState,
} from "../runs/runWorkspace.js";
import { extractJsonObject } from "../util/jsonExtract.js";
import { extractRequirementTraceSeeds } from "../util/requirementTrace.js";
import { envConsultHumanEnabled, envStreamExplicitlyEnabled } from "../util/agenticEnv.js";
import { stripAgenticMyAppAskHumanBlocks } from "../util/humanConsult.js";
import type { DecompositionDoc } from "./decompositionTypes.js";

type Paths = ReturnType<typeof runPaths>;

/** Injected consult I/O for non-TTY sessions (e.g. Telegram). Skips TTY checks in `openPlanningHumanConsult`. */
export type PlanningHumanConsultSession = {
  hooks: HumanConsultHooks;
  close?: () => void;
};

function ensureApiKey(loaded: LoadedConfig): string {
  const k = resolveCursorApiKey(loaded);
  if (!k) {
    throw new Error(
      `Missing Cursor API key (set ${loaded.config.runtime.cursor.apiKeyEnv}).`,
    );
  }
  return k;
}

function taskSummary(task: TaskInput): string {
  const comments = task.comments
    .map((c) => `- ${c.author ?? "unknown"}: ${c.body}`)
    .join("\n");
  const linked =
    task.linkedPullRequests?.map((p) => `- PR #${p.number}: ${p.url}`).join("\n") ||
    "";
  return [
    `Title: ${task.title}`,
    `URL: ${task.sourceUrl ?? "(none)"}`,
    `Body:\n${task.description}`,
    linked ? `Linked PRs:\n${linked}` : "",
    comments ? `Comments:\n${comments}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function openPlanningHumanConsult(
  loaded: LoadedConfig,
  options?: { sharedReadline?: readlinePromises.Interface },
): { hooks: HumanConsultHooks; close: () => void } | null {
  const ch = loaded.config.workflow.consultHuman;
  const envOn = envConsultHumanEnabled();
  const enabled = Boolean(ch?.enabled) || envOn;
  if (!enabled) return null;

  const shared = options?.sharedReadline;
  if (!shared && (!process.stdin.isTTY || !process.stdout.isTTY)) return null;
  if (shared && !process.stdin.isTTY) return null;

  const ownRl =
    shared === undefined
      ? readlinePromises.createInterface({
          input: process.stdin,
          output: process.stdout,
        })
      : null;
  const rl = shared ?? ownRl!;
  const askHumanMarker = ch?.askHumanMarker !== false;
  const pauseBeforeTools = ch?.pauseBeforeTools !== false;
  const confirmAllTools = ch?.confirmAllTools === true;
  const maxConsultRounds = Math.min(
    50,
    Math.max(2, Number(ch?.maxConsultRounds) || 12),
  );

  return {
    hooks: {
      askHumanMarker,
      pauseBeforeTools,
      confirmAllTools,
      maxConsultRounds,
      question: async (prompt) => {
        process.stderr.write(prompt.endsWith("\n") ? prompt : `${prompt}\n`);
        const line = await rl.question("Your reply: ");
        return line.trimEnd();
      },
      log: (msg) =>
        process.stderr.write(`\x1b[90m${msg}\x1b[0m\n`),
    },
    close: () => {
      ownRl?.close();
    },
  };
}

export async function runPoAndDecomposition(args: {
  loaded: LoadedConfig;
  paths: Paths;
  task: TaskInput;
  autonomous: boolean;
  /**
   * Reuse one readline for consult + downstream prompts (`agentic-my-app full`).
   * A second `{ input: stdin }` interface that is closed corrupts stdin for the caller.
   */
  sharedReadline?: readlinePromises.Interface;
  /**
   * When set, PO/decompose agents use these hooks instead of opening a TTY readline.
   * Ignores `process.stdin/stdout.isTTY`. Caller owns `question` / `log` implementation.
   */
  humanConsultSession?: PlanningHumanConsultSession;
  /** Optional sink for assistant streaming text (e.g. Telegram); independent of `streamStdout` / env. */
  onAgentStreamChunk?: (text: string) => void;
}): Promise<{ state: RunState }> {
  const state = readState(args.paths);
  if (state.cancelRequested) {
    state.phase = "CANCELLED";
    writeState(args.paths, state);
    return { state };
  }
  const apiKey = ensureApiKey(args.loaded);
  const settingSources = args.loaded.config.runtime.cursor.settingSources;
  const approvals = readApprovals(args.paths);

  state.gitRoot = args.task.repo.localPath;
  if (args.task.issueNumber !== undefined) {
    state.issueNumber = args.task.issueNumber;
  }
  writeState(args.paths, state);

  const consultHost: {
    session:
      | { hooks: HumanConsultHooks; close?: () => void }
      | null
      | "unvisited";
  } = { session: "unvisited" };

  const consultHooks = (): HumanConsultHooks | undefined => {
    if (consultHost.session === "unvisited") {
      if (args.humanConsultSession) {
        consultHost.session = {
          hooks: args.humanConsultSession.hooks,
          close: args.humanConsultSession.close,
        };
      } else {
        consultHost.session =
          openPlanningHumanConsult(args.loaded, {
            sharedReadline: args.sharedReadline,
          }) ?? null;
      }
    }
    return consultHost.session?.hooks;
  };

  try {
  const reqGate =
    args.loaded.config.workflow.approval.requireSpecApproval &&
    !args.loaded.config.workflow.autonomy.autoApproveSpec &&
    !args.autonomous;
  const decompGate =
    args.loaded.config.workflow.approval.requireDecompositionApproval &&
    !args.loaded.config.workflow.autonomy.autoApproveDecomposition &&
    !args.autonomous;

  if (!fs.existsSync(args.paths.requirements)) {
    if (workflowSkips("po", args.loaded.config.workflow)) {
      throw new Error(
        'workflow.skipSteps includes "po" but requirements.md is missing; add requirements.md or remove "po" from skipSteps.',
      );
    }
    state.phase = "PO_DRAFTING";
    writeState(args.paths, state);
    const poTemplate = readPromptFile("po.md");
    const prompt = interpolate(poTemplate, {
      TASK: taskSummary(args.task),
      REPO: `${args.task.repo.owner}/${args.task.repo.name}`,
      DEFAULT_BRANCH: args.task.repo.defaultBranch,
    });
    const turn = await runAgentTurn({
      apiKey,
      modelId: args.loaded.config.runtime.cursor.models.po,
      cwd: args.task.repo.localPath,
      prompt: withWorkflowStepPrompt(prompt, args.loaded, "po"),
      settingSources,
      transcriptPath: path.join(args.paths.transcriptDir, "po.txt"),
      streamStdout: envStreamExplicitlyEnabled(),
      onStreamChunk: args.onAgentStreamChunk,
      consult: consultHooks(),
      shouldAbort: () => readState(args.paths).cancelRequested,
    });
    const bodyRaw =
      typeof turn.result.result === "string" && turn.result.result.trim()
        ? turn.result.result
        : turn.transcript;
    const body = stripAgenticMyAppAskHumanBlocks(bodyRaw) || bodyRaw;
    fs.writeFileSync(args.paths.requirements, body, "utf8");
    const seeds = extractRequirementTraceSeeds(body);
    writeJsonFile(path.join(args.paths.root, "requirements.trace.json"), {
      generatedAt: new Date().toISOString(),
      source: "po_draft",
      requirements: seeds.map((s) => ({
        ...s,
        source: { kind: "po_spec" as const },
        evidence: [],
      })),
    });
    writeJsonFile(path.join(args.paths.agentsDir, "po.json"), {
      agentId: turn.agentId,
      runId: turn.runId,
    });
    state.agents = {
      ...state.agents,
      po: { agentId: turn.agentId, lastRunId: turn.runId },
    };
    writeState(args.paths, state);
  }

  if (reqGate && !approvals.specApprovedAt) {
    state.phase = "AWAITING_SPEC_APPROVAL";
    writeState(args.paths, state);
    return { state };
  }

  if (!fs.existsSync(args.paths.decomposition)) {
    if (workflowSkips("decomposer", args.loaded.config.workflow)) {
      throw new Error(
        'workflow.skipSteps includes "decomposer" but decomposition.json is missing; add decomposition.json or remove "decomposer" from skipSteps.',
      );
    }
    state.phase = "DECOMPOSING";
    writeState(args.paths, state);
    const decTemplate = readPromptFile("decompose.md");
    const requirements = fs.readFileSync(args.paths.requirements, "utf8");
    const prompt = interpolate(decTemplate, {
      REQUIREMENTS: requirements,
      REPO: `${args.task.repo.owner}/${args.task.repo.name}`,
      DEFAULT_BRANCH: args.task.repo.defaultBranch,
    });
    const turn = await runAgentTurn({
      apiKey,
      modelId: args.loaded.config.runtime.cursor.models.decomposer,
      cwd: args.task.repo.localPath,
      prompt: withWorkflowStepPrompt(
        prompt,
        args.loaded,
        "decomposer",
      ),
      settingSources,
      transcriptPath: path.join(args.paths.transcriptDir, "decompose.txt"),
      streamStdout: envStreamExplicitlyEnabled(),
      onStreamChunk: args.onAgentStreamChunk,
      consult: consultHooks(),
      shouldAbort: () => readState(args.paths).cancelRequested,
    });
    const outRaw =
      typeof turn.result.result === "string" && turn.result.result.trim()
        ? turn.result.result
        : turn.transcript;
    const outText = stripAgenticMyAppAskHumanBlocks(outRaw) || outRaw;
    let doc: DecompositionDoc;
    try {
      doc = extractJsonObject(outText) as DecompositionDoc;
      if (!Array.isArray(doc.tasks) || !Array.isArray(doc.parallelBatches)) {
        throw new Error("invalid shape");
      }
    } catch {
      doc = {
        tasks: [
          {
            id: "impl-01",
            title: "Implement requested change",
            brief: outText.slice(0, 8000),
            dependencies: [],
          },
        ],
        parallelBatches: [["impl-01"]],
        verificationPlan: "Run configured repo checks after implementation.",
      };
    }
    writeJsonFile(args.paths.decomposition, doc);
    writeJsonFile(path.join(args.paths.agentsDir, "decomposer.json"), {
      agentId: turn.agentId,
      runId: turn.runId,
    });
    state.agents = {
      ...state.agents,
      decomposer: { agentId: turn.agentId, lastRunId: turn.runId },
    };
    writeState(args.paths, state);
  }

  if (decompGate && !approvals.decompositionApprovedAt) {
    state.phase = "AWAITING_DECOMPOSITION_APPROVAL";
    writeState(args.paths, state);
    return { state };
  }

  state.phase = "PREPARING_WORKTREES";
  writeState(args.paths, state);
  return { state };
  } catch (e) {
    if (e instanceof WorkflowCancelledError) {
      const st = readState(args.paths);
      st.phase = "CANCELLED";
      writeState(args.paths, st);
      return { state: st };
    }
    throw e;
  } finally {
    // Injected sessions (e.g. Telegram) stay open for the full interactive run; only
    // planning-owned TTY readlines close here.
    if (
      consultHost.session !== "unvisited" &&
      consultHost.session !== null &&
      !args.humanConsultSession
    ) {
      consultHost.session.close?.();
    }
  }
}

export function approveSpec(paths: Paths): void {
  const a = readApprovals(paths);
  a.specApprovedAt = new Date().toISOString();
  writeApprovals(paths, a);
}

export function approveDecomposition(paths: Paths): void {
  const a = readApprovals(paths);
  a.decompositionApprovedAt = new Date().toISOString();
  writeApprovals(paths, a);
}
