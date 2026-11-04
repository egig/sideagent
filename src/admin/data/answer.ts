// Limits and constants for a turn. The prompt rules and the relevance gate live in the library
// (`scope` option of createAgent); runtime.ts passes these in.
export const MESSAGE_MAX = 2000;
export const TOP_K = 5;
/** Cosine floor for a passage to count as relevant. Below it the model is not called at all (D-20). Tune against real questions. */
export const MIN_SCORE = 0.45;
export const OFF_TOPIC =
  "I can only answer questions about this product's documentation. Try asking about how it works or how to set it up.";
