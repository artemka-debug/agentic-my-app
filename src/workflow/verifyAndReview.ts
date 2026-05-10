import fs from "node:fs";
import path from "node:path";
import { createLocalAgent } from "../sdk/createLocalAgent.js";
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
import { runAgentTurn, resumeAgentTurn, type HumanConsultHooks, WorkflowCancelledError } from "../sdk/runAgentTurn.js";
import { envStreamExplicitlyEnabled } from "../util/agenticEnv.js";
import { gitDiffRange } from "../util/git.js";
import { verificationGatePassed } from "../util/verifierVerdict.js";
import { allRequiredPassed, runVerificationCommands } from "../verify/commandRunner.js";
import type { CheckResult } from "../verify/commandRunner.js";
import type { TaskInput } from "../intake/taskTypes.js";
import type { DecompositionDoc } from "./decompositionTypes.js";

type Paths = ReturnType<typeof runPaths>;

type CandidateMetaFile = {
  candidateId: string;
  branch?: string;
  base?: string;
  worktreePath?: string;
  error?: string;
  testWriterAgentId?: string;
  testWriterRunId?: string;
  testWriterStatus?: string;
  implementerAgentId?: string;
  implementerRunId?: string;
  cleanupAgentId?: string;
  cleanupRunId?: string;
  cleanupStatus?: string;
  status?: string;
};

type Summary = {
  candidateId: string;
  worktreePath?: string;
  checks: CheckResult[];
  mechanicalPass: boolean;
  verifierNotes?: string;
  manualQaNotes?: string;
  implementationRetriesAfterVerify: number;
};

function key(loaded: LoadedConfig): string {
  const k = resolveCursorApiKey(loaded);
  if (!k)
    throw new Error(
      `Missing Cursor API key (set ${loaded.config.runtime.cursor.apiKeyEnv}).`,
    );
  return k;
}

