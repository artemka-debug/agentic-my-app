import fs from "node:fs";
import path from "node:path";
import {
  loadConfig,
  resolveCursorApiKey,
} from "../src/config/loadConfig.js";
import { runSdkSmoke } from "../src/smoke/runSdkSmoke.js";

async function main(): Promise<void> {
  const cwd = process.cwd();
  const loaded = loadConfig(cwd);
  const apiKey = resolveCursorApiKey(loaded);
  const code = await runSdkSmoke({
    cwd,
    apiKey,
    modelId: loaded.config.runtime.cursor.models.implementer,
  });

  const smokeMarker = path.join(cwd, ".agentic-my-app", "last-smoke.json");
  fs.mkdirSync(path.dirname(smokeMarker), { recursive: true });
  fs.writeFileSync(
    smokeMarker,
    `${JSON.stringify({ at: new Date().toISOString(), exitCode: code }, null, 2)}\n`,
    "utf8",
  );

  process.exitCode = code;
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
