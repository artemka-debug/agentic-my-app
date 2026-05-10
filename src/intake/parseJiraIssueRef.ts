export type ParsedJiraIssueRef = {
  key: string;
  project: string;
  number: number;
};

const JIRA_KEY_RE = /^([A-Z][A-Z0-9]+)-([1-9][0-9]*)$/;

export function parseJiraIssueRef(raw: string): ParsedJiraIssueRef | null {
  const key = raw.trim().toUpperCase();
  const m = JIRA_KEY_RE.exec(key);
  if (!m?.[1] || !m?.[2]) return null;
  return {
    key,
    project: m[1],
    number: Number(m[2]),
  };
}
