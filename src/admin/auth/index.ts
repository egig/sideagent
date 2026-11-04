// Sign-in for the dashboard's users (integrators), bundled: email magic link always, GitHub and Google when their
// client id and secret are set, no passwords. Runs better-auth on the admin's Postgres tables. Not the end-user auth
// of the data plane (data/end-user-auth.ts); the two never share sessions or secrets (D-1).
// Optional: pass your own `session` to createAdmin instead and none of this loads.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";
import type { AdminUser } from "../deps.js";
import type { PgDb } from "../store/pg/store.js";
import * as schema from "../store/pg/schema.js";

export type SendMagicLink = (email: string, url: string) => Promise<void>;

export const MAGIC_LINK_TTL_SECONDS = 10 * 60;

export interface AuthOptions {
  /** The same Drizzle database the store uses. */
  db: PgDb;
  /** Public origin of the admin, e.g. `https://admin.example.com`. */
  baseURL: string;
  /** Signs cookies and tokens: `openssl rand -base64 32`. */
  secret: string;
  /** Delivers the sign-in link. Throw to fail the request; keep the link out of the error. */
  sendMagicLink: SendMagicLink;
  github?: { clientId: string; clientSecret: string };
  google?: { clientId: string; clientSecret: string };
  /** Lets new people create an account. Default false: only existing accounts sign in. */
  signup?: boolean;
  /** Where the dashboard asks for one click before it spends the link. Default `/verify`: the dashboard's own route, under its base path. */
  confirmPath?: string;
  /** Request headers that carry the client address, for rate limits. Default `x-forwarded-for`. */
  ipHeaders?: string[];
}

// Email scanners prefetch links and would burn the single-use token. The emailed link opens the confirm page instead,
// with better-auth's query moved into the fragment (never sent to a server, so never logged); that page asks for a
// click before calling the verify endpoint (D-3).
export function toConfirmLink(verifyUrl: string, baseURL: string, confirmPath = "/verify"): string {
  const query = new URL(verifyUrl).searchParams.toString();
  return `${new URL(confirmPath, baseURL)}#${query}`;
}

export function createAuth(options: AuthOptions) {
  const disableSignUp = !options.signup;
  const auth = betterAuth({
    appName: "sideagent",
    baseURL: options.baseURL,
    basePath: "/api/auth",
    secret: options.secret,
    database: drizzleAdapter(options.db, { provider: "pg", schema: schema.authTables }),
    emailAndPassword: { enabled: false },
    socialProviders: {
      ...(options.github && { github: { ...options.github, disableSignUp } }),
      ...(options.google && { google: { ...options.google, disableSignUp } }),
    },
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_TTL_SECONDS,
        disableSignUp,
        storeToken: "hashed",
        sendMagicLink: ({ email, url }) =>
          options.sendMagicLink(email, toConfirmLink(url, options.baseURL, options.confirmPath)),
      }),
    ],
    // Processes do not share memory, so the counters live in the database (PRD 6.7).
    rateLimit: { enabled: true, storage: "database", window: 60, max: 100 },
    advanced: { cookiePrefix: "sideagent", ipAddress: { ipAddressHeaders: options.ipHeaders ?? ["x-forwarded-for"] } },
    telemetry: { enabled: false },
  });
  return {
    /** Serves `/api/auth/*`. */
    handler: (request: Request) => auth.handler(request),
    /** The signed-in dashboard user of a request, or null. */
    session: async (request: Request): Promise<AdminUser | null> => {
      const found = await auth.api.getSession({ headers: request.headers });
      if (!found) return null;
      const { id, email, name, image } = found.user;
      return { id, email, name, image };
    },
    providers: { github: Boolean(options.github), google: Boolean(options.google), signup: Boolean(options.signup) },
  };
}

export type BundledAuth = ReturnType<typeof createAuth>;