async function verifyCandidateWithImplementRetries(args: {
  loaded: LoadedConfig;
  paths: Paths;
  metaPath: string;
  meta: CandidateMetaFile;
  taskInput: TaskInput;
  requirements: string;
  decomposition: DecompositionDoc;
  consult?: HumanConsultHooks;
  onAgentStreamChunk?: (text: string) => void;
}): Promise<Summary | null> {
  const wt = args.meta.worktreePath;
  if (!wt || args.meta.error) return null;

  const maxRetries = Math.max(
    0,
    Number(args.loaded.config.verification.maxImplementRetriesAfterVerify) || 3,
  );
  const verificationJson = JSON.stringify(
    args.loaded.config.verification.commands,
    null,
    2,
  );
  const task =
    args.decomposition.tasks.find((t) => t.id === args.meta.candidateId) ??
    args.decomposition.tasks[0];
  if (!task) throw new Error("decomposition has no tasks");

  const implementerModelId = args.loaded.config.runtime.cursor.models.implementer;
  const verifierModelId = args.loaded.config.runtime.cursor.models.verifier;
  const settingSources = args.loaded.config.runtime.cursor.settingSources;
  const skipVerifierAgent = workflowSkips("verifier", args.loaded.config.workflow);
  let meta: CandidateMetaFile = { ...args.meta };
  let retriesUsed = 0;
  let lastChecks: CheckResult[] = [];
  let lastMechanical = false;
  let lastVerifierNotes = "";
  let lastManualQaNotes = "";
  let loggedVerifierSkip = false;

  const apiKeyStr = key(args.loaded);

  const runVerifierRound = async () => {
    lastChecks = runVerificationCommands({
      cwd: wt,
      config: args.loaded.config,
      runRoot: args.paths.root,
      candidateId: meta.candidateId,
    });
    lastMechanical = allRequiredPassed(args.loaded.config, lastChecks);
    const diff = gitDiffRange({
      cwd: wt,
      base: `origin/${args.taskInput.repo.defaultBranch}`,
    });
    if (skipVerifierAgent) {
      if (!loggedVerifierSkip) {
        logWorkflowStepSkipped("verifier");
        loggedVerifierSkip = true;
      }
      lastVerifierNotes = lastMechanical
        ? [
            "Verifier agent was skipped via workflow.skipSteps.",
            "Mechanical checks ran; AGENTIC_MY_APP_VERDICT: PASS assumed because the verifier omitted (no LLM review of diff).",
            "",
            "AGENTIC_MY_APP_VERDICT: PASS",
          ].join("\n")
        : [
            "Verifier agent was skipped via workflow.skipSteps.",
            "Mechanical checks failed.",
            "",
            "AGENTIC_MY_APP_VERDICT: FAIL",
          ].join("\n");
      lastManualQaNotes = [
        "Manual QA verifier was skipped because workflow.skipSteps includes verifier.",
        "",
        "AGENTIC_MY_APP_MANUAL_QA_VERDICT: PASS",
      ].join("\n");
    } else {
      const promptVars = {
        REQUIREMENTS: args.requirements.slice(0, 8000),
        DIFF: diff.slice(0, 24000),
        CHECK_RESULTS: JSON.stringify(lastChecks, null, 2),
      };
      const verPrompt = interpolate(readPromptFile("verifier.md"), promptVars);
      const manualQaPrompt = interpolate(
        readPromptFile("manualQaVerifier.md"),
        promptVars,
      );
      const [verTurn, manualQaTurn] = await Promise.all([
        runAgentTurn({
          apiKey: apiKeyStr,
          modelId: verifierModelId,
          cwd: wt,
          prompt: withWorkflowStepPrompt(
            verPrompt,
            args.loaded,
            "verifier",
          ),
          settingSources,
          transcriptPath: path.join(
            args.paths.transcriptDir,
            `verify-${meta.candidateId}-a${retriesUsed}.txt`,
          ),
          streamStdout: envStreamExplicitlyEnabled(),
          consult: args.consult,
          onStreamChunk: args.onAgentStreamChunk,
          shouldAbort: () => readState(args.paths).cancelRequested,
        }),
        runAgentTurn({
          apiKey: apiKeyStr,
          modelId: verifierModelId,
          cwd: wt,
          prompt: withWorkflowStepPrompt(
            manualQaPrompt,
            args.loaded,
            "verifier",
          ),
          settingSources,
          transcriptPath: path.join(
            args.paths.transcriptDir,
            `manual-qa-${meta.candidateId}-a${retriesUsed}.txt`,
          ),
          streamStdout: envStreamExplicitlyEnabled(),
          consult: args.consult,
          onStreamChunk: args.onAgentStreamChunk,
          shouldAbort: () => readState(args.paths).cancelRequested,
        }),
      ]);
      lastVerifierNotes =
        typeof verTurn.result.result === "string"
          ? verTurn.result.result
          : verTurn.transcript;
      lastManualQaNotes =
        typeof manualQaTurn.result.result === "string"
          ? manualQaTurn.result.result
          : manualQaTurn.transcript;
    }
    writeJsonFile(path.join(args.paths.verificationDir, `${meta.candidateId}.json`), {
      candidateId: meta.candidateId,
      checks: lastChecks,
      mechanicalPass: lastMechanical,
      verifierNotes: lastVerifierNotes,
      manualQaNotes: lastManualQaNotes,
      implementationRetriesAfterVerify: retriesUsed,
    });
  };

  while (true) {
    await runVerifierRound();

    if (
      verificationGatePassed({
        mechanicalPass: lastMechanical,
        verifierNotes: lastVerifierNotes,
        manualQaNotes: lastManualQaNotes,
      })
    ) {
      return {
        candidateId: meta.candidateId,
        worktreePath: wt,
        checks: lastChecks,
        mechanicalPass: lastMechanical,
        verifierNotes: lastVerifierNotes,
        manualQaNotes: lastManualQaNotes,
        implementationRetriesAfterVerify: retriesUsed,
      };
    }

    if (retriesUsed >= maxRetries) {
      return {
        candidateId: meta.candidateId,
        worktreePath: wt,
        checks: lastChecks,
        mechanicalPass: lastMechanical,
        verifierNotes: lastVerifierNotes,
        manualQaNotes: lastManualQaNotes,
        implementationRetriesAfterVerify: retriesUsed,
      };
    }

    const retryTemplate = readPromptFile("implementVerifyRetry.md");
    const retryPrompt = interpolate(retryTemplate, {
      CANDIDATE_ID: meta.candidateId,
      TASK_TITLE: task.title,
      TASK_BRIEF: task.brief,
      REQUIREMENTS: args.requirements.slice(0, 12000),
      VERIFICATION_COMMANDS: verificationJson,
      CHECK_RESULTS: JSON.stringify(lastChecks, null, 2),
      VERIFIER_FEEDBACK: [
        "## Verifier feedback",
        lastVerifierNotes,
        "",
        "## Manual QA verifier feedback",
        lastManualQaNotes,
      ].join("\n").slice(0, 32000),
    });
    const retryTranscriptPath = path.join(
      args.paths.transcriptDir,
      `implement-${meta.candidateId}-verify-retry-${retriesUsed + 1}.txt`,
    );
    const retryPromptWrapped = withWorkflowStepPrompt(
      retryPrompt,
      args.loaded,
      "implementer",
    );
    let turn =
      meta.implementerAgentId !== undefined &&
      meta.implementerAgentId.length > 0
        ? await resumeAgentTurn({
            apiKey: apiKeyStr,
            modelId: implementerModelId,
            cwd: wt,
            agentId: meta.implementerAgentId,
            prompt: retryPromptWrapped,
            settingSources,
            transcriptPath: retryTranscriptPath,
            streamStdout: envStreamExplicitlyEnabled(),
            consult: args.consult,
            onStreamChunk: args.onAgentStreamChunk,
            shouldAbort: () => readState(args.paths).cancelRequested,
          })
        : await runAgentTurn({
            apiKey: apiKeyStr,
            modelId: implementerModelId,
            cwd: wt,
            prompt: retryPromptWrapped,
            settingSources,
            transcriptPath: retryTranscriptPath,
            streamStdout: envStreamExplicitlyEnabled(),
            consult: args.consult,
            onStreamChunk: args.onAgentStreamChunk,
            shouldAbort: () => readState(args.paths).cancelRequested,
          });
    meta = {
      ...meta,
      implementerAgentId: turn.agentId,
      implementerRunId: turn.runId,
      status: turn.result.status,
    };
    writeJsonFile(args.metaPath, meta);
    retriesUsed += 1;
  }
}

