// sideagent/server: the whole server in one call. Dashboard API, the agents' endpoints, sign-in and (with a `ui`)
// the dashboard, behind one `fetch(request)` you mount in Hono, Workers, Next or Node.
//
//   const server = createServer({ database: process.env.DATABASE_URL, publicUrl: "https://agent.example.com", secret });
//   export default server; // Workers; on Node see sideagent/server/node
import { createAuth, type AuthOptions } from "./admin/auth/index.js";
import type { AdminDeps, AdminUser } from "./admin/deps.js";
import { createAdmin } from "./admin/index.js";
import { deriveSecrets } from "./admin/security/crypto.js";
import { dohResolve } from "./admin/security/url-guard.js";
import { createPgStore, type PgDb } from "./admin/store/pg/index.js";
import type { AdminStore } from "./admin/store/types.js";

export type { AdminStore } from "./admin/store/types.js";
export type { PgDb } from "./admin/store/pg/index.js";
export type { AdminUser } from "./admin/deps.js";
export type { BuiltinProvider as BuiltinModel, BuiltinUsage } from "./admin/builtin.js";
export { turnstileChallenge, type Challenge } from "./admin/security/challenge.js";

/** The bundled sign-in: an emailed link always, GitHub and Google when configured. */
export interface BundledSignIn {
  /** Delivers the sign-in link. Without it, links are printed to the log on `localhost` and email sign-in is refused elsewhere. */
  sendMagicLink?: AuthOptions["sendMagicLink"];
  github?: AuthOptions["github"];
  google?: AuthOptions["google"];
  /** Lets new people create an account. Default false: only existing accounts sign in. */
  signup?: boolean;
  /** Request headers that carry the client address. Default `x-forwarded-for`. */
  ipHeaders?: string[];
}

/** Your own sign-in (an SSO proxy, Auth.js...). It replaces the bundled one, and nothing of it loads. */
export interface CustomSignIn {
  /** The signed-in dashboard user of this request, or null. */
  session(request: Request): Promise<AdminUser | null>;
}

export interface ServerOptions {
  /**
   * Where everything is stored: a Postgres URL (with pgvector; Node), a Drizzle Postgres database (Workers with
   * Hyperdrive, PGlite, ...) or your own `AdminStore`. Tables are created and migrated on first use, except for your own store.
   */
  database: string | PgDb | AdminStore;
  /** Public origin of the server, e.g. `https://agent.example.com`. Publishable keys name its host, and dashboard writes must carry it as `Origin`. */
  publicUrl: string;
  /** One master secret, at least 32 characters (`openssl rand -base64 32`). Stored LLM keys and sign-in cookies each use a key derived from it. */
  secret: string;
  /** The dashboard's sign-in. Default: the bundled one, with no providers beyond email. */
  auth?: BundledSignIn | CustomSignIn;
  /** Whose agents a signed-in user sees: users with the same scope share them. Default: one workspace. */
  scope?: AdminDeps["scope"];
  /** The host's own model, offered next to each integrator's endpoint and metered per owner. */
  builtinModel?: AdminDeps["builtin"];
  /** A bot challenge anonymous visitors solve before they chat. Without it, anonymous agents are open. */
  challenge?: AdminDeps["challenge"];
  /** Per-address request limit for the agents' endpoints. Without it a weak per-process limiter applies. */
  rateLimit?: AdminDeps["rateLimit"];
  /** Anonymous messages one agent answers per UTC day. Default 25. */
  anonDailyMessages?: number;
  /** Keeps work alive after the response, e.g. `waitUntil` on a serverless host. */
  background?: AdminDeps["background"];
  /** The client address of a request. Default: the first `x-forwarded-for` entry. */
  clientIp?: AdminDeps["clientIp"];
  /** Hears every failed turn. Errors can echo keys and customer text: log them, never return them. */
  onError?: AdminDeps["onError"];
  /** Serves the dashboard's files; return null for any other request. On Node: `sideagent/server/node`. */
  ui?: (request: Request) => Promise<Response> | null;
  /** Network guard's DNS lookup and outbound fetch. Defaults: DNS over HTTPS and the global `fetch`. */
  resolve?: AdminDeps["resolve"];
  fetch?: typeof fetch;
}

