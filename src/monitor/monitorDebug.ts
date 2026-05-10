/** Toggle with AGENTIC_MY_APP_MONITOR_DEBUG (legacy ORCHESTRATOR_MONITOR_DEBUG)=1 or true → stderr diagnostics for PR polling. */

import { envMonitorDebugEnabled } from "../util/agenticEnv.js";

export function monitorDebugEnabled(): boolean {
  return envMonitorDebugEnabled();
}

export function monitorDebugLog(
  event: string,
  data?: Record<string, unknown>,
): void {
  if (!monitorDebugEnabled()) return;
  process.stderr.write(
    `[monitor-debug ${new Date().toISOString()}] ${event}${
      data !== undefined ? ` ${JSON.stringify(data)}` : ""
    }\n`,
  );
}
