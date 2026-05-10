import readlinePromises from "node:readline/promises";

/** Minimal readline for `runInteractiveFull` when I/O is fully overridden (e.g. Telegram). */
export function createStubReadline(): readlinePromises.Interface {
  return {
    question: async () => "",
    setPrompt: () => {},
    pause: () => {},
    resume: () => {},
    close: () => {},
  } as unknown as readlinePromises.Interface;
}