export interface Server {
  fetch(request: Request): Promise<Response>;
  /** Resolves once the database is ready; rejects if it cannot be reached or migrated. */
  ready: Promise<void>;
  /** Closes the database, when the server opened it. */
  close(): Promise<void>;
}

const isStore = (db: ServerOptions["database"]): db is AdminStore =>
  typeof db === "object" && "agents" in db && "migrate" in db;

async function openDatabase(database: string | PgDb): Promise<{ db: PgDb; close: () => Promise<void> }> {
  if (typeof database !== "string") return { db: database, close: async () => {} };
  const [{ drizzle }, { Pool }] = await Promise.all([import("drizzle-orm/node-postgres"), import("pg")]);
  const pool = new Pool({ connectionString: database });
  return { db: drizzle(pool), close: () => pool.end() };
}

function bundled(auth: ServerOptions["auth"]): auth is BundledSignIn | undefined {
  return !auth || !("session" in auth);
}

export function createServer(options: ServerOptions): Server {
  if (!options.database) throw new Error("sideagent: database is required");
  let origin: URL;
  try {
    origin = new URL(options.publicUrl);
  } catch {
    throw new Error("sideagent: publicUrl must be a URL, e.g. https://agent.example.com");
  }
  if (!options.secret) throw new Error("sideagent: secret is required");
  const local = /^(localhost|127\.0\.0\.1)$/.test(origin.hostname);
  const publicUrl = origin.origin;

  let closeDb: () => Promise<void> = async () => {};
  const app = (async () => {
    const { kek, authSecret } = await deriveSecrets(options.secret);
    let store: AdminStore;
    let db: PgDb | undefined;
    if (isStore(options.database)) {
      store = options.database;
    } else {
      const opened = await openDatabase(options.database);
      db = opened.db;
      store = createPgStore(db, { onClose: opened.close });
      closeDb = () => store.close();
      await store.migrate();
    }

    const signIn = options.auth;
    let auth: AdminDeps["auth"];
    let session: AdminDeps["session"];
    if (bundled(signIn)) {
      if (!db) throw new Error("sideagent: with your own AdminStore, pass auth: { session } too");
      const sendMagicLink =
        signIn?.sendMagicLink ??
        (async (email: string, url: string) => {
          if (!local) throw new Error("sideagent: set auth.sendMagicLink to send sign-in emails");
          console.log(`sign-in link for ${email}: ${url}`);
        });
      const created = createAuth({
        db,
        baseURL: publicUrl,
        secret: authSecret,
        sendMagicLink,
        github: signIn?.github,
        google: signIn?.google,
        signup: signIn?.signup,
        ipHeaders: signIn?.ipHeaders,
      });
      auth = created;
      session = created.session;
    } else {
      session = signIn.session;
    }

    return createAdmin({
      store,
      auth,
      session,
      publicUrl,
      secrets: { CONFIG_KEK: kek },
      resolve: options.resolve ?? dohResolve,
      fetch: options.fetch ?? fetch,
      scope: options.scope,
      builtin: options.builtinModel,
      challenge: options.challenge,
      rateLimit: options.rateLimit,
      anonDailyMessages: options.anonDailyMessages,
      background: options.background,
      clientIp: options.clientIp,
      onError: options.onError,
      debug: local,
    });
  })();
  // A rejected `ready` is the caller's to handle; every request also reports it.
  const ready = app.then(() => undefined);
  ready.catch(() => {});

  return {
    ready,
    close: () => app.then(closeDb, closeDb),
    fetch: async (request) => options.ui?.(request) ?? (await app).fetch(request),
  };
}
