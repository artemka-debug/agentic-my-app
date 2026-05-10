import fs from "node:fs";
import type { LoadedConfig } from "../config/loadConfig.js";
import { Markup } from "telegraf";
import type { HumanConsultHooks } from "../sdk/runAgentTurn.js";
import { WorkflowCancelledError } from "../sdk/runAgentTurn.js";

async function raceWithCancel<T>(
  promise: Promise<T>,
  pollCancel?: () => boolean | undefined,
): Promise<T> {
  if (!pollCancel) return promise;
  return new Promise((resolve, reject) => {
    const iv = setInterval(() => {
      try {
        if (pollCancel()) {
          clearInterval(iv);
          reject(new WorkflowCancelledError());
        }
      } catch (err) {
        clearInterval(iv);
        reject(err);
      }
    }, 400);
    promise.then(
      (v) => {
        clearInterval(iv);
        resolve(v);
      },
      (err) => {
        clearInterval(iv);
        reject(err);
      },
    );
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function newChoiceNonce(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function yesNoKeyboard(nonce: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Yes", `agentic:ch:yes:${nonce}`),
      Markup.button.callback("❌ No", `agentic:ch:no:${nonce}`),
    ],
  ]);
}

/** Strip TTY-only suffix; Telegram uses Yes/No instead. */
function stripToolPromptTtySuffix(text: string): string {
  return text
    .replace(
      /\n+Press Enter to continue \(or type a short instruction to send back to the model\)\s*$/i,
      "",
    )
    .trimEnd();
}

function tryPrettyPrintJsonLine(args: string): string {
  const t = args.trim();
  if (
    (t.startsWith("{") && t.endsWith("}")) ||
    (t.startsWith("[") && t.endsWith("]"))
  ) {
    try {
      return JSON.stringify(JSON.parse(t), null, 2);
    } catch {
      /* keep raw */
    }
  }
  return args;
}

/**
 * Best-effort parse of tool-approval prompts from `runAgentTurn` (`Tool:` / `Arguments:`) for one monospace block.
 */
function extractToolApprovalCodeBlock(prompt: string): string {
  const toolM = /^Tool:\s*(.+)$/m.exec(prompt);
  const approveNeedle = "\n\nApprove running tool";
  if (toolM) {
    const argsIdx = prompt.indexOf("\nArguments:\n");
    if (argsIdx !== -1) {
      const bodyStart = argsIdx + "\nArguments:\n".length;
      const end = prompt.indexOf(approveNeedle, bodyStart);
      const args =
        end === -1 ? prompt.slice(bodyStart).trim() : prompt.slice(bodyStart, end).trim();
      const prettyArgs = tryPrettyPrintJsonLine(args);
      return `Tool: ${toolM[1]!.trim()}\n\nArguments:\n${prettyArgs}`;
    }
  }
  return stripToolPromptTtySuffix(prompt);
}

export type InlineKeyboard = ReturnType<typeof Markup.inlineKeyboard>;

/** Immediate Telegram UI (not the outbound text queue). */
export type TelegramConsultBridge = {
  sendHtmlKeyboard: (html: string, keyboard: InlineKeyboard) => Promise<void>;
  sendDocumentKeyboard: (
    filePath: string,
    captionHtml: string,
    keyboard?: InlineKeyboard,
  ) => Promise<void>;
  sendDocumentBufferKeyboard: (
    filename: string,
    content: Buffer,
    captionHtml: string,
    keyboard: InlineKeyboard,
  ) => Promise<void>;
  registerBinaryChoice: (
    nonce: string,
    resolve: (choice: "yes" | "no") => void,
  ) => void;
};

type TextWaiter = {
  resolve: (s: string) => void;
  timeout?: ReturnType<typeof setTimeout>;
};

/**
 * `/reply <taskId>` arms the next text message to satisfy non-binary `question()` consults.
 * Plain messages never consume consult unless armed. Yes/No gates use inline keyboards.
 */
export class TelegramConsultPort {
  private armed = false;
  private readonly waiters: TextWaiter[] = [];

  constructor(
    private readonly opts: {
      taskId: string;
      consultTimeoutMs: number;
      sendText: (t: string) => Promise<void>;
      bridge: TelegramConsultBridge;
      /** When true, abort pending consult waits (e.g. `agentic-my-app cancel` set cancelRequested). */
      pollCancel?: () => boolean | undefined;
    },
  ) {}

  setArmed(on: boolean): void {
    this.armed = on;
  }

  getArmed(): boolean {
    return this.armed;
  }

  /** @returns true if the message was consumed as a consult reply. */
  consumeArmedText(text: string): boolean {
    if (!this.armed) return false;
    const w = this.waiters.shift();
    if (!w) {
      this.armed = false;
      return false;
    }
    this.armed = false;
    if (w.timeout) clearTimeout(w.timeout);
    w.resolve(text);
    return true;
  }

  async waitTextAfterArm(instruction: string): Promise<string> {
    await this.opts.sendText(instruction);
    return raceWithCancel(
      new Promise<string>((res) => {
        const w: TextWaiter = {
          resolve: (s: string) => {
            if (w.timeout) clearTimeout(w.timeout);
            res(s);
          },
        };
        if (this.opts.consultTimeoutMs > 0) {
          w.timeout = setTimeout(() => {
            const idx = this.waiters.indexOf(w);
            if (idx >= 0) this.waiters.splice(idx, 1);
            res("");
          }, this.opts.consultTimeoutMs);
        }
        this.waiters.push(w);
      }),
      this.opts.pollCancel,
    );
  }

  private async waitBinaryChoice(
    deliver: (nonce: string) => Promise<void>,
  ): Promise<boolean> {
    const nonce = newChoiceNonce();
    const outcome = new Promise<"yes" | "no">((resolve) => {
      this.opts.bridge.registerBinaryChoice(nonce, resolve);
    });
    await deliver(nonce);
    return (await raceWithCancel(outcome, this.opts.pollCancel)) === "yes";
  }

  /** Spec / decomposition / other file-backed approvals. */
  async confirm(
    prompt: string,
    meta?: { attachPaths?: string[] },
  ): Promise<boolean> {
    const existing = (meta?.attachPaths ?? []).filter((p) => fs.existsSync(p));
    return this.waitBinaryChoice(async (nonce) => {
      const kb = yesNoKeyboard(nonce);
      const header = `<b>${escapeHtml(this.opts.taskId)}</b>\n\n${escapeHtml(prompt)}`;
      const pathBlock = existing.length
        ? `\n\n${existing.map((p) => `<code>${escapeHtml(p)}</code>`).join("\n")}`
        : "";
      const footer = `\n\nTap <b>Yes</b> to approve or <b>No</b> to decline.`;
      const fullHtml = `${header}${pathBlock}${footer}`.slice(0, 3800);

      if (existing.length === 1) {
        const p0 = existing[0]!;
        const cap = `${header}${pathBlock}${footer}`.slice(0, 1024);
        await this.opts.bridge.sendDocumentKeyboard(p0, cap, kb);
        return;
      }

      for (const pth of existing) {
        await this.opts.bridge.sendDocumentKeyboard(
          pth,
          `<code>${escapeHtml(pth)}</code>\n<i>See message below for approve/decline.</i>`.slice(
            0,
            1024,
          ),
        );
      }

      await this.opts.bridge.sendHtmlKeyboard(fullHtml, kb);
    });
  }

  buildHumanConsultHooks(loaded: LoadedConfig): HumanConsultHooks {
    const ch = loaded.config.workflow.consultHuman;
    const askHumanMarker = ch?.askHumanMarker !== false;
    const pauseBeforeTools = ch?.pauseBeforeTools !== false;
    const confirmAllTools = ch?.confirmAllTools === true;
    const maxConsultRounds = Math.min(
      50,
      Math.max(2, Number(ch?.maxConsultRounds) || 12),
    );

    return {
      askHumanMarker,
      pauseBeforeTools,
      confirmAllTools,
      maxConsultRounds,
      log: async (msg) => {
        await this.opts.sendText(`[${this.opts.taskId}] ${msg}`);
      },
      question: async (prompt) => {
        if (prompt.includes("Approve running tool")) {
          const ok = await this.waitBinaryChoice(async (nonce) => {
            const kb = yesNoKeyboard(nonce);
            const codeFragment = extractToolApprovalCodeBlock(prompt);
            const preInner = escapeHtml(codeFragment.slice(0, 14_000));
            const html =
              `<b>Tool call approval</b> · task <code>${escapeHtml(this.opts.taskId)}</code>\n\n` +
              `<pre>${preInner}</pre>\n\n` +
              `Tap <b>Yes</b> to run the tool or <b>No</b> to skip.`;
            const attach =
              codeFragment.length > 2800 || html.length > 3800;
            if (attach) {
              const caption =
                `<b>Tool call approval</b> · task <code>${escapeHtml(this.opts.taskId)}</code>\n` +
                `Full tool definition + arguments: <code>tool-request.txt</code> (monospace).\n\n` +
                `Tap <b>Yes</b> or <b>No</b> below.`.slice(0, 1024);
              await this.opts.bridge.sendDocumentBufferKeyboard(
                "tool-request.txt",
                Buffer.from(codeFragment, "utf8"),
                caption,
                kb,
              );
            } else {
              await this.opts.bridge.sendHtmlKeyboard(html.slice(0, 4000), kb);
            }
          });
          return ok
            ? ""
            : "Skip this tool; explain briefly to the user.";
        }

        return this.waitTextAfterArm(
          `[${this.opts.taskId}] Human consult:\n\n${prompt}\n\nUse /reply ${this.opts.taskId} then send your reply.`,
        );
      },
    };
  }
}
