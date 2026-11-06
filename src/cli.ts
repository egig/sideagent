#!/usr/bin/env node
// `npx sideagent`: the server from environment variables (a `.env` in the working directory is read too).
// The same as createServer from sideagent/server/node.
//   SIDEAGENT_SECRET   at least 32 characters, required in production (openssl rand -base64 32)
//   DATABASE_URL       Postgres with pgvector; without it, an in-memory database that dies with the process (dev only)
//   PUBLIC_URL         the server's public origin, default http://localhost:$PORT
//   PORT               default 8788
//   SIDEAGENT_LOG_SIGN_IN_LINKS   "true" prints email sign-in links to the log (no mail sender here; anyone who reads the log can sign in)
//   SIGNUP             "true" lets new people create accounts
//   LLM_API_KEY / LLM_MODEL / EMBEDDING_MODEL   turn on the built-in model (any OpenAI-compatible API); all three required
//   LLM_BASE_URL   optional, default OpenAI; BUILTIN_MONTHLY_LIMIT   messages per owner per month, default 100 (counted in memory)
//   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET   social sign-in
import { createServer } from "./create-server-node.js";
import type { PgDb } from "./admin/store/pg/index.js";
import { builtinModelFromEnv } from "./cli-builtin.js";

// A `.env` in the working directory fills in what the shell did not set (real environment variables win).
// Needs Node 20.12+; missing file or older Node is fine.
try {
  process.loadEnvFile?.(".env");
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}

const env = process.env;
const production = env.NODE_ENV === "production";
const port = Number(env.PORT ?? 8788);

function fail(message: string): never {
  console.error(`sideagent: ${message}`);
  process.exit(1);
}

const secret = env.SIDEAGENT_SECRET ?? (production ? fail("SIDEAGENT_SECRET is required in production") : undefined);
if (!secret)
  console.warn("SIDEAGENT_SECRET is not set: using a throwaway one, sessions and stored keys die with this process.");

let database: string | PgDb;
if (env.DATABASE_URL) {
  database = env.DATABASE_URL;
} else {
  if (production) fail("DATABASE_URL is required in production");
  const [{ PGlite }, { vector }, { drizzle }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("@electric-sql/pglite-pgvector"),
    import("drizzle-orm/pglite"),
  ]).catch(() => fail("set DATABASE_URL, or install @electric-sql/pglite for an in-memory database"));
  database = drizzle(new PGlite({ extensions: { vector } })) as unknown as PgDb;
  console.warn("DATABASE_URL is not set: using an in-memory database, data is lost on exit.");
}

const pair = (id?: string, secret?: string) => (id && secret ? { clientId: id, clientSecret: secret } : undefined);

const server = createServer({
  database,
  publicUrl: env.PUBLIC_URL ?? `http://localhost:${port}`,
  secret: secret ?? crypto.randomUUID() + crypto.randomUUID(),
  auth: {
    signup: env.SIGNUP === "true",
    sendMagicLink:
      env.SIDEAGENT_LOG_SIGN_IN_LINKS === "true"
        ? async (email, url) => console.log(`sign-in link for ${email}: ${url}`)
        : undefined,
    github: pair(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET),
    google: pair(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
  },
  builtinModel: builtinModelFromEnv(env),
  onError: ({ agentId, code }) => console.error("agent turn error", { agentId, code }),
});

await server.ready.catch((e) => fail(`could not start: ${e instanceof Error ? e.message : e}`));
await server.listen(port);
console.log(`sideagent on ${env.PUBLIC_URL ?? `http://localhost:${port}`}`);
