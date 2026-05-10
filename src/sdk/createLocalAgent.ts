import type {
  AgentOptions,
  ModelSelection,
  McpServerConfig,
  SettingSource,
} from "@cursor/sdk";
import { Agent } from "@cursor/sdk";
import { ensureCursorRipgrepPathEnv } from "./ensureCursorRipgrepPathEnv.js";

export type CreateLocalAgentParams = {
  apiKey: string;
  model: ModelSelection;
  cwd: string;
  settingSources?: SettingSource[];
  mcpServers?: Record<string, McpServerConfig>;
  name?: string;
  agents?: AgentOptions["agents"];
  platform?: AgentOptions["platform"];
  agentId?: string;
};

/**
 * Local-only policy: never construct agents with Cursor cloud runtime options.
 * Throws if the provided options object includes a `cloud` key at all.
 */
export function assertLocalAgentOptions(options: object): void {
  if ("cloud" in options) {
    throw new Error("Cloud runtime is forbidden by agentic-my-app policy.");
  }
}

export async function createLocalAgent(
  options: CreateLocalAgentParams,
): Promise<Awaited<ReturnType<typeof Agent.create>>> {
  ensureCursorRipgrepPathEnv();
  assertLocalAgentOptions(options);
  return Agent.create({
    apiKey: options.apiKey,
    model: options.model,
    local: {
      cwd: options.cwd,
      settingSources: options.settingSources ?? [],
    },
    ...(options.mcpServers ? { mcpServers: options.mcpServers } : {}),
    ...(options.name ? { name: options.name } : {}),
    ...(options.agents ? { agents: options.agents } : {}),
    ...(options.platform ? { platform: options.platform } : {}),
    ...(options.agentId ? { agentId: options.agentId } : {}),
  });
}
