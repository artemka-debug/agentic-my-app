import { Agent, type AgentOptions } from "@cursor/sdk";

/** Rejects any attempt to pass cloud runtime; orchestrator is local-only per docs/plan.md */
export function assertLocalOptions(options: AgentOptions): void {
  if ("cloud" in options && (options as { cloud?: unknown }).cloud != null) {
    throw new Error("Cloud runtime is forbidden by orchestrator policy.");
  }
}

export function createLocalAgent(options: AgentOptions): ReturnType<typeof Agent.create> {
  assertLocalOptions(options);
  if (!options.local?.cwd) {
    throw new Error("local.cwd is required for local orchestrator agents.");
  }
  return Agent.create(options);
}
