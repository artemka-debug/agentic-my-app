/** Telegram message chunk size (Bot API limit). */
export const TELEGRAM_MAX_MESSAGE = 4096;

export function chunkUtf16(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += max) {
    parts.push(text.slice(i, i + max));
  }
  return parts;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type TelegramSender = {
  sendMessage: (text: string) => Promise<void>;
  sendDocument?: (filename: string, content: Buffer) => Promise<void>;
};

/**
 * Serialized outbound sends with spacing and retry on flood/wait.
 */
export class TelegramSendQueue {
  private tail: Promise<void> = Promise.resolve();
  private lastSendAt = 0;

  constructor(
    private readonly sender: TelegramSender,
    private readonly minIntervalMs: number,
  ) {}

  enqueueText(text: string): Promise<void> {
    const trimmed = text.trimEnd();
    const body =
      trimmed.length > TELEGRAM_MAX_MESSAGE * 12
        ? `${trimmed.slice(0, TELEGRAM_MAX_MESSAGE * 12 - 80)}\n\n… (truncated for Telegram; see run transcripts on disk.)`
        : trimmed;
    const chunks = chunkUtf16(body, TELEGRAM_MAX_MESSAGE);
    const job = async () => {
      for (let i = 0; i < chunks.length; i += 1) {
        const c = chunks[i]!;
        await this.gap();
        let attempt = 0;
        while (true) {
          try {
            if (
              i === 0 &&
              body.length > 11000 &&
              this.sender.sendDocument &&
              chunks.length > 4
            ) {
              await this.sender.sendDocument(
                "stream.txt",
                Buffer.from(body, "utf8"),
              );
              break;
            }
            await this.sender.sendMessage(c);
            break;
          } catch (e) {
            attempt += 1;
            if (attempt > 6) throw e;
            const msg = e instanceof Error ? e.message : String(e);
            const wait = msg.includes("429") || /retry after/i.test(msg)
              ? 3000 * attempt
              : 800 * attempt;
            await sleep(wait);
          }
        }
      }
    };
    this.tail = this.tail.then(job, job);
    return this.tail;
  }

  /** Coalesce stream chunks: throttle flushes to Telegram. */
  createStreamTap(args: {
    enabled: boolean;
    flushMs: number;
    maxBuffer: number;
  }): (chunk: string) => void {
    if (!args.enabled) return () => {};
    let buf = "";
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (!buf) return;
      const t = buf;
      buf = "";
      void this.enqueueText(t);
    };
    return (chunk: string) => {
      if (!chunk) return;
      buf += chunk;
      if (buf.length >= args.maxBuffer) flush();
      else if (!timer) {
        timer = setTimeout(flush, args.flushMs);
      }
    };
  }

  private async gap(): Promise<void> {
    const now = Date.now();
    const wait = this.lastSendAt + this.minIntervalMs - now;
    if (wait > 0) await sleep(wait);
    this.lastSendAt = Date.now();
  }
}
