import { spawnSync } from "node:child_process";

export type GhJsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function ghJson<T = unknown>(args: {
  argv: string[];
  cwd: string;
}): GhJsonResult<T> {
  const r = spawnSync("gh", args.argv, {
    cwd: args.cwd,
    encoding: "utf8",
    env: process.env,
  });
  if (r.error || r.status !== 0) {
    const hint =
      r.stderr?.trim() ||
      r.error?.message ||
      `gh exited with status ${r.status ?? "unknown"}`;
    return { ok: false, error: hint };
  }
  try {
    return { ok: true, data: JSON.parse(r.stdout) as T };
  } catch {
    return { ok: false, error: "Failed to parse gh JSON output" };
  }
}

export function ghOk(args: { argv: string[]; cwd: string }): {
  ok: boolean;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync("gh", args.argv, {
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
