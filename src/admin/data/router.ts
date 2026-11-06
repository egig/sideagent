// POST /v1/agents/:agentId. It speaks the sideagent wire protocol (SSE events from the
// library's src/protocol.ts).
// Every request carries the agent's publishable key in x-sideagent-key (D-27), the admin's own
// agents included. The key proves nothing; it catches a key used against the wrong agent or host.
// Every turn runs on the library (runtime.ts, D-24), which holds the prompt rules and the relevance
// gate (D-20). Who the end user is depends on the agent's auth mode:
// - anonymous: nobody. No history list. A visitor continues a conversation only by the unguessable id of its
//   thread, kept in the database for ANON_THREAD_TTL_MS after its last message; without one, each request is a new
//   visitor.
// - jwks, userinfo: the bearer token in Authorization, verified by end-user-auth.ts (D-29), names the
//   user, who gets history.
// - The dashboard's own agent (APP_PUBLISHABLE_KEY): the better-auth session cookie, from the dashboard
//   origin only (D-23), then the same.
// - A preview (D-31): the owner, who may paste a token to check the agent's token settings.
//
// This file is the request flow only. Who may ask: access.ts. Costs and caps: quota.ts. The audit row:
// audit.ts. Limits: limits.ts. CORS, SSE and error bodies: http.ts. Rate limit: rate-limit.ts.
import { Hono, type Context } from "hono";
import { normalizeConfig } from "../config.js";
import type { AdminDeps } from "../deps.js";
import { anonAvailable } from "../llm.js";
import type { AgentRecord, AuditInput } from "../store/types.js";
import { ANON_USER_PREFIX } from "../retention.js";
import { dohResolve } from "../security/url-guard.js";
import { checkChallengeToken, CHALLENGE_HEADER, issueChallengeToken } from "../security/challenge.js";
import { createAccess, type Identity } from "./access.js";
import { auditStream } from "./audit.js";
import { anonUserOf } from "./anon.js";
import { createRuntime, type Mode } from "./runtime.js";
import { createEndUserAuth } from "./end-user-auth.js";
import { corsHeaders, uniform, uniformFrom } from "./http.js";
import { checkMessageQuota } from "./quota.js";
import { createRequestLimiter } from "./rate-limit.js";
import { body } from "./schemas.js";

export { publishableKeyProblem } from "./access.js";

type Ctx = Context;

export function dataPlaneRouter(deps: AdminDeps) {
  const app = new Hono();
  const now = deps.now ?? Date.now;
  const limited = createRequestLimiter(now);
  const resolveHost = deps.resolve ?? dohResolve;
  const fetcher = deps.fetch;
  const runtime = createRuntime(deps);
  const endUser = createEndUserAuth({ resolve: resolveHost, fetch: fetcher, now });
  const dashboard = new URL(deps.publicUrl).origin;
  const access = createAccess({ deps, endUser, dashboard });
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
    const identity: Identity = { userId: null };
    const eventName = (event: string) =>
      !previewOwner ? event : event === "chat.turn" ? "preview.turn" : `preview.${event}`;
    const log = (input: Omit<AuditInput, "agentId" | "event">, event = "chat.turn") =>
      deps.store.audit.recordEvent({
        agentId: row.id,
        event: eventName(event),
        userId: identity.userId,
        durationMs: now() - started,
        ...(event === "chat.turn" && { id: turnId }),
        ...input,
      });

    // Before anything that writes an audit row, so a flood cannot fill the log. Its own
    // rejections are not logged for the same reason.
    const ip = ipOf(c);
    if (await limited(deps.rateLimit, row.id, ip)) return uniform(c, 429, "rate_limited");

    const refused = await access(c, row, previewOwner, identity, log);
    if (refused.refused) return refused.refused;
    const { cors, origins } = refused;
    const userId = identity.userId;
    const origin = c.req.header("origin");

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

    const audited = (res: Response) =>
      auditStream(res, { previewOwner, takeFailure: () => runtime.takeFailure(row.id), log });

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
      const refusal = await checkMessageQuota(c, deps, row, userId, cors, now, log);
      if (refusal) return refusal;
    }
    // The library checks the origin itself and would answer a server-side caller in its own words.
    if (!origin) {
      await log({ result: "denied", reason: "origin_not_allowed" }, "request");
      return uniform(c, 403, "forbidden");
    }
    // An anonymous visitor is whoever holds the id of a live thread of theirs; otherwise a new one with a new thread.
    // A stale or foreign id makes the library answer 404, as for a signed-in user.
    const priorAnon = userId || !isMessage ? null : anonUserOf((raw as { threadId?: unknown }).threadId);
    const turnUser = userId ?? priorAnon ?? `${ANON_USER_PREFIX}${crypto.randomUUID()}`;
    const request = new Request(c.req.url, {
      method: "POST",
      headers: c.req.raw.headers,
      body: JSON.stringify(userId || priorAnon ? raw : { ...raw, threadId: undefined }),
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

  return Object.assign(app, {
    /** One turn for the owner of `row`, from the control plane's preview route (D-31). */
    preview: (request: Request, row: Row, ownerId: string): Promise<Response> | Response => {
      const internal = new Request(new URL("/__preview", request.url), request);
      previews.set(internal, { row, owner: ownerId });
      return app.fetch(internal);
    },
  });
}
