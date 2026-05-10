/**
 * Parse the first ```json ... ``` fence from agent output, or parse the whole string.
 */
export function extractJsonObject(text: string): unknown {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = (fence ? fence[1] : text).trim();
  return JSON.parse(raw);
}