export async function runVerifyAndReviews(args: {
  loaded: LoadedConfig;
  paths: Paths;
  consult?: HumanConsultHooks;
  onAgentStreamChunk?: (text: string) => void;
}): Promise<void> {
  try {
    return await runVerifyAndReviewsInner(args);
  } catch (e) {
    if (e instanceof WorkflowCancelledError) {
      const s = readState(args.paths);
      s.phase = "CANCELLED";
      writeState(args.paths, s);
      return;
    }
    throw e;
  }
}

async function runVerifyAndReviewsInner(args: {
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
  const taskInput = readTaskInput(args.paths);
  const requirements = fs.readFileSync(args.paths.requirements, "utf8");
  const decomposition = readJsonFile<DecompositionDoc>(args.paths.decomposition);

  const files = fs
    .readdirSync(args.paths.candidatesDir)
    .filter((f) => f.endsWith(".json"));
  const summaries: Summary[] = [];

  for (const f of files) {
    const metaPath = path.join(args.paths.candidatesDir, f);
    const meta = readJsonFile<CandidateMetaFile>(metaPath);
    const summary = await verifyCandidateWithImplementRetries({
      loaded: args.loaded,
      paths: args.paths,
      metaPath,
      meta,
      taskInput,
      requirements,
      decomposition,
      consult: args.consult,
      onAgentStreamChunk: args.onAgentStreamChunk,
    });
    if (summary) summaries.push(summary);
  }

  let winner =
    summaries.find((s) =>
      verificationGatePassed({
        mechanicalPass: s.mechanicalPass,
        verifierNotes: s.verifierNotes ?? "",
        manualQaNotes: s.manualQaNotes,
      }),
    ) ?? undefined;
  state.phase = "REVIEWING_PASSES";
  writeState(args.paths, state);

  if (!summaries.length || !winner?.worktreePath) {
    state.phase = "BLOCKED_NEEDS_USER";
    state.lastError = !summaries.length
      ? "No candidate worktrees to verify."
      : "No candidate passed mechanical checks and verifier (see verification/*.json and transcripts). Raise maxImplementRetriesAfterVerify or fix issues manually.";
    writeState(args.paths, state);
    return;
  }

  state.selectedCandidateId = winner.candidateId;
  writeState(args.paths, state);

  const winnerMetaPath = path.join(
    args.paths.candidatesDir,
    `${winner.candidateId}.json`,
  );
  const winnerWorktree = winner.worktreePath;
  if (!winnerWorktree) {
    state.phase = "BLOCKED_NEEDS_USER";
    state.lastError =
      "Selected candidate lost its worktree path after cleanup/recommendation pass.";
    writeState(args.paths, state);
    return;
  }

  state.phase = "REVIEWING_PASSES";
  writeState(args.paths, state);

  const wf = args.loaded.config.workflow;
  const diff = gitDiffRange({
    cwd: winnerWorktree,
    base: `origin/${taskInput.repo.defaultBranch}`,
  });

  let codeReview = "";
  let securityReview = "";
  let poAcceptance = "";
  const skipCr = workflowSkips("codeReviewer", wf);
  const skipSr = workflowSkips("securityReviewer", wf);
  const skipPa = workflowSkips("poAcceptance", wf);

  if (!skipCr || !skipSr || !skipPa) {
    const agent = await createLocalAgent({
      apiKey: key(args.loaded),
      model: { id: args.loaded.config.runtime.cursor.models.codeReviewer },
      cwd: winnerWorktree,
      settingSources: args.loaded.config.runtime.cursor.settingSources,
    });
    try {
      if (!skipCr) {
        const cr = withWorkflowStepPrompt(
          interpolate(readPromptFile("codeReview.md"), {
            DIFF: diff.slice(0, 24000),
            REQUIREMENTS: requirements.slice(0, 6000),
          }),
          args.loaded,
          "codeReviewer",
        );
        const r1 = await agent.send(cr, {
          model: { id: args.loaded.config.runtime.cursor.models.codeReviewer },
        });
        const r1Result = await r1.wait();
        codeReview =
          typeof r1Result.result === "string"
            ? r1Result.result
            : JSON.stringify(r1Result.result);
      } else {
        logWorkflowStepSkipped("codeReviewer");
        codeReview =
          "(Skipped: workflow.skipSteps includes codeReviewer.)";
      }

      if (!skipSr) {
        const sr = withWorkflowStepPrompt(
          interpolate(readPromptFile("securityReview.md"), {
            DIFF: diff.slice(0, 24000),
            REQUIREMENTS: requirements.slice(0, 6000),
          }),
          args.loaded,
          "securityReviewer",
        );
        const r2 = await agent.send(sr, {
          model: { id: args.loaded.config.runtime.cursor.models.securityReviewer },
        });
        const r2Result = await r2.wait();
        securityReview =
          typeof r2Result.result === "string"
            ? r2Result.result
            : JSON.stringify(r2Result.result);
      } else {
        logWorkflowStepSkipped("securityReviewer");
        securityReview =
          "(Skipped: workflow.skipSteps includes securityReviewer.)";
      }

      if (!skipPa) {
        const issueSummary = `${taskInput.title}\n\n${taskInput.description}`;
        const pa = withWorkflowStepPrompt(
          interpolate(readPromptFile("poAcceptance.md"), {
            ISSUE: issueSummary.slice(0, 8000),
            REQUIREMENTS: requirements.slice(0, 8000),
            DIFF: diff.slice(0, 12000),
          }),
          args.loaded,
          "poAcceptance",
        );
        const r3 = await agent.send(pa, {
          model: { id: args.loaded.config.runtime.cursor.models.poAcceptance },
        });
        const r3Result = await r3.wait();
        poAcceptance =
          typeof r3Result.result === "string"
            ? r3Result.result
            : JSON.stringify(r3Result.result);
      } else {
        logWorkflowStepSkipped("poAcceptance");
        poAcceptance =
          "(Skipped: workflow.skipSteps includes poAcceptance.)";
      }

      const phases: Array<"code" | "security" | "poAcceptance"> = [];
      if (!skipCr) phases.push("code");
      if (!skipSr) phases.push("security");
      if (!skipPa) phases.push("poAcceptance");
      writeJsonFile(path.join(args.paths.agentsDir, "review-thread.json"), {
        agentId: agent.agentId,
        phases,
      });
    } finally {
      await agent[Symbol.asyncDispose]();
    }
  } else {
    logWorkflowStepSkipped("codeReviewer");
    codeReview =
      "(Skipped: workflow.skipSteps includes codeReviewer.)";
    logWorkflowStepSkipped("securityReviewer");
    securityReview =
      "(Skipped: workflow.skipSteps includes securityReviewer.)";
    logWorkflowStepSkipped("poAcceptance");
    poAcceptance =
      "(Skipped: workflow.skipSteps includes poAcceptance.)";
  }

  state.phase = "CLEANUP_RECOMMENDATIONS";
  writeState(args.paths, state);

  const recommendations = [
    "## Verifier",
    winner.verifierNotes ?? "(none)",
    "## Manual QA verifier",
    winner.manualQaNotes ?? "(none)",
    "## Code review",
    codeReview || "(none)",
    "## Security review",
    securityReview || "(none)",
    "## PO acceptance",
    poAcceptance || "(none)",
  ].join("\n\n");

  const skipCleanup = workflowSkips("cleanup", wf);
  let cleanupMeta: CandidateMetaFile = readJsonFile<CandidateMetaFile>(
    winnerMetaPath,
  );
  let postCleanupSummary: Summary | null = null;

  if (skipCleanup) {
    logWorkflowStepSkipped("cleanup");
    cleanupMeta = {
      ...cleanupMeta,
      cleanupStatus: "skipped_config",
    };
    writeJsonFile(winnerMetaPath, cleanupMeta);
    postCleanupSummary = {
      candidateId: winner.candidateId,
      worktreePath: winnerWorktree,
      checks: winner.checks,
      mechanicalPass: winner.mechanicalPass,
      verifierNotes: winner.verifierNotes,
      manualQaNotes: winner.manualQaNotes,
      implementationRetriesAfterVerify: winner.implementationRetriesAfterVerify,
    };
  } else {
    const cleanupPrompt = interpolate(readPromptFile("cleanup.md"), {
      REQUIREMENTS: requirements.slice(0, 8000),
      RECOMMENDATIONS: recommendations.slice(0, 24000),
      DIFF: gitDiffRange({
        cwd: winnerWorktree,
        base: `origin/${taskInput.repo.defaultBranch}`,
      }).slice(0, 24000),
    });
    const cleanupTurn = await runAgentTurn({
      apiKey: key(args.loaded),
      modelId: args.loaded.config.runtime.cursor.models.cleanup,
      cwd: winnerWorktree,
      prompt: withWorkflowStepPrompt(cleanupPrompt, args.loaded, "cleanup"),
      settingSources: args.loaded.config.runtime.cursor.settingSources,
      transcriptPath: path.join(
        args.paths.transcriptDir,
        `cleanup-${winner.candidateId}.txt`,
      ),
      streamStdout: envStreamExplicitlyEnabled(),
      consult: args.consult,
      onStreamChunk: args.onAgentStreamChunk,
      shouldAbort: () => readState(args.paths).cancelRequested,
    });
    cleanupMeta = {
      ...readJsonFile<CandidateMetaFile>(winnerMetaPath),
      cleanupAgentId: cleanupTurn.agentId,
      cleanupRunId: cleanupTurn.runId,
      cleanupStatus: cleanupTurn.result.status,
    };
    writeJsonFile(winnerMetaPath, cleanupMeta);
    state.agents = {
      ...state.agents,
      cleanup: {
        agentId: cleanupTurn.agentId,
        lastRunId: cleanupTurn.runId,
      },
    };
    writeState(args.paths, state);

    postCleanupSummary = await verifyCandidateWithImplementRetries({
      loaded: args.loaded,
      paths: args.paths,
      metaPath: winnerMetaPath,
      meta: cleanupMeta,
      taskInput,
      requirements,
      decomposition,
      consult: args.consult,
      onAgentStreamChunk: args.onAgentStreamChunk,
    });
  }

  const postCleanupPassed =
    postCleanupSummary !== null &&
    verificationGatePassed({
      mechanicalPass: postCleanupSummary.mechanicalPass,
      verifierNotes: postCleanupSummary.verifierNotes ?? "",
      manualQaNotes: postCleanupSummary.manualQaNotes,
    });

  writeJsonFile(path.join(args.paths.verificationDir, "review-summary.json"), {
    selectedCandidateId: winner.candidateId,
    decompositionHeadline: decomposition.tasks.length,
    codeReview,
    securityReview,
    poAcceptance,
    cleanupAgentId: cleanupMeta.cleanupAgentId,
    cleanupRunId: cleanupMeta.cleanupRunId,
    postCleanupPassed,
    postCleanupSummary,
  });

  if (!postCleanupPassed) {
    state.phase = "BLOCKED_NEEDS_USER";
    state.lastError = skipCleanup
      ? "Post-recommendation verification failed unexpectedly (cleanup was skipped; see verification/review-summary.json)."
      : "Cleanup recommendations were applied but post-cleanup verification failed. See verification/review-summary.json, verification/*.json, and commands/*.json.";
    writeState(args.paths, state);
    return;
  }

  state.phase = "SELECTING_CANDIDATE";
  writeState(args.paths, state);
}
