#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { createLocalAgent } from "./createLocalAgent.js";
import { defaultOrchestratorRoot, ensureRunLayout, runDir } from "./paths.js";

function newRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const program = new Command();
program.name("orchestrator").description("Cursor SDK local orchestrator (Phase 1 scaffold)");

program
  .command("init")
  .argument("[cwd]", "repository root", process.cwd())
  .action((cwd: string) => {
    const root = defaultOrchestratorRoot(path.resolve(cwd));
    fs.mkdirSync(root, { recursive: true });
    const id = newRunId();
    const rp = runDir(root, id);
    ensureRunLayout(rp);
    fs.writeFileSync(
      path.join(rp, "state.json"),
      JSON.stringify({ runId: id, status: "initialized", createdAt: new Date().toISOString() }, null, 2),
    );
    console.log(`Created run ${id} under ${rp}`);
  });

program
  .command("sdk-smoke")
  .description("Optional: one-shot Agent.prompt with local runtime (needs CURSOR_API_KEY)")
  .argument("[prompt]", "prompt text", "Say hello in one short sentence.")
  .action(async (promptText: string) => {
    const apiKey = process.env.CURSOR_API_KEY;
    if (!apiKey) {
      console.error("CURSOR_API_KEY not set; skipping SDK call.");
      process.exit(0);
    }
    const { Agent } = await import("@cursor/sdk");
    const result = await Agent.prompt(promptText, {
      apiKey,
      model: { id: "composer-2-fast" },
      local: { cwd: process.cwd(), settingSources: [] },
    });
    console.log(result.status, result.result?.slice(0, 500));
  });

program
  .command("guard-demo")
  .description("Verify createLocalAgent throws if cloud is passed")
  .action(() => {
    try {
      createLocalAgent({
        apiKey: "x",
        model: { id: "composer-2" },
        cloud: { repos: [{ url: "https://github.com/foo/bar", ref: "main" }] },
      } as Parameters<typeof createLocalAgent>[0]);
      console.error("Expected error");
      process.exit(1);
    } catch (e) {
      console.log(String(e));
    }
  });

program.parse();
