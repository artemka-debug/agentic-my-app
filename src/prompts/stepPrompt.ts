import fs from "node:fs";
import path from "node:path";
import type { LoadedConfig } from "../config/loadConfig.js";
import type {
  WorkflowStepPromptKey,
  WorkflowStepPromptValue,
} from "../config/types.js";

/**
 * Prepends optional YAML-configured instructions so defaults from prompt templates stay intact.
 */
export function prependStepPrompt(
  basePrompt: string,
  supplement?: string | null,
): string {
  const s = supplement?.trim();
  if (!s) return basePrompt;
  return [
    "## Step-specific instructions (workflow.stepPrompts)",
    "",
    s,
    "",
    "---",
    "",
    basePrompt,
  ].join("\n");
}

function resolveWorkflowStepPromptSupplement(
  value: WorkflowStepPromptValue | undefined,
  stepKey: WorkflowStepPromptKey,
  loaded: LoadedConfig,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "file" in value) {
    const fileVal = (value as { file: unknown }).file;
    if (typeof fileVal !== "string" || !fileVal.trim()) {
      throw new Error(
        `workflow.stepPrompts.${stepKey}: "file" must be a non-empty string`,
      );
    }
    const { configPath, cwd } = loaded;
    if (!configPath) {
      throw new Error(
        `workflow.stepPrompts.${stepKey} uses { file: ... } but no config file was loaded (defaults only). Create agentic-my-app.config.yaml or set AGENTIC_MY_APP_CONFIG (legacy ORCHESTRATOR_CONFIG) so relative paths resolve next to that file.`,
      );
    }
    const configDir = path.dirname(path.resolve(cwd, configPath));
    const absolute = path.resolve(configDir, fileVal.trim());
    try {
      return fs.readFileSync(absolute, "utf8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `workflow.stepPrompts.${stepKey}: cannot read prompt file (resolved path: ${absolute}): ${msg}`,
      );
    }
  }
  throw new Error(
    `workflow.stepPrompts.${stepKey}: expected a string or { file: "<path>" }, got ${typeof value}`,
  );
}

export function withWorkflowStepPrompt(
  basePrompt: string,
  loaded: LoadedConfig,
  key: WorkflowStepPromptKey,
): string {
  const raw = loaded.config.workflow.stepPrompts?.[key];
  const extra = resolveWorkflowStepPromptSupplement(raw, key, loaded);
  return prependStepPrompt(basePrompt, extra);
}
