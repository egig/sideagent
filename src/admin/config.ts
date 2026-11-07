// Agent config: input validation per settings section, and the readiness
// check that gates "Go live". Shapes follow PRD 6.1 and 6.2.
import { z } from "zod";
import { checkUrlSyntax } from "./security/url-guard.js";
import { MODE_LABEL, TRACE_LEVELS, type TraceLevel, type LlmConfig, type ReadinessItem } from "./api.js";
import { ALGORITHMS, DEFAULT_ALGORITHMS, INSTRUCTIONS_MAX, NAME_MAX, OFF_TOPIC_MAX, ORIGINS_MAX } from "./limits.js";

export type { LlmConfig, ReadinessItem };

const customerUrl = z
  .string()
  .trim()
  .max(2000)
  .superRefine((v, ctx) => {
    try {
      checkUrlSyntax(v);
    } catch (e) {
      ctx.addIssue({ code: "custom", message: (e as Error).message });
    }
  });

// Exact origins. Plain http only for loopback, so integrators can test locally;
// origins are matched against the browser's Origin header, never fetched.
const origin = z
  .string()
  .trim()
  .superRefine((v, ctx) => {
    let u: URL;
    try {
      u = new URL(v);
    } catch {
      return void ctx.addIssue({ code: "custom", message: `"${v.slice(0, 100)}" is not a URL.` });
    }
    const loopback = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
    if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) {
      return void ctx.addIssue({ code: "custom", message: "Origins must use HTTPS, except localhost." });
    }
    if (u.origin !== v.replace(/\/$/, "").toLowerCase()) {
      ctx.addIssue({ code: "custom", message: "An origin is scheme, host and port only, with no path." });
    }
  })
  .transform((v) => new URL(v).origin);

const name = z.string().trim().min(1, "Name is required.").max(NAME_MAX, `${NAME_MAX} characters at most.`);

export const createInput = z.object({
  name,
});

export const generalInput = z
  .object({
    name,
    allowedOrigins: z
      .array(origin)
      .max(ORIGINS_MAX, `${ORIGINS_MAX} origins at most.`)
      .transform((list) => [...new Set(list)]),
    instructions: z.string().max(INSTRUCTIONS_MAX, `${INSTRUCTIONS_MAX} characters at most.`),
    offTopic: z.string().trim().max(OFF_TOPIC_MAX, `${OFF_TOPIC_MAX} characters at most.`),
  })
  .partial()
  .strict();

const modelId = (label: string) => z.string().trim().min(1, `${label} is required.`).max(200);

export const llmInput = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("builtin") }).strict(),
  z
    .object({
      provider: z.literal("custom"),
      baseUrl: customerUrl,
      model: modelId("Model"),
      embeddingModel: modelId("Embedding model").default("text-embedding-3-small"),
      /** Omitted: keep the stored key. */
      apiKey: z.string().trim().min(8, "That does not look like an API key.").max(1000).optional(),
    })
    .strict(),
]);

const issuer = z.string().trim().min(1, "Issuer is required.").max(200, "200 characters at most.");
const claim = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_.:-]+$/, "Letters, digits and _ . : - only.");

export const authInput = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("jwks"),
      jwksUrl: customerUrl,
      issuer,
      audience: z.string().trim().max(200).default(""),
      acceptAnyAudience: z.boolean().default(false),
      userIdClaim: claim.default("sub"),
      algorithms: z
        .array(z.enum(ALGORITHMS))
        .min(1, "Choose at least one algorithm.")
        .default([...DEFAULT_ALGORITHMS])
        .transform((a) => [...new Set(a)]),
    })
    .strict()
    .refine((a) => a.acceptAnyAudience || a.audience.length > 0, {
      path: ["audience"],
      message: "Audience is required unless any audience is accepted.",
    }),
  z
    .object({
      mode: z.literal("userinfo"),
      url: customerUrl,
      userIdField: claim.default("sub"),
      cacheTtlSeconds: z.number().int().min(0).max(300).default(60),
    })
    .strict(),
  z.object({ mode: z.literal("anonymous") }).strict(),
]);

export type AuthConfig = z.output<typeof authInput>;

