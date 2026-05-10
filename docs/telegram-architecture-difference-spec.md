# Telegram sketch vs `telegram-interface-plan`: difference spec

This document compares the **hand-drawn target sketch** (User → Telegram Bot → host “Machine 1” with multiple **Projects** and per-project **terminal sessions**) with what is specified in [`telegram-interface-plan.md`](telegram-interface-plan.md). It states what already aligns, what differs, and what to implement so the sketch and the shipped product stay reconciled.

**Canonical technical plan:** [`telegram-interface-plan.md`](telegram-interface-plan.md) (and the Cursor plan that tracks implementation).

---

## 1. Same (no conceptual conflict)

| Sketch idea | Plan coverage |
|-------------|----------------|
| User talks to a bot inside Telegram | 1:1 private DMs, allowlisted `chat_id`, slash commands (`/run`, `/reply`, `/status`, `/cancel`, etc.). |
| Bot is a **control plane**, not a second workflow engine | Telegraf as **transport + UI adapter**; same `runInteractiveFull` / state machine / artifacts as CLI. |
| Multiple workloads can run on one machine | Multiple sessions over time via `(chat_id, taskId)`; `taskId` from upstream intake (e.g. `owner/repo#123`); concurrency policy explicitly TBD. |
| Work is **scoped** (per “project” / checkout) | `TelegramSession` / session model includes `cwd`; runs use `LoadedConfig` + paths rooted in a working directory. |
| “Terminal” as *where work executes* | Agents and shell/git run **on the host** where the `agentic-my-app` process runs — same as CLI; not a separate fictional runtime. |

---

## 2. Different (gaps to name explicitly)

| Topic | Sketch emphasizes | Plan emphasizes | Implication |
|-------|-------------------|-----------------|-------------|
| **Process placement** | Bot reaches **Machine 1**; diagram is neutral on where the bot process runs. | Bot server runs **locally** with **long polling**; trust model = whoever has token + host access. | If Machine 1 **is** the host that runs `agentic-my-app telegram`, the sketch matches. If the sketch implies **bot off-box** talking to Machine 1 only, the plan does **not** yet specify remote execution (SSH, agent, queue). |
| **Project identity** | Explicit **Project 1 / Project 2** boxes; operator picks a **project**, then a **session** there. | Primary handle is **`taskId`** from intake (GitHub issue ref, etc.), not a **named project registry**. | Multi-repo on one machine is achievable via **per-run `cwd`**, but **named project aliases** (`default`, `work`, … → absolute path) are **not** spelled out in the interface plan. |
| **Session metaphor** | “Start a session in project N” reads like **TTY / multiplexer** attachment. | Sessions are **workflow runs** (plan → implement → verify → …) with Telegram Q&A and approvals. | Same *outcome* (work in a repo); different *UX* unless you add raw terminal attach (out of scope unless requested). |
| **Network path** | Implicit “bot talks to projects” | Explicit **outbound-only HTTPS** to Telegram API (polling); **no** inbound webhook in MVP. | Diagram arrows are logical; **no** extra open ports on Machine 1 for Telegram beyond outbound. |

---

## 3. What to implement (difference backlog)

Items are ordered: **close sketch–plan gaps first**, then **optional** enhancements.

### 3.1 Document and deploy (no code, or minimal)

- **Deployment topology** — Add a short subsection to the main plan or runbook: recommended layout is **run `agentic-my-app telegram` on Machine 1** (same host as checkouts). State that **remote-only** bot (process not on Machine 1) is **unsupported** unless a future remote runner exists.
- **Diagram caption** — Treat “Bot → Project N” as **logical binding** (config + `cwd` + issue intake), not a separate TCP link per project.

### 3.2 Project selection (closes the main semantic gap)

Implement **one** of these (pick in product design; both can coexist):

- **A. Config-based project registry** — YAML or env: `projects.<name>.path` (or list). Telegram UX: `/run <project> issue owner/repo#123` or `/use <project>` then `/run issue …`. Persist chosen project in session state until changed.
- **B. Issue-only resolution** — Infer repo root from GitHub issue’s **repository** and a **single-machine clone map** (e.g. `owner/repo` → `/srv/repos/owner/repo`). No human “project” name; still multiple directories if many clones exist — map must be **explicit** to avoid ambiguity.

**Acceptance:** From Telegram, an operator can start a run and be sure **which filesystem root** on Machine 1 is used, matching the sketch’s “Project 1 vs Project 2” disambiguation.

### 3.3 Concurrency on one `taskId`

The plan already flags: second `/run` with the same upstream `taskId` → **reject**, **queue**, or **suffix** (`owner/repo#123~2`). **Implement and document** the chosen default so “two projects” does not collapse into ambiguous shared handles when the same issue is used twice.

### 3.4 Remote Machine 1 (only if required by the sketch)

If the product must support **bot process not on the target host**:

- Specify a **remote runner protocol** (SSH command, gRPC, job queue) that shells into the right `cwd` on Machine 1, or run a **thin agent** on Machine 1 that polls a queue. This is **outside** the current local-only Telegram MVP; treat as a **separate phase** with its own security review.

### 3.5 Optional / stretch

- **Discrete Telegram commands** for `plan`, `workflow`, … — already “Later” in the interface plan; same adapter, same session model.
- **Pipeline consult parity** (implement/verify/monitor) — stretch in plan; only if CLI gains the same.

---

## 4. Traceability

| Sketch element | Satisfied by plan today? | Satisfied after §3? |
|----------------|---------------------------|---------------------|
| User → Bot | Yes | Yes |
| Bot → work on Machine 1 | Yes **if** bot runs on Machine 1 | Yes; §3.4 if off-box |
| Multiple projects | Partially (`cwd` per session, not named) | Yes with §3.2 |
| Per-project “session” | Workflow session, not TTY | Same unless terminal attach added |
| Terminal copy in diagram | Metaphor for agent execution | Explicit in docs (§3.1) |

---

## 5. Related files

- [`telegram-interface-plan.md`](telegram-interface-plan.md) — full goals, session model, UX, phased roadmap, code gaps.
- Target sketch asset: `Screenshot_2026-05-10_at_1.42.17_AM-365b31cc-0968-445c-aaa0-c1de6fb872e8.png` (workspace assets; path may vary by checkout).

When §3.2 and §3.3 are decided, update the **Resolved product decisions** table in `telegram-interface-plan.md` so this difference spec does not drift.
