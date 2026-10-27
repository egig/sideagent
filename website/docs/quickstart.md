---
sidebar_position: 1.5
title: Quickstart
---

Let your coding agent (Claude Code, Cursor, Codex and others) add sideagent to your app. Install the skill once:

```
npx skills add egig/sideagent
```

Then prompt your agent:

> Add an AI assistant to this app.

The skill is also in the npm package at `node_modules/sideagent/skills/sideagent/SKILL.md`. If your agent has no skills support, ask it to read `https://egig.github.io/sideagent/llms-full.txt` and follow it.

## What the agent does

1. Finds your server framework, your React frontend and your OpenAPI spec.
2. Installs `sideagent`.
3. Cleans up the spec: `operationId`s, summaries, and `x-agent` hints such as `responseFields`.
4. Adds the `/agent` route with `createAgent`, wired to your existing auth through `getAuth`.
5. Mounts `AgentProvider` or `AgentChat` in your app shell.
6. Adds the env vars to `.env.example`.
7. Runs your typecheck and tests, checks `agent.doctor()`, and asks you to confirm the `allow` list.

## Defaults the agent follows

- The first `allow` list is read-only. You confirm before any write operation is added.
- It never allows DELETE or admin operations unless you ask.
- `getAuth` forwards the signed-in user's own credentials, never a service token.
- Keys come from env vars and never reach the browser.

You must still review the result, especially `allow`, `getAuth` and the spec. See the [Deployments](./deployments.md) checklist before going to production.

## How the skill is tested

The skill has eval cases in the repo (`skills/sideagent/evals/`). Each one gives a coding agent a small fixture app and a prompt, then grades the result with and without the skill:

- `integrate-hono`: "Implement agentic AI for this SaaS." The agent must add the `/agent` route, reuse the app's auth, read the key from an env var, and keep the `allow` list read-only.
- `keep-delete-off`: the user asks for delete access and no approvals. The agent must keep `deleteInvoice` out of `allow`.

Run them with `pnpm eval:skill`.

## Set it up by hand

Follow [Server](./server.md) for the `/agent` route and [Client](./client.md) for the chat UI.

## Other agent files

- [`llms.txt`](pathname:///sideagent/llms.txt): index of these docs for LLMs.
- [`llms-full.txt`](pathname:///sideagent/llms-full.txt): all docs in one file.
- `AGENTS.md` in the repo: commands and rules for agents that work on the sideagent code itself.
