import type { LoadedConfig } from "../config/loadConfig.js";
import { logWorkflowStepSkipped, workflowSkips } from "../config/workflowSkipSteps.js";
import { readState, runPaths } from "../runs/runWorkspace.js";
import { advanceWorkflow } from "./pipeline.js";

type Paths = ReturnType<typeof runPaths>;

type PrototypeOptions = {
  followPr?: boolean;
  monitor?: (prUrl: string) => Promise<void>;
  log?: (message: string) => void;
};

export async function runArchitecturePrototype(args: {
  loaded: LoadedConfig;
  paths: Paths;
  options?: PrototypeOptions;
}): Promise<void> {
  const options = args.options ?? {};
  options.log?.("Prototype flow: running agentic-my-app autonomous workflow.");

  await advanceWorkflow({
    loaded: args.loaded,
    paths: args.paths,
    autonomous: true,
    followPr: false,
  });

  const state = readState(args.paths);
  if (options.followPr && state.prUrl && options.monitor) {
    if (workflowSkips("prMonitor", args.loaded.config.workflow)) {
      logWorkflowStepSkipped("prMonitor");
      options.log?.("Prototype flow: skipped PR monitor (workflow.skipSteps).");
    } else {
      options.log?.("Prototype flow: monitoring PR comments and CI.");
      await options.monitor(state.prUrl);
    }
  }
}
