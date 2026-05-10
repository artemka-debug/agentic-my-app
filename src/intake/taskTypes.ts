export type TaskComment = {
  author?: string;
  body: string;
  createdAt?: string;
};

export type TaskAttachment = {
  name: string;
  url: string;
};

/** Optional PRs linked to the issue (e.g. closing PRs) from `gh`. */
export type TaskLinkedPullRequest = {
  number: number;
  url: string;
  title?: string;
  state?: string;
};

/**
 * Normalized task model (plan: docs/plan.md).
 * Top-level fields are strongly typed; `metadata` holds source-specific extras.
 */
export type TaskInput = {
  id: string;
  source: "github_issue" | "manual" | "file" | string;
  title: string;
  description: string;
  sourceUrl?: string;
  /** Present for GitHub issue intake. */
  issueNumber?: number;
  /** Populated when `gh` returns linked/closing PRs (optional). */
  linkedPullRequests?: TaskLinkedPullRequest[];
  /** Optional SHAs detected in issue body (best-effort). */
  referencedCommits?: string[];
  repo: {
    owner: string;
    name: string;
    defaultBranch: string;
    localPath: string;
  };
  metadata: TaskInputMetadata;
  comments: TaskComment[];
  attachments: TaskAttachment[];
};

export type TaskInputMetadata = {
  intake:
    | "github_issue"
    | "github_issue_stub"
    | "jira"
    | "jira_stub"
    | "file"
    | "manual";
  stubReason?: string;
  labels?: unknown;
  assignees?: unknown;
  milestone?: unknown;
  /** When fetched via `gh issue view`. */
  author?: string;
  state?: "OPEN" | "CLOSED" | string;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string;
  /** Raw `gh` payloads for debugging (redacted in logs when configured). */
  ghIssueJson?: Record<string, unknown>;
} & Record<string, unknown>;
