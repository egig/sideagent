---
sidebar_position: 13
title: Self-hosting
---

This guide takes you from nothing to a docs chat on your own site, answered by a [sideagent server](./server.md) you run yourself. You get a dashboard to manage the agent and an endpoint your site talks to. Plan on 20 minutes.

What you run: Postgres with pgvector, and one Node process (the admin) that serves the dashboard, the dashboard API and the agent endpoint `/v1/agents/:id`. What you bring: a domain with HTTPS, and an API key for an OpenAI-compatible model provider.

## 1. Get the code

The Docker setup lives in the sideagent repository.

```sh
git clone https://github.com/egig/sideagent.git
cd sideagent
```

If you want the admin inside your own server instead, skip to [Embed the server in your own code](#embed-the-server-in-your-own-code).

## 2. Set the secrets

Create `.env` next to `docker-compose.yml`:

```sh
SIDEAGENT_SECRET=...     # openssl rand -base64 32
POSTGRES_PASSWORD=...    # anything long and random
ADMIN_PUBLIC_URL=https://admin.example.com
```

| Variable | What it does |
|---|---|
| `SIDEAGENT_SECRET` | The master secret: signs sessions and wraps every stored LLM key. Change it and everyone is signed out. **Lose it and the stored keys are unreadable.** Keep a copy outside the server. |
| `POSTGRES_PASSWORD` | The compose file defaults to `sideagent`. Change it if the database port is reachable by anyone. |
| `ADMIN_PUBLIC_URL` | The exact URL people type in the browser, with scheme and no trailing slash. Sign-in links and the origin check on dashboard writes use it. Wrong value: sign-in links point to the wrong host and saves fail with an origin error. |
| `SIGNUP` | `false` stops new accounts. See step 4. |

Production refuses to start without `SIDEAGENT_SECRET`.

## 3. Start it

```sh
docker compose up -d --build
docker compose logs -f admin
```

Wait for `sideagent on https://admin.example.com`. The migrations run on every start, so there is no separate step. Check health:

```sh
curl http://localhost:8788/api/health
```

The compose file also publishes Postgres on host port 5433 (`POSTGRES_PORT`). Remove that `ports` entry from the `db` service if you do not need it from outside Docker.

## 4. Put HTTPS in front

The admin speaks plain HTTP on port 8788 (`ADMIN_PORT`). Terminate TLS in a reverse proxy and point it there. Agent replies are server-sent events, so turn buffering off for the agent route.

```nginx
server {
  server_name admin.example.com;
  # listen 443 ssl; certificates: certbot, Cloudflare, your load balancer

  location / {
    proxy_pass http://127.0.0.1:8788;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
  location /v1/ {
    proxy_pass http://127.0.0.1:8788;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_buffering off;
    proxy_read_timeout 180s;
  }
}
```

The admin reads the client address from `x-forwarded-for` for rate limits. Make your proxy overwrite that header, never append to one sent by the client.

## 5. Create your account

The compose file has no mail server, so it prints sign-in links to the log (`SIDEAGENT_LOG_SIGN_IN_LINKS`):

1. Open `https://admin.example.com`, enter your email.
2. Run `docker compose logs admin` and copy the line `sign-in link for you@example.com: …`.
3. Open the link and click through. Links are single use.

Then close sign-up. By default anyone who can reach the dashboard can create an account, and every account shares every agent. Add `SIGNUP=false` to `.env` and run `docker compose up -d`. Existing accounts still sign in; new ones are refused. To add a teammate later, set `SIGNUP=true`, let them sign in once, and set it back.

For GitHub or Google sign-in set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (or the Google pair) and remove `SIDEAGENT_LOG_SIGN_IN_LINKS`. To send real email, [run your own server](#embed-the-server-in-your-own-code) with `auth.sendMagicLink`.

## 6. Create the agent

In the dashboard choose **New agent**. The agent starts inactive: its endpoint answers 404 until you turn it on. The dashboard opens its **Setup** page, five steps in the order they depend on each other. Each step opens once the one before it is done, and progress is read from the server, so you can leave and come back.

1. **Connect a model**. Set the provider base URL (OpenAI-compatible, HTTPS), the chat model, the embedding model and the API key, save, then **Test and continue**: one tiny chat call and one embedding call show a wrong key or model before any knowledge fails to index. The model must support tool calling, because the knowledge search is a tool. The key is encrypted and never shown again.
2. **Add knowledge**. Add web pages (public HTTPS only) or paste Markdown, and optional instructions. Wait until each source says *Indexed*. A *Failed* source usually means the page is not public; saving a new API key retries failed sources.
3. **Try it**. Open the preview and ask what your users would ask. The step completes once the agent has answered there (or choose **Skip for now**).
4. **Deploy to your app**. List every site that embeds the chat under **Allowed origins**, exact match with scheme and port, such as `https://docs.example.com`; `http://localhost:3000` is allowed for testing. Under **User auth** pick *Nothing, or there is no API* for a public docs site (anyone can ask and nothing is remembered), or a JWT or userinfo mode for a logged-in product so conversations stay with their user. The embed code for your choice is shown below.
5. **Go live**. **Activate agent**, then send a message from your site. The step waits for that first request and shows requests refused in the last hour, so a wrong origin is visible at once.

The same settings stay editable later under **Knowledge** and **Settings**.

## 7. Embed the chat

Copy the publishable key from the Overview page. It is public and safe in the browser.

```sh
npm install sideagent
```

```tsx
import { AgentChat } from "sideagent";

export function Docs() {
  return <AgentChat publishableKey="pk_…" />;
}
```

The key carries the server's host and the agent ID, so nothing else is needed. See [Client](./client.md) for layout, theming and signed-in users.

Check it end to end:

1. Open your site from one of the allowed origins and ask a question that your knowledge answers.
2. Open the agent's **Audit log** in the dashboard. You should see a *Chat turn* with result *OK*.
3. A *Denied* row with `Origin is not in the allowed list` means step 6.4 is wrong: scheme, host or port differ.

## Running it

**Back up** the `pgdata` volume (or run `pg_dump`) and `SIDEAGENT_SECRET`. The database holds agents, vectors, threads and the sealed keys. Restoring the database without the same secret leaves the LLM keys unreadable, and you enter them again.

**Upgrade** by pulling the new code and rebuilding. Migrations apply on start and are only ever appended.

```sh
git pull
docker compose up -d --build
```

**Scale**: the rate limiter and the concurrent-turn limit are per process. With several admin instances, each counts on its own.

**Privacy**: traces (opened from a turn in the **Audit log**, where you also set the level) keep no text at *Metadata* and redacted text at *Full content*. Pick the level your users agreed to. The audit log never stores message text.

## Embed the server in your own code

Use this to send real mail, split users into workspaces with the `scope` hook, or run on another runtime. See [Server](./server.md): `createServer({ database, publicUrl, secret, auth })`. The Dockerfile runs `src/cli.ts`, which is a thin wrapper over it.

The database needs the pgvector extension (`CREATE EXTENSION vector`, which `docker/init.sql` does). Managed Postgres such as Neon, Supabase or RDS offers it.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Sign-in link opens a wrong host | `ADMIN_PUBLIC_URL` does not match the browser URL. |
| Dashboard saves fail with an origin error | Same cause: writes must carry the dashboard's own origin. |
| Agent cannot be activated | A setup step is not done yet: model, knowledge, origins or user auth. The **Setup** page shows which. |
| Knowledge source stays *Failed* | Page not public HTTPS, or wrong embedding model or key. The server refuses private addresses on purpose. |
| Chat shows nothing | The agent is inactive, or its anonymous daily cap is reached. |
| Chat error in the browser, *Denied* in the audit log | Origin not in the allowed list. |
| Answer arrives all at once at the end | The proxy buffers. Disable buffering on `/v1/`. |
| LLM keys stopped working after a restore or move | `SIDEAGENT_SECRET` differs from the one that sealed them. |
| Everyone signed out after a restart | `SIDEAGENT_SECRET` changed. |
