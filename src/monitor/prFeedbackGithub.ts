import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ghJson } from "../util/gh.js";
import { monitorDebugLog } from "./monitorDebug.js";

export type PrCoordinates = {
  owner: string;
  repo: string;
  number: number;
};

export type AddressedPrFeedback = {
  issueCommentIds: number[];
  reviewCommentIds: number[];
  /** Submitted PR review summaries (REST `pulls/:n/reviews[].id`). */
  pullReviewIds?: number[];
};

/** Tool-authored replies carry this literal prefix; humans’ comments with it are skipped. */
export const AGENTIC_PLATFORM_REPLY_MARKER = "[Agentic Platform]";

export function feedbackHasAgenticPlatformPrefix(body: string): boolean {
  return body.replace(/^\uFEFF/, "").trimStart().startsWith(AGENTIC_PLATFORM_REPLY_MARKER);
}

/** Ensure posted replies are tagged; avoid double-prefixing if the draft already begins with it. */
export function prependAgenticPlatformReplyPrefix(body: string): string {
  const b = body.replace(/^\uFEFF/, "");
  if (b.trimStart().startsWith(AGENTIC_PLATFORM_REPLY_MARKER)) return b;
  return `${AGENTIC_PLATFORM_REPLY_MARKER}\n\n${b}`;
}

type GhUser = { login?: string; type?: string };

export type IssueCommentRow = {
  id: number;
  body?: string;
  user?: GhUser;
  created_at?: string;
};

export type ReviewCommentRow = {
  id: number;
  body?: string;
  user?: GhUser;
  created_at?: string;
  in_reply_to_id?: number | null;
  in_reply_to?: number | null;
  path?: string;
};

export type PullReviewRow = {
  id: number;
  body?: string | null;
  state?: string;
  user?: GhUser;
  submitted_at?: string;
};

export type PendingRootFeedback =
  | {
      kind: "issue";
      id: number;
      author: string;
      body: string;
      createdAtIso?: string;
    }
  | {
      kind: "review";
      id: number;
      author: string;
      body: string;
      path?: string;
      inReplyToId?: number | null;
      createdAtIso?: string;
    }
  | {
      kind: "review_submission";
      id: number;
      author: string;
      body: string;
      state?: string;
      createdAtIso?: string;
    };

/** Explicit REST `page`/`per_page` loop so every row is fetched (GitHub caps 100 per page). */
function ghApiPaged<T>(
  cwd: string,
  pathNoQuery: string,
  debugLabel: string,
): T[] {
  const collected: T[] = [];
  monitorDebugLog("gh_pages_start", {
    label: debugLabel,
    path: pathNoQuery,
  });

  for (let page = 1; page <= 500; page++) {
    const qp = `${pathNoQuery}?per_page=100&page=${page}`;
    const r = ghJson<T[]>({ argv: ["api", qp], cwd });
    if (!r.ok) {
      monitorDebugLog(`${debugLabel}_fetch_error`, {
        page,
        error:
          typeof r.error === "string" ? r.error.slice(0, 500) : String(r.error),
      });
      break;
    }
    const batch = Array.isArray(r.data) ? r.data : [];
    monitorDebugLog(`${debugLabel}_page`, {
      page,
      received: batch.length,
    });
    collected.push(...batch);
    if (batch.length === 0) break;
    if (batch.length < 100) break;
  }

  monitorDebugLog(`${debugLabel}_done`, { total: collected.length });
  return collected;
}

function ghApiIssueComments(
  coords: PrCoordinates,
  cwd: string,
): IssueCommentRow[] {
  const p = `repos/${coords.owner}/${coords.repo}/issues/${coords.number}/comments`;
  return ghApiPaged<IssueCommentRow>(cwd, p, "issue_comments");
}

function ghApiReviewComments(
  coords: PrCoordinates,
  cwd: string,
): ReviewCommentRow[] {
  const p =
    `repos/${coords.owner}/${coords.repo}/pulls/${coords.number}/comments`;
  return ghApiPaged<ReviewCommentRow>(cwd, p, "pull_review_comments");
}

