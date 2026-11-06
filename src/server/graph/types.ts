/** Per-turn data passed to graph nodes through `configurable.run`. */
export interface RunContext {
  userId: string;
  context?: unknown;
  /** Host decision for this request (exposeKnowledge); never taken from the request body. */
  exposeKnowledge?: boolean;
  /** The relevance gate's search of the user's message, made once per request. */
  gate?: Promise<GateVerdict>;
}

/**
 * What the relevance gate decides for a turn.
 * - grounded: the user's message alone matches the documentation.
 * - uncertain: only a weaker match, or one that needs the earlier messages (a follow-up, an ambiguous
 *   question). The model decides, with the scope rules, and may ask what the user means.
 * - off: nothing close in the documentation; the fixed reply is sent and the model is not called.
 */
export type GateVerdict = "grounded" | "uncertain" | "off";
