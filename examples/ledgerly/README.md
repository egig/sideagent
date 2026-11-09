# Ledgerly: a sideagent demo

A fake invoicing SaaS with a docs section. The sideagent chat is docked beside it and answers from the docs **and** from the signed-in user's account (plan, seats, invoices, a failed payment), which the app passes as page context. All data is fake.

Two things deploy to Cloudflare:

| | What | Config |
| --- | --- | --- |
| `ledgerly-sideagent` | sideagent server + dashboard. Postgres (Neon through Hyperdrive), Workers AI for the model and embeddings. | `wrangler.server.jsonc`, `worker/` |
| `ledgerly-demo` | The Vite React app. Static files. | `wrangler.app.jsonc`, `src/` |

## Deploy

From the repo root: `pnpm install && pnpm build` (this builds `dist/admin-ui`, which the server Worker serves). Then, here:

```sh
pnpm install --ignore-workspace
```

1. **Database.** Create a Neon project, enable `CREATE EXTENSION vector;`, then
   `npx wrangler hyperdrive create ledgerly --connection-string "postgres://…?sslmode=require"` and put the id in `wrangler.server.jsonc`.
2. **Secrets and URL.** Set `PUBLIC_URL` in `wrangler.server.jsonc` to the Worker's URL, then
   `openssl rand -base64 32 | npx wrangler secret put SIDEAGENT_SECRET -c wrangler.server.jsonc`.
   For the first deploy also set `SIGNUP=true` (`wrangler secret put SIGNUP`), so you can create your account.
3. `pnpm deploy:server`. Open it, sign in, then **delete the `SIGNUP` secret** so nobody else can sign up.
4. **Create the agent** (New agent → Setup). Use the built-in model. Add knowledge as URL sources, once the app is deployed: `https://<app>/docs/getting-started.md` and the five other files in `public/docs/`.
5. **Lock it down.** Under allowed origins list only the app's origin. Set a low quota and turn on the bot challenge for anonymous visitors (`challenge` in `createServer`; see Turnstile in the docs).
6. **Deploy the app** with the agent's publishable key: `VITE_SIDEAGENT_KEY=pk_… pnpm deploy:app`.

## Develop

`pnpm dev` runs the app. Without `VITE_SIDEAGENT_KEY` (put it in `.env.local`) the app runs and the chat is hidden. To run against a local server use `pnpm dev` in the repo root (server on :8788) and create an agent there.

## Record the demo

```sh
pnpm demo
```

Runs one Playwright test that records the whole story to `demo/out/demo-Ledgerly-demo/video.webm` (1280×800, about 40 seconds): sign in to the dashboard, create an agent, add the six docs pages, try it in the preview, allow the app's origin and activate, then use the chat inside the app (a payment question, a seats question, a declined off-topic question) and confirm in the dashboard that the agent is live.

It needs no network, key or database. `demo/server.ts` runs the real server and dashboard over an in-memory database, and `demo/script.ts` stands in for the model with scripted answers (and a small embedding that ignores common words). The answers are canned: they show how the product behaves, not how good a model is. Edit `ANSWERS` in `demo/script.ts` to change what is asked and said, and the matching steps in `demo/demo.spec.ts`. Convert to MP4 or GIF with ffmpeg.

## Try these

- "Why did my last payment fail?" (reads the failed charge, cites Payment methods)
- "Can I invite another teammate?" (reads the seat count, cites Teammates and roles)
- "How do I add VAT?" (docs only)
- "Write me a poem." (refused by the relevance gate)

## About the user context

`chatContext()` in `src/data.ts` is sent as page context. The server treats it as **untrusted data** and it never grants permissions, so the agent can read it but not act on it, and a visitor can edit it. That is fine for a demo of fake data; do not put anything in it that the user should not be able to see or forge. A signed, server-verified user context is the planned feature.
