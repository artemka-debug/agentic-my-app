import type {
  Run,
  RunResult,
  SDKAssistantMessage,
  SDKToolUseMessage,
  ToolUseBlock,
} from "@cursor/sdk";
import fs from "node:fs";
import path from "node:path";
import type { AgenticMyAppConfig } from "../config/types.js";
import { shouldRedactTranscripts } from "../util/agenticEnv.js";
import { redactSecrets } from "../util/redact.js";
import {
  extractAgenticMyAppAskHuman,
  stringifyToolPayload,
} from "../util/humanConsult.js";
import { shouldConsultBeforeTool } from "../util/toolConsultRisk.js";
import { createLocalAgent, assertLocalAgentOptions } from "./createLocalAgent.js";
import { ensureCursorRipgrepPathEnv } from "./ensureCursorRipgrepPathEnv.js";

/** Thrown when `state.cancelRequested` is set (e.g. CLI or Telegram /cancel) during an agent stream. */
export class WorkflowCancelledError extends Error {
  constructor() {
    super("Run was cancelled.");
    this.name = "WorkflowCancelledError";
  }
}

export type AgentTurnResult = {
  runId: string;
  agentId: string;
  result: RunResult;
  transcript: string;
};

/** Terminal-driven consultation during a single persisted agent session. */
export type HumanConsultHooks = {
  /** React to `<AGENTIC_MY_APP_ASK_HUMAN>` (legacy `<ORCHESTRATOR_ASK_HUMAN>`) after each model turn. */
  askHumanMarker: boolean;
  /** Prompt when the stream shows tool use (best-effort); see `confirmAllTools`. */
  pauseBeforeTools: boolean;
  /**
   * When true with `pauseBeforeTools`, confirm every tool. When false, only destructive /
   * high‑risk tools (deletes, force push, `rm -rf`, `git reset --hard`, …) prompt.
   */
  confirmAllTools: boolean;
  maxConsultRounds: number;
  question: (prompt: string) => Promise<string>;
  log?: (msg: string) => void;
};

export async function consumeRunStream(args: {
  run: Run;
  streamStdout: boolean;
  onStreamChunk?: (text: string) => void;
  consult?: HumanConsultHooks;
  shouldAbort?: () => boolean | undefined;
}): Promise<string> {
  const { run, streamStdout, onStreamChunk, consult, shouldAbort } = args;
  if (!run.supports("stream")) return "";

  let turnText = "";
  const seenTools = new Set<string>();

  const maybePauseForTool = async (
    name: string,
    payloadKey: string,
    payload: unknown,
  ) => {
    if (!consult?.pauseBeforeTools) return;
    if (
      !shouldConsultBeforeTool({
        confirmAllTools: Boolean(consult.confirmAllTools),
        toolName: name,
        payload,
      })
    ) {
      return;
    }
    if (seenTools.has(payloadKey)) return;
    seenTools.add(payloadKey);
    const payloadStr = stringifyToolPayload(payload, 24_000);
    await consult.question(
      [
        `Tool: ${name}`,
        ``,
        `Arguments:`,
        payloadStr,
        ``,
        `Approve running tool "${name}" with these arguments?`,
        `Press Enter to continue (or type a short instruction to send back to the model).`,
      ].join("\n"),
    );
  };

  for await (const ev of run.stream()) {
    if (shouldAbort?.()) throw new WorkflowCancelledError();
    if (ev.type === "assistant") {
      const assistant = ev as SDKAssistantMessage;
      for (const block of assistant.message.content) {
        if (block.type === "text") {
          turnText += block.text;
          if (streamStdout) process.stdout.write(block.text);
          onStreamChunk?.(block.text);
        } else if (block.type === "tool_use") {
          const tb = block as ToolUseBlock;
          await maybePauseForTool(tb.name, `tool_use:${tb.id}`, tb.input);
        }
      }
      continue;
    }

    if (ev.type === "tool_call") {
      const tc = ev as SDKToolUseMessage;
      if (tc.status === "running") {
        await maybePauseForTool(tc.name, `tool_call:${tc.call_id}`, tc.args);
      }
    }
  }

  return turnText;
}

