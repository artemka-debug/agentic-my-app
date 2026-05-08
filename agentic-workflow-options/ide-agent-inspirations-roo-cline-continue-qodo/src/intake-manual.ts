import fs from 'node:fs';
import path from 'node:path';

export interface ManualIntakePayload {
  source: 'manual';
  createdAt: string;
  title: string;
  body: string;
}

export function buildManualPayload(title: string, body: string): ManualIntakePayload {
  return {
    source: 'manual',
    createdAt: new Date().toISOString(),
    title: title.trim() || 'Manual task',
    body: body.trim(),
  };
}

export function writeManualIntake(runPath: string, payload: ManualIntakePayload): void {
  fs.writeFileSync(path.join(runPath, 'intake.json'), JSON.stringify(payload, null, 2) + '\n', 'utf8');
  const md = [
    '# Manual intake',
    '',
    `**Created:** ${payload.createdAt}`,
    '',
    '## Title',
    '',
    payload.title,
    '',
    '## Description',
    '',
    payload.body || '_empty_',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(runPath, 'issue.md'), md, 'utf8');
}
