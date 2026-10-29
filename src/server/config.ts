import { z } from "zod";

const url = z.string().url();
/** Used for every HTTP call to the endpoint, e.g. a guarded fetch that blocks private hosts. */
const customFetch = z.custom<typeof fetch>((v) => typeof v === "function", "fetch must be a function");

const knowledgeSchema = z
  .object({
    /** Markdown or plain text you provide. Pass strings: the edge has no filesystem. */
    sources: z
      .array(z.object({ id: z.string().min(1).max(64), title: z.string().min(1).max(200), content: z.string() }))
      .default([]),
    /** Pages the server fetches itself (never model-chosen). Public hosts only unless allowPrivateNetworks. */
    urls: z.array(z.union([url, z.object({ url, title: z.string().max(200).optional() })])).default([]),
    /** OpenAI-compatible /embeddings endpoint. baseUrl and apiKey default to the llm ones. Omit when you pass the `embeddings` option to createAgent. */
    embeddings: z
      .object({
        model: z.string().min(1),
        baseUrl: url.optional(),
        apiKey: z.string().min(1).optional(),
        fetch: customFetch.optional(),
        maxRetries: z.number().int().min(0).max(6).optional(),
      })
      .optional(),
    topK: z.number().int().min(1).max(12).default(4),
    ttlMs: z.number().int().positive().default(3_600_000),
    maxSourceBytes: z.number().int().positive().default(200_000),
    maxChunks: z.number().int().positive().default(2000),
    chunkSize: z.number().int().min(200).max(4000).default(800),
  })
  .strict()
  .refine((k) => k.sources.length + k.urls.length > 0, { message: "knowledge needs at least one source or url" });

export const configSchema = z
  .object({
    /** OpenAPI spec. Required with `allow`; a knowledge-only agent leaves it out. */
    spec: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
    /** Where your API lives. Required with `allow`. */
    baseUrl: url.optional(),
    /** OpenAI-compatible endpoint. Give either this or the `model` option of createAgent, never both. */
    llm: z
      .object({
        baseUrl: url,
        apiKey: z.string().min(1, "llm.apiKey is empty; read it from an env var on the server"),
        model: z.string().min(1),
        temperature: z.number().min(0).max(2).optional(),
        fetch: customFetch.optional(),
        /** Retries after a failed call. Default: the client's own (several, with backoff). 0 fails at once. */
        maxRetries: z.number().int().min(0).max(6).optional(),
      })
      .optional(),
    /** Operations to expose (default-deny). Empty only for a knowledge-only agent. */
    allow: z.array(z.string()).default([]),
    allowedOrigins: z.array(z.string().url()).min(1, "allowedOrigins is required"),
    anonymous: z.boolean().optional(),
    allowPrivateNetworks: z.boolean().optional(),
    /** HMAC key for approval tokens. Set it on serverless/multi-instance deployments. */
    approvalSecret: z.string().min(16).optional(),
    instructions: z.string().optional(),
    /**
     * Keeps the agent on its documentation and operations. Adds fixed scope rules to the system prompt and a
     * relevance gate: a turn that no passage scoring at least `minScore` and no operation backs is answered
     * with `offTopic` and the model's text never reaches the user. Needs `knowledge`.
     */
    scope: z
      .object({
        minScore: z.number().min(0).max(1).default(0.45),
        offTopic: z
          .string()
          .min(1)
          .max(500)
          .default(
            "I can only answer questions about this product's documentation. Try asking about how it works or how to set it up.",
          ),
        /**
         * Have the model write the off-topic reply, in the user's language, instead of sending `offTopic`. The
         * model sees only the last user message, with no tools or passages. `offTopic` stays the fallback. Costs
         * one model call per off-topic turn.
         */
        naturalReply: z.boolean().default(false),
      })
      .strict()
      .optional(),
    /**
     * Replaces older messages of a long thread with a model-written summary once the thread passes `afterTokens`
     * (approximate count). The last `keepMessages` messages stay as they are. Off by default.
     */
    summarize: z
      .object({
        afterTokens: z.number().int().positive().default(8000),
        keepMessages: z.number().int().positive().default(20),
      })
      .strict()
      .optional(),
    knowledge: knowledgeSchema.optional(),
    limits: z
      .object({
        maxSteps: z.number().int().positive().default(8),
        callTimeoutMs: z.number().int().positive().default(30_000),
        maxResultBytes: z
          .number()
          .int()
          .positive()
          .default(64 * 1024),
        turnTimeoutMs: z.number().int().positive().default(120_000),
        maxConcurrentTurnsPerUser: z.number().int().positive().default(2),
        maxTools: z.number().int().positive().default(40),
      })
      .default({
        maxSteps: 8,
        callTimeoutMs: 30_000,
        maxResultBytes: 64 * 1024,
        turnTimeoutMs: 120_000,
        maxConcurrentTurnsPerUser: 2,
        maxTools: 40,
      }),
  })
  .strict();

export type AgentConfigInput = z.input<typeof configSchema>;
export type AgentConfig = z.output<typeof configSchema>;

/** Validates config; also requires getAuth or anonymous:true (checked by caller with the function in hand). */
export function parseConfig(
  input: unknown,
  hasGetAuth: boolean,
  injected: { model?: boolean; embeddings?: boolean } = {},
): AgentConfig {
  const result = configSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Invalid agent config:\n${lines.join("\n")}`);
  }
  if (!hasGetAuth && !result.data.anonymous) {
    throw new Error("Invalid agent config:\n  - getAuth: provide getAuth(request) or set anonymous: true explicitly");
  }
  const { llm, knowledge, allow, scope } = result.data;
  const fail = (msg: string): never => {
    throw new Error(`Invalid agent config:\n  - ${msg}`);
  };
  if (allow.length === 0 && !knowledge) fail("allow is empty; list operationIds, tags or globs to expose");
  if (allow.length > 0 && !(result.data.spec && result.data.baseUrl)) fail("allow needs spec and baseUrl");
  if (scope && !knowledge) fail("scope needs knowledge");
  // A turn adds up to two messages per step plus the user's. Keeping that many keeps the current turn whole.
  const { summarize, limits } = result.data;
  if (summarize && summarize.keepMessages < limits.maxSteps * 2 + 1)
    fail(`summarize.keepMessages must be at least limits.maxSteps * 2 + 1 (${limits.maxSteps * 2 + 1})`);
  if (llm && injected.model)
    fail(
      "llm and model are mutually exclusive: pass llm for an OpenAI-compatible endpoint, or model for your own chat model",
    );
  if (!llm && !injected.model)
    fail("no model: pass llm ({ baseUrl, apiKey, model }) or model (a LangChain BaseChatModel)");
  if (knowledge?.embeddings && injected.embeddings)
    fail("knowledge.embeddings and the embeddings option are mutually exclusive");
  if (knowledge && !knowledge.embeddings && !injected.embeddings)
    fail("knowledge needs knowledge.embeddings (HTTP endpoint) or the embeddings option");
  if (knowledge?.embeddings && !llm && !(knowledge.embeddings.baseUrl && knowledge.embeddings.apiKey)) {
    fail("knowledge.embeddings needs baseUrl and apiKey when llm is not set");
  }
  return result.data;
}
