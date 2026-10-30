/** Per-turn data passed to graph nodes through `configurable.run`. */
export interface RunContext {
  userId: string;
  context?: unknown;
  /** Host decision for this request (exposeKnowledge); never taken from the request body. */
  exposeKnowledge?: boolean;
  /** The relevance gate's search of the user's message, made once per request. */
  gate?: Promise<boolean>;
}
