/** Per-turn data passed to graph nodes through `configurable.run`. */
export interface RunContext {
  userId: string;
  headers: Record<string, string>;
  context?: unknown;
  /** Host decision for this request (exposeKnowledge); never taken from the request body. */
  exposeKnowledge?: boolean;
  /** Host decision for this request (dryRun): writes are approved but not sent. */
  dryRun?: boolean;
  /** The relevance gate's search of the user's message, made once per request. */
  gate?: Promise<boolean>;
}

/** What the graph interrupts with when a call needs the user's approval. */
export interface PendingApproval {
  callId: string;
  operationId: string;
  method: string;
  path: string;
  args: unknown;
  token: string;
  expiresAt: number;
}
