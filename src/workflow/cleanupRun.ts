import fs from "node:fs";
import path from "node:path";
import type { LoadedConfig } from "../config/loadConfig.js";
import { resolveArtifactsRoot } from "../config/loadConfig.js";
import { readJsonFile, runPaths } from "../runs/runWorkspace.js";
import { gitTopLevel } from "../util/git.js";
import { removeWorktreeIfPresent } from "../worktree/manager.js";

export function cleanupRun(args: {
  loaded: LoadedConfig;
  runId: string;
  removeRunDir?: boolean;
}): { removedWorktrees: string[]; removedRunDir: boolean } {
  const { relativeRoot } = resolveArtifactsRoot(args.loaded);
  const paths = runPaths({
    cwd: args.loaded.cwd,
    artifactsRootRelative: relativeRoot,
    runId: args.runId,
  });
  const removed: string[] = [];
  let gitRoot: string | undefined;
  const candDir = paths.candidatesDir;
  if (fs.existsSync(candDir)) {
    for (const f of fs.readdirSync(candDir)) {
      if (!f.endsWith(".json")) continue;
      const meta = readJsonFile<{ worktreePath?: string }>(
        path.join(candDir, f),
      );
      if (!meta.worktreePath || !fs.existsSync(meta.worktreePath)) continue;
      try {
        if (!gitRoot) gitRoot = gitTopLevel(meta.worktreePath);
      } catch {
        continue;
      }
      removeWorktreeIfPresent({ gitRoot, path: meta.worktreePath });
      removed.push(meta.worktreePath);
    }
  }

  let removedRunDir = false;
  if (args.removeRunDir && fs.existsSync(paths.root)) {
    fs.rmSync(paths.root, { recursive: true, force: true });
    removedRunDir = true;
  }
  return { removedWorktrees: removed, removedRunDir };
}
