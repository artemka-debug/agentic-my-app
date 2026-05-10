import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { DEFAULT_CONFIG } from "./defaults.js";
import type { AgenticMyAppConfig } from "./types.js";
import { assertValidWorkflowSkipSteps } from "./workflowSkipSteps.js";
import { envConfigPathOverride } from "../util/agenticEnv.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function mergeDeep<T extends Record<string, unknown>>(
  base: T,
  override: Record<string, unknown>,
): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(override)) {
    if (isRecord(v) && isRecord(out[k] as unknown)) {
      out[k] = mergeDeep(out[k] as Record<string, unknown>, v);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

export type LoadedConfig = {
  config: AgenticMyAppConfig;
  configPath: string | null;
  cwd: string;
};

export function resolveConfigPath(cwd: string): string {
  const fromEnv = envConfigPathOverride();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(cwd, fromEnv);
  }
  return path.join(cwd, "agentic-my-app.config.yaml");
}

export function loadConfig(cwd: string = process.cwd()): LoadedConfig {
  const configPath = resolveConfigPath(cwd);
  if (!fs.existsSync(configPath)) {
    return {
      config: structuredClone(DEFAULT_CONFIG),
      configPath: null,
      cwd,
    };
  }
  const raw = YAML.parse(fs.readFileSync(configPath, "utf8"));
  if (!isRecord(raw)) {
    throw new Error(`Invalid config YAML (expected mapping): ${configPath}`);
  }
  const base = structuredClone(DEFAULT_CONFIG) as unknown as Record<
    string,
    unknown
  >;
  const config = mergeDeep(base, raw) as unknown as AgenticMyAppConfig;
  if (!config.runtime.cursor.localOnly) {
    throw new Error(
      `agentic-my-app requires runtime.cursor.localOnly: true (${configPath})`,
    );
  }
  assertValidWorkflowSkipSteps(config.workflow.skipSteps, configPath);
  return { config, configPath, cwd };
}

export function resolveArtifactsRoot(
  loaded: LoadedConfig,
): { absoluteRoot: string; relativeRoot: string } {
  const relativeRoot = loaded.config.artifacts.root;
  return {
    relativeRoot,
    absoluteRoot: path.join(loaded.cwd, relativeRoot),
  };
}

export function resolveCursorApiKey(loaded: LoadedConfig): string | undefined {
  const envName = loaded.config.runtime.cursor.apiKeyEnv;
  const v = process.env[envName]?.trim();
  return v || undefined;
}
