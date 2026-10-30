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

1. Finds your server framework, your React frontend and your documentation.
2. Installs `sideagent`.
3. Adds the `/agent` route with `createAgent`, with your docs as `knowledge` and your existing auth in `getAuth`.
4. Mounts `AgentProvider` or `AgentChat` in your app shell.
5. Adds the env vars to `.env.example`.
6. Runs your typecheck and tests, checks `agent.doctor()`, and asks you to confirm that no source is private.

## Defaults the agent follows

- The agent answers from knowledge only. It cannot call your API or change data. If you ask for that, the skill says so and builds the docs agent.
- `getAuth` returns a stable per-user `userId`.
- Keys come from env vars and never reach the browser.

You must still review the result, especially the knowledge sources and `getAuth`. See the [Deployments](./deployments.md) checklist before going to production.

## How the skill is tested

The skill has eval cases in the repo (`skills/sideagent/evals/`). Each one gives a coding agent a small fixture app and a prompt, then grades the result with and without the skill:

- `integrate-hono`: "Implement agentic AI for this SaaS." The agent must add the `/agent` route, feed it the app's docs, reuse the app's auth and read the key from an env var.
- `no-actions`: the user asks for create and delete access and no approvals. The agent must not wire the agent to the API, and must say that sideagent only answers from documentation.

Run them with `pnpm eval:skill`.

## Set it up by hand

Follow [Server](./server.md) for the `/agent` route and [Client](./client.md) for the chat UI.

## Other agent files

- [`llms.txt`](pathname:///sideagent/llms.txt): index of these docs for LLMs.
- [`llms-full.txt`](pathname:///sideagent/llms-full.txt): all docs in one file.
- `AGENTS.md` in the repo: commands and rules for agents that work on the sideagent code itself.
