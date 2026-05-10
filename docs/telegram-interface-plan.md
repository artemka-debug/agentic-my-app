# Telegram bot, local server, and shared CLI core

Architecture plan for a Telegram-facing control plane bundled with `agentic-my-app`, reusing workflow logic and consult hooks via a transport adapter ([Telegraf](https://github.com/telegraf/telegraf)).

## Goals

- Ship a **Telegram-facing control plane** for `agentic-my-app` that reuses **the same workflow entry points and state machine** as the CLI (runs under `.agentic-my-app`-style artifacts, `loadConfig`, `runInteractiveFull` / `advanceWorkflow`, etc.).
- Treat **Telegram + Telegraf as a transport and UI adapter**: permissions, Q&A, and consultations should flow through the same **`HumanConsultHooks`-style** prompts and the same **approval gates** used in the terminal path, not a parallel workflow.
- Run **locally** with the published package: a **`telegraf` dependency**, a **`bin` subcommand** (e.g. `agentic-my-app telegram`), and clear **env-based configuration** (`TELEGRAM_BOT_TOKEN`, allowlists). **Polling** is the production transport choice for this deployment (see Process / server lifecycle).
- **Observe** runs with structured logs that tie **`runId`** + **`taskId`** (inferred from the **GitHub issue** or **other upstream task identifier**) ↔ Telegram **`chat_id`** / **`user_id`**.

## Current CLI touchpoints (file pointers)

| Area | Location | Role |
|------|----------|------|
| **CLI commands** | `src/cli.ts` | Commander program: `init`, `smoke`, `full`/`auto`, `prototype`, `issue`, `task`, `plan`, `workflow`/`run`, `approve`, `implement`, `verify`, `finalize`, `monitor-pr`, `resume`, `cancel`, `status`, etc. `full` builds a **shared readline** and passes it to `runInteractiveFull`. |
| **Interactive “full” flow** | `src/workflow/interactiveFull.ts` | `workflowStepLog` → `process.stdout`. **Spec/decomposition approval** uses `readline.question` y/N (`confirmRl`). Pauses readline during background work. Orchestrates planning → implement → verify → finalize → `monitorPullRequest`. |
| **Planning + human consult** | `src/workflow/planning.ts` | `openPlanningHumanConsult`: opens **TTY readline** (or **shared** readline from CLI), wires **`HumanConsultHooks`** (`question`, `log`, flags). **Only place** that passes `consult:` into `runAgentTurn` today. |
| **Consult protocol + tools** | `src/sdk/runAgentTurn.ts` | **`HumanConsultHooks`**: `askHumanMarker` loops, `pauseBeforeTools` + `shouldConsultBeforeTool` → `question()` for approvals; **stream** writes assistant text with **`process.stdout.write`**. |
| **Ask-human markers** | `src/util/humanConsult.ts` | Parses/strips `<AGENTIC_MY_APP_ASK_HUMAN>` / legacy `<ORCHESTRATOR_ASK_HUMAN>`; `stringifyToolPayload` for consult prompts. |
| **Non-interactive pipeline** | `src/workflow/pipeline.ts` | `advanceWorkflow`, `requestCancel` (writes `cancelRequested` on disk). No readline. |
| **Config** | `src/config/loadConfig.ts`, `src/config/types.ts`, `src/config/defaults.ts` | YAML merge, `consultHuman.*`, `workflow.approval` / `autonomy`. Env toggles in `src/util/agenticEnv.ts` (`AGENTIC_MY_APP_CONSULT_HUMAN`, stream, log stdout). |
| **Logging** | `src/logging/logger.ts` | JSONL + optional stdout/stderr; **`runId` + `component` + `event`**; redaction via `redactSecrets`. No Telegram fields yet. |
| **Implement / verify / monitor** | `src/workflow/implementCandidates.ts`, `verifyAndReview.ts`, `finalizePr.ts`, `monitor/prMonitor.ts` | **`runAgentTurn` without `consult`** in these files (fact). |

**Important fact:** “CLI interactivity” for consult **today is concentrated in planning** (`planning.ts` + `runAgentTurn`) plus **y/N gates** in `interactiveFull.ts`. Implementation and later phases **do not** pass `HumanConsultHooks`, so there is **no** terminal tool-confirm or ASK_HUMAN loop there in the current code.

## Target architecture

### Separation of concerns

1. **Workflow engine / use-cases**  
   Unchanged responsibilities: `runInteractiveFull`, `runPoAndDecomposition`, `advanceWorkflow`, `runImplementCandidates`, etc., operating on **`LoadedConfig` + run `paths` + persisted `state.json`**.

2. **CLI adapter**  
   `readline` + stdout/stderr + `workflowStepLog`; already composes `sharedReadline` with planning consult.

3. **Telegram adapter (new)**  
   Telegraf `Context` → map to a **`UserChannel`** (or inject **`HumanConsultHooks` + approval callbacks** built from Telegram). Handles:

   - sending/editing messages, **splitting long text** (Telegram limits);
   - mapping **inline keyboards** or slash commands to **y/N** and **tool approve / skip**;
   - **Sparse outbound traffic:** mirror only **high-signal** updates (milestones, consult prompts, errors); **delay is acceptable**. Apply **backoff + a send queue** so stream-derived updates do not trip Telegram flood limits.

4. **Process / server lifecycle**  

   - **Long polling (chosen path):** `Telegraf` + `bot.launch()` — **no inbound HTTP** from Telegram; only outbound HTTPS to `api.telegram.org`. Fits a **local-only** server behind NAT and **avoids HTTPS/TLS webhook setup**.
   - **Webhook:** **not planned** for this product slice. If a future hosted deployment wants webhooks, that is additive (tunnel or public HTTPS); the default remains polling.

### Session model

- **Personal chat only (1:1):** **Group chats and forum topics are not supported.** Do not rely on `message_thread_id`; reject or silently ignore updates from non-private chats after a single “DM only” reply if desired.
- **Primary key:** `chat_id` for the private dialogue with the operator.
- **`taskId` (inferred session handle):** **Do not mint arbitrary ids.** **`taskId` is derived** from whatever **platform/work-intake identifier** kicked off the run — canonical example: **`owner/repo#123`** from **`full`/Telegram **`/run issue owner/repo#123`**, surfaced in Telegram unchanged (or normalized to **one canonical string form** documented in UX, e.g. always lowercase owner — *exact normalization TBD*). Other starters map similarly: **`task`/`plan`/`workflow` entry points** should contribute a **single stable slug** when they have an external ref (another tracker’s issue key, a Notion page id shorthand, etc.); when the only input is an opaque path with no upstream id, **derive from an agreed convention** (e.g. sanitized filename) so it stays **deterministic**, not UUID-based.
- **`/reply` is always mandatory before an answer:** a **plain user message never** fulfills `HumanConsultHooks.question(...)`, **even** when there is only **one** active session. The server stays simple: ingest updates are either **slash commands**, **`/reply`-armed** payloads, or **ignored for consult** / handled separately. Flow: **`/reply <taskId>`** (where **`taskId`** matches the **inferred upstream id**, e.g. **`owner/repo#123`**) → **exactly one** subsequent message carries the reply text (then disarm until next **`/reply <taskId>`**).
- **Mapping:** `(chat_id, taskId) → workflow execution** (`taskId` = **`inferTaskId(...)`**, same string used in Telegram). Operator may run **multiple sessions** over time from **different upstream ids**. **`/reply` without arguments** may **list** active **`taskId`s** (inferred refs) and usage hint; **it does not** arm a waiter. Persist **`runId`** + **`taskId`** in memory + optionally a small **session file** under the artifacts root for crash recovery.
- **Concurrency:** workflow is **heavy**; define policy for **“second `/run` with the same upstream `taskId`”** (same GitHub issue) — **queue vs reject vs suffix-disambiguated `taskId`** — product default TBD (ties to **`inferTaskId` collisions**).
- **Multi-user:** **allowlisted private chats**; one operator persona per deployment is the nominal model.

### Parity with CLI interactivity

| CLI behavior | Implementation today | Telegram direction |
|--------------|----------------------|-------------------|
| Consult Q&A | `HumanConsultHooks.question` + readline (`planning.ts`) | Same hooks; **`question(prompt)`** → send prompt (include **inferred `taskId`**, e.g. **`owner/repo#123`**, so the operator matches **`/reply`** to the intake). **`await`** arms **only** after **`/reply <taskId>`**; the **immediate next** inbound text message supplies the answer. **No** absorbing plain chatter — **`/reply` is always required**, including when only one session exists (keeps inbound handling deterministic for the server). |
| ASK_HUMAN XML blocks | `extractAgenticMyAppAskHuman` loop in `runAgentTurn` | Unchanged logic; only **I/O** swaps to Telegram. |
| Tool pause | `consult.question(...)` in `consumeStream` | Same; optional **inline keyboard** “Approve” / “Edit instruction”. |
| Spec/decomposition approval | `confirmRl` in `interactiveFull.ts` | **Dedicated messages** + y/n or buttons; then call **`approveSpec` / `approveDecomposition`** same as CLI. |
| Stream | `process.stdout.write` in `consumeStream` | **Injectable stream sink** (see Gaps): Telegram messages or “document” for long streams. |
| Progress | `workflowStepLog` → stdout | Route **`onLog`** to **logger always**; to Telegram **only high-signal lines** unless **debug mode** is on (see Configuration). |
| Cancel | `requestCancel` + state | **`/cancel <taskId>`** (**inferred** upstream id as used in Telegram) or button keyed by **`taskId`** → same API. |
| Timeouts | Blocking readline (no explicit timeout in **`question`**) | Product should add **optional timeout** at the **port** layer for Telegram. |

### Bundling

- Add **`telegraf`** to `package.json` `dependencies`.
- **`agentic-my-app telegram`** (or `serve-telegram`): loads config from cwd, reads **`TELEGRAM_BOT_TOKEN`**, optional **`AGENTIC_MY_APP_TELEGRAM_ALLOWED_CHATS`** (comma-separated IDs). **Polling only** — no webhook URL required for MVP.
- **Separate bundle entry:** optional second **bin** pointing at the same file is unnecessary if Commander adds one subcommand; keeps **one** `dist/cli.js`.

### Configuration (bot flags / env)

- **`--autonomous` (and/or YAML):** when set, mirror CLI **`--autonomous`**: skip or auto-approve human gates where the shared workflow permits; Telegram still sends **milestones/errors** consistent with autonomy settings.
- **Debug mode (flag / env):** forward **verbose** structured logs (and optionally model **reasoning** where the SDK exposes it) to the chat or to a dedicated log tap; normal mode stays **quiet** — few messages, slower cadence acceptable.

### Security

- **Bot token:** env only; never log raw token (logger already redacts some secrets — **verify** redact patterns cover `TELEGRAM_BOT_TOKEN`-style values or add allowlist for env names).
- **Allowlist:** **only** allowlisted **`chat_id`** (private DMs **only** above) — and optionally **`user_id`** — may trigger runs; ignore others or reply once “unauthorized.”
- **SSRF (future webhook only):** if a webhook transport is added later, the handler must **only** accept POSTs from Telegram’s flow (**`secret_token`** validation, etc.); **do not** fetch arbitrary URLs from user messages for “preview” unless strictly controlled.
- **Dangerous operations:** the workflow can run **shell/git** via agents; **same trust model as CLI** — assume **physical access to machine + token**; Telegram adds **remote** trigger surface, hence **allowlist is mandatory** for MVP.

### Observability

- Extend **`createLogger`** calls (or a thin wrapper) with **`data: { telegramChatId, telegramUserId }`** on events emitted from the Telegram command path.
- **Correlation:** every structured line should include **`runId`** (already), **`taskId`** when known (**same inferred token** as Telegram, e.g. GitHub **`owner/repo#N`**), plus Telegram ids in **`data`** for joinability in JSONL.

## UX flows (examples)

1. **Start full run from issue**  
   Operator (allowlisted DM): **`/run issue owner/repo#123`** → bot creates run (same as **`full --issue`**) → **`taskId`** is **`inferTaskId(intake)`** — here **`owner/repo#123`** (or one agreed canonical spelling) alongside internal **`runId`** → planning runs → consult arrives (prompt shows **`taskId`**) → operator sends **`/reply owner/repo#123`**, then sends the answer as the **next** message (repeat for each consult round) → **spec approval** → pipeline continues → **sparse** Telegram updates unless **debug** is on.

2. **Session targeting (`/reply`)**  
   **`/reply`** alone: lists **active `taskId`s** (derived from intake for each session); **does not** arm ingest. **`/reply <taskId>`:** arms **exactly once** — the **next** text message answers the pending **`question`** for that session **if** the waiter is keyed to that **`taskId`**; afterward disarm. **`taskId`** must match the **inferred upstream id**, not an opaque token. **Plain messages outside this sequence are never consult answers.** Same rule applies when only one session is active.

3. **Resume / status**  
   **`/status`** / **`/status <taskId>`** reads `state.json` and summarizes phase; **`/cancel <taskId>`** calls `requestCancel`. **`taskId`** is always the **inferred platform identifier** the operator typed for **`/run`** (e.g. issue ref); **`runId`** remains internal / logs-first.

4. **Duplicate intake / concurrency**  
   **Two simultaneous runs from the same `taskId`** (same issue reopened twice): **ambiguous** shared handle — **`runId`** still unique. Product must decide **reject second run**, **queue**, or **disambiguating suffix** (`owner/repo#123~2`). Document choice when implementing concurrency policy above.

5. **Blocked**  
   Phase `BLOCKED_NEEDS_USER` → bot sends `lastError` and suggests **`/status <taskId>`** or human fix on disk.

## Phased roadmap (MVP → parity)

### MVP

- `agentic-my-app telegram` subcommand; **long polling only**; **allowlist** via env.
- **Trigger:** mirror **`full`** (interactive full workflow entry) only; discrete CLI commands (**`plan`**, **`workflow`**, etc.) are **not** required for MVP but should share the same **UI port / adapter** when added later (same hooks, same session model).
- Commands: **start full run** (issue or task — *exact UX TBD*), **`/reply`** / **`/reply <taskId>`**, **`/status`** / **`/status <taskId>`**, **`/cancel <taskId>`** — **`taskId`** is **`inferTaskId`** from intake (GitHub **`owner/repo#N`**, other tracker keys, agreed path-derived slug — **never** opaque random ids).
- **`--autonomous`** and **debug mode** exposed as CLI flags and/or config; document env mirrors if any.
- **`UserChannel` / consult port:** implement **`HumanConsultHooks`** from Telegram for **planning-only** consult (matches current code).
- **`runInteractiveFull`:** inject **approval** and **log** adapters instead of raw readline where practical, or run a **thin wrapper** that duplicates `interactiveFull` steps but swaps `confirmRl` + `workflowStepLog` — *cleaner* is one **`runInteractiveFull({ ui: TerminalUi | TelegramUi })`** refactor (see Gaps).

### Mid

- **Stream sink** injection in `runAgentTurn` for agent text — **combined with throttled queue + backoff** so only important deltas reach Telegram unless debug is on.
- **Timeouts** and **message chunking** (4096 char limit; use multiple messages or a file).

### Later

- Discrete Telegram commands mapping to **`plan`**, **`workflow`**, etc., reusing the same adapter.

### Parity / stretch

- Thread **`HumanConsultHooks`** into **implement / verify / finalize / monitor** `runAgentTurn` calls if product requires **full** tool-consult parity beyond planning (not present in CLI today — **explicit gap**).

## Gaps in current code (refactor first)

1. **`HumanConsultHooks` + TTY coupling**  
   `openPlanningHumanConsult` returns **null** if not TTY (`planning.ts`). Telegram must bypass TTY and inject hooks **explicitly** (new parameter or factory).

2. **`runAgentTurn` stdout coupling**  
   `consumeStream` uses **`process.stdout.write`** for streaming; **`resumeAgentTurn`** same. Needs an optional **`onStreamChunk?: (s: string) => void`** or **`streamSink`** for Telegram.

3. **`workflowStepLog` hardcoded to stdout**  
   `interactiveFull.ts` — needs **`onLog: (s: string) => void`** or reuse logger.

4. **`interactiveFull` readline**  
   Approvals are **`confirmRl(rl, ...)`** — abstract to **`confirm: (prompt) => Promise<boolean>`** from a **session UI** object.

5. **Consult coverage**  
   Implement/verify/finalize/monitor: **no consult hooks** today. “Parity with CLI” for those steps is already “no consult” unless you extend the codebase.

## Resolved product decisions

| Topic | Decision |
|-------|-----------|
| **Group chats / threads** | **Not supported.** Personal **1:1** private chats only; no `message_thread_id` semantics. |
| **Rate limits / flood control** | Implement **backoff + outbound queue**. Operator priority: **few, important messages**; **latency is acceptable**; avoid mirroring dense streams in normal mode. |
| **Pending `question()` / stray messages** | **`/reply <taskId>`** is **always** required before the answer message (**including** single-session runs). **`taskId`** = **`inferTaskId`** from the run’s upstream ref. **`/reply` alone** lists **`taskId`s** only — **never** arms. **Plain messages** do not consume waiters. |
| **Autonomous vs interactive** | Support **`--autonomous`** (flag + config) aligned with CLI. Add **debug mode** for **full logs and reasoning** visibility. |
| **Webhook TLS** | **Use polling.** Local-only server; no webhook/TLS requirement for MVP. |
| **CLI parity surface** | **Start with `full`** only in Telegram MVP; architecture leaves **clear extension points** so **`plan` / `workflow` / …** can use the **same UI port** later. |
| **`taskId` source** | **Inferred** from work intake (**GitHub `owner/repo#N`**, other platform issue keys when integrated, otherwise a **deterministic slug** from the chosen entrypoint — **not** random UUIDs). **Collision** handling for concurrent runs sharing one upstream id aligns with concurrency policy (see UX §4). |

## Optional: brief TypeScript sketches (ports)

```ts
/** Narrow UI contract for interactive full + planning consult */
export type InteractiveUi = {
  log: (line: string) => void;
  confirm: (prompt: string) => Promise<boolean>;
};

/** Drop-in replacement for TTY HumanConsultHooks.question / log */
export type ConsultChannel = Pick<
  import("../sdk/runAgentTurn.js").HumanConsultHooks,
  | "question"
  | "log"
  | "askHumanMarker"
  | "pauseBeforeTools"
  | "confirmAllTools"
  | "maxConsultRounds"
>;

/** Optional: stream chunks from model (requires runAgentTurn change) */
export type AgentStreamSink = { write: (chunk: string) => void };

export type TelegramSession = {
  runId: string;
  /** Inferred from intake (e.g. owner/repo#issue); operator `/reply`s with this stable ref. */
  taskId: string;
  chatId: number;
  userId: number;
  cwd: string;
};
```

## Fact note

This plan is grounded in the repo paths cited above. Anything not inspected (e.g. exact Telegraf version API, full `prMonitor` behavior) is **labeled** rather than assumed.
