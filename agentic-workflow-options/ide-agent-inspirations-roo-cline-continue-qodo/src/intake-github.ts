import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface ParsedIssueUrl {
  owner: string;
  repo: string;
  number: number;
  host: string;
}

const ISSUE_RE =
  /^https?:\/\/(?<host>[^/]+)\/(?<owner>[^/]+)\/(?<repo>[^/]+)\/issues\/(?<num>\d+)\/?$/i;

export function parseGitHubIssueUrl(url: string): ParsedIssueUrl {
  const m = url.trim().match(ISSUE_RE);
  if (!m?.groups) {
    throw new Error(
      `Expected GitHub issue URL like https://github.com/owner/repo/issues/123, got: ${url}`,
    );
  }
  const { host, owner, repo, num } = m.groups;
  return {
    host: host!,
    owner: owner!,
    repo: repo!,
    number: Number(num),
  };
}

/** Shape returned by `gh issue view --json …` — extended fields tolerated. */
export interface GhIssueJson {
  number: number;
  title: string;
  body: string;
  state: string;
  url: string;
  labels?: { name: string; id?: string; color?: string }[];
  assignees?: { login: string; id?: number }[];
  milestone?: { title: string; number?: number } | null;
}

export function fetchIssueViaGhCli(parsed: ParsedIssueUrl): GhIssueJson {
  const slug = `${parsed.owner}/${parsed.repo}`;
  try {
    const out = execFileSync(
      'gh',
      [
        'issue',
        'view',
        String(parsed.number),
        '--repo',
        slug,
        '--json',
        'number,title,body,state,url,labels,assignees,milestone',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return JSON.parse(out) as GhIssueJson;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `gh CLI failed (${msg}). Ensure GitHub CLI is installed (\`brew install gh\`) and authenticated (\`gh auth login\`). Repo: ${slug} issue #${parsed.number}.`,
    );
  }
}

export interface IntakePayload {
  source: 'github';
  fetchedAt: string;
  issueUrl: string;
  repo: { owner: string; name: string; host: string };
  issue: GhIssueJson;
}

export function buildIssueMarkdown(payload: IntakePayload): string {
  const labels = payload.issue.labels?.map((l) => l.name).join(', ') ?? '';
  const assignees = payload.issue.assignees?.map((a) => a.login).join(', ') ?? '';
  const ms = payload.issue.milestone?.title ?? '';
  return [
    `# GitHub Issue #${payload.issue.number}`,
    '',
    `**URL:** ${payload.issue.url}`,
    '',
    `**State:** ${payload.issue.state}`,
    '',
    `**Labels:** ${labels || '—'}`,
    '',
    `**Assignees:** ${assignees || '—'}`,
    '',
    `**Milestone:** ${ms || '—'}`,
    '',
    '## Title',
    '',
    payload.issue.title,
    '',
    '## Body',
    '',
    payload.issue.body || '_empty_',
    '',
  ].join('\n');
}

export function writeIntakeArtifacts(runPath: string, payload: IntakePayload): void {
  fs.writeFileSync(path.join(runPath, 'intake.json'), JSON.stringify(payload, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(runPath, 'issue.md'), buildIssueMarkdown(payload), 'utf8');
}
