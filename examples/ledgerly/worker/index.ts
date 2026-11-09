// The sideagent server for the Ledgerly demo, on Cloudflare Workers: Postgres (Neon via Hyperdrive) for data,
// Workers AI for the model and embeddings. The dashboard comes from static assets (see wrangler.server.jsonc).
import { drizzle } from "drizzle-orm/node-postgres";
import { createServer, type Server } from "sideagent/server";
import type { WorkersAiBinding } from "sideagent/workers-ai";
import { workersAiBuiltin, type MeterNamespace } from "./builtin";

export { BuiltinMeter } from "./builtin";

interface Env {
  AI: WorkersAiBinding;
  BUILTIN_METER: MeterNamespace;
  HYPERDRIVE: { connectionString: string };
  PUBLIC_URL: string;
  SIDEAGENT_SECRET: string;
  SIGNUP?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}

// Visitors are anonymous, so the demo's cost is capped here: messages per owner per UTC month on Workers AI.
const MONTHLY_MESSAGES = 300;

let server: Server | undefined;

export default {
  fetch(request: Request, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    server ??= createServer({
      database: drizzle(env.HYPERDRIVE.connectionString),
      publicUrl: env.PUBLIC_URL,
      secret: env.SIDEAGENT_SECRET,
      background: (work) => ctx.waitUntil(work()),
      builtinModel: workersAiBuiltin(env, MONTHLY_MESSAGES),
      anonDailyMessages: 15,
      auth: {
        // Set SIGNUP=true for the first deploy, create your account, then remove it: only existing accounts sign in.
        signup: env.SIGNUP === "true",
        github:
          env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
            ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
            : undefined,
        // No email service in the demo: the link goes to `wrangler tail`. Fine for a single owner, not for production.
        sendMagicLink: async (email, url) => console.log(`sign-in link for ${email}: ${url}`),
      },
    });
    return server.fetch(request);
  },
};
