// POST /v1/agents/:agentId. It speaks the sideagent wire protocol (SSE events from the
// library's src/protocol.ts).
// Every request carries the agent's publishable key in x-sideagent-key (D-27), the admin's own
// agents included. The key proves nothing; it catches a key used against the wrong agent or host.
// Every turn runs on the library (runtime.ts, D-24), which holds the prompt rules and the relevance
// gate (D-20). Who the end user is depends on the agent's auth mode:
// - anonymous: nobody. No history. Each request is its own user and thread.
// - jwks, userinfo: the bearer token in Authorization, verified by end-user-auth.ts (D-29), names the
//   user, who gets history.
// - The dashboard's own agent (APP_PUBLISHABLE_KEY): the better-auth session cookie, from the dashboard
//   origin only (D-23), then the same.
// - A preview (D-31): the owner, who may paste a token to check the agent's token settings.
//
// This file is the request flow only. Limits: answer.ts. CORS, SSE and error
// bodies: http.ts. Rate limit: rate-limit.ts.
import { Hono, type Context } from "hono";
import { z } from "zod";
import { parsePublishableKey, PUBLISHABLE_KEY_HEADER } from "../../keys.js";
import { normalizeConfig } from "../config.js";
import type { AdminDeps } from "../deps.js";
import { anonAvailable, anonDailyMessages, embeddingKey } from "../llm.js";
import type { AgentRecord, AuditInput } from "../store/types.js";
import { dohResolve } from "../url-guard.js";
import { createRuntime, type Mode } from "./runtime.js";
import { llmErrorCode, previewUserId } from "./preview.js";
import { createEndUserAuth } from "./end-user-auth.js";
import { MESSAGE_MAX } from "./answer.js";
import { corsHeaders, sse, uniform, uniformFrom } from "./http.js";
import { createRequestLimiter } from "./rate-limit.js";
import { checkChallengeToken, CHALLENGE_HEADER, issueChallengeToken } from "./challenge.js";

type Ctx = Context;

const body = z
  .object({ threadId: z.string().max(100).optional(), message: z.string().trim().min(1).max(MESSAGE_MAX) })
  .passthrough();

const historyAction = z.union([
  z.object({ action: z.literal("threads.list") }),
  z.object({ action: z.enum(["threads.get", "threads.delete"]), threadId: z.string().max(100) }),
]);

/** The dashboard assistant's agent ID, from its publishable key; null when unset or invalid. */
const appAgentId = (deps: Pick<AdminDeps, "appPublishableKey">) =>
  deps.appPublishableKey ? (parsePublishableKey(deps.appPublishableKey)?.agentId ?? null) : null;

type KeyProblem = "no_publishable_key" | "bad_publishable_key" | "publishable_key_mismatch";

/** D-27: the key must name this agent. Its host is only for clients; the API may move. Every key is a `live` key (D-30). */
export function publishableKeyProblem(key: string | undefined, agent: { id: string }): KeyProblem | null {
  if (!key) return "no_publishable_key";
  const parts = parsePublishableKey(key);
  if (!parts) return "bad_publishable_key";
  if (parts.agentId !== agent.id) return "publishable_key_mismatch";
  return null;
}

