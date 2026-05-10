import fs from "node:fs";
import path from "node:path";
import type { LoadedConfig } from "../config/loadConfig.js";
import { ghJson } from "../util/gh.js";
import type { ParsedGitHubIssueRef } from "./parseIssueRef.js";
import type {
  TaskAttachment,
  TaskComment,
  TaskInput,
  TaskLinkedPullRequest,
  TaskInputMetadata,
} from "./taskTypes.js";

export type GitHubIssueFetchResult =
  | {
      ok: true;
      via: "gh_cli";
      rawJson: Record<string, unknown>;
      defaultBranch?: string;
    }
  | {
      ok: false;
      via: "stub";
      reason: string;
    };

const ISSUE_JSON_FIELDS =
  "title,body,labels,assignees,milestone,comments,url,number,state,author,createdAt,updatedAt,closedAt,closedByPullRequestsReferences";

function tryDefaultBranch(args: {
  owner: string;
  name: string;
  cwd: string;
}): string | undefined {
  const r = ghJson<{ defaultBranchRef?: { name?: string } }>({
    argv: ["repo", "view", `${args.owner}/${args.name}`, "--json", "defaultBranchRef"],
    cwd: args.cwd,
  });
  if (!r.ok) return undefined;
  const n = r.data.defaultBranchRef?.name;
  return typeof n === "string" && n.trim() ? n : undefined;
}

function mapClosingPullRequests(raw: unknown): TaskLinkedPullRequest[] {
  if (!Array.isArray(raw)) return [];
  const out: TaskLinkedPullRequest[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const num = rec.number;
    const url = rec.url;
    if (typeof num !== "number" || typeof url !== "string") continue;
    out.push({
      number: num,
      url,
      title: typeof rec.title === "string" ? rec.title : undefined,
      state: typeof rec.state === "string" ? rec.state : undefined,
    });
  }
  return out;
}

function mapComments(raw: unknown): TaskComment[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => {
    const row = c && typeof c === "object" ? (c as Record<string, unknown>) : {};
    const author =
      typeof row.author === "object" &&
      row.author &&
      typeof (row.author as { login?: unknown }).login === "string"
        ? String((row.author as { login: string }).login)
        : undefined;
    return {
      author,
      body: typeof row.body === "string" ? row.body : "",
      createdAt: typeof row.createdAt === "string" ? row.createdAt : undefined,
    };
  });
}

function extractCommitShas(text: string): string[] {
  const re = /\b([0-9a-f]{7,40})\b/gi;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    found.add(m[1].toLowerCase());
  }
  return [...found];
}

export function tryFetchGitHubIssueViaGh(args: {
  owner: string;
  name: string;
  number: number;
  cwd: string;
}): GitHubIssueFetchResult {
  const r = ghJson<Record<string, unknown>>({
    argv: [
      "issue",
      "view",
      String(args.number),
      "--repo",
      `${args.owner}/${args.name}`,
      "--json",
      ISSUE_JSON_FIELDS,
    ],
    cwd: args.cwd,
  });
  if (!r.ok) {
    return { ok: false, via: "stub", reason: r.error };
  }
  const row = r.data;
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return { ok: false, via: "stub", reason: "Invalid gh issue JSON payload" };
  }
  const defaultBranch = tryDefaultBranch({
    owner: args.owner,
    name: args.name,
    cwd: args.cwd,
  });
  return {
    ok: true,
    via: "gh_cli",
    rawJson: row as Record<string, unknown>,
    ...(defaultBranch ? { defaultBranch } : {}),
  };
}

export function buildTaskInputFromGhJson(args: {
  parsed: ParsedGitHubIssueRef;
  ghJson: Record<string, unknown>;
  loaded: LoadedConfig;
  runId: string;
  defaultBranchOverride?: string;
}): TaskInput {
  const title = String(args.ghJson.title ?? "");
  const body = String(args.ghJson.body ?? "");
  const url = typeof args.ghJson.url === "string" ? args.ghJson.url : undefined;
  const issueNumber =
    typeof args.ghJson.number === "number"
      ? args.ghJson.number
      : args.parsed.number;

  const authorLogin =
    typeof args.ghJson.author === "object" &&
    args.ghJson.author &&
    typeof (args.ghJson.author as { login?: unknown }).login === "string"
      ? String((args.ghJson.author as { login: string }).login)
      : undefined;

  const linkedRaw =
    args.ghJson.closedByPullRequestsReferences ??
    args.ghJson.closingPullRequests;
  const linkedPullRequests = mapClosingPullRequests(linkedRaw);
  const comments = mapComments(args.ghJson.comments);
  const referencedCommits = extractCommitShas(`${title}\n${body}`);

  const defaultBranch =
    args.defaultBranchOverride?.trim() ||
    args.loaded.config.repo.defaultBaseBranch;

  const meta: TaskInputMetadata = {
    intake: "github_issue",
    labels: args.ghJson.labels,
    assignees: args.ghJson.assignees,
    milestone: args.ghJson.milestone,
    ...(authorLogin ? { author: authorLogin } : {}),
    state: typeof args.ghJson.state === "string" ? args.ghJson.state : undefined,
    createdAt:
      typeof args.ghJson.createdAt === "string"
        ? args.ghJson.createdAt
        : undefined,
    updatedAt:
      typeof args.ghJson.updatedAt === "string"
        ? args.ghJson.updatedAt
        : undefined,
    closedAt:
      typeof args.ghJson.closedAt === "string"
        ? args.ghJson.closedAt
        : undefined,
    ghIssueJson: args.ghJson,
  };

  return {
    id: args.runId,
    source: "github_issue",
    title,
    description: body,
    ...(url ? { sourceUrl: url } : {}),
    issueNumber,
    ...(linkedPullRequests.length ? { linkedPullRequests } : {}),
    ...(referencedCommits.length ? { referencedCommits } : {}),
    repo: {
      owner: args.parsed.owner,
      name: args.parsed.name,
      defaultBranch,
      localPath: args.loaded.cwd,
    },
    metadata: meta,
    comments,
    attachments: [] satisfies TaskAttachment[],
  };
}

export function buildStubTaskInput(args: {
  parsed: ParsedGitHubIssueRef;
  loaded: LoadedConfig;
  runId: string;
  reason: string;
}): TaskInput {
  const url = `https://github.com/${args.parsed.owner}/${args.parsed.name}/issues/${args.parsed.number}`;
  const defaultBranch = args.loaded.config.repo.defaultBaseBranch;
  return {
    id: args.runId,
    source: "github_issue",
    title: `GitHub issue #${args.parsed.number}`,
    description:
      `Issue intake stub: gh fetch failed or is unavailable.\n\nReason:\n${args.reason}\n`,
    sourceUrl: url,
    issueNumber: args.parsed.number,
    repo: {
      owner: args.parsed.owner,
      name: args.parsed.name,
      defaultBranch,
      localPath: args.loaded.cwd,
    },
    metadata: {
      intake: "github_issue_stub",
      stubReason: args.reason,
    },
    comments: [],
    attachments: [],
  };
}

export function persistTaskInput(taskDir: string, task: TaskInput): void {
  fs.writeFileSync(
    path.join(taskDir, "task-input.json"),
    `${JSON.stringify(task, null, 2)}\n`,
    "utf8",
  );
}
