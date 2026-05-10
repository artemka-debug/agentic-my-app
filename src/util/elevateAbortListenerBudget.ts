/**
 * Cursor SDK attaches many layered `abort` listeners to the same AbortSignal trees.
 * Node’s default cap (10) triggers `MaxListenersExceededWarning` during full/monitor runs.
 *
 * - Raises `events.defaultMaxListeners` for ordinary EventEmitters.
 * - Wraps global `AbortController` so each `signal` receives a higher listener budget.
 *
 * Override cap with **`AGENTIC_MY_APP_ABORT_LISTENER_BUDGET`** (legacy **`ORCHESTRATOR_ABORT_LISTENER_BUDGET`**) (integer ≥ **11**, default **512**).
 */
import { EventEmitter, setMaxListeners } from "node:events";

import { envAbortListenerBudgetRaw } from "./agenticEnv.js";

const raw = envAbortListenerBudgetRaw();
const parsed = raw ? Number.parseInt(raw, 10) : NaN;
const cap =
  Number.isFinite(parsed) && parsed >= 11 ? parsed : 512;

try {
  EventEmitter.defaultMaxListeners = Math.max(
    EventEmitter.defaultMaxListeners,
    cap,
  );
} catch {
  /* older runtimes */
}

const NativeAbortController = globalThis.AbortController;

class AbortControllerWithListenerBudget extends NativeAbortController {
  constructor() {
    super();
    try {
      setMaxListeners(cap, this.signal as never);
    } catch {
      /* */
    }
  }
}

Object.defineProperty(AbortControllerWithListenerBudget, "name", {
  value: "AbortController",
  configurable: true,
});

(globalThis as unknown as { AbortController: typeof NativeAbortController })
  .AbortController = AbortControllerWithListenerBudget;
