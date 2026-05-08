import fs from 'node:fs';
import YAML from 'yaml';
import { configPath } from './paths.js';

export interface AgenticConfig {
  version: number;
  localOnly: boolean;
  github: {
    owner: string;
    repo: string;
    defaultBaseBranch: string;
    auth: string;
    issueLabels: { include: string[]; exclude: string[] };
    pr: {
      draftByDefault: boolean;
      autoCreate: boolean;
      autoRespondToComments: boolean;
      autoMerge: boolean;
    };
  };
  models: Record<string, unknown>;
  workflow: {
    sourceAdapters: string[];
    approval: {
      afterSpec: string;
      afterDecomposition: string;
      beforePR: string;
    };
    autonomy: Record<string, unknown>;
  };
  worktrees: Record<string, unknown>;
  commands: Record<string, unknown>;
  verification: Record<string, unknown>;
  roles: Record<string, unknown>;
  prMonitor: Record<string, unknown>;
}

function normalizeConfig(raw: Record<string, unknown>): AgenticConfig {
  const v = raw.version;
  const version = typeof v === 'number' ? v : Number(v ?? 1) || 1;
  const github = (raw.github ?? {}) as Record<string, unknown>;
  const wf = (raw.workflow ?? {}) as Record<string, unknown>;
  const approval = (wf.approval ?? {}) as Record<string, unknown>;
  const ghIssueLabels = (github.issueLabels ?? {}) as Record<string, unknown>;
  const ghPr = (github.pr ?? {}) as Record<string, unknown>;

  return {
    version,
    localOnly: raw.localOnly !== false,
    github: {
      owner: String(github.owner ?? ''),
      repo: String(github.repo ?? ''),
      defaultBaseBranch: String(github.defaultBaseBranch ?? 'main'),
      auth: String(github.auth ?? 'gh-cli'),
      issueLabels: {
        include: Array.isArray(ghIssueLabels.include) ? (ghIssueLabels.include as string[]) : [],
        exclude: Array.isArray(ghIssueLabels.exclude) ? (ghIssueLabels.exclude as string[]) : [],
      },
      pr: {
        draftByDefault: !!ghPr.draftByDefault,
        autoCreate: ghPr.autoCreate !== false,
        autoRespondToComments: !!ghPr.autoRespondToComments,
        autoMerge: !!ghPr.autoMerge,
      },
    },
    models: (raw.models ?? {}) as Record<string, unknown>,
    workflow: {
      sourceAdapters: Array.isArray((wf as Record<string, unknown>).sourceAdapters)
        ? ((wf as Record<string, unknown>).sourceAdapters as string[])
        : ['github', 'manual'],
      approval: {
        afterSpec: String(approval.afterSpec ?? 'optional'),
        afterDecomposition: String(approval.afterDecomposition ?? 'required'),
        beforePR: String(approval.beforePR ?? 'optional'),
      },
      autonomy: (wf.autonomy ?? {}) as Record<string, unknown>,
    },
    worktrees: (raw.worktrees ?? {}) as Record<string, unknown>,
    commands: (raw.commands ?? {}) as Record<string, unknown>,
    verification: (raw.verification ?? {}) as Record<string, unknown>,
    roles: (raw.roles ?? {}) as Record<string, unknown>,
    prMonitor: (raw.prMonitor ?? {}) as Record<string, unknown>,
  };
}

export function loadConfig(agenticRoot: string): AgenticConfig {
  const fp = configPath(agenticRoot);
  if (!fs.existsSync(fp)) {
    throw new Error(
      `Missing config at ${fp}. Run \`agentic init\` in your project root or set --agentic-root.`,
    );
  }
  const text = fs.readFileSync(fp, 'utf8');
  const parsed = YAML.parse(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid YAML in ${fp}`);
  }
  return normalizeConfig(parsed as Record<string, unknown>);
}
