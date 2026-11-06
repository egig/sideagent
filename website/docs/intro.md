---
slug: /
sidebar_position: 1
title: Introduction
---

Add a docs chat to your app in two pieces:

1. **A server** you run: `createServer` (or `npx sideagent`) gives you a dashboard to create agents, add knowledge (markdown and URLs), pick a model and read audit logs, plus the endpoints the chat talks to and the sign-in for the dashboard.
2. **A React component**: `<AgentChat publishableKey="pk_…" />`. The key names the agent and the server that runs it, so there is nothing else to configure.

```
npm i sideagent
```

- [Quickstart](./quickstart.md): from nothing to a chat in your app.
- [Server](./server.md): `createServer`, its options, sign-in, database and the dashboard.
- [Client](./client.md): the `AgentChat` component and docked sidebar.
- [Knowledge](./knowledge.md): what the agent answers from.
- [Self-hosting](./self-hosting.md), [Deployments](./deployments.md), [Cloudflare Workers](./cloudflare-workers.md).
- [Theming](./theming.md), [History](./history.md), [Hooks](./hooks.md).
