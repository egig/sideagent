---
sidebar_position: 1.5
title: Quickstart
---

## 1. Run the server

```sh
npx sideagent
```

It starts on http://localhost:8788 with an in-memory database (data is lost on exit) and prints the sign-in link to the log. For a real database set `DATABASE_URL` (Postgres with pgvector) and `SIDEAGENT_SECRET` (`openssl rand -base64 32`); see [Server](./server.md).

## 2. Create an agent

Open the dashboard, choose **New agent**, then follow the Overview page: set the model and key, add knowledge, list the origins that may embed the chat, and switch the agent to **Active**. Copy its publishable key (`pk_…`). It is public.

## 3. Add the chat

```tsx
import { AgentChat } from "sideagent";

<AgentChat publishableKey="pk_…" />
```

For signed-in users pass `getToken`; see [Client](./client.md).

## Let your coding agent do it

Install the skill once, then prompt your agent: "Add an AI assistant to this app."

```
npx skills add egig/sideagent
```

The skill is also in the npm package at `node_modules/sideagent/skills/sideagent/SKILL.md`. If your agent has no skills support, ask it to read `https://egig.github.io/sideagent/llms-full.txt` and follow it. It is tested with eval cases in `skills/sideagent/evals/` (`pnpm eval:skill`).

The agent answers from knowledge only. It cannot call your API or change data.

## Other agent files

- [`llms.txt`](pathname:///sideagent/llms.txt) and [`llms-full.txt`](pathname:///sideagent/llms-full.txt): these docs for LLMs.
- `AGENTS.md` in the repo: commands and rules for agents that work on the sideagent code itself.
