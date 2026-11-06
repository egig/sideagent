---
sidebar_position: 9
title: Deployments
---

## Checklist

- [ ] `SIDEAGENT_SECRET` is long and random, stored outside the server too. Lose it and the stored LLM keys are unreadable.
- [ ] `DATABASE_URL` is Postgres with pgvector, and backed up.
- [ ] `publicUrl` is the exact URL people type in the browser, with HTTPS.
- [ ] Sign-up is closed once your team has accounts (`SIGNUP` unset or `auth.signup: false`).
- [ ] Each agent lists only your real app origins, and its **User auth** matches your product: a JWT or userinfo mode for signed-in products, nothing for public docs (anonymous visitors then keep no history).
- [ ] Every knowledge source is something any user may read: the agent can quote any passage it finds.
- [ ] Email sign-in has `auth.sendMagicLink`, or you use GitHub or Google.
- [ ] Behind a proxy, `rateLimit` and `clientIp` read the real client address, and the proxy overwrites `x-forwarded-for`.

## CORS and origins

A request without an `Origin` header, or from an origin not in the agent's allowed list, is refused and audited as *Denied*. Server-to-server calls and `curl` need an `Origin` header. Only `POST` and `OPTIONS` are allowed, and `Content-Type` must be `application/json`.

## Rate limits and quotas

The server limits requests per address, concurrent turns per user and anonymous messages per agent per day. Those counters are per process: with several instances, each counts on its own. Pass `rateLimit` for a shared limiter.

Fixed limits: request body 256 KB, message 8000 characters, 8 steps and 120 seconds per turn.

## Streaming and proxies

Responses are server-sent events. Reverse proxies and CDNs must not buffer them, or the user sees no text until the turn ends. Disable buffering for `/v1/` (for nginx: `proxy_buffering off;`). Set the platform's function timeout above 120 seconds.

## Other things to know

- The agent's instructions are part of its system prompt. Use them for tone and domain rules, not for security.
- The `context` prop of `AgentChat` comes from the browser, so a user can forge it. It is cut to 4000 characters and given to the model as untrusted page context. Never use it for access control, and do not put secrets in it.
- Assistant replies render as Markdown (GFM) with raw HTML dropped; links open in a new tab with `noopener noreferrer`.
- The model must support tool calling, which the knowledge search uses.
