// What the admin needs from its host. Everything the admin cannot decide for itself is here: who is signed in, where
// secrets come from and which network it may reach.
import type { CryptoEnv } from "./security/crypto.js";
import type { Resolve } from "./security/url-guard.js";
import type { AdminStore } from "./store/types.js";
import type { BuiltinProvider } from "./builtin.js";
import type { Challenge } from "./security/challenge.js";

export interface AdminUser {
  id: string;
  email?: string;
  name?: string;
  image?: string | null;
}

/** The scope every user shares when `scope` is not set. */
export const DEFAULT_SCOPE = "workspace";

export interface AdminDeps {
  store: AdminStore;
  /** The bundled sign-in (`createAuth` from `sideagent/admin/auth`). Mounts `/api/auth/*`. Without it, serve your own sign-in. */
  auth?: {
    handler(request: Request): Promise<Response>;
    providers: { github: boolean; google: boolean; signup: boolean };
  };
  /** The signed-in dashboard user of this request, or null. Plug in better-auth, Auth.js, an SSO proxy... */
  session(request: Request): Promise<AdminUser | null>;
  /**
   * Whose agents a signed-in user sees: users with the same scope share them. Default: one workspace, so every
   * signed-in user shares every agent. Return `user.id` for one workspace per user, or an organisation id for teams.
   * Another scope's agent answers like a missing one (D-9).
   */
  scope?: (user: AdminUser, request: Request) => string | Promise<string>;
  /** Public origin of the admin, e.g. `https://admin.example.com`. Writes must carry it as `Origin` (D-10); publishable keys name its host. */
  publicUrl: string;
  /** Holds `CONFIG_KEK`, the key that wraps every stored secret (D-12). */
  secrets: CryptoEnv;
  /** DNS for the SSRF guard (D-11). On Workers: `dohResolve`. */
  resolve: Resolve;
  fetch: typeof fetch;
  /** The host's own model, offered next to the integrator's endpoint and metered per owner (D-18). New agents start on it. */
  builtin?: BuiltinProvider;
  /** A bot challenge that anonymous visitors must solve before they chat (D-39). Without it, anonymous agents are open. */
  challenge?: Challenge;
  /** Anonymous messages one agent answers per UTC day (D-38). Default 25. */
  anonDailyMessages?: number;
  /** Starts work after the response and keeps it alive, e.g. `waitUntil` on a serverless host. Default: start it at once and let it run. */
  background?: (work: () => Promise<unknown>) => void;
  /** Deletes a user's threads under an agent: when the agent is deleted and when a preview is cleared. */
  destroyThreads?: (agentId: string, userId: string) => Promise<void>;
  /** One data-plane turn for the agent's owner (D-31). Set by the data plane. */
  preview?: (
    request: Request,
    agent: import("./store/types.js").AgentRecord,
    ownerId: string,
  ) => Promise<Response> | Response;
  /** Per-address request limit for the data plane (D-37). Without it a weak per-process limiter applies. */
  rateLimit?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** The client address of a request, for rate limits. Default: the first `x-forwarded-for` entry; behind a proxy that sets another header, read that. */
  clientIp?: (request: Request) => string | undefined;
  /** The dashboard's own assistant: its publishable key. Its requests carry the dashboard session instead of an end-user token (D-23). */
  appPublishableKey?: string;
  now?: () => number;
  /** Hears every failed turn: the agent, an error code and the error itself, which can echo keys and customer text, so log it, never return it. */
  onError?: (info: { agentId: string; code: string; threadId?: string; error: unknown }) => void;
  /** Logs on `localhost` only; production errors may echo request details. */
  debug?: boolean;
}
