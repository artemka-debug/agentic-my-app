import type { AgenticMyAppConfig } from "./types.js";

/** Discrete agent-driven units users may skip via `workflow.skipSteps`. */
export const WORKFLOW_SKIP_STEP_IDS = [
  "po",
  "decomposer",
  "testWriter",
  "implementer",
  "verifier",
  "codeReviewer",
  "securityReviewer",
  "poAcceptance",
  "cleanup",
  "finalizer",
  "prMonitor",
  "prFix",
] as const;

export type WorkflowSkipStepId = (typeof WORKFLOW_SKIP_STEP_IDS)[number];

const KNOWN = new Set<string>(WORKFLOW_SKIP_STEP_IDS);

export function assertValidWorkflowSkipSteps(
  steps: unknown,
  configPath: string,
): asserts steps is WorkflowSkipStepId[] | undefined {
  if (steps === undefined || steps === null) return;
  if (!Array.isArray(steps)) {
    throw new Error(
      `Invalid workflow.skipSteps in ${configPath}: expected an array of step ids`,
    );
  }
  for (const s of steps) {
    if (typeof s !== "string" || !KNOWN.has(s)) {
      throw new Error(
        `Unknown workflow.skipSteps id ${JSON.stringify(s)} in ${configPath}. Expected one of: ${WORKFLOW_SKIP_STEP_IDS.join(", ")}`,
      );
    }
  }
}

export function workflowSkips(
  step: WorkflowSkipStepId,
  workflow: AgenticMyAppConfig["workflow"],
): boolean {
  return workflow.skipSteps?.includes(step) ?? false;
}

export function logWorkflowStepSkipped(step: WorkflowSkipStepId): void {
  process.stdout.write(
    `[agentic-my-app ${new Date().toISOString()}] Skipped workflow step "${step}" (reason: workflow.skipSteps in agentic-my-app.config.yaml)\n`,
  );
}
