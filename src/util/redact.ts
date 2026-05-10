/**
 * Best-effort secret redaction for persisted logs/transcripts.
 * Does not guarantee zero leakage; prefer env vars and never echo keys.
 */
export function redactSecrets(text: string): string {
  let out = text;
  const patterns: Array<{ re: RegExp; replace: string }> = [
    { re: /cursor_[a-zA-Z0-9_-]{20,}/gi, replace: "cursor_<redacted>" },
    { re: /ghp_[a-zA-Z0-9]{20,}/gi, replace: "ghp_<redacted>" },
    { re: /github_pat_[a-zA-Z0-9_]+/gi, replace: "github_pat_<redacted>" },
    { re: /xox[baprs]-[a-zA-Z0-9-]+/gi, replace: "xox_<redacted>" },
    { re: /Bearer\s+[a-zA-Z0-9._-]+/gi, replace: "Bearer <redacted>" },
    /** Telegram bot API tokens (digits:secret). */
    {
      re: /\b\d{8,}:[A-Za-z0-9_-]{30,}\b/g,
      replace: "telegram_bot_token_<redacted>",
    },
    {
      re: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g,
      replace: "<redacted private key>",
    },
  ];
  for (const p of patterns) {
    out = out.replace(p.re, p.replace);
  }
  return out;
}
