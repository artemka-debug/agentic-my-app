import { PassThrough } from "node:stream";
import readlinePromises from "node:readline/promises";

/** Readline interface for non-interactive transports (Telegram); no stdin/stdout I/O. */
export function createNullReadline(): readlinePromises.Interface {
  const input = new PassThrough();
  const output = new PassThrough();
  return readlinePromises.createInterface({ input, output });
}
