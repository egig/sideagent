---
sidebar_position: 10
title: Example
---

A small invoices app that uses every part of sideagent: a REST API, an agent endpoint, a React app with the chat docked on the side, and a scripted mock LLM so it runs without an API key.

Source: [`demo/`](https://github.com/egig/sideagent/tree/main/demo)

## Run it

```
pnpm install
pnpm demo       # API + agent + mock LLM on :8787, UI on http://localhost:5173
```

Run `pnpm demo:api` for just the API and agent. To use a real model, set `LLM_API_KEY`, and optionally `LLM_BASE_URL`, `LLM_MODEL` and `EMBEDDING_MODEL`.

Try these. The mock LLM matches keywords, not meaning:

- "list my invoices" calls `listInvoices`.
- "create an invoice" always creates Acme, 100 dollars, after you approve it.
- "what are the payment terms?" searches knowledge.
- "delete" makes the mock try `deleteInvoice`, which is not in `allow`, so the call is denied.

## Files

| File | What it shows |
|---|---|
| [`demo/server.ts`](https://github.com/egig/sideagent/blob/main/demo/server.ts) | The invoices API, the mock LLM routes and `createAgent` setup |
| [`demo/spec.ts`](https://github.com/egig/sideagent/blob/main/demo/spec.ts) | The OpenAPI spec, with `x-agent` hints |
| [`demo/src/main.tsx`](https://github.com/egig/sideagent/blob/main/demo/src/main.tsx) | The React app: `AgentProvider`, `context`, `hooks`, dark mode |
| [`demo/vite.config.ts`](https://github.com/egig/sideagent/blob/main/demo/vite.config.ts) | Dev proxy for `/agent` and `/api` to `:8787` |

## Server walkthrough

**The API enforces its own auth.** `/api/*` requires `Bearer demo-token`. The agent can only do what that token allows.

**Allowlist.** The spec has three operations, but only two are exposed:

```ts
allow: ["listInvoices", "createInvoice"], // deleteInvoice stays unreachable
```

Asking the agent to delete an invoice fails, because the operation is not in `allow`.

**Auth.** `getAuth` checks the bearer token and returns a user id. The same header is forwarded to the API on each tool call.

**Spec hints** in `spec.ts`:
- `listInvoices` has `responseFields: ["id", "customer", "amount"]`, so the `internalNote` field in the API data never reaches the model or the browser.
- `createInvoice` has `invalidates: ["invoices"]`. It is a POST, so it needs approval.

**Knowledge.** One markdown source and one URL (a payment terms page served by the demo itself). With the mock LLM, embeddings come from a mock endpoint.

**Audit.** `onAudit` logs every tool call to the console.

**Startup order.** The server starts listening before `createAgent` runs, because the agent calls the mock LLM, mock embeddings and the docs page on the same process while it starts. Until it is ready, `/agent` returns `503`.

## Client walkthrough

```tsx
<AgentProvider
  endpoint="/agent"
  mode="sidebar"
  defaultOpen
  theme={theme}
  headers={AUTH}
  context={() => ({ page: "invoices", visibleCount: invoices.length })}
  hooks={{ onInvalidate: (tag) => tag === "invoices" && load() }}
>
  <main>…</main>
</AgentProvider>
```

- `headers` sends the demo token to `/agent`.
- `context` tells the agent what the user is looking at.
- `onInvalidate` refetches the list after `createInvoice` succeeds, so the page updates without a reload.
- `theme` follows the app's own dark mode toggle.

## What the example leaves out

It is not production setup. It uses in-memory storage, a hardcoded token and user, a demo `approvalSecret`, and `allowPrivateNetworks: true` because everything runs on localhost. See [Deployments](./deployments.md) and [Persistence](./persistence.md) for the real setup.
