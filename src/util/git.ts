import { execSync, spawnSync } from "node:child_process";

export function execGit(args: { cwd: string; argv: string[] }): {
  ok: boolean;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync("git", args.argv, {
    cwd: args.cwd,
    encoding: "utf8",
    env: process.env,
  });
  return {
    ok: !r.error && r.status === 0,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

export function gitTopLevel(cwd: string): string {
  const out = execSync("git rev-parse --show-toplevel", {
    cwd,
    encoding: "utf8",
  }).trim();
  if (!out) throw new Error(`not a git repository: ${cwd}`);
  return out;
}

export function gitCurrentBranch(cwd: string): string {
  return execSync("git rev-parse --abbrev-ref HEAD", {
    cwd,
    encoding: "utf8",
  }).trim();
}

export function gitDiffRange(args: { cwd: string; base: string }): string {
  const r = execGit({ cwd: args.cwd, argv: ["diff", `${args.base}...HEAD`] });
  if (!r.ok) return "";
  return r.stdout;
}
