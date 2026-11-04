// The host's own model (D-18): the dashboard offers it next to the integrator's endpoint, and the host meters it. On
// Cloudflare it is Workers AI through the AI binding; any host can supply another.
import type { CreateAgentOptions } from "../server/index.js";
import type { Embed } from "./knowledge/ingest.js";

export interface BuiltinUsage {
  /** UTC month, `YYYY-MM`. */
  month: string;
  used: number;
  limit: number;
}

export interface BuiltinProvider {
  /** Names the chat model and the embedding model, for the dashboard and for `embeddingKey` (D-30). */
  model: string;
  embeddingModel: string;
  /** What the library agent runs on: its chat model and query embeddings. `onError` hears provider failures (D-31). */
  models(onError: (error: unknown) => void): Pick<CreateAgentOptions, "model" | "embeddings">;
  /** Embeds knowledge text for indexing. */
  embed: Embed;
  /**
   * Counts one message against the owner's cap. Atomic: concurrent callers cannot overshoot. Called before each new
   * built-in turn, so a refused message costs nothing.
   */
  consume(ownerId: string, now?: Date): Promise<{ allowed: boolean }>;
  /** The owner's use this month, without counting. */
  usage(ownerId: string, now?: Date): Promise<BuiltinUsage>;
}
