import { z } from "zod";

const url = z.string().url();

const knowledgeSchema = z
  .object({
    /** Markdown or plain text you provide. Pass strings: the edge has no filesystem. */
    sources: z
      .array(z.object({ id: z.string().min(1).max(64), title: z.string().min(1).max(200), content: z.string() }))
      .default([]),
    /** Pages the server fetches itself (never model-chosen). Public hosts only unless allowPrivateNetworks. */
    urls: z.array(z.union([url, z.object({ url, title: z.string().max(200).optional() })])).default([]),
    /** OpenAI-compatible /embeddings endpoint. baseUrl and apiKey default to the llm ones. Omit when you pass the `embeddings` option to createAgent. */
    embeddings: z.object({ model: z.string().min(1), baseUrl: url.optional(), apiKey: z.string().min(1).optional() }).optional(),
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
    spec: z.union([z.string(), z.record(z.string(), z.unknown())]),
    baseUrl: url,
    /** OpenAI-compatible endpoint. Give either this or the `model` option of createAgent, never both. */
    llm: z
      .object({
        baseUrl: url,
        apiKey: z.string().min(1, "llm.apiKey is empty; read it from an env var on the server"),
        model: z.string().min(1),
        temperature: z.number().min(0).max(2).optional(),
      })
      .optional(),
    allow: z.array(z.string()).min(1, "allow is empty; list operationIds, tags or globs to expose"),
    allowedOrigins: z.array(z.string().url()).min(1, "allowedOrigins is required"),
    anonymous: z.boolean().optional(),
    allowPrivateNetworks: z.boolean().optional(),
    /** HMAC key for approval tokens. Set it on serverless/multi-instance deployments. */
    approvalSecret: z.string().min(16).optional(),
    instructions: z.string().optional(),
    knowledge: knowledgeSchema.optional(),
    limits: z
      .object({
        maxSteps: z.number().int().positive().default(8),
        callTimeoutMs: z.number().int().positive().default(30_000),
        maxResultBytes: z.number().int().positive().default(64 * 1024),
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
export function parseConfig(input: unknown, hasGetAuth: boolean, injected: { model?: boolean; embeddings?: boolean } = {}): AgentConfig {
  const result = configSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Invalid agent config:\n${lines.join("\n")}`);
  }
  if (!hasGetAuth && !result.data.anonymous) {
    throw new Error("Invalid agent config:\n  - getAuth: provide getAuth(request) or set anonymous: true explicitly");
  }
  const { llm, knowledge } = result.data;
  const fail = (msg: string): never => {
    throw new Error(`Invalid agent config:\n  - ${msg}`);
  };
  if (llm && injected.model) fail("llm and model are mutually exclusive: pass llm for an OpenAI-compatible endpoint, or model for your own chat model");
  if (!llm && !injected.model) fail("no model: pass llm ({ baseUrl, apiKey, model }) or model (a LangChain BaseChatModel)");
  if (knowledge?.embeddings && injected.embeddings) fail("knowledge.embeddings and the embeddings option are mutually exclusive");
  if (knowledge && !knowledge.embeddings && !injected.embeddings) fail("knowledge needs knowledge.embeddings (HTTP endpoint) or the embeddings option");
  if (knowledge?.embeddings && !llm && !(knowledge.embeddings.baseUrl && knowledge.embeddings.apiKey)) {
    fail("knowledge.embeddings needs baseUrl and apiKey when llm is not set");
  }
  return result.data;
}