export async function runAgentTurn(args: {
  apiKey: string;
  modelId: string;
  cwd: string;
  prompt: string;
  settingSources: AgenticMyAppConfig["runtime"]["cursor"]["settingSources"];
  transcriptPath?: string;
  streamStdout?: boolean;
  /** Stream assistant text chunks without tying to process.stdout (e.g. Telegram). */
  onStreamChunk?: (text: string) => void;
  /** When set (TTY sessions), enables multi-turn Q&A / tool confirmations. Only PO/decomposition pass this from the bundled workflow today. */
  consult?: HumanConsultHooks;
  /** When true, abort streaming / wait early (cooperative cancel via `state.cancelRequested`). */
  shouldAbort?: () => boolean | undefined;
}): Promise<AgentTurnResult> {
  const agent = await createLocalAgent({
    apiKey: args.apiKey,
    model: { id: args.modelId },
    cwd: args.cwd,
    settingSources: args.settingSources,
  });

  try {
    const consult = args.consult;
    const askLoop = Boolean(consult?.askHumanMarker);
    const maxRounds = askLoop
      ? Math.max(1, consult!.maxConsultRounds)
      : 1;
    const wantStreamCapture =
      Boolean(consult) ||
      Boolean(args.streamStdout) ||
      Boolean(args.onStreamChunk) ||
      askLoop;

    let cumulativeTranscript = "";
    let lastRunId = "";
    let lastResult: RunResult | undefined;
    let nextPrompt = args.prompt;

    for (let round = 1; round <= maxRounds; round += 1) {
      if (args.shouldAbort?.()) throw new WorkflowCancelledError();
      const run = await agent.send(nextPrompt);

      let turnText = "";
      if (run.supports("stream") && wantStreamCapture) {
        turnText = await consumeRunStream({
          run,
          streamStdout: Boolean(args.streamStdout),
          onStreamChunk: args.onStreamChunk,
          consult,
          shouldAbort: args.shouldAbort,
        });
      }

      if (args.shouldAbort?.()) throw new WorkflowCancelledError();
      const result = await run.wait();
      lastRunId = run.id;
      lastResult = result;

      let roundBody = turnText;
      if (
        !roundBody &&
        typeof result.result === "string" &&
        result.result.trim()
      ) {
        roundBody = result.result;
      }

      cumulativeTranscript += cumulativeTranscript
        ? `\n\n--- consult round ${round} ---\n\n`
        : "";
      cumulativeTranscript += roundBody;

      if (!askLoop) break;

      const askText = extractAgenticMyAppAskHuman(
        `${roundBody}\n${typeof result.result === "string" ? result.result : ""}`,
      );
      if (!askText) break;

      consult!.log?.(
        "[consult] Model embedded <AGENTIC_MY_APP_ASK_HUMAN>; waiting for your reply.",
      );
      const answer = await consult!.question(
        askText,
      );
      nextPrompt =
        answer.trim().length > 0
          ? `The human operator replies:\n${answer}\n\nContinue. Resolve or remove answered items from open questions before finalizing output.`
          : `The human operator had no extra input. Continue — make reasonable assumptions where needed and state them explicitly.`;
    }

    if (!lastResult) throw new Error("Agent run produced no terminal result.");

    let transcript =
      cumulativeTranscript ||
      (typeof lastResult.result === "string" ? lastResult.result : "");

    if (args.transcriptPath) {
      fs.mkdirSync(path.dirname(args.transcriptPath), { recursive: true });
      const body = shouldRedactTranscripts()
        ? redactSecrets(transcript)
        : transcript;
      fs.writeFileSync(args.transcriptPath, body, "utf8");
    }

    return {
      runId: lastRunId,
      agentId: agent.agentId,
      result: lastResult,
      transcript,
    };
  } finally {
    await agent[Symbol.asyncDispose]();
  }
}

