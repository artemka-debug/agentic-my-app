export type DecompositionTask = {
  id: string;
  title: string;
  brief: string;
  dependencies: string[];
};

export type DecompositionDoc = {
  tasks: DecompositionTask[];
  /** Each inner array can run in parallel; batches run in order. */
  parallelBatches: string[][];
  verificationPlan?: string;
  risks?: string[];
};
