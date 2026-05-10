import fs from "node:fs";
import path from "node:path";
import { Markup, Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import {
  loadConfig,
  resolveArtifactsRoot,
  type LoadedConfig,
} from "../config/loadConfig.js";
import {
  buildStubTaskInput,
  buildTaskInputFromGhJson,
  persistTaskInput,
  tryFetchGitHubIssueViaGh,
} from "../intake/githubIssue.js";
import { parseGitHubIssueRef } from "../intake/parseIssueRef.js";
import { buildTaskInputFromMarkdownFile } from "../intake/taskFromFile.js";
import { createLogger } from "../logging/logger.js";
import {
  readState,
  readTaskInput,
  runPaths,
  ensureRunLayout,
} from "../runs/runWorkspace.js";
import { ensureRunDir, newRunId } from "../runs/paths.js";
import { advanceWorkflow, requestCancel } from "../workflow/pipeline.js";
import {
  envTelegramConsultTimeoutMs,
  envTelegramDebugEnabled,
  envStreamExplicitlyEnabled,
} from "../util/agenticEnv.js";
import { runInteractiveFull } from "../workflow/interactiveFull.js";
import { runPoAndDecomposition } from "../workflow/planning.js";
import { TelegramConsultPort, type TelegramConsultBridge } from "./consultPort.js";
import { createNullReadline } from "./nullReadline.js";
import { TelegramSendQueue } from "./outboundQueue.js";
import {
  findRunIdForTask,
  readTelegramSessionFile,
  removeTelegramSessionRowsForRunId,
  resolveTelegramSessionFilePath,
  type TelegramSessionRecord,
  upsertTelegramSession,
} from "./sessions.js";
import {
  formatTaskRunsLines,
  listDiskRunsForTaskId,
  type DiskRunBrief,
} from "./taskRuns.js";
import {
  issueTaskId,
  normalizeUserTaskId,
  taskFileTaskId,
} from "./taskId.js";
import type { PlanningHumanConsultSession } from "../workflow/planning.js";

function withConsultHumanEnabled(
  loaded: LoadedConfig,
  enabled: boolean | undefined,
): LoadedConfig {
  if (enabled === undefined) return loaded;
  return {
    ...loaded,
    config: {
      ...loaded.config,
      workflow: {
        ...loaded.config.workflow,
        consultHuman: {
          ...loaded.config.workflow.consultHuman,
          enabled,
        },
      },
    },
  };
}

function openRun(args: { cwd: string; runId: string }) {
  const loaded = loadConfig(args.cwd);
  const { relativeRoot } = resolveArtifactsRoot(loaded);
  const paths = runPaths({
    cwd: args.cwd,
    artifactsRootRelative: relativeRoot,
    runId: args.runId,
  });
  if (!fs.existsSync(paths.root)) {
    throw new Error(`Run directory not found: ${paths.root}`);
  }
  ensureRunLayout(paths.root);
  return { loaded, paths };
}

/**
 * `/plan`, `/workflow`, `/resume` accept the real run directory name (UUID) or a
 * taskId when it maps to exactly one run on disk (or legacy telegram-sessions row).
 */
function resolveTelegramRunSpec(args: {
  cwd: string;
  sessionFilePath: string;
  spec: string;
  repoHint: string | undefined;
}):
  | { type: "run"; runId: string }
  | { type: "error"; message: string }
  | { type: "ambiguous"; taskId: string; runs: DiskRunBrief[] } {
  const raw = args.spec.trim();
  if (!raw) {
    return { type: "error", message: "Missing run id." };
  }
  let loaded: LoadedConfig;
  try {
    loaded = loadConfig(args.cwd);
  } catch (e) {
    return {
      type: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
  const { relativeRoot } = resolveArtifactsRoot(loaded);
  const direct = runPaths({
    cwd: args.cwd,
    artifactsRootRelative: relativeRoot,
    runId: raw,
  });
  if (fs.existsSync(direct.root)) {
    return { type: "run", runId: raw };
  }

  const taskId = normalizeUserTaskId(raw, args.repoHint);
  if (taskId) {
    const diskRuns = listDiskRunsForTaskId({ cwd: args.cwd, taskId });
    const file = readTelegramSessionFile(args.sessionFilePath);

    if (diskRuns.length > 1) {
      return { type: "ambiguous", taskId, runs: diskRuns };
    }
    if (diskRuns.length === 1) {
      return { type: "run", runId: diskRuns[0]!.runId };
    }

    const mapped = findRunIdForTask(file, taskId);
    if (mapped) {
      const mappedPaths = runPaths({
        cwd: args.cwd,
        artifactsRootRelative: relativeRoot,
        runId: mapped,
      });
      if (fs.existsSync(mappedPaths.root)) {
        return { type: "run", runId: mapped };
      }
      return {
        type: "error",
        message: `telegram-sessions.json maps ${taskId} → ${mapped}, but that run folder is missing on disk (${mappedPaths.root}).`,
      };
    }

    return {
      type: "error",
      message: `${formatTaskRunsLines({
        taskId,
        runs: [],
        sessionFile: file,
        title: "No run on disk for this task",
      })}\n\nUse a UUID from .agentic-my-app/runs or start /run for this task.`,
    };
  }

  return {
    type: "error",
    message: `No run directory for "${raw}". Use a UUID under:
${path.join(args.cwd, relativeRoot, "<uuid>")}
or a task id (owner/repo#n or task:path).`,
  };
}

function parseMergeStrategy(s: unknown): "merge" | "squash" | "rebase" {
  const m = String(s ?? "merge").trim().toLowerCase();
  if (m === "merge" || m === "squash" || m === "rebase") return m;
  throw new Error(`merge must be merge, squash, or rebase (got ${String(s)})`);
}

type RunPickKind =
  | "status"
  | "cancel"
  | "plan"
  | "workflow"
  | "resume"
  | "reply_info";

type BotCtx = {
  cwd: string;
  autonomous: boolean;
  debug: boolean;
  allowChats: Set<number>;
  unauthorizedNotified: Set<number>;
  /** taskId -> in-flight */
  activeTask: Map<string, Promise<void>>;
  /** taskIds currently doing intake / boot (avoid duplicate /run races) */
  startingTask: Set<string>;
  sessionFilePath: string;
  /** Yes/No inline keyboard callbacks for spec/decomp/tool approvals. */
  choiceWaiters: Map<
    string,
    {
      resolve: (choice: "yes" | "no") => void;
      t?: ReturnType<typeof setTimeout>;
    }
  >;
  /** Short-lived menus for /reply inline pick (callback_data length limit). */
  replyPickMenus: Map<
    string,
    { chatId: number; taskIds: string[]; discardTimer: ReturnType<typeof setTimeout> }
  >;
  /** Short-lived run UUID picks: /status, /cancel, /plan, /workflow, /resume, /reply. */
  runPickMenus: Map<
    string,
    {
      chatId: number;
      kind: RunPickKind;
      /** Buttons map 1:1 to this slice. */
      runs: DiskRunBrief[];
      /** Full id list for "cancel ALL" (may be longer than `runs`). */
      allRunIds: string[];
      taskId?: string;
      discardTimer: ReturnType<typeof setTimeout>;
    }
  >;
  /**
   * Non-terminal runs restored from telegram-sessions.json + run state on disk.
   * Cleared when a reconnect workflow starts or finishes.
   */
  restoredRuns: Map<
    string,
    { runId: string; chatId: number; userId: number; phase: string }
  >;
};

const REPLY_PICK_MENU_TTL_MS = 15 * 60 * 1000;

function newReplyPickNonce(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(-12);
}

function truncateButtonLabel(s: string, max = 64): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function runPickKindLetter(k: RunPickKind): string {
  switch (k) {
    case "status":
      return "s";
    case "cancel":
      return "c";
    case "plan":
      return "p";
    case "workflow":
      return "w";
    case "resume":
      return "r";
    case "reply_info":
      return "i";
  }
}

function parseRunPickLetter(s: string): RunPickKind | null {
  switch (s) {
    case "s":
      return "status";
    case "c":
      return "cancel";
    case "p":
      return "plan";
    case "w":
      return "workflow";
    case "r":
      return "resume";
    case "i":
      return "reply_info";
    default:
      return null;
  }
}

async function sendRunPickMessage(args: {
  bot: Telegraf;
  app: BotCtx;
  chatId: number;
  kind: RunPickKind;
  taskId?: string;
  runs: DiskRunBrief[];
  intro: string;
  /** Prefer this from bot commands so the inline keyboard is a normal reply (like /reply). */
  reply?: (
    text: string,
    keyboard: ReturnType<typeof Markup.inlineKeyboard>,
  ) => Promise<unknown>;
}): Promise<void> {
  const { bot, app, chatId, kind, taskId, runs, intro, reply } = args;
  if (!runs.length) return;
  const nonce = newReplyPickNonce();
  const cap = 12;
  const sliceRuns = runs.slice(0, cap);
  const allRunIds = runs.map((r) => r.runId);
  let text = intro;
  if (runs.length > cap) {
    text += `\n\nShowing first ${cap} of ${runs.length} runs.`;
  }
  if (taskId) {
    text += `\n\ntaskId: ${taskId}`;
  }
  const rows = sliceRuns.map((r, i) => [
    Markup.button.callback(
      truncateButtonLabel(
        r.taskIdHint
          ? `${r.taskIdHint.slice(0, 28)} · ${r.phase} · ${r.runId.slice(0, 8)}`
          : `${r.phase} · ${r.runId.slice(0, 8)}…`,
        58,
      ),
      `agentic:rp:${runPickKindLetter(kind)}:${nonce}:${i}`,
    ),
  ]);
  if (kind === "cancel" && runs.length > 1) {
    rows.push([Markup.button.callback("Cancel ALL", `agentic:runca:${nonce}`)]);
  }
  const discardTimer = setTimeout(() => {
    app.runPickMenus.delete(nonce);
  }, REPLY_PICK_MENU_TTL_MS);
  app.runPickMenus.set(nonce, {
    chatId,
    kind,
    runs: sliceRuns,
    allRunIds,
    taskId,
    discardTimer,
  });
  const keyboard = Markup.inlineKeyboard(rows);
  if (reply) {
    await reply(text.slice(0, 3900), keyboard);
  } else {
    await bot.telegram.sendMessage(chatId, text.slice(0, 3900), {
      reply_markup: keyboard.reply_markup,
    });
  }
}

function createTelegramUiBridge(args: {
  app: BotCtx;
  bot: Telegraf;
  chatId: number;
  consultTimeoutMs: number;
}): TelegramConsultBridge {
  const { app, bot, chatId, consultTimeoutMs } = args;
  return {
    sendHtmlKeyboard: async (html, keyboard) => {
      await bot.telegram.sendMessage(chatId, html, {
        parse_mode: "HTML",
        reply_markup: keyboard.reply_markup,
        disable_web_page_preview: true,
      } as never);
    },
    sendDocumentKeyboard: async (filePath, captionHtml, keyboard) => {
      const buf = fs.readFileSync(filePath);
      await bot.telegram.sendDocument(
        chatId,
        { source: buf, filename: path.basename(filePath) },
        {
          caption: captionHtml,
          parse_mode: "HTML",
          ...(keyboard ? { reply_markup: keyboard.reply_markup } : {}),
        } as never,
      );
    },
    sendDocumentBufferKeyboard: async (filename, content, captionHtml, keyboard) => {
      await bot.telegram.sendDocument(
        chatId,
        { source: content, filename },
        {
          caption: captionHtml,
          parse_mode: "HTML",
          reply_markup: keyboard.reply_markup,
        } as never,
      );
    },
    registerBinaryChoice: (nonce, resolve) => {
      const t =
        consultTimeoutMs > 0
          ? setTimeout(() => {
              const w = app.choiceWaiters.get(nonce);
              if (!w) return;
              app.choiceWaiters.delete(nonce);
              resolve("no");
            }, consultTimeoutMs)
          : undefined;
      app.choiceWaiters.set(nonce, { resolve, t });
    },
  };
}

function mergeStrategyFromEnv(): "merge" | "squash" | "rebase" {
  const raw = process.env.AGENTIC_MY_APP_TELEGRAM_MERGE_STRATEGY?.trim();
  try {
    return parseMergeStrategy(raw ?? "merge");
  } catch {
    return "merge";
  }
}

const TERMINAL_WORKFLOW_PHASES = new Set<string>(["COMPLETED", "CANCELLED"]);

/** Loads non-terminal sessions from disk into app.restoredRuns; returns rows to reconnect after bot.launch. */
function hydrateTelegramStateFromDisk(app: BotCtx): TelegramSessionRecord[] {
  const file = readTelegramSessionFile(app.sessionFilePath);
  const cwdResolved = path.resolve(app.cwd);
  const toReconnect: TelegramSessionRecord[] = [];

  for (const rec of file.runs) {
    if (rec.cwd !== undefined && path.resolve(rec.cwd) !== cwdResolved) {
      continue;
    }
    let loaded: LoadedConfig;
    try {
      loaded = loadConfig(app.cwd);
    } catch {
      continue;
    }
    const { relativeRoot } = resolveArtifactsRoot(loaded);
    const paths = runPaths({
      cwd: app.cwd,
      artifactsRootRelative: relativeRoot,
      runId: rec.runId,
    });
    if (
      !fs.existsSync(paths.root) ||
      !fs.existsSync(paths.taskInput) ||
      !fs.existsSync(paths.state)
    ) {
      continue;
    }
    let state: ReturnType<typeof readState>;
    try {
      state = readState(paths);
    } catch {
      continue;
    }
    if (TERMINAL_WORKFLOW_PHASES.has(state.phase)) continue;

    app.restoredRuns.set(rec.taskId, {
      runId: rec.runId,
      chatId: rec.chatId,
      userId: rec.userId,
      phase: state.phase,
    });
    toReconnect.push({
      ...rec,
      cwd: rec.cwd ?? cwdResolved,
    });
  }
  return toReconnect;
}

function clearRestoredRunsForRunId(app: BotCtx, runId: string): void {
  for (const [tid, meta] of [...app.restoredRuns.entries()]) {
    if (meta.runId === runId) app.restoredRuns.delete(tid);
  }
}

/** Drop telegram rows + reconnect memory for this run after user cancels. */
function finalizeCancelRunForTelegram(app: BotCtx, runId: string): number {
  const removed = removeTelegramSessionRowsForRunId(app.sessionFilePath, runId);
  clearRestoredRunsForRunId(app, runId);
  return removed;
}

/** Non-terminal runs visible to this chat (persisted sessions + reconnect queue). */
function listCancellableRunsForChatCancelMenu(
  app: BotCtx,
  chatId: number,
): DiskRunBrief[] {
  const file = readTelegramSessionFile(app.sessionFilePath);
  const rows = file.runs
    .filter((r) => r.chatId === chatId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const byRunId = new Map<string, TelegramSessionRecord>();
  for (const r of rows) {
    if (!byRunId.has(r.runId)) byRunId.set(r.runId, r);
  }
  const out: DiskRunBrief[] = [];
  const seen = new Set<string>();

  for (const rec of byRunId.values()) {
    if (seen.has(rec.runId)) continue;
    try {
      const st = readState(openRun({ cwd: app.cwd, runId: rec.runId }).paths);
      if (TERMINAL_WORKFLOW_PHASES.has(st.phase)) continue;
      seen.add(rec.runId);
      out.push({
        runId: rec.runId,
        phase: st.phase,
        createdAt: st.createdAt,
        taskIdHint: rec.taskId,
      });
    } catch {
      continue;
    }
  }

  for (const [taskId, meta] of app.restoredRuns.entries()) {
    if (meta.chatId !== chatId) continue;
    if (seen.has(meta.runId)) continue;
    try {
      const st = readState(openRun({ cwd: app.cwd, runId: meta.runId }).paths);
      if (TERMINAL_WORKFLOW_PHASES.has(st.phase)) continue;
      seen.add(meta.runId);
      out.push({
        runId: meta.runId,
        phase: st.phase,
        createdAt: st.createdAt,
        taskIdHint: taskId,
      });
    } catch {
      continue;
    }
  }

  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

export async function runTelegramBot(args: {
  cwd: string;
  autonomous: boolean;
  debug: boolean;
}): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required");
  }
  const allowRaw = process.env.AGENTIC_MY_APP_TELEGRAM_ALLOWED_CHATS?.trim();
  if (!allowRaw) {
    throw new Error(
      "AGENTIC_MY_APP_TELEGRAM_ALLOWED_CHATS is required (comma-separated numeric chat ids)",
    );
  }
  const allowChats = new Set(
    allowRaw
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n)),
  );
  if (!allowChats.size) {
    throw new Error("AGENTIC_MY_APP_TELEGRAM_ALLOWED_CHATS contained no valid ids");
  }

  const cwd = path.resolve(args.cwd);
  const loadedSeed = loadConfig(cwd);
  const sessionFilePath = resolveTelegramSessionFilePath(loadedSeed);

  const app: BotCtx = {
    cwd,
    autonomous: args.autonomous,
    debug: args.debug || envTelegramDebugEnabled(),
    allowChats,
    unauthorizedNotified: new Set(),
    activeTask: new Map(),
    startingTask: new Set(),
    sessionFilePath,
    choiceWaiters: new Map(),
    replyPickMenus: new Map(),
    runPickMenus: new Map(),
    restoredRuns: new Map(),
  };

  const reconnectList = hydrateTelegramStateFromDisk(app);

  const bot = new Telegraf(token);

  bot.on("callback_query", async (ctx) => {
    const data =
      ctx.callbackQuery && "data" in ctx.callbackQuery
        ? ctx.callbackQuery.data
        : undefined;
    if (typeof data !== "string") return;

    const pick = /^agentic:replypick:([a-z0-9]+):(\d+)$/.exec(data);
    if (pick) {
      const nonce = pick[1]!;
      const idx = Number(pick[2]);
      const menu = app.replyPickMenus.get(nonce);
      const chatId = ctx.chat?.id;
      if (!menu || chatId === undefined || menu.chatId !== chatId) {
        try {
          await ctx.answerCbQuery("Menu expired or invalid — run /reply again.");
        } catch {
          /* ignore */
        }
        return;
      }
      const taskId = menu.taskIds[idx];
      if (!taskId) {
        try {
          await ctx.answerCbQuery("Invalid choice.");
        } catch {
          /* ignore */
        }
        return;
      }
      clearTimeout(menu.discardTimer);
      app.replyPickMenus.delete(nonce);
      const port = getPortForChatTask(chatId, taskId);
      if (!port) {
        try {
          await ctx.answerCbQuery("Session ended — start a new /run if needed.");
        } catch {
          /* ignore */
        }
        return;
      }
      port.setArmed(true);
      try {
        await ctx.answerCbQuery(`Armed: ${truncateButtonLabel(taskId, 50)}`);
      } catch {
        /* ignore */
      }
      await ctx.reply(
        `Armed for ${taskId}. Send your next plain-text message once (freeform human consult).`,
      );
      return;
    }

    const runca = /^agentic:runca:([a-z0-9]+)$/.exec(data);
    if (runca) {
      const nonce = runca[1]!;
      const menu = app.runPickMenus.get(nonce);
      const chatId = ctx.chat?.id;
      if (!menu || chatId === undefined || menu.chatId !== chatId || menu.kind !== "cancel") {
        try {
          await ctx.answerCbQuery("Menu expired or invalid.");
        } catch {
          /* ignore */
        }
        return;
      }
      clearTimeout(menu.discardTimer);
      app.runPickMenus.delete(nonce);
      const outcomes: string[] = [];
      for (const runId of menu.allRunIds) {
        try {
          requestCancel(openRun({ cwd: app.cwd, runId }).paths);
          const n = finalizeCancelRunForTelegram(app, runId);
          outcomes.push(`• ${runId} (session rows dropped: ${n})`);
        } catch (e) {
          outcomes.push(
            `• ${runId}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      try {
        await ctx.answerCbQuery(`Stopped ${menu.allRunIds.length} run(s).`);
      } catch {
        /* ignore */
      }
      await ctx.reply(
        `Cancelled ALL ${menu.allRunIds.length} run(s) for this chat. Session file + reconnect queue updated for each.\n${outcomes.join("\n")}`.slice(
          0,
          4096,
        ),
      );
      return;
    }

    const rp = /^agentic:rp:([scpwri]):([a-z0-9]+):(\d+)$/.exec(data);
    if (rp) {
      const letter = rp[1]!;
      const nonce = rp[2]!;
      const idx = Number(rp[3]);
      const kind = parseRunPickLetter(letter);
      const menu = app.runPickMenus.get(nonce);
      const chatId = ctx.chat?.id;
      const userId = ctx.from?.id ?? 0;
      if (!kind || !menu || chatId === undefined || menu.chatId !== chatId || menu.kind !== kind) {
        try {
          await ctx.answerCbQuery("Menu expired or invalid.");
        } catch {
          /* ignore */
        }
        return;
      }
      const chosen = menu.runs[idx];
      if (!chosen) {
        try {
          await ctx.answerCbQuery("Invalid choice.");
        } catch {
          /* ignore */
        }
        return;
      }
      const runId = chosen.runId;
      clearTimeout(menu.discardTimer);
      app.runPickMenus.delete(nonce);

      if (kind === "status") {
        try {
          const st = readState(openRun({ cwd: app.cwd, runId }).paths);
          await ctx.answerCbQuery(`${chosen.phase}`);
          await ctx.reply(
            `runId=${runId}\nstate.json:\n${JSON.stringify(st, null, 2).slice(0, 3800)}`,
          );
        } catch (e) {
          try {
            await ctx.answerCbQuery(e instanceof Error ? e.message : String(e));
          } catch {
            /* ignore */
          }
        }
        return;
      }

      if (kind === "cancel") {
        try {
          requestCancel(openRun({ cwd: app.cwd, runId }).paths);
          const n = finalizeCancelRunForTelegram(app, runId);
          await ctx.answerCbQuery(`Stopped ${runId.slice(0, 8)}…`);
          await ctx.reply(
            `Cancelled runId=${runId}${chosen.taskIdHint ? ` — ${chosen.taskIdHint}` : ""}. Workflow cancel flag set; removed ${n} telegram session row(s) for this run. It will not be offered again on /cancel or reconnect.`,
          );
        } catch (e) {
          try {
            await ctx.answerCbQuery(e instanceof Error ? e.message : String(e));
          } catch {
            /* ignore */
          }
        }
        return;
      }

      if (kind === "plan") {
        try {
          await ctx.answerCbQuery(`Plan ${runId.slice(0, 8)}…`);
        } catch {
          /* ignore */
        }
        void handlePlanRun(app, bot, chatId, userId, runId);
        return;
      }

      if (kind === "workflow") {
        try {
          await ctx.answerCbQuery(`Workflow ${runId.slice(0, 8)}…`);
        } catch {
          /* ignore */
        }
        void handleWorkflowRun(app, bot, chatId, runId, false);
        return;
      }

      if (kind === "resume") {
        try {
          await ctx.answerCbQuery(`Resume ${runId.slice(0, 8)}…`);
        } catch {
          /* ignore */
        }
        void handleWorkflowRun(app, bot, chatId, runId, true);
        return;
      }

      if (kind === "reply_info") {
        try {
          await ctx.answerCbQuery(chosen.phase);
        } catch {
          /* ignore */
        }
        await ctx.reply(
          `No live consult for this run (phase ${chosen.phase}). runId=${runId}\n${menu.taskId ? `taskId=${menu.taskId}\n` : ""}Start /run … or wait for bot reconnect.`,
        );
        return;
      }
    }

    const yn = /^agentic:ch:(yes|no):([a-z0-9]+)$/.exec(data);
    if (yn) {
      const choseYes = yn[1] === "yes";
      const nonce = yn[2]!;
      const w = app.choiceWaiters.get(nonce);
      if (!w) {
        try {
          await ctx.answerCbQuery("Choice expired.");
        } catch {
          /* ignore */
        }
        return;
      }
      if (w.t) clearTimeout(w.t);
      app.choiceWaiters.delete(nonce);
      try {
        await ctx.answerCbQuery(choseYes ? "Yes" : "No");
      } catch {
        /* ignore */
      }
      w.resolve(choseYes ? "yes" : "no");
      return;
    }
  });

  bot.start(async (c) => {
    if (!checkAccess(c.chat, c.from?.id, app, bot)) return;
    await c.reply(
      [
        "agentic-my-app Telegram control (private chats, allowlist only).",
        "Commands: /run issue owner/repo#123 | /run task path/to.md",
        "/reply — freeform consult only (pick task, then text). Spec/decomposition/tools use Yes/No buttons.",
        "/status [taskId] — buttons when several runs; /cancel — pick run(s) for this chat, or /cancel <taskId>",
        "/issue <spec> | /task <file> — intake only (runId printed)",
        "/plan | /workflow | /resume — UUID or taskId; multiple runs → inline pick (resume follows PR)",
      ].join("\n"),
    );
  });

  bot.command("reply", async (c) => {
    if (!checkAccess(c.chat, c.from?.id, app, bot)) return;
    const rest = c.message.text.replace(/^\/reply(@\w+)?/i, "").trim();
    const loaded = loadConfig(app.cwd);
    const repoHint = loaded.config.github.defaultRepo.trim() || undefined;
    const chatId = c.chat.id;

    if (!rest) {
      const taskIds = listActiveTaskIds(app, chatId);
      if (!taskIds.length) {
        await c.reply(
          "No active consult sessions in this bot process for this chat. Start with /run …",
        );
        return;
      }
      const nonce = newReplyPickNonce();
      const rows = taskIds.map((tid, i) => [
        Markup.button.callback(truncateButtonLabel(tid), `agentic:replypick:${nonce}:${i}`),
      ]);
      const discardTimer = setTimeout(() => {
        app.replyPickMenus.delete(nonce);
      }, REPLY_PICK_MENU_TTL_MS);
      app.replyPickMenus.set(nonce, { chatId, taskIds, discardTimer });
      await c.reply(
        "Pick a task (freeform consult only). Then send one plain-text message.",
        Markup.inlineKeyboard(rows),
      );
      return;
    }

    const taskId = normalizeUserTaskId(rest, repoHint);
    if (!taskId) {
      await c.reply("Could not parse task id. Use owner/repo#123 or task:relative/path.md");
      return;
    }

    const port = getPortForChatTask(chatId, taskId);
    if (!port) {
      const file = readTelegramSessionFile(app.sessionFilePath);
      const diskRuns = listDiskRunsForTaskId({ cwd: app.cwd, taskId });
      if (!diskRuns.length) {
        const summary = formatTaskRunsLines({
          taskId,
          runs: [],
          sessionFile: file,
          title: "No active consult session for this task in this chat",
        });
        await c.reply(
          `${summary}\n\nconsult ports only exist while a /run (or reconnect) is active in this process.`.slice(
            0,
            4096,
          ),
        );
        return;
      }
      await sendRunPickMessage({
        bot,
        app,
        chatId,
        kind: "reply_info",
        taskId,
        runs: diskRuns.map((r) => ({ ...r, taskIdHint: taskId })),
        intro:
          "/reply — no live consult for this task. Pick a run for runId/phase (or start /run):",
        reply: (t, kb) => c.reply(t, kb),
      });
      return;
    }
    port.setArmed(true);
      await c.reply(
        `Armed for ${taskId}. Send one plain-text message (freeform consult — spec/decomp/tools use Yes/No buttons instead).`,
      );
  });

  bot.command("status", async (c) => {
    if (!checkAccess(c.chat, c.from?.id, app, bot)) return;
    const rest = c.message.text.replace(/^\/status(@\w+)?/i, "").trim();
    const loaded = loadConfig(app.cwd);
    const repoHint = loaded.config.github.defaultRepo.trim() || undefined;
    try {
      if (rest) {
        const taskId = normalizeUserTaskId(rest, repoHint);
        if (!taskId) {
          await c.reply("Could not parse task id.");
          return;
        }
        const file = readTelegramSessionFile(app.sessionFilePath);
        const diskRuns = listDiskRunsForTaskId({ cwd: app.cwd, taskId });
        if (!diskRuns.length) {
          await c.reply(
            formatTaskRunsLines({
              taskId,
              runs: [],
              sessionFile: file,
              title: "/status — runs for task",
            }).slice(0, 4096),
          );
          return;
        }
        if (diskRuns.length === 1) {
          const st = readState(
            openRun({ cwd: app.cwd, runId: diskRuns[0]!.runId }).paths,
          );
          await c.reply(
            `${formatTaskRunsLines({
              taskId,
              runs: diskRuns,
              sessionFile: file,
              title: "/status — runs for task",
            })}\n\nstate.json:\n${JSON.stringify(st, null, 2).slice(0, 3200)}`.slice(
              0,
              4096,
            ),
          );
          return;
        }
        await sendRunPickMessage({
          bot,
          app,
          chatId: c.chat.id,
          kind: "status",
          taskId,
          runs: diskRuns.map((r) => ({ ...r, taskIdHint: taskId })),
          intro: "/status — multiple runs for this task. Pick one for full state.json:",
          reply: (t, kb) => c.reply(t, kb),
        });
        return;
      }

      const file = readTelegramSessionFile(app.sessionFilePath);
      const forChat = file.runs
        .filter((r) => r.chatId === c.chat.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      if (!forChat.length) {
        await c.reply("No sessions recorded for this chat; pass /status <taskId>.");
        return;
      }
      if (forChat.length === 1) {
        const r = forChat[0]!;
        try {
          const st = readState(openRun({ cwd: app.cwd, runId: r.runId }).paths);
          await c.reply(
            `taskId=${r.taskId}\nrunId=${r.runId}\nupdated=${r.updatedAt}\n\nstate.json:\n${JSON.stringify(st, null, 2).slice(0, 3800)}`,
          );
        } catch (e) {
          await c.reply(e instanceof Error ? e.message : String(e));
        }
        return;
      }
      const briefs: DiskRunBrief[] = forChat.map((r) => {
        try {
          const st = readState(openRun({ cwd: app.cwd, runId: r.runId }).paths);
          return {
            runId: r.runId,
            phase: st.phase,
            createdAt: st.createdAt,
            taskIdHint: r.taskId,
          };
        } catch {
          return {
            runId: r.runId,
            phase: "?",
            createdAt: "?",
            taskIdHint: r.taskId,
          };
        }
      });
      await sendRunPickMessage({
        bot,
        app,
        chatId: c.chat.id,
        kind: "status",
        intro: `/status — ${forChat.length} telegram session row(s) for this chat. Pick a run for state:`,
        runs: briefs,
        reply: (t, kb) => c.reply(t, kb),
      });
    } catch (e) {
      await c.reply(e instanceof Error ? e.message : String(e));
    }
  });

  bot.command("cancel", async (c) => {
    if (!checkAccess(c.chat, c.from?.id, app, bot)) return;
    const rest = c.message.text.replace(/^\/cancel(@\w+)?/i, "").trim();
    const loaded = loadConfig(app.cwd);
    const repoHint = loaded.config.github.defaultRepo.trim() || undefined;

    if (!rest) {
      const cancellable = listCancellableRunsForChatCancelMenu(app, c.chat.id);
      if (!cancellable.length) {
        await c.reply(
          [
            "Nothing to cancel for this chat.",
            "",
            "No in-progress runs are tied to this chat in telegram-sessions.json or the reconnect queue. Start a /run first.",
            "To cancel by task without the menu: /cancel owner/repo#123 or /cancel task:relative/path.md",
          ].join("\n"),
        );
        return;
      }
      await sendRunPickMessage({
        bot,
        app,
        chatId: c.chat.id,
        kind: "cancel",
        runs: cancellable,
        intro:
          cancellable.length > 1
            ? "/cancel — pick a run to stop and remove from bot tracking, or Cancel ALL:"
            : "/cancel — tap below to stop this run and remove it from bot tracking:",
        reply: (t, kb) => c.reply(t, kb),
      });
      return;
    }

    const taskId = normalizeUserTaskId(rest, repoHint);
    if (!taskId) {
      await c.reply(
        "Send /cancel alone for the pick list, or /cancel owner/repo#123 / /cancel task:relative/path.md",
      );
      return;
    }
    const file = readTelegramSessionFile(app.sessionFilePath);
    const diskRuns = listDiskRunsForTaskId({ cwd: app.cwd, taskId });
    if (!diskRuns.length) {
      await c.reply(
        [
          `Nothing to cancel for task «${taskId}».`,
          "",
          "No run folders on disk match this task under your configured artifacts directory. Check the issue ref or task: path, or start a workflow with /run.",
          "",
          formatTaskRunsLines({
            taskId,
            runs: [],
            sessionFile: file,
            title: "telegram-sessions.json (hint)",
          }),
        ]
          .join("\n")
          .slice(0, 4096),
      );
      return;
    }
    const cancellable = diskRuns.filter(
      (r) => !TERMINAL_WORKFLOW_PHASES.has(r.phase),
    );
    if (!cancellable.length) {
      await c.reply(
        [
          `No active workflows to cancel for «${taskId}».`,
          "",
          `There ${diskRuns.length === 1 ? "is" : "are"} ${diskRuns.length} run folder(s) on disk, but ${diskRuns.length === 1 ? "it is" : "they are all"} already finished (phase COMPLETED or CANCELLED). /cancel only applies to runs that are still in progress.`,
          "",
          formatTaskRunsLines({
            taskId,
            runs: diskRuns,
            sessionFile: file,
            title: "Runs on disk (reference)",
          }),
        ]
          .join("\n")
          .slice(0, 4096),
      );
      return;
    }
    await sendRunPickMessage({
      bot,
      app,
      chatId: c.chat.id,
      kind: "cancel",
      taskId,
      runs: cancellable.map((r) => ({ ...r, taskIdHint: taskId })),
      intro:
        cancellable.length > 1
          ? "/cancel — pick one in-progress run to stop, or Cancel ALL:"
          : "/cancel — tap the button below to cancel this in-progress run:",
      reply: (t, kb) => c.reply(t, kb),
    });
  });

  bot.command("run", async (c) => {
    if (!checkAccess(c.chat, c.from?.id, app, bot)) return;
    const text = c.message.text.replace(/^\/run(@\w+)?/i, "").trim();
    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length < 2 || (parts[0] !== "issue" && parts[0] !== "task")) {
      await c.reply("Usage: /run issue owner/repo#123  OR  /run task path/to/task.md");
      return;
    }
    const kind = parts[0];
    const spec = parts.slice(1).join(" ").trim();
    if (!spec) {
      await c.reply("Missing issue ref or task path.");
      return;
    }
    void handleFullRun({
      ctx: app,
      bot,
      chatId: c.chat.id,
      userId: c.from?.id ?? 0,
      kind: kind as "issue" | "task",
      spec,
    });
  });

  bot.command("issue", async (c) => {
    if (!checkAccess(c.chat, c.from?.id, app, bot)) return;
    const rest = c.message.text.replace(/^\/issue(@\w+)?/i, "").trim();
    if (!rest) {
      await c.reply("Usage: /issue owner/repo#123");
      return;
    }
    try {
      const out = intakeIssueOnly(app.cwd, rest);
      await c.reply(JSON.stringify(out, null, 2));
    } catch (e) {
      await c.reply(e instanceof Error ? e.message : String(e));
    }
  });

  bot.command("task", async (c) => {
    if (!checkAccess(c.chat, c.from?.id, app, bot)) return;
    const rest = c.message.text.replace(/^\/task(@\w+)?/i, "").trim();
    if (!rest) {
      await c.reply("Usage: /task path/to/task.md");
      return;
    }
    try {
      const out = intakeTaskOnly(app.cwd, rest);
      await c.reply(JSON.stringify(out, null, 2));
    } catch (e) {
      await c.reply(e instanceof Error ? e.message : String(e));
    }
  });

  bot.command("plan", async (c) => {
    if (!checkAccess(c.chat, c.from?.id, app, bot)) return;
    const rest = c.message.text.replace(/^\/plan(@\w+)?/i, "").trim();
    if (!rest) {
      await c.reply("Usage: /plan <runId | taskId> (UUID from /status, or owner/repo#n / task:path if listed in telegram-sessions.json)");
      return;
    }
    const loaded = loadConfig(app.cwd);
    const repoHint = loaded.config.github.defaultRepo.trim() || undefined;
    const resolved = resolveTelegramRunSpec({
      cwd: app.cwd,
      sessionFilePath: app.sessionFilePath,
      spec: rest,
      repoHint,
    });
    if (resolved.type === "error") {
      await c.reply(resolved.message.slice(0, 4096));
      return;
    }
    if (resolved.type === "ambiguous") {
      await sendRunPickMessage({
        bot,
        app,
        chatId: c.chat.id,
        kind: "plan",
        taskId: resolved.taskId,
        runs: resolved.runs.map((r) => ({ ...r, taskIdHint: resolved.taskId })),
        intro: "/plan — multiple runs for this task. Pick one:",
        reply: (t, kb) => c.reply(t, kb),
      });
      return;
    }
    void handlePlanRun(app, bot, c.chat.id, c.from?.id ?? 0, resolved.runId);
  });

  bot.command("workflow", async (c) => {
    if (!checkAccess(c.chat, c.from?.id, app, bot)) return;
    const rest = c.message.text.replace(/^\/workflow(@\w+)?/i, "").trim();
    if (!rest) {
      await c.reply(
        "Usage: /workflow <runId | taskId> (see /plan — same resolution)",
      );
      return;
    }
    const loaded = loadConfig(app.cwd);
    const repoHint = loaded.config.github.defaultRepo.trim() || undefined;
    const resolved = resolveTelegramRunSpec({
      cwd: app.cwd,
      sessionFilePath: app.sessionFilePath,
      spec: rest,
      repoHint,
    });
    if (resolved.type === "error") {
      await c.reply(resolved.message.slice(0, 4096));
      return;
    }
    if (resolved.type === "ambiguous") {
      await sendRunPickMessage({
        bot,
        app,
        chatId: c.chat.id,
        kind: "workflow",
        taskId: resolved.taskId,
        runs: resolved.runs.map((r) => ({ ...r, taskIdHint: resolved.taskId })),
        intro: "/workflow — multiple runs for this task. Pick one:",
        reply: (t, kb) => c.reply(t, kb),
      });
      return;
    }
  });

  bot.command("resume", async (c) => {
    if (!checkAccess(c.chat, c.from?.id, app, bot)) return;
    const rest = c.message.text.replace(/^\/resume(@\w+)?/i, "").trim();
    if (!rest) {
      await c.reply(
        "Usage: /resume <runId | taskId> (UUID from /status, or task id if in telegram-sessions.json; not the literal issue ref as a folder name)",
      );
      return;
    }
    const loaded = loadConfig(app.cwd);
    const repoHint = loaded.config.github.defaultRepo.trim() || undefined;
    const resolved = resolveTelegramRunSpec({
      cwd: app.cwd,
      sessionFilePath: app.sessionFilePath,
      spec: rest,
      repoHint,
    });
    if (resolved.type === "error") {
      await c.reply(resolved.message.slice(0, 4096));
      return;
    }
    if (resolved.type === "ambiguous") {
      await sendRunPickMessage({
        bot,
        app,
        chatId: c.chat.id,
        kind: "resume",
        taskId: resolved.taskId,
        runs: resolved.runs.map((r) => ({ ...r, taskIdHint: resolved.taskId })),
        intro: "/resume — multiple runs for this task. Pick one:",
        reply: (t, kb) => c.reply(t, kb),
      });
      return;
    }
  });

  bot.on(message("text"), async (c) => {
    if (!checkAccess(c.chat, c.from?.id, app, bot)) return;
    if (c.message.text.trim().startsWith("/")) return;
    const chatId = c.chat.id;
    for (const [, port] of consultPortsForChat(chatId)) {
      if (port.consumeArmedText(c.message.text)) return;
    }
  });

  await bot.launch();
  for (const rec of reconnectList) {
    if (!app.allowChats.has(rec.chatId)) continue;
    scheduleTelegramReconnect(app, bot, rec);
  }
  process.once("SIGINT", () => bot.stop("SIGINT"));
}

/** chat -> taskId -> port (consult for active runs) */
const consultPorts = new Map<number, Map<string, TelegramConsultPort>>();

function consultPortsForChat(chatId: number): Iterable<[string, TelegramConsultPort]> {
  const m = consultPorts.get(chatId);
  return m ?? [];
}

function registerConsultPort(
  chatId: number,
  taskId: string,
  port: TelegramConsultPort,
): void {
  let m = consultPorts.get(chatId);
  if (!m) {
    m = new Map();
    consultPorts.set(chatId, m);
  }
  m.set(taskId, port);
}

function unregisterConsultPort(chatId: number, taskId: string): void {
  const m = consultPorts.get(chatId);
  m?.delete(taskId);
  if (m && m.size === 0) consultPorts.delete(chatId);
}

function getPortForChatTask(
  chatId: number,
  taskId: string,
): TelegramConsultPort | undefined {
  return consultPorts.get(chatId)?.get(taskId);
}

function listActiveTaskIds(app: BotCtx, chatId: number): string[] {
  const fromPorts = [...consultPortsForChat(chatId)].map(([k]) => k);
  const fromRestored = [...app.restoredRuns.entries()]
    .filter(([, m]) => m.chatId === chatId)
    .map(([tid]) => tid);
  return [...new Set([...fromPorts, ...fromRestored])];
}

function checkAccess(
  chat: { id: number; type?: string } | undefined,
  userId: number | undefined,
  botCtx: BotCtx,
  bot: Telegraf,
): boolean {
  void userId;
  if (!chat?.id) return false;
  if (chat.type !== "private") {
    void bot.telegram
      .sendMessage(chat.id, "This bot only accepts private direct messages (no groups).")
      .catch(() => {});
    return false;
  }
  if (botCtx.allowChats.has(chat.id)) return true;
  if (!botCtx.unauthorizedNotified.has(chat.id)) {
    botCtx.unauthorizedNotified.add(chat.id);
    void bot.telegram
      .sendMessage(chat.id, "Unauthorized chat for this bot deployment.")
      .catch(() => {});
  }
  return false;
}

function intakeIssueOnly(cwd: string, spec: string): {
  runId: string;
  taskId: string;
  title: string;
} {
  const loaded = loadConfig(cwd);
  const repoHint = loaded.config.github.defaultRepo.trim() || undefined;
  const parsed = parseGitHubIssueRef(spec, repoHint);
  if (!parsed) {
    throw new Error(`Could not parse issue ref: ${spec}`);
  }
  const taskId = issueTaskId(parsed);
  const runId = newRunId();
  const { relativeRoot } = resolveArtifactsRoot(loaded);
  const taskDir = ensureRunDir({
    cwd,
    artifactsRootRelative: relativeRoot,
    runId,
  });
  ensureRunLayout(taskDir);
  const fetched = tryFetchGitHubIssueViaGh({
    owner: parsed.owner,
    name: parsed.name,
    number: parsed.number,
    cwd,
  });
  const ghRecord =
    fetched.ok &&
    fetched.rawJson &&
    typeof fetched.rawJson === "object" &&
    !Array.isArray(fetched.rawJson)
      ? (fetched.rawJson as Record<string, unknown>)
      : null;
  const task = ghRecord
    ? buildTaskInputFromGhJson({
        parsed,
        ghJson: ghRecord,
        loaded,
        runId,
        ...(fetched.ok && fetched.defaultBranch
          ? { defaultBranchOverride: fetched.defaultBranch }
          : {}),
      })
    : buildStubTaskInput({
        parsed,
        loaded,
        runId,
        reason: fetched.ok ? "invalid gh json payload" : fetched.reason,
      });
  persistTaskInput(taskDir, task);
  fs.writeFileSync(
    path.join(taskDir, "config.resolved.json"),
    `${JSON.stringify(loaded.config, null, 2)}\n`,
    "utf8",
  );
  return { runId, taskId, title: task.title };
}

function intakeTaskOnly(cwd: string, filePath: string): {
  runId: string;
  taskId: string;
  title: string;
} {
  const loaded = loadConfig(cwd);
  const runId = newRunId();
  const { relativeRoot } = resolveArtifactsRoot(loaded);
  const taskDir = ensureRunDir({
    cwd,
    artifactsRootRelative: relativeRoot,
    runId,
  });
  ensureRunLayout(taskDir);
  const task = buildTaskInputFromMarkdownFile({
    filePath: path.resolve(cwd, filePath),
    loaded,
    runId,
  });
  persistTaskInput(taskDir, task);
  fs.writeFileSync(
    path.join(taskDir, "config.resolved.json"),
    `${JSON.stringify(loaded.config, null, 2)}\n`,
    "utf8",
  );
  const taskId = taskFileTaskId(cwd, filePath);
  return { runId, taskId, title: task.title };
}

async function handleFullRun(args: {
  ctx: BotCtx;
  bot: Telegraf;
  chatId: number;
  userId: number;
  kind: "issue" | "task";
  spec: string;
}): Promise<void> {
  const { ctx, bot, chatId, userId, kind, spec } = args;
  let loaded = loadConfig(ctx.cwd);
  const repoHint = loaded.config.github.defaultRepo.trim() || undefined;
  let taskId: string;
  let runId: string;

  try {
    if (kind === "issue") {
      const parsed = parseGitHubIssueRef(spec, repoHint);
      if (!parsed) {
        await bot.telegram.sendMessage(chatId, `Invalid issue ref: ${spec}`);
        return;
      }
      taskId = issueTaskId(parsed);
      if (ctx.activeTask.has(taskId) || ctx.startingTask.has(taskId) || ctx.restoredRuns.has(taskId)) {
        await bot.telegram.sendMessage(
          chatId,
          `A run for ${taskId} is already active in this bot. Duplicate taskId policy: reject. Use /status or wait for completion.`,
        );
        return;
      }
      ctx.startingTask.add(taskId);
      try {
      runId = newRunId();
      const { relativeRoot } = resolveArtifactsRoot(loaded);
      const taskDir = ensureRunDir({
        cwd: ctx.cwd,
        artifactsRootRelative: relativeRoot,
        runId,
      });
      ensureRunLayout(taskDir);
      const fetched = tryFetchGitHubIssueViaGh({
        owner: parsed.owner,
        name: parsed.name,
        number: parsed.number,
        cwd: ctx.cwd,
      });
      const ghRecord =
        fetched.ok &&
        fetched.rawJson &&
        typeof fetched.rawJson === "object" &&
        !Array.isArray(fetched.rawJson)
          ? (fetched.rawJson as Record<string, unknown>)
          : null;
      const task = ghRecord
        ? buildTaskInputFromGhJson({
            parsed,
            ghJson: ghRecord,
            loaded,
            runId,
            ...(fetched.ok && fetched.defaultBranch
              ? { defaultBranchOverride: fetched.defaultBranch }
              : {}),
          })
        : buildStubTaskInput({
            parsed,
            loaded,
            runId,
            reason: fetched.ok ? "invalid gh json payload" : fetched.reason,
          });
      persistTaskInput(taskDir, task);
      fs.writeFileSync(
        path.join(taskDir, "config.resolved.json"),
        `${JSON.stringify(loaded.config, null, 2)}\n`,
        "utf8",
      );
      } finally {
        ctx.startingTask.delete(taskId);
      }
    } else {
      const abs = path.resolve(ctx.cwd, spec);
      taskId = taskFileTaskId(ctx.cwd, spec);
      if (ctx.activeTask.has(taskId) || ctx.startingTask.has(taskId) || ctx.restoredRuns.has(taskId)) {
        await bot.telegram.sendMessage(
          chatId,
          `Task ${taskId} already active. Duplicate policy: reject.`,
        );
        return;
      }
      ctx.startingTask.add(taskId);
      try {
      runId = newRunId();
      const { relativeRoot } = resolveArtifactsRoot(loaded);
      const taskDir = ensureRunDir({
        cwd: ctx.cwd,
        artifactsRootRelative: relativeRoot,
        runId,
      });
      ensureRunLayout(taskDir);
      const task = buildTaskInputFromMarkdownFile({
        filePath: abs,
        loaded,
        runId,
      });
      persistTaskInput(taskDir, task);
      fs.writeFileSync(
        path.join(taskDir, "config.resolved.json"),
        `${JSON.stringify(loaded.config, null, 2)}\n`,
        "utf8",
      );
      } finally {
        ctx.startingTask.delete(taskId);
      }
    }
  } catch (e) {
    await bot.telegram.sendMessage(
      chatId,
      `Intake failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return;
  }

  const runPromise = runTelegramFullWorkflow({
    ctx,
    bot,
    chatId,
    userId,
    taskId,
    runId,
    reconnect: false,
  });
  ctx.activeTask.set(taskId, runPromise);
  await bot.telegram.sendMessage(
    chatId,
    `Started full run taskId=${taskId} runId=${runId}. Use /reply for freeform consult; approvals use Yes/No buttons.`,
  );
}

async function runTelegramFullWorkflow(args: {
  ctx: BotCtx;
  bot: Telegraf;
  chatId: number;
  userId: number;
  taskId: string;
  runId: string;
  reconnect: boolean;
}): Promise<void> {
  const { ctx, bot, chatId, userId, taskId, runId, reconnect } = args;
  const queue = new TelegramSendQueue(
    {
      sendMessage: async (t) => {
        await bot.telegram.sendMessage(chatId, t.slice(0, 4096));
      },
      sendDocument: async (name, buf) => {
        await bot.telegram.sendDocument(chatId, {
          source: buf,
          filename: name,
        });
      },
    },
    ctx.debug ? 35 : 80,
  );

  const consultTimeoutMs = envTelegramConsultTimeoutMs();
  const bridge = createTelegramUiBridge({
    app: ctx,
    bot,
    chatId,
    consultTimeoutMs,
  });

  let loaded = withConsultHumanEnabled(loadConfig(ctx.cwd), !ctx.autonomous);
  const { paths } = openRun({ cwd: ctx.cwd, runId });

  const consultPort = new TelegramConsultPort({
    taskId,
    consultTimeoutMs,
    sendText: (t) => queue.enqueueText(t),
    bridge,
    pollCancel: () => readState(paths).cancelRequested,
  });

  registerConsultPort(chatId, taskId, consultPort);

  const jsonlPath = path.join(paths.logsDir, "events.jsonl");
  const log = createLogger({
    runId,
    component: "telegram.bot",
    jsonlPath,
    telegramContext: { telegramChatId: chatId, telegramUserId: userId, taskId },
  });
  log.log("info", reconnect ? "telegram_reconnect_started" : "telegram_full_run_started", {
    taskId,
    runId,
  });

  upsertTelegramSession(ctx.sessionFilePath, {
    taskId,
    runId,
    chatId,
    userId,
    updatedAt: new Date().toISOString(),
    cwd: ctx.cwd,
  });

  if (ctx.debug && !envStreamExplicitlyEnabled()) {
    process.env.AGENTIC_MY_APP_STREAM = "1";
  }

  const consultHooks = consultPort.buildHumanConsultHooks(loaded);
  const humanConsultSession: PlanningHumanConsultSession = {
    hooks: consultHooks,
    close: () => {
      unregisterConsultPort(chatId, taskId);
    },
  };

  const streamTap = queue.createStreamTap({
    enabled: ctx.debug,
    flushMs: 450,
    maxBuffer: 2800,
  });

  const rl = createNullReadline();
  try {
    const mergeStrategy = mergeStrategyFromEnv();
    await runInteractiveFull({
      loaded,
      paths,
      autonomous: ctx.autonomous,
      rl,
      mergeStrategy,
      sessionUi: {
        log: (line) => {
          void queue.enqueueText(line);
        },
        confirm: (prompt, meta) => consultPort.confirm(prompt, meta),
      },
      humanConsultSession,
      onAgentStreamChunk: ctx.debug ? streamTap : undefined,
    });

    const st = readState(paths);
    await queue.enqueueText(
      `Run finished for ${taskId}.\nFinal phase: ${st.phase}\nrunId=${runId}`,
    );
    log.log("info", reconnect ? "telegram_reconnect_finished" : "telegram_full_run_finished", {
      phase: st.phase,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.log("error", reconnect ? "telegram_reconnect_failed" : "telegram_full_run_failed", {
      error: msg,
    });
    await queue.enqueueText(`Error for ${taskId}: ${msg}`);
  } finally {
    humanConsultSession.close?.();
    const st = readState(paths);
    if (st.phase === "CANCELLED" || st.cancelRequested) {
      finalizeCancelRunForTelegram(ctx, runId);
    }
    ctx.restoredRuns.delete(taskId);
    ctx.activeTask.delete(taskId);
    rl.close();
  }
}

function scheduleTelegramReconnect(
  app: BotCtx,
  bot: Telegraf,
  rec: TelegramSessionRecord,
): void {
  app.restoredRuns.delete(rec.taskId);
  const runPromise = runTelegramFullWorkflow({
    ctx: app,
    bot,
    chatId: rec.chatId,
    userId: rec.userId,
    taskId: rec.taskId,
    runId: rec.runId,
    reconnect: true,
  });
  app.activeTask.set(rec.taskId, runPromise);
  void runPromise;
  void bot.telegram
    .sendMessage(
      rec.chatId,
      `Reconnected workflow from disk — taskId=${rec.taskId} runId=${rec.runId}. /reply and Yes/No are active again.`,
    )
    .catch(() => {});
}

async function handlePlanRun(
  botCtx: BotCtx,
  bot: Telegraf,
  chatId: number,
  _userId: number,
  runId: string,
): Promise<void> {
  const queue = new TelegramSendQueue(
    {
      sendMessage: async (t) => {
        await bot.telegram.sendMessage(chatId, t.slice(0, 4096));
      },
    },
    botCtx.debug ? 35 : 80,
  );
  const loaded = withConsultHumanEnabled(
    loadConfig(botCtx.cwd),
    !botCtx.autonomous,
  );
  const { paths } = openRun({ cwd: botCtx.cwd, runId });
  const task = readTaskInput(paths);
  let taskId: string;
  if (task.issueNumber !== undefined) {
    taskId = `${task.repo.owner.toLowerCase()}/${task.repo.name.toLowerCase()}#${task.issueNumber}`;
  } else {
    const pathMeta = (task.metadata as Record<string, unknown>).path;
    taskId =
      typeof pathMeta === "string"
        ? taskFileTaskId(botCtx.cwd, pathMeta)
        : runId;
  }

  const consultTimeoutMs = envTelegramConsultTimeoutMs();
  const bridge = createTelegramUiBridge({
    app: botCtx,
    bot,
    chatId,
    consultTimeoutMs,
  });
  const consultPort = new TelegramConsultPort({
    taskId,
    consultTimeoutMs,
    sendText: (t) => queue.enqueueText(t),
    bridge,
    pollCancel: () => readState(paths).cancelRequested,
  });
  registerConsultPort(chatId, taskId, consultPort);
  const humanConsultSession: PlanningHumanConsultSession = {
    hooks: consultPort.buildHumanConsultHooks(loaded),
    close: () => unregisterConsultPort(chatId, taskId),
  };
  try {
    await runPoAndDecomposition({
      loaded,
      paths,
      task,
      autonomous: botCtx.autonomous,
      humanConsultSession,
      onAgentStreamChunk: botCtx.debug
        ? queue.createStreamTap({ enabled: true, flushMs: 400, maxBuffer: 2500 })
        : undefined,
    });
    await queue.enqueueText(`/plan done for ${runId}: ${readState(paths).phase}`);
  } catch (e) {
    await queue.enqueueText(
      `/plan failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    humanConsultSession.close?.();
  }
}

async function handleWorkflowRun(
  botCtx: BotCtx,
  bot: Telegraf,
  chatId: number,
  runId: string,
  followPr: boolean,
): Promise<void> {
  const queue = new TelegramSendQueue(
    {
      sendMessage: async (t) => {
        await bot.telegram.sendMessage(chatId, t.slice(0, 4096));
      },
    },
    50,
  );
  try {
    const loaded = loadConfig(botCtx.cwd);
    const { paths } = openRun({ cwd: botCtx.cwd, runId });
    await advanceWorkflow({
      loaded,
      paths,
      autonomous: botCtx.autonomous,
      followPr,
    });
    await queue.enqueueText(
      `/workflow done runId=${runId} phase=${readState(paths).phase}`,
    );
  } catch (e) {
    await queue.enqueueText(
      `Workflow error: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
