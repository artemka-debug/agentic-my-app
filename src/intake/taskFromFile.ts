import fs from "node:fs";
import path from "node:path";
import type { LoadedConfig } from "../config/loadConfig.js";
import type { TaskInput } from "./taskTypes.js";

export function buildTaskInputFromMarkdownFile(args: {
  filePath: string;
  loaded: LoadedConfig;
  runId: string;
}): TaskInput {
  const raw = fs.readFileSync(args.filePath, "utf8");
  const base = path.basename(args.filePath);
  const lines = raw.split(/\n/);
  const first = lines[0]?.trim() ?? "";
  const title =
    first.replace(/^#\s+/, "").trim() ||
    base.replace(/\.[^.]+$/, "") ||
    "Task";
  const description =
    lines
      .slice(1)
      .join("\n")
      .trim() || raw;

  const repo =
    args.loaded.config.github.defaultRepo.trim() ||
    path.basename(args.loaded.cwd);
  const slash = repo.split("/");
  const owner = slash[0] ?? "local";
  const name = slash[1] ?? slash[0] ?? "repo";

  return {
    id: args.runId,
    source: "file",
    title,
    description,
    repo: {
      owner,
      name,
      defaultBranch: args.loaded.config.repo.defaultBaseBranch,
      localPath: args.loaded.cwd,
    },
    metadata: { intake: "file", path: args.filePath },
    comments: [],
    attachments: [],
  };
}
