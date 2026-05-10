import fs from "node:fs";
import path from "node:path";
import { execGit } from "../util/git.js";

export function removeWorktreeIfPresent(args: { gitRoot: string; path: string }): void {
  if (!fs.existsSync(args.path)) return;
  execGit({
    cwd: args.gitRoot,
    argv: ["worktree", "remove", "--force", args.path],
  });
}

export function addWorktree(args: {
  gitRoot: string;
  worktreePath: string;
  branch: string;
  startPoint: string;
}): { ok: boolean; stderr: string } {
  fs.mkdirSync(path.dirname(args.worktreePath), { recursive: true });
  const fetch = execGit({ cwd: args.gitRoot, argv: ["fetch", "origin"] });
  if (!fetch.ok) {
    return { ok: false, stderr: fetch.stderr || "git fetch failed" };
  }
  const add = execGit({
    cwd: args.gitRoot,
    argv: [
      "worktree",
      "add",
      "-b",
      args.branch,
      args.worktreePath,
      args.startPoint,
    ],
  });
  if (add.ok) return { ok: true, stderr: "" };
  return { ok: false, stderr: add.stderr || "git worktree add failed" };
}

export function worktreeAbsolutePath(args: {
  cwd: string;
  worktreeRootRelative: string;
  segment: string;
}): string {
  return path.resolve(args.cwd, args.worktreeRootRelative, args.segment);
}

export function candidateBranchName(args: {
  issueNumber: number;
  runId: string;
  candidateId: string;
}): string {
  const shortRun = args.runId.replace(/-/g, "").slice(0, 8);
  return `agentic-my-app/${args.issueNumber}/${shortRun}/${args.candidateId}`;
}
