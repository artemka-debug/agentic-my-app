/**
 * Decide whether a Cursor agent tool call should require human confirmation
 * when `pauseBeforeTools` is enabled with selective (non‑all) mode.
 */

const DESTRUCTIVE_NAME_FRAGMENTS = [
  "delete_file",
  "deletefile",
  "remove_file",
  "rmdir",
  "unlink",
  "trash",
  "wipe",
];

function toolNameNorm(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "_");
}

function collectStringValues(v: unknown, out: string[], depth = 0): void {
  if (depth > 8) return;
  if (typeof v === "string") {
    out.push(v);
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) collectStringValues(x, out, depth + 1);
    return;
  }
  if (v && typeof v === "object") {
    for (const x of Object.values(v as Record<string, unknown>)) {
      collectStringValues(x, out, depth + 1);
    }
  }
}

/** Prefer likely shell/command fields from tool payloads (varies by tool). */
function extractShellLikeText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const o = payload as Record<string, unknown>;
  const preferKeys = [
    "command",
    "shell_command",
    "cmd",
    "script",
    "input",
    "args",
    "argv",
    "line",
    "text",
  ];
  const parts: string[] = [];
  for (const k of preferKeys) {
    const raw = o[k];
    if (typeof raw === "string") parts.push(raw);
    else collectStringValues(raw, parts);
  }
  const joined = parts.join("\n").trim();
  if (joined) return joined;
  const all: string[] = [];
  collectStringValues(payload, all);
  return all.join(" ").slice(0, 12000);
}

/**
 * Matches obviously destructive / hard‑to‑revert shell usage. Heuristic;
 * occasional false positives are acceptable.
 */
function shellLooksDestructive(cmd: string): boolean {
  const c = cmd.toLowerCase().replace(/\s+/g, " ").trim();
  if (!c) return false;

  if (/\bgit\s+push\b[^;\n]*\s(--force|\s-f)(\s|$|,)/i.test(c)) return true;
  if (/\bgit\s+branch\b[^;\n]*\s-D\s/i.test(c)) return true;
  if (/\bgit\s+reset\s+--hard\b/i.test(c)) return true;
  if (/\bgit\s+clean\s+[^;\n]*-[^;\n\d\sf]*(?:f|x)\b/i.test(c)) return true;
  if (/\brm\s+\S/i.test(c)) return true;

  if (/\bshred\b/i.test(c)) return true;
  if (/\bdd\s+[^;\n]*\bof=/.test(c)) return true;
  if (/\bmkfs\./i.test(c) || /\bdiskutil\s+erase\b/i.test(c)) return true;

  if (c.includes(":(){") || c.includes("(){:")) return true;

  if (/\bdrop\s+(database|table|schema)\b/i.test(c)) return true;

  return false;
}

export function toolCallLooksDestructive(
  toolName: string,
  payload: unknown,
): boolean {
  const n = toolNameNorm(toolName);

  if (DESTRUCTIVE_NAME_FRAGMENTS.some((frag) => n.includes(frag))) return true;

  const shellHints = [
    "run_terminal",
    "terminal",
    "shell",
    "exec",
    "bash",
    "zsh",
  ];
  if (shellHints.some((h) => n.includes(h))) {
    const text = extractShellLikeText(payload);
    if (shellLooksDestructive(text)) return true;
  }

  if (n.includes("delete") && !n.includes("delete_lines")) return true;

  return false;
}

/** Whether to prompt the operator for this tool (given consult is active). */
export function shouldConsultBeforeTool(args: {
  confirmAllTools: boolean;
  toolName: string;
  payload: unknown;
}): boolean {
  if (args.confirmAllTools) return true;
  return toolCallLooksDestructive(args.toolName, args.payload);
}
