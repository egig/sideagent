---
sidebar_position: 13
title: Self-hosting
---

This guide takes you from nothing to a docs chat on your own site, answered by a [sideagent admin](./admin.md) you run yourself. You get a dashboard to manage the agent and an endpoint your site talks to. Plan on 20 minutes.

What you run: Postgres with pgvector, and one Node process (the admin) that serves the dashboard, the dashboard API and the agent endpoint `/v1/agents/:id`. What you bring: a domain with HTTPS, and an API key for an OpenAI-compatible model provider.

## 1. Get the code

The Docker setup lives in the sideagent repository.

```sh
git clone https://github.com/egig/sideagent.git
cd sideagent
```

If you want the admin inside your own server instead, skip to [Embed the admin in your own server](#embed-the-admin-in-your-own-server).

## 2. Set the secrets

Create `.env` next to `docker-compose.yml`:

```sh
BETTER_AUTH_SECRET=...   # openssl rand -base64 32
CONFIG_KEK=...           # openssl rand -base64 32
POSTGRES_PASSWORD=...    # anything long and random
ADMIN_PUBLIC_URL=https://admin.example.com
```

| Variable | What it does |
|---|---|
| `BETTER_AUTH_SECRET` | Signs sessions and sign-in links. Change it and everyone is signed out. |
| `CONFIG_KEK` | Wraps every stored LLM key. **Lose it and the stored keys are unreadable.** Keep a copy outside the server. |
| `POSTGRES_PASSWORD` | The compose file defaults to `sideagent`. Change it if the database port is reachable by anyone. |
| `ADMIN_PUBLIC_URL` | The exact URL people type in the browser, with scheme and no trailing slash. Sign-in links and the origin check on dashboard writes use it. Wrong value: sign-in links point to the wrong host and saves fail with an origin error. |
| `SIGNUP` | `false` stops new accounts. See step 4. |

Without `BETTER_AUTH_SECRET` and `CONFIG_KEK` the admin invents throwaway ones. Sessions and stored keys then die with the container.

## 3. Start it

```sh
docker compose up -d --build
docker compose logs -f admin
```

Wait for `admin on https://admin.example.com (postgres)`. The migrations run on every start, so there is no separate step. Check health:

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

The admin has no mail server. Sign-in links print to the log:

1. Open `https://admin.example.com`, enter your email.
2. Run `docker compose logs admin` and copy the line `sign-in link for you@example.com: …`.
3. Open the link and click through. Links are single use.

Then close sign-up. By default anyone who can reach the dashboard can create an account, and every account shares every agent. Add `SIGNUP=false` to `.env` and run `docker compose up -d`. Existing accounts still sign in; new ones are refused. To add a teammate later, set `SIGNUP=true`, let them sign in once, and set it back.

To send real email, or add GitHub and Google sign-in, [run your own server](#embed-the-admin-in-your-own-server): `createAuth` takes `sendMagicLink`, `github` and `google`.

## 6. Create the agent

In the dashboard choose **New agent**. The agent starts inactive: its endpoint answers 404 until you turn it on. The **Overview** page lists what is missing.

1. **LLM** (Settings, LLM tab). Set the provider base URL (OpenAI-compatible, HTTPS), the chat model, the embedding model and the API key. The model must support tool calling, because the knowledge search is a tool. The key is encrypted and never shown again.
2. **Knowledge**. Add web pages (public HTTPS only) or paste Markdown. Wait until each source says *Indexed*. A *Failed* source usually means the page is not public, or the embedding model or key is wrong.
3. **Allowed origins** (Settings, General tab). List every site that embeds the chat, exact match with scheme and port, such as `https://docs.example.com`. `http://localhost:3000` is allowed for testing. No origins, no browser can use the agent.
4. **User auth** (Settings, User auth tab). Pick *Nothing, or there is no API* for a public docs site. Anyone can ask and nothing is remembered. For a logged-in product, pick a JWT or userinfo mode so conversations stay with their user.
5. Back on **Overview**, switch the agent to **Active**.

Use the preview in the dashboard to ask a test question before you embed anything.

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

The key carries the admin's host and the agent ID, so no endpoint is needed. Set `endpoint` too only to go through your own proxy. See [Client](./client.md) for layout, theming and signed-in users.

Check it end to end:

1. Open your site from one of the allowed origins and ask a question that your knowledge answers.
2. Open the agent's **Audit log** in the dashboard. You should see a *Chat turn* with result *OK*.
3. A *Denied* row with `Origin is not in the allowed list` means step 6.3 is wrong: scheme, host or port differ.

## Running it

**Back up** the `pgdata` volume (or run `pg_dump`) and `CONFIG_KEK`. The database holds agents, vectors, threads and the sealed keys. Restoring the database without the same `CONFIG_KEK` leaves the LLM keys unreadable, and you enter them again.

**Upgrade** by pulling the new code and rebuilding. Migrations apply on start and are only ever appended.

```sh
git pull
docker compose up -d --build
```

**Scale**: the rate limiter and the concurrent-turn limit are per process. With several admin instances, each counts on its own.

**Privacy**: traces (Traces tab) keep no text at *Metadata* and redacted text at *Full content*. Pick the level your users agreed to. The audit log never stores message text.

## Embed the admin in your own server

Use this to send real mail, add GitHub or Google sign-in, split users into workspaces with the `scope` hook, or run on another runtime. Follow the code under [Run it](./admin.md#run-it): `createPgStore` on your Postgres, `createAuth` with a real `sendMagicLink`, and `createAdmin`. `dev/server.ts` in the repository is a complete working example, and the Dockerfile's `admin` stage runs it.

The database needs the pgvector extension (`CREATE EXTENSION vector`, which `docker/init.sql` does). Managed Postgres such as Neon, Supabase or RDS offers it.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Sign-in link opens a wrong host | `ADMIN_PUBLIC_URL` does not match the browser URL. |
| Dashboard saves fail with an origin error | Same cause: writes must carry the dashboard's own origin. |
| Agent cannot be activated | A setup item on Overview is missing: content, origins, LLM or user auth. |
| Knowledge source stays *Failed* | Page not public HTTPS, or wrong embedding model or key. The server refuses private addresses on purpose. |
| Chat shows nothing | The agent is inactive, or its anonymous daily cap is reached. |
| Chat error in the browser, *Denied* in the audit log | Origin not in the allowed list. |
| Answer arrives all at once at the end | The proxy buffers. Disable buffering on `/v1/`. |
| LLM keys stopped working after a restore or move | `CONFIG_KEK` differs from the one that sealed them. |
| Everyone signed out after a restart | `BETTER_AUTH_SECRET` was not set, or changed. |