export function dataPlaneRouter(deps: AdminDeps) {
  const app = new Hono();
  const now = deps.now ?? Date.now;
  const limited = createRequestLimiter(now);
  const resolveHost = deps.resolve ?? dohResolve;
  const fetcher = deps.fetch;
  const runtime = createRuntime(deps);
  const endUser = createEndUserAuth({ resolve: resolveHost, fetch: fetcher, now });
  const dashboard = new URL(deps.publicUrl).origin;
  const ipOf = (c: Ctx) =>
    (deps.clientIp ? deps.clientIp(c.req.raw) : c.req.header("x-forwarded-for")?.split(",")[0]?.trim()) ?? "unknown";
  // Users already recorded in agentUser, per process: the insert is idempotent anyway.
  const known = new Set<string>();

  // Records that this user has threads under the agent, so deleting the agent can clear them from outside the database.
  async function track(agentId: string, userId: string) {
    const key = `${agentId}|${userId}`;
    if (known.has(key)) return;
    await deps.store.agents.trackUser(agentId, userId);
    known.add(key);
  }

  async function load(c: Ctx) {
    const row = await deps.store.agents.get(c.req.param("agentId")!);
    return row && { ...row, config: normalizeConfig(row.config) };
  }

  // A preview request is the owner's own, already checked by the control plane. It reaches `turn` through a request
  // object only that code holds, so the public route of the same path always answers 404.
  const previews = new WeakMap<Request, { row: Row; owner: string }>();
  app.post("/__preview", (c) => {
    const p = previews.get(c.req.raw);
    return p ? turn(c, p.row, p.owner) : uniform(c, 404, "not_found");
  });

  app.options("/:agentId", async (c) => {
    const row = await load(c);
    const headers = row ? corsHeaders(c.req.header("origin"), row.config.allowedOrigins) : {};
    return new Response(null, { status: headers["access-control-allow-origin"] ? 204 : 403, headers });
  });

  app.post("/:agentId", async (c) => {
    const row = await load(c);
    // Unknown, draft and disabled agents look the same (D-8).
    if (!row || row.status !== "active" || row.disabledAt) return uniform(c, 404, "not_found");
    return turn(c, row, null);
  });

  type Row = AgentRecord;

  /**
   * One turn. `previewOwner` is the dashboard user trying their own agent (D-31): the control plane
   * has already checked the session, the owner and the dashboard origin, so this skips the status,
   * origin and publishable-key checks, which exist for embedded browsers. The user id becomes
   * "preview:<owner>" whatever the auth mode; a pasted end-user token is still verified (D-29), so
   * the owner can check the token settings, but does not name the user.
   */
  async function turn(c: Ctx, row: Row, previewOwner: string | null): Promise<Response> {
    const started = now();
    const turnId = crypto.randomUUID();
    return run();

    async function run(): Promise<Response> {
      const eventName = (event: string) =>
        !previewOwner ? event : event === "chat.turn" ? "preview.turn" : `preview.${event}`;
      const log = (input: Omit<AuditInput, "agentId" | "event">, event = "chat.turn") =>
        deps.store.audit.recordEvent({
          agentId: row.id,
          event: eventName(event),
          userId,
          durationMs: now() - started,
          ...(event === "chat.turn" && { id: turnId }),
          ...input,
        });

      // Before anything that writes an audit row, so a flood cannot fill the log. Its own
      // rejections are not logged for the same reason.
      const ip = ipOf(c);
      if (await limited(deps.rateLimit, row.id, ip)) return uniform(c, 429, "rate_limited");

      // After the origin check, so a disallowed origin never learns whether its key is valid. A
      // missing key is 401; a wrong one looks like a missing agent (D-8).
      const checkKey = async () => {
        const problem = publishableKeyProblem(c.req.header(PUBLISHABLE_KEY_HEADER), row);
        if (!problem) return null;
        await log({ result: "denied", reason: problem }, "request");
        return problem === "no_publishable_key" ? uniform(c, 401, "unauthorized") : uniform(c, 404, "not_found");
      };

      const origin = c.req.header("origin");
      const isApp = !previewOwner && !!appAgentId(deps) && row.id === appAgentId(deps);
      let userId: string | null = null;
      let cors: Record<string, string> = {};
      // The origins the library accepts.
      let origins: string[] = row.config.allowedOrigins;
      if (previewOwner) {
        userId = previewUserId(previewOwner);
        origins = [dashboard];
        const auth = row.config.auth;
        if (auth?.mode === "jwks" || auth?.mode === "userinfo") {
          // Only the owner sees why a token fails (D-31); end users get the uniform 401 (D-29).
          const given = c.req.header("authorization");
          if (given) {
            const verified = await endUser.verify(auth, given);
            if (!verified.ok) {
              await log({ result: "denied", reason: verified.reason }, "request");
              return c.json({ error: "unauthorized", reason: verified.reason }, 401);
            }
          }
        }
        // The owner is the user a preview turn runs for (D-31), in any status: an agent that has not
        // chosen how users are identified yet has no end user to verify, and still previews for them.
      } else if (isApp) {
        // The cookie also rides along on requests from sibling subdomains (SameSite=Lax), so only
        // the dashboard's own origin counts. Same-origin: no CORS headers needed.
        if (origin !== dashboard) {
          await log({ result: "denied", reason: "origin_not_allowed" }, "request");
          return uniform(c, 403, "forbidden");
        }
        const refused = await checkKey();
        if (refused) return refused;
        userId = (await deps.session(c.req.raw))?.id ?? null;
        if (!userId) {
          await log({ result: "denied", reason: "no_session" }, "request");
          return uniform(c, 401, "unauthorized");
        }
        origins = [dashboard];
      } else {
        cors = corsHeaders(origin, row.config.allowedOrigins);
        if (origin && !cors["access-control-allow-origin"]) {
          await log({ result: "denied", reason: "origin_not_allowed" }, "request");
          return uniform(c, 403, "forbidden");
        }
        const refused = await checkKey();
        if (refused) return refused;
        const auth = row.config.auth;
        if (auth?.mode === "jwks" || auth?.mode === "userinfo") {
          // D-29. The reason goes to the audit log only; the client learns nothing but 401. CORS
          // headers so the browser lets the chat read the status and ask for a fresh token.
          const verified = await endUser.verify(auth, c.req.header("authorization"));
          if (!verified.ok) {
            await log({ result: "denied", reason: verified.reason }, "request");
            return uniform(c, 401, "unauthorized", cors);
          }
          userId = verified.userId;
        } else if (auth?.mode !== "anonymous") {
          return uniform(c, 501, "not_implemented");
        }
      }

      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return uniform(c, 400, "bad_request");
      }
      // An anonymous visitor must hold a solved bot challenge, when this deployment has one set up (D-39).
      const challenge = !userId && !previewOwner ? deps.challenge : undefined;

      // The chat UI's title (D-33). After the origin, key and end-user checks, so it is no more open than a turn.
      if (typeof raw === "object" && raw !== null && "action" in raw && raw.action === "agent.info") {
        // An anonymous agent over a cap would refuse every message: say so, so the chat hides itself (D-38).
        if (userId) return c.json({ name: row.name }, 200, cors);
        const available = await anonAvailable(
          deps,
          { id: row.id, ownerId: row.ownerId, builtin: row.config.llm?.provider === "builtin" },
          new Date(now()),
        );
        return c.json(
          { name: row.name, available, ...(challenge && { challenge: { siteKey: challenge.siteKey } }) },
          200,
          cors,
        );
      }

      if (typeof raw === "object" && raw !== null && "action" in raw && raw.action === "challenge.verify") {
        const proof = "token" in raw && typeof raw.token === "string" && raw.token.length <= 2048 ? raw.token : null;
        if (!challenge || !proof) return uniform(c, 400, "bad_request", cors);
        if (!(await challenge.verify(proof, ip))) {
          await log({ result: "denied", reason: "challenge_failed" }, "request");
          return uniform(c, 403, "challenge_failed", cors);
        }
        const issued = await issueChallengeToken(challenge, row.id, ip, now());
        return c.json({ challengeToken: issued.token, expiresIn: issued.expiresIn }, 200, cors);
      }

      // The turn is logged when its stream ends, so a provider failure shows as one. The library says only
      // "the agent failed"; the owner previewing is told why (D-31), the audit row gets a fixed reason.
      const audited = (res: Response) => {
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        let tail = "";
        let reason: string | null = null;
        const rewrite = (block: string) => {
          if (!block.startsWith("data: ")) return block;
          try {
            const e = JSON.parse(block.slice(6)) as { type?: string; code?: string };
            if (e.type !== "error") return block;
            reason = e.code === "error" ? "llm_error" : (e.code ?? "error");
            const cause = runtime.takeFailure(row.id);
            if (!previewOwner || e.code !== "error" || cause === undefined) return block;
            return `data: ${JSON.stringify({ ...e, code: llmErrorCode(cause) })}`;
          } catch {
            return block;
          }
        };
        const out = res.body!.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              const blocks = (tail + decoder.decode(chunk, { stream: true })).split("\n\n");
              tail = blocks.pop()!;
              if (blocks.length) controller.enqueue(encoder.encode(blocks.map((b) => `${rewrite(b)}\n\n`).join("")));
            },
            async flush(controller) {
              if (tail) controller.enqueue(encoder.encode(rewrite(tail)));
              await log(reason ? { result: "error", reason } : { result: "ok" });
            },
          }),
        );
        return new Response(out, { status: res.status, headers: res.headers });
      };

      // Every turn runs on the library (D-24): prompt rules, the relevance gate (D-20), knowledge search
      // and history all live there. What differs is what this request may use: see Mode in runtime.ts.
      if (typeof raw !== "object" || raw === null) return uniform(c, 400, "bad_request");
      const isMessage = "message" in raw;
      if (challenge && !(await checkChallengeToken(challenge, row.id, ip, c.req.header(CHALLENGE_HEADER), now()))) {
        await log({ result: "denied", reason: "challenge_required" }, "request");
        return uniform(c, 403, "challenge_required", cors);
      }
      // Nobody is signed in: no history.
      if (!userId && "action" in raw) return uniform(c, 501, "not_implemented");
      if (isMessage && !body.safeParse(raw).success) return uniform(c, 400, "bad_request");

      const mode: Mode = userId ? "docs" : "anon";

      if (isMessage) {
        // Anonymous visitors share a daily cap per agent (D-38), before the monthly one so a refused message costs the
        // owner nothing. Custom models are counted too: the owner's provider bills them.
        if (!userId) {
          const daily = await deps.store.usage.consumeAnon(row.id, anonDailyMessages(deps), new Date(now()));
          if (!daily.allowed) {
            await log({ result: "limited", reason: "anon_daily_cap_reached" });
            return uniform(c, 429, "limit_reached", cors);
          }
        }
        // A new message costs one built-in message; approvals and history reads do not. A custom model is billed by
        // its own provider, so it is not counted (D-18, D-30).
        if (row.config.llm?.provider === "builtin" && deps.builtin) {
          const cap = await deps.builtin.consume(row.ownerId, new Date(now()));
          if (!cap.allowed) {
            await log({ result: "limited", reason: "builtin_cap_reached" });
            return uniform(c, 429, "limit_reached");
          }
        }
        // Passages made by another embedding model are skipped by search: say so instead of "off topic".
        if (await deps.store.knowledge.isStale(row.id, embeddingKey(deps, row.config))) {
          await log({ result: "error", reason: "knowledge_stale" });
          return sse(
            [
              { type: "turn.start", threadId: `thr_${crypto.randomUUID()}` },
              { type: "error", code: "knowledge_stale", message: "The knowledge base needs to be re-indexed." },
              { type: "turn.end" },
            ],
            cors,
          );
        }
      }
      // The library checks the origin itself and would answer a server-side caller in its own words.
      if (!origin) {
        await log({ result: "denied", reason: "origin_not_allowed" }, "request");
        return uniform(c, 403, "forbidden");
      }
      // An anonymous visitor is a new user each request, with a new thread.
      const turnUser = userId ?? `anonymous:${crypto.randomUUID()}`;
      const request = new Request(c.req.url, {
        method: "POST",
        headers: c.req.raw.headers,
        body: JSON.stringify(userId ? raw : { ...raw, threadId: undefined }),
      });
      try {
        if (userId) await track(row.id, userId);
        const res = await runtime.handle(row, request, { userId: turnUser }, origins, mode, turnId);
        if (!res.ok) {
          if (isMessage) await log({ result: "error", reason: "runtime_error" });
          return uniformFrom(c, res.status, cors);
        }
        return isMessage ? audited(res) : res;
      } catch {
        await log({ result: "error", reason: "runtime_error" });
        return uniform(c, 503, "unavailable");
      }
    }
  }

  return Object.assign(app, {
    /** One turn for the owner of `row`, from the control plane's preview route (D-31). */
    preview: (request: Request, row: Row, ownerId: string): Promise<Response> | Response => {
      const internal = new Request(new URL("/__preview", request.url), request);
      previews.set(internal, { row, owner: ownerId });
      return app.fetch(internal);
    },
  });
}
