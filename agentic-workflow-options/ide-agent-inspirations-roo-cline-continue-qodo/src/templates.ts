import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function templatePath(name: string): string {
  return path.join(pkgRoot, 'templates', name);
}

export function readTemplateFile(rel: string): string {
  return fs.readFileSync(templatePath(rel), 'utf8');
}

export function applyPlaceholders(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}