export interface AgentConfig {
  allowedOrigins: string[];
  instructions: string;
  /** Markdown reply for a message the knowledge does not back. Absent or empty: the default (and a model-written decline). */
  offTopic?: string;
  /** Null until the integrator sets up their provider (a host without a built-in model). */
  llm: LlmConfig | null;
  auth: AuthConfig | null;
  /** Absent on rows from before D-35: read as `DEFAULT_TRACE_LEVEL`. */
  tracing?: TraceLevel;
}

export const DEFAULT_TRACE_LEVEL: TraceLevel = "metadata";

export const tracingInput = z.object({ level: z.enum(TRACE_LEVELS as [TraceLevel, ...TraceLevel[]]) }).strict();

/** A new agent starts on the host's built-in model when it has one (D-18). */
export const emptyConfig = (builtin = false): AgentConfig => ({
  allowedOrigins: [],
  instructions: "",
  llm: builtin ? { provider: "builtin" } : null,
  auth: null,
  tracing: DEFAULT_TRACE_LEVEL,
});

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "(root)";
    fields[key] ??= issue.message;
  }
  return fields;
}

export interface ReadinessInput {
  /** Indexed or queued; failed sources do not count. */
  knowledgeSources: number;
  failedSources?: number;
  hasLlmKey: boolean;
  /** The host's built-in model name; absent when the host has none. */
  builtinModel?: string;
}

/** What going live needs (D-19): something to answer from, an origin, a model and a way to identify users. */
export function readiness(config: AgentConfig, input: ReadinessInput): ReadinessItem[] {
  const auth = config.auth;
  const content = [
    config.instructions.trim() && "instructions",
    input.knowledgeSources > 0 &&
      `${input.knowledgeSources} knowledge source${input.knowledgeSources === 1 ? "" : "s"}`,
  ].filter(Boolean) as string[];
  const llm = config.llm;
  return [
    {
      id: "content",
      label: "What the agent knows",
      ok: content.length > 0,
      detail:
        (content.length ? content.join(", ") : "Add instructions or knowledge") +
        (input.failedSources
          ? ` (${input.failedSources} source${input.failedSources === 1 ? "" : "s"} failed to index)`
          : ""),
    },
    {
      id: "origins",
      label: "Allowed origins",
      ok: config.allowedOrigins.length > 0,
      detail:
        config.allowedOrigins.length > 0
          ? `${config.allowedOrigins.length} origin${config.allowedOrigins.length === 1 ? "" : "s"}`
          : "None: no browser could embed the chat",
    },
    {
      id: "llm",
      label: "LLM",
      ok: llm?.provider === "builtin" ? input.builtinModel !== undefined : llm !== null && input.hasLlmKey,
      detail: !llm
        ? "Not set up"
        : llm.provider === "builtin"
          ? input.builtinModel !== undefined
            ? `Built-in (${input.builtinModel})`
            : "Built-in model is not available"
          : input.hasLlmKey
            ? llm.model
            : "Your API key is missing",
    },
    {
      id: "auth",
      label: "User auth",
      ok: auth !== null,
      detail: auth ? MODE_LABEL[auth.mode] : "Not chosen",
    },
  ];
}

export const knowledgeInput = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("url"),
      url: customerUrl,
      title: z.string().trim().max(200, "200 characters at most.").optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("text"),
      title: z.string().trim().min(1, "Title is required.").max(200, "200 characters at most."),
      content: z.string().trim().min(1, "Paste some text."),
    })
    .strict(),
]);

/**
 * Rows without a `provider` tag (an endpoint, or nothing) are custom (D-18); a row with no endpoint is not set up.
 * Rows from before D-28 may hold the removed backend proxy mode: no auth mode chosen.
 */
export function normalizeConfig(config: AgentConfig): AgentConfig {
  if ((config.auth as { mode: string } | null)?.mode === "proxy") config = { ...config, auth: null };
  const llm = config.llm as unknown as Record<string, string> | null;
  if (llm?.provider === "builtin") return config;
  return {
    ...config,
    llm: llm?.baseUrl
      ? {
          provider: "custom",
          baseUrl: llm.baseUrl,
          model: llm.model!,
          embeddingModel: llm.embeddingModel ?? "text-embedding-3-small",
        }
      : null,
  };
}
