import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const APPROVALS_FILENAME = 'approvals.json';

export type GateName = 'afterSpec' | 'afterDecomposition' | 'beforePR';
export type GateStatus = 'pending' | 'approved' | 'rejected' | 'skipped';

export interface ApprovalDecisionEntry {
  gate: GateName | string;
  status: GateStatus;
  actor: string;
  note?: string;
  decidedAt: string;
}

/** Durable approval record for a workflow run (`approvals.json`). */
export interface ApprovalsRecord {
  schemaVersion: 1;
  runId: string;
  updatedAt: string;
  gates: Partial<Record<GateName | string, GateStatus>>;
  workflowConfigSnapshot?: {
    approvalAfterSpec?: string;
    approvalAfterDecomposition?: string;
    approvalBeforePR?: string;
  };
  history: ApprovalDecisionEntry[];
}

export function emptyApprovals(runId: string, workflow?: ApprovalsRecord['workflowConfigSnapshot']): ApprovalsRecord {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    runId,
    updatedAt: now,
    gates: {
      afterSpec: 'pending',
      afterDecomposition: 'pending',
      beforePR: 'pending',
    },
    workflowConfigSnapshot: workflow,
    history: [],
  };
}

export function readApprovals(filePath: string): ApprovalsRecord {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as ApprovalsRecord;
  if (parsed.schemaVersion !== 1) throw new Error(`Unsupported approvals schema: ${parsed.schemaVersion}`);
  return parsed;
}

export function writeApprovals(filePath: string, record: ApprovalsRecord): void {
  const next: ApprovalsRecord = { ...record, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2) + '\n', 'utf8');
}

/** Append a decision and update aggregate `gates` status for known gate keys. */
export function recordGateDecision(
  record: ApprovalsRecord,
  gate: GateName | string,
  status: GateStatus,
  opts: { actor: string; note?: string },
): ApprovalsRecord {
  const decidedAt = new Date().toISOString();
  const gates = { ...record.gates, [gate]: status };
  const history = [
    ...record.history,
    { gate, status, actor: opts.actor, note: opts.note, decidedAt },
  ];
  return { ...record, gates, history, updatedAt: decidedAt };
}

export function approvalsPath(runPath: string): string {
  return path.join(runPath, APPROVALS_FILENAME);
}

export function yamlApprovalSnapshot(agenticYamlText: string): ApprovalsRecord['workflowConfigSnapshot'] {
  const doc = YAML.parse(agenticYamlText) as Record<string, unknown>;
  const wf = (doc?.workflow ?? {}) as Record<string, unknown>;
  const ap = (wf.approval ?? {}) as Record<string, unknown>;
  return {
    approvalAfterSpec: String(ap.afterSpec ?? ''),
    approvalAfterDecomposition: String(ap.afterDecomposition ?? ''),
    approvalBeforePR: String(ap.beforePR ?? ''),
  };
}