function ghApiPullReviewsSubmitted(
  coords: PrCoordinates,
  cwd: string,
): PullReviewRow[] {
  const p =
    `repos/${coords.owner}/${coords.repo}/pulls/${coords.number}/reviews`;
  return ghApiPaged<PullReviewRow>(cwd, p, "pull_reviews_submitted");
}

/**
 * Parse a browser/GitHub UI URL (`https://github.com/OWNER/REPO/pull/NUMBER`).
 * Prefer this over `gh pr view URL` — the CLI often fails outside a checkout of that repo.
 */
export function coordsFromGithubPullBrowserUrl(prRef: string): PrCoordinates | null {
  const trimmed = prRef.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;

  try {
    const pathname = new URL(trimmed.replace(/#.*/, "").trim()).pathname;
    const m = pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!m?.[3]) return null;
    const n = parseInt(m[3]!, 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    const repo = decodeURIComponent(m[2]!).replace(/\.git$/i, "");
    return {
      owner: decodeURIComponent(m[1]!),
      repo,
      number: n,
    };
  } catch {
    return null;
  }
}

export function resolvePrCoordinates(args: {
  prRef: string;
  cwd: string;
}): PrCoordinates | null {
  const trimmed = args.prRef.trim();

  const fromUrl = coordsFromGithubPullBrowserUrl(trimmed);
  if (fromUrl) {
    monitorDebugLog("resolve_pr_coordinates_ok", {
      ...fromUrl,
      via: "github_pull_url_parse",
    });
    return fromUrl;
  }

  const view = ghJson<{
    number: number;
    repository?: { nameWithOwner?: string };
  }>({
    argv: ["pr", "view", trimmed, "--json", "number,repository"],
    cwd: args.cwd,
  });

  monitorDebugLog("resolve_pr_coordinates_gh", {
    ok: view.ok,
    rawPrRef: trimmed,
    ghError:
      view.ok || typeof view.error !== "string"
        ? undefined
        : view.error.trim().slice(0, 500),
  });

  if (!view.ok || !view.data.repository?.nameWithOwner) return null;

  const [owner, repo] = view.data.repository.nameWithOwner.split("/");
  if (!owner || !repo) return null;
  const coords = { owner, repo, number: view.data.number };
  monitorDebugLog("resolve_pr_coordinates_ok", { ...coords, via: "gh_pr_view" });
  return coords;
}

function isProbablyBot(login: string, user?: GhUser): boolean {
  if (user?.type === "Bot") return true;
  return login.endsWith("[bot]") || login === "copilot-pull-request-reviewer";
}

function parseTime(iso?: string): number {
  if (!iso) return 0;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
}

function sortFeedbackPending(items: PendingRootFeedback[]): void {
  items.sort((a, b) => {
    const ta = parseTime(a.createdAtIso);
    const tb = parseTime(b.createdAtIso);
    if (ta !== tb) return ta - tb;
    return `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`, "en");
  });
}

/** All PR feedback visible via REST: conversation, every inline (incl. replies), submitted summaries. */
export function fetchUnaddressedRootFeedback(args: {
  coords: PrCoordinates;
  cwd: string;
  addressed: AddressedPrFeedback;
}): PendingRootFeedback[] {
  monitorDebugLog("fetch_feedback_start", {
    ...args.coords,
    addressedIssueCount: args.addressed.issueCommentIds.length,
    addressedReviewCount: args.addressed.reviewCommentIds.length,
    addressedPullReviewCount: args.addressed.pullReviewIds?.length ?? 0,
  });

  const issueRows = ghApiIssueComments(args.coords, args.cwd);
  const reviewRows = ghApiReviewComments(args.coords, args.cwd);
  const pullReviews = ghApiPullReviewsSubmitted(args.coords, args.cwd);

  monitorDebugLog("fetch_feedback_sources", {
    issueRows: issueRows.length,
    reviewRows: reviewRows.length,
    pullReviews: pullReviews.length,
  });

  const addressedIssue = new Set(args.addressed.issueCommentIds);
  const addressedReview = new Set(args.addressed.reviewCommentIds);
  const addressedPullReview = new Set(args.addressed.pullReviewIds ?? []);

  const pending: PendingRootFeedback[] = [];
  const skipped = {
    addressed: 0,
    bot: 0,
    empty: 0,
    prefixed: 0,
    issueEmpty: 0,
    issueAddressed: 0,
    issueBot: 0,
    issuePrefixed: 0,
    reviewEmpty: 0,
    reviewAddressed: 0,
    reviewBot: 0,
    reviewPrefixed: 0,
    pullReviewEmpty: 0,
    pullReviewAddressed: 0,
    pullReviewBot: 0,
    pullReviewPrefixed: 0,
  };

  for (const row of issueRows) {
    if (
      typeof row.id !== "number" ||
      typeof row.body !== "string" ||
      !row.body.trim()
    ) {
      skipped.empty += 1;
      skipped.issueEmpty += 1;
      continue;
    }
    if (addressedIssue.has(row.id)) {
      skipped.addressed += 1;
      skipped.issueAddressed += 1;
      continue;
    }
    const login = row.user?.login?.trim() ?? "unknown";
    if (isProbablyBot(login, row.user)) {
      skipped.bot += 1;
      skipped.issueBot += 1;
      continue;
    }
    const bodyText = row.body.trim();
    if (feedbackHasAgenticPlatformPrefix(bodyText)) {
      skipped.prefixed += 1;
      skipped.issuePrefixed += 1;
      continue;
    }
    pending.push({
      kind: "issue",
      id: row.id,
      author: login,
      body: bodyText,
      createdAtIso: row.created_at,
    });
  }

  for (const row of reviewRows) {
    const inReplyTo =
      row.in_reply_to_id ?? (row as { in_reply_to?: number | null }).in_reply_to;
    if (
      typeof row.id !== "number" ||
      typeof row.body !== "string" ||
      !row.body.trim()
    ) {
      skipped.empty += 1;
      skipped.reviewEmpty += 1;
      continue;
    }
    if (addressedReview.has(row.id)) {
      skipped.addressed += 1;
      skipped.reviewAddressed += 1;
      continue;
    }
    const login = row.user?.login?.trim() ?? "unknown";
    if (isProbablyBot(login, row.user)) {
      skipped.bot += 1;
      skipped.reviewBot += 1;
      continue;
    }

    const reviewBody = row.body.trim();
    if (feedbackHasAgenticPlatformPrefix(reviewBody)) {
      skipped.prefixed += 1;
      skipped.reviewPrefixed += 1;
      continue;
    }

    pending.push({
      kind: "review",
      id: row.id,
      author: login,
      body: reviewBody,
      path: row.path,
      inReplyToId:
        typeof inReplyTo === "number" && inReplyTo > 0 ? inReplyTo : null,
      createdAtIso: row.created_at,
    });
  }

  for (const row of pullReviews) {
    const bodyRaw = typeof row.body === "string" ? row.body : "";
    if (typeof row.id !== "number" || !bodyRaw.trim()) {
      skipped.empty += 1;
      skipped.pullReviewEmpty += 1;
      continue;
    }
    if (addressedPullReview.has(row.id)) {
      skipped.addressed += 1;
      skipped.pullReviewAddressed += 1;
      continue;
    }
    const login = row.user?.login?.trim() ?? "unknown";
    if (isProbablyBot(login, row.user)) {
      skipped.bot += 1;
      skipped.pullReviewBot += 1;
      continue;
    }
    const subBody = bodyRaw.trim();
    if (feedbackHasAgenticPlatformPrefix(subBody)) {
      skipped.prefixed += 1;
      skipped.pullReviewPrefixed += 1;
      continue;
    }
    pending.push({
      kind: "review_submission",
      id: row.id,
      author: login,
      body: subBody,
      state: typeof row.state === "string" ? row.state : undefined,
      createdAtIso: row.submitted_at,
    });
  }

  sortFeedbackPending(pending);

  monitorDebugLog("fetch_feedback_skips", skipped);
  monitorDebugLog("fetch_feedback_done", {
    pendingCount: pending.length,
    breakdown: pending.reduce<
      Record<PendingRootFeedback["kind"], number>
    >(
      (acc, p) => {
        acc[p.kind] = (acc[p.kind] ?? 0) + 1;
        return acc;
      },
      { issue: 0, review: 0, review_submission: 0 },
    ),
  });

  return pending;
}

export function loadAddressedFeedback(filePath: string): AddressedPrFeedback {
  if (!fs.existsSync(filePath))
    return { issueCommentIds: [], reviewCommentIds: [], pullReviewIds: [] };
  try {
    const j = JSON.parse(fs.readFileSync(filePath, "utf8")) as AddressedPrFeedback;
    const issue = Array.isArray(j.issueCommentIds) ? j.issueCommentIds : [];
    const review = Array.isArray(j.reviewCommentIds) ? j.reviewCommentIds : [];
    const pr = Array.isArray(j.pullReviewIds) ? j.pullReviewIds : [];
    return {
      issueCommentIds: [...new Set(issue)].sort((a, b) => a - b),
      reviewCommentIds: [...new Set(review)].sort((a, b) => a - b),
      pullReviewIds: [...new Set(pr)].sort((a, b) => a - b),
    };
  } catch {
    return {
      issueCommentIds: [],
      reviewCommentIds: [],
      pullReviewIds: [],
    };
  }
}

export function saveAddressedFeedback(
  filePath: string,
  data: AddressedPrFeedback,
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const normalized: AddressedPrFeedback = {
    issueCommentIds: data.issueCommentIds,
    reviewCommentIds: data.reviewCommentIds,
    pullReviewIds: data.pullReviewIds ?? [],
  };
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export function ghApiPost(args: {
  endpoint: string;
  cwd: string;
  payload: Record<string, unknown>;
}): { ok: boolean; stderr: string } {
  const r = spawnSync(
    "gh",
    ["api", "--method", "POST", args.endpoint, "--input", "-"],
    {
      cwd: args.cwd,
      input: `${JSON.stringify(args.payload)}\n`,
      encoding: "utf8",
      env: process.env,
    },
  );
  return {
    ok: !r.error && r.status === 0,
    stderr: `${r.stderr ?? ""}${r.stdout ?? ""}`.trim(),
  };
}

export function postThreadReply(args: {
  cwd: string;
  coords: PrCoordinates;
  item: PendingRootFeedback;
  body: string;
}): { ok: boolean; stderr: string } {
  const { coords, cwd, item, body } = args;
  if (item.kind === "issue") {
    return ghApiPost({
      cwd,
      endpoint: `repos/${coords.owner}/${coords.repo}/issues/${coords.number}/comments`,
      payload: { body },
    });
  }
  if (item.kind === "review_submission") {
    return ghApiPost({
      cwd,
      endpoint: `repos/${coords.owner}/${coords.repo}/issues/${coords.number}/comments`,
      payload: { body },
    });
  }
  monitorDebugLog("post_review_comment_reply", {
    replyingToCommentId: item.id,
    path: item.path ?? null,
  });
  return ghApiPost({
    cwd,
    endpoint:
      `repos/${coords.owner}/${coords.repo}/pulls/${coords.number}/comments/${item.id}/replies`,
    payload: { body },
  });
}

/** Short preview for Markdown quote blocks */
export function ellipsis(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 3)}…`;
}

export function buildCommentFeedbackBlock(items: PendingRootFeedback[]): string {
  if (items.length === 0) return "";
  const chunks = items.map((p, idx) => {
    if (p.kind === "issue") {
      return `### Conversation comment #${idx + 1} (issue comment id=${p.id}, @${p.author})\n\n${p.body}`;
    }
    if (p.kind === "review_submission") {
      const st = p.state ? `, state=${p.state}` : "";
      return `### Submitted review #${idx + 1} (pull-review id=${p.id}${st}, @${p.author})\n\n${p.body}`;
    }
    const reply =
      p.inReplyToId != null ? `reply thread (parent comment id=${p.inReplyToId})` : "thread root";
    return `### Inline review comment #${idx + 1} (review comment id=${p.id}, ${reply}, path=${p.path ?? "?"}, @${p.author})\n\n${p.body}`;
  });
  return chunks.join("\n\n---\n\n");
}