export async function resumeAgentTurn(args: {
  apiKey: string;
  modelId: string;
  cwd: string;
  agentId: string;
  prompt: string;
  settingSources: AgenticMyAppConfig["runtime"]["cursor"]["settingSources"];
  transcriptPath?: string;
  streamStdout?: boolean;
  onStreamChunk?: (text: string) => void;
  /** Tool / ASK_HUMAN consult during streamed resume turns (parity with runAgentTurn). */
  consult?: HumanConsultHooks;
  shouldAbort?: () => boolean | undefined;
}): Promise<AgentTurnResult> {
  ensureCursorRipgrepPathEnv();
  const { Agent } = await import("@cursor/sdk");
  const resumeOpts = {
    apiKey: args.apiKey,
    model: { id: args.modelId },
    local: {
      cwd: args.cwd,
      settingSources: args.settingSources,
    },
  };
  assertLocalAgentOptions(resumeOpts);
  const agent = await Agent.resume(args.agentId, resumeOpts);
  try {
    const consult = args.consult;
    const askLoop = Boolean(consult?.askHumanMarker);
    const maxRounds = askLoop
      ? Math.max(1, consult!.maxConsultRounds)
      : 1;
    const wantStreamCapture =
      Boolean(consult) ||
      Boolean(args.streamStdout) ||
      Boolean(args.onStreamChunk) ||
      askLoop;

    let cumulativeTranscript = "";
    let lastRunId = "";
    let lastResult: RunResult | undefined;
    let nextPrompt = args.prompt;

    for (let round = 1; round <= maxRounds; round += 1) {
      if (args.shouldAbort?.()) throw new WorkflowCancelledError();
      const run = await agent.send(nextPrompt);
      let turnText = "";
      if (run.supports("stream") && wantStreamCapture) {
        turnText = await consumeRunStream({
          run,
          streamStdout: Boolean(args.streamStdout),
          onStreamChunk: args.onStreamChunk,
          consult,
          shouldAbort: args.shouldAbort,
        });
      }
      if (args.shouldAbort?.()) throw new WorkflowCancelledError();
      const result = await run.wait();
      lastRunId = run.id;
      lastResult = result;

      let roundBody = turnText;
      if (
        !roundBody &&
        typeof result.result === "string" &&
        result.result.trim()
      ) {
        roundBody = result.result;
      }

      cumulativeTranscript += cumulativeTranscript
        ? `\n\n--- consult round ${round} ---\n\n`
        : "";
      cumulativeTranscript += roundBody;

      if (!askLoop) break;

      const askText = extractAgenticMyAppAskHuman(
        `${roundBody}\n${typeof result.result === "string" ? result.result : ""}`,
      );
      if (!askText) break;

      consult!.log?.(
        "[consult] Model embedded <AGENTIC_MY_APP_ASK_HUMAN>; waiting for your reply.",
      );
      const answer = await consult!.question(askText);
      nextPrompt =
        answer.trim().length > 0
          ? `The human operator replies:\n${answer}\n\nContinue. Resolve or remove answered items from open questions before finalizing output.`
          : `The human operator had no extra input. Continue — make reasonable assumptions where needed and state them explicitly.`;
    }

    if (!lastResult) throw new Error("Resume agent run produced no result.");

    let transcript =
      cumulativeTranscript ||
      (typeof lastResult.result === "string" ? lastResult.result : "");

    if (args.transcriptPath) {
      fs.mkdirSync(path.dirname(args.transcriptPath), { recursive: true });
      const body = shouldRedactTranscripts()
        ? redactSecrets(transcript)
        : transcript;
      fs.writeFileSync(args.transcriptPath, body, "utf8");
    }
    return {
      runId: lastRunId,
      agentId: agent.agentId,
      result: lastResult,
      transcript,
    };
  } finally {
    await agent[Symbol.asyncDispose]();
  }
}
