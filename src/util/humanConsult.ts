/** Matches a single fenced question block the model emits to pause for the operator. */
const ASK_BLOCK =
  /<(AGENTIC_MY_APP_ASK_HUMAN|ORCHESTRATOR_ASK_HUMAN)>\s*([\s\S]*?)\s*<\/\1>/gi;

export function extractAgenticMyAppAskHuman(text: string): string | undefined {
  ASK_BLOCK.lastIndex = 0;
  const m = ASK_BLOCK.exec(text);
  if (!m?.[2]) return undefined;
  const inner = m[2].trim();
  return inner.length ? inner : undefined;
}

export function stripAgenticMyAppAskHumanBlocks(text: string): string {
  return text.replace(ASK_BLOCK, "").trim();
}

export function stringifyToolPayload(input: unknown, maxLen = 2800): string {
  try {
    const s = JSON.stringify(input, null, 0);
    if (s.length <= maxLen) return s;
    return `${s.slice(0, maxLen)}…`;
  } catch {
    return String(input).slice(0, maxLen);
  }
}
