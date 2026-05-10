import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Packaged prompt templates live next to `src/` under `prompts/`.
 */
export function promptsDir(): string {
  const pkgRoot = fileURLToPath(new URL("../..", import.meta.url));
  return path.join(pkgRoot, "prompts");
}

export function readPromptFile(name: string): string {
  const p = path.join(promptsDir(), name);
  return fs.readFileSync(p, "utf8");
}

export function interpolate(
  template: string,
  vars: Record<string, string | number | undefined>,
): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) continue;
    out = out.split(`{{${k}}}`).join(String(v));
  }
  return out;
}
