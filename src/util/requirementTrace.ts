/**
 * Best-effort traceability seed from PO markdown output (FR-/NFR-/AC-/SEC-/TEST- prefixes).
 */
export type RequirementTraceSeed = {
  id: string;
  type:
    | "functional"
    | "non_functional"
    | "acceptance"
    | "security"
    | "test"
    | "edge_case";
  text: string;
  priority: "must" | "should" | "could";
  status: "unimplemented";
};

function inferType(id: string): RequirementTraceSeed["type"] {
  const u = id.toUpperCase();
  if (u.startsWith("NFR-")) return "non_functional";
  if (u.startsWith("AC-")) return "acceptance";
  if (u.startsWith("SEC-")) return "security";
  if (u.startsWith("TEST-")) return "test";
  return "functional";
}

function normalizeRequirementId(raw: string): string {
  return raw.replace(/^(fr|nfr|ac|sec|test)-/i, (prefix) => prefix.toUpperCase());
}

const LINE_RE =
  /^\s*(?:[-*]\s*)?((?:FR|NFR|AC|SEC|TEST)-\d+)\s*(?:[:-]|\.)\s*(.+)$/i;

export function extractRequirementTraceSeeds(markdown: string): RequirementTraceSeed[] {
  const seeds: RequirementTraceSeed[] = [];
  const seen = new Set<string>();
  for (const line of markdown.split(/\r?\n/)) {
    const m = line.match(LINE_RE);
    if (!m) continue;
    const id = normalizeRequirementId(m[1].trim());
    const text = m[2].trim();
    if (!text || seen.has(id)) continue;
    seen.add(id);
    seeds.push({
      id,
      type: inferType(id),
      text,
      priority: "must",
      status: "unimplemented",
    });
  }
  return seeds;
}
