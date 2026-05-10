/**
 * Environment variables for agentic-my-app. New names use `AGENTIC_MY_APP_*`;
 * legacy `ORCHESTRATOR_*` names are still read where noted for one-step migration.
 */

export function envConfigPathOverride(): string | undefined {
  const primary = process.env.AGENTIC_MY_APP_CONFIG?.trim();
  if (primary) return primary;
  return process.env.ORCHESTRATOR_CONFIG?.trim();
}

/** True when stream-to-stdout is explicitly enabled via env (either name). */
export function envStreamExplicitlyEnabled(): boolean {
  return (
    process.env.AGENTIC_MY_APP_STREAM?.trim() === "1" ||
    process.env.ORCHESTRATOR_STREAM?.trim() === "1"
  );
}

function envTruthy(primary: string, legacy: string): boolean {
  const v =
    process.env[primary]?.trim() || process.env[legacy]?.trim();
  if (!v) return false;
  return v === "1" || v.toLowerCase() === "true";
}

export function envConsultHumanEnabled(): boolean {
  return envTruthy("AGENTIC_MY_APP_CONSULT_HUMAN", "ORCHESTRATOR_CONSULT_HUMAN");
}

/** When false (`…=0`), transcripts are written without secret redaction. */
export function shouldRedactTranscripts(): boolean {
  const v =
    process.env.AGENTIC_MY_APP_REDACT_IN_TRANSCRIPTS?.trim() ??
    process.env.ORCHESTRATOR_REDACT_IN_TRANSCRIPTS?.trim();
  return v !== "0";
}

export function envAbortListenerBudgetRaw(): string | undefined {
  return (
    process.env.AGENTIC_MY_APP_ABORT_LISTENER_BUDGET?.trim() ||
    process.env.ORCHESTRATOR_ABORT_LISTENER_BUDGET?.trim()
  );
}

export function envMonitorDebugEnabled(): boolean {
  const v =
    process.env.AGENTIC_MY_APP_MONITOR_DEBUG?.trim() ||
    process.env.ORCHESTRATOR_MONITOR_DEBUG?.trim();
  if (!v) return false;
  const l = v.toLowerCase();
  return v === "1" || l === "true" || l === "yes";
}

export function envLogStdoutEnabled(): boolean {
  return (
    process.env.AGENTIC_MY_APP_LOG_STDOUT?.trim() === "1" ||
    process.env.ORCHESTRATOR_LOG_STDOUT?.trim() === "1"
  );
}

/** Verbose Telegram bot: forward model stream chunks, extra logging. */
export function envTelegramDebugEnabled(): boolean {
  const v = process.env.AGENTIC_MY_APP_TELEGRAM_DEBUG?.trim();
  if (!v) return false;
  const l = v.toLowerCase();
  return v === "1" || l === "true" || l === "yes";
}

/** Optional timeout (ms) for Telegram `HumanConsultHooks.question` / confirm waits. 0 = none. */
export function envTelegramConsultTimeoutMs(): number {
  const raw =
    process.env.AGENTIC_MY_APP_TELEGRAM_CONSULT_TIMEOUT_MS?.trim() ?? "";
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
