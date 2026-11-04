// Who may make this request, and as whom: rate limit aside, the origin, publishable key and end-user
// checks of a turn (D-23, D-27, D-29, D-31). It answers with the user and the origins the library
// should accept, or with the response that refuses the request.
import type { Context } from "hono";
import { parsePublishableKey, PUBLISHABLE_KEY_HEADER } from "../../keys.js";
import type { AdminDeps } from "../deps.js";
import type { AgentRecord } from "../store/types.js";
import type { Log } from "./audit.js";
import type { createEndUserAuth } from "./end-user-auth.js";
import { corsHeaders, uniform } from "./http.js";
import { previewUserId } from "./preview.js";

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

/** The request's identity as the audit log sees it: set as soon as it is known, so a later denial names the user. */
export type Identity = { userId: string | null };

export type Access =
  | { refused: Response }
  | {
      refused?: undefined;
      /** CORS headers for the answer; empty for the dashboard's own origin and for previews. */
      cors: Record<string, string>;
      /** The origins the library accepts. */
      origins: string[];
    };

export function createAccess(opts: {
  deps: AdminDeps;
  endUser: ReturnType<typeof createEndUserAuth>;
  /** The dashboard's own origin. */
  dashboard: string;
}) {
  const { deps, endUser, dashboard } = opts;

  return async function resolveAccess(
    c: Context,
    row: AgentRecord,
    previewOwner: string | null,
    identity: Identity,
    log: Log,
  ): Promise<Access> {
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
    let cors: Record<string, string> = {};
    let origins: string[] = row.config.allowedOrigins;
    if (previewOwner) {
      identity.userId = previewUserId(previewOwner);
      origins = [dashboard];
      const auth = row.config.auth;
      if (auth?.mode === "jwks" || auth?.mode === "userinfo") {
        // Only the owner sees why a token fails (D-31); end users get the uniform 401 (D-29).
        const given = c.req.header("authorization");
        if (given) {
          const verified = await endUser.verify(auth, given);
          if (!verified.ok) {
            await log({ result: "denied", reason: verified.reason }, "request");
            return { refused: c.json({ error: "unauthorized", reason: verified.reason }, 401) };
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
        return { refused: uniform(c, 403, "forbidden") };
      }
      const refused = await checkKey();
      if (refused) return { refused };
      identity.userId = (await deps.session(c.req.raw))?.id ?? null;
      if (!identity.userId) {
        await log({ result: "denied", reason: "no_session" }, "request");
        return { refused: uniform(c, 401, "unauthorized") };
      }
      origins = [dashboard];
    } else {
      cors = corsHeaders(origin, row.config.allowedOrigins);
      if (origin && !cors["access-control-allow-origin"]) {
        await log({ result: "denied", reason: "origin_not_allowed" }, "request");
        return { refused: uniform(c, 403, "forbidden") };
      }
      const refused = await checkKey();
      if (refused) return { refused };
      const auth = row.config.auth;
      if (auth?.mode === "jwks" || auth?.mode === "userinfo") {
        // D-29. The reason goes to the audit log only; the client learns nothing but 401. CORS
        // headers so the browser lets the chat read the status and ask for a fresh token.
        const verified = await endUser.verify(auth, c.req.header("authorization"));
        if (!verified.ok) {
          await log({ result: "denied", reason: verified.reason }, "request");
          return { refused: uniform(c, 401, "unauthorized", cors) };
        }
        identity.userId = verified.userId;
      } else if (auth?.mode !== "anonymous") {
        return { refused: uniform(c, 501, "not_implemented") };
      }
    }
    return { cors, origins };
  };
}
