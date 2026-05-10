import fs from "node:fs";
import path from "node:path";
import type { TaskInput } from "../intake/taskTypes.js";
import { runDirPath } from "./paths.js";

export type WorkflowPhase =
  | "NEW"
  | "INTAKING_TASK"
  | "PO_DRAFTING"
  | "AWAITING_SPEC_APPROVAL"
  | "DECOMPOSING"
  | "AWAITING_DECOMPOSITION_APPROVAL"
  | "PREPARING_WORKTREES"
  | "WRITING_TESTS"
  | "IMPLEMENTING_PARALLEL"
  | "VERIFYING_CANDIDATES"
  | "REVIEWING_PASSES"
  | "CLEANUP_RECOMMENDATIONS"
  | "SELECTING_CANDIDATE"
  | "FINALIZING"
  | "CREATING_PR"
  | "MONITORING_PR"
  | "COMPLETED"
  | "CANCELLED"
  | "BLOCKED_NEEDS_USER";

export type RunState = {
  runId: string;
  createdAt: string;
  phase: WorkflowPhase;
  issueNumber?: number;
  gitRoot?: string;
  selectedCandidateId?: string;
  prUrl?: string;
  prNumber?: number;
  cancelRequested?: boolean;
  agents?: {
    po?: { agentId: string; lastRunId?: string };
    decomposer?: { agentId: string; lastRunId?: string };
    testWriter?: { agentId: string; lastRunId?: string };
    review?: { agentId: string; lastRunId?: string };
    cleanup?: { agentId: string; lastRunId?: string };
  };
  lastError?: string;
};

export type Approvals = {
  specApprovedAt?: string;
  decompositionApprovedAt?: string;
};

export function runPaths(args: {
  cwd: string;
  artifactsRootRelative: string;
  runId: string;
}) {
  const root = runDirPath(args.cwd, args.artifactsRootRelative, args.runId);
  return {
    root,
    state: path.join(root, "state.json"),
    taskInput: path.join(root, "task-input.json"),
    requirements: path.join(root, "requirements.md"),
    decomposition: path.join(root, "decomposition.json"),
    approvals: path.join(root, "approvals.json"),
    transcriptDir: path.join(root, "transcripts"),
    agentsDir: path.join(root, "agents"),
    candidatesDir: path.join(root, "candidates"),
    verificationDir: path.join(root, "verification"),
    artifactsDir: path.join(root, "artifacts"),
    monitorDir: path.join(root, "monitor"),
    logsDir: path.join(root, "logs"),
    commandsDir: path.join(root, "commands"),
  };
}

export function ensureRunLayout(root: string): void {
  const sub = [
    "logs",
    "artifacts",
    "transcripts",
    "agents",
    "candidates",
    "verification",
    "monitor",
    "commands",
    "prompts",
  ];
  for (const s of sub) {
    fs.mkdirSync(path.join(root, s), { recursive: true });
  }
}

export function readJsonFile<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function writeJsonFile(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function readState(paths: ReturnType<typeof runPaths>): RunState {
  return readJsonFile<RunState>(paths.state);
}

export function writeState(paths: ReturnType<typeof runPaths>, state: RunState): void {
  writeJsonFile(paths.state, state);
}

export function readTaskInput(paths: ReturnType<typeof runPaths>): TaskInput {
  return readJsonFile<TaskInput>(paths.taskInput);
}

export function readApprovals(paths: ReturnType<typeof runPaths>): Approvals {
  if (!fs.existsSync(paths.approvals)) return {};
  return readJsonFile<Approvals>(paths.approvals);
}

export function writeApprovals(paths: ReturnType<typeof runPaths>, a: Approvals): void {
  writeJsonFile(paths.approvals, a);
}
