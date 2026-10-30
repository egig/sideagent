---
sidebar_position: 10
title: Example
---

A small docs assistant: an agent endpoint over a markdown source and a web page, a React app with the chat docked on the side, and a scripted mock LLM so it runs without an API key.

Source: [`demo/`](https://github.com/egig/sideagent/tree/main/demo)

## Run it

```
pnpm install
pnpm demo       # agent + mock LLM on :8787, UI on http://localhost:5173
```

Run `pnpm demo:api` for just the agent. To use a real model, set `LLM_API_KEY`, and optionally `LLM_BASE_URL`, `LLM_MODEL` and `EMBEDDING_MODEL`.

Try these. The mock LLM matches keywords, not meaning:

- "what is your refund policy?" searches the knowledge and shows a Sources card.
- "what are the payment terms?" does the same, with the web page as a source.
- "hello" is answered without a search.

## Files

| File | What it shows |
|---|---|
| [`demo/server.ts`](https://github.com/egig/sideagent/blob/main/demo/server.ts) | The mock LLM routes, a docs page and the `createAgent` setup |
| [`demo/src/main.tsx`](https://github.com/egig/sideagent/blob/main/demo/src/main.tsx) | The React app: `AgentProvider`, `context`, dark mode |
| [`demo/vite.config.ts`](https://github.com/egig/sideagent/blob/main/demo/vite.config.ts) | Dev proxy for `/agent` to `:8787` |

## Server walkthrough

**Knowledge.** One markdown source and one URL (a payment terms page served by the demo itself). With the mock LLM, embeddings come from a mock endpoint.

**Auth.** The demo has no sign-in, so it sets `anonymous: true`. A real app uses `getAuth`.

**Startup order.** The server starts listening before `createAgent` runs, because the agent calls the mock LLM, mock embeddings and the docs page on the same process while it starts. Until it is ready, `/agent` returns `503`.

## Client walkthrough

```tsx
<AgentProvider
  endpoint="/agent"
  mode="sidebar"
  defaultOpen
  theme={theme}
  context={() => ({ page: "invoicing guide" })}
>
  <main>…</main>
</AgentProvider>
```

- `context` tells the agent what the user is looking at.
- `theme` follows the app's own dark mode toggle.

## What the example leaves out

It is not production setup. It uses in-memory storage, no sign-in, and `allowPrivateNetworks: true` because everything runs on localhost. See [Deployments](./deployments.md) and [Persistence](./persistence.md) for the real setup.
