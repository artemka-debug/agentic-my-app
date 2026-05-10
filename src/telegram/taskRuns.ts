import fs from "node:fs";
import path from "node:path";
import { loadConfig, resolveArtifactsRoot } from "../config/loadConfig.js";
import type { TaskInput } from "../intake/taskTypes.js";
import {
  readState,
  readTaskInput,
  runPaths,
} from "../runs/runWorkspace.js";
import { taskFileTaskId } from "./taskId.js";
import { findSessionRecordForRunId, type TelegramSessionFile } from "./sessions.js";

export type DiskRunBrief = {
  runId: string;
  phase: string;
  createdAt: string;
  /** Optional short label (e.g. telegram row taskId) for button text. */
  taskIdHint?: string;
};

/** Same convention as handlePlanRun / task-input on disk. */
export function canonicalTaskIdFromTaskInput(
  task: TaskInput,
  cwd: string,
): string {
  if (task.issueNumber !== undefined) {
    return `${task.repo.owner.toLowerCase()}/${task.repo.name.toLowerCase()}#${task.issueNumber}`;
  }
  const pathMeta = (task.metadata as Record<string, unknown>).path;
  if (typeof pathMeta === "string") {
    return taskFileTaskId(cwd, pathMeta);
  }
  return task.id;
}

/** All runs under the artifacts root whose task-input matches `taskId` (newest `createdAt` first). */
export function listDiskRunsForTaskId(args: {
  cwd: string;
  taskId: string;
}): DiskRunBrief[] {
  let loaded;
  try {
    loaded = loadConfig(args.cwd);
  } catch {
    return [];
  }
  const { relativeRoot } = resolveArtifactsRoot(loaded);
  const runsRoot = path.join(args.cwd, relativeRoot);
  if (!fs.existsSync(runsRoot)) {
    return [];
  }
  const entries = fs.readdirSync(runsRoot, { withFileTypes: true });
  const out: DiskRunBrief[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const runId = ent.name;
    const paths = runPaths({
      cwd: args.cwd,
      artifactsRootRelative: relativeRoot,
      runId,
    });
    if (!fs.existsSync(paths.taskInput) || !fs.existsSync(paths.state)) {
      continue;
    }
    try {
      const task = readTaskInput(paths);
      const state = readState(paths);
      const tid = canonicalTaskIdFromTaskInput(task, args.cwd);
      if (tid !== args.taskId) continue;
      out.push({
        runId,
        phase: state.phase,
        createdAt: state.createdAt,
      });
    } catch {
      continue;
    }
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

export function formatTaskRunsLines(args: {
  taskId: string;
  runs: DiskRunBrief[];
  sessionFile: TelegramSessionFile;
  title: string;
}): string {
  const { taskId, runs, sessionFile, title } = args;
  if (!runs.length) {
    return `${title}\nNo runs on disk for ${taskId} under this workspace.`;
  }
  const lines = runs.map((r, i) => {
    const sess = findSessionRecordForRunId(sessionFile, r.runId);
    const sessBit = sess
      ? ` telegram: chat=${sess.chatId} updated=${sess.updatedAt}`
      : "";
    return `${i + 1}. runId=${r.runId} phase=${r.phase} created=${r.createdAt}${sessBit}`;
  });
  return [`${title} (${runs.length})`, `taskId: ${taskId}`, "", ...lines].join(
    "\n",
  );
}
