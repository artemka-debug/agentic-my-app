import { CursorAgentError } from "@cursor/sdk";
import { createLocalAgent } from "../sdk/createLocalAgent.js";

export async function runSdkSmoke(args: {
  cwd: string;
  apiKey: string | undefined;
  modelId: string;
}): Promise<number> {
  if (!args.apiKey) {
    process.stdout.write(
      "smoke: skipped (API key missing; set CURSOR_API_KEY or configure runtime.cursor.apiKeyEnv)\n",
    );
    return 0;
  }

  process.stdout.write("smoke: creating local agent...\n");
  const agent = await createLocalAgent({
    apiKey: args.apiKey,
    model: { id: args.modelId },
    cwd: args.cwd,
    settingSources: [],
    name: "agentic-my-app-smoke",
  });

  try {
    const run = await agent.send(
      "Reply with exactly the text: smoke-ok (nothing else).",
    );
    if (run.supports("stream")) {
      for await (const _event of run.stream()) {
        // Intentionally quiet; enable AGENTIC_MY_APP_LOG_STDOUT elsewhere if needed.
      }
    }
    const result = await run.wait();
    process.stdout.write(
      `smoke: finished status=${result.status} runId=${run.id}\n`,
    );
    if (result.status !== "finished") {
      return 2;
    }
    return 0;
  } catch (raw: unknown) {
    if (raw instanceof CursorAgentError) {
      const err = raw as InstanceType<typeof CursorAgentError>;
      process.stderr.write(
        `smoke: CursorAgentError retryable=${err.isRetryable} ${err.message}\n`,
      );
      return 1;
    }
    throw raw;
  } finally {
    await agent[Symbol.asyncDispose]();
  }
}
