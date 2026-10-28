# sideagent

Embed a chat agent in your app. You give it an OpenAPI spec and an OpenAI-compatible host and key. It gives you a secure agent endpoint and a React chat UI.

```
npm i sideagent
```

Docs: https://egig.github.io/sideagent/

## Server (`sideagent/server`)

```ts
import { createAgent, honoHandler } from "sideagent/server";

const agent = await createAgent({
  spec: "https://api.example.com/openapi.json", // or an object / JSON string
  baseUrl: "https://api.example.com",           // pinned; the spec's `servers` is ignored
  llm: { baseUrl: "https://api.openai.com/v1", apiKey: process.env.LLM_API_KEY!, model: "gpt-4o-mini" },
  allow: ["listInvoices", "createInvoice", "tag:reports"], // default-deny allowlist
  allowedOrigins: ["https://app.example.com"],
  approvalSecret: process.env.APPROVAL_SECRET,   // set on serverless / multi-instance
  getAuth: (req) => ({ userId: "…", headers: { authorization: req.headers.get("authorization")! } }),
});

app.on(["POST", "OPTIONS"], "/agent", honoHandler(agent)); // also: nextRoute, expressHandler
console.log(await agent.doctor());                         // what the agent can do + LLM check
```

Secure by default: allowlisted operations only, the end user's own credentials forwarded, non-GET calls need
server-verified approval bound to the exact arguments, pinned `baseUrl` with SSRF guards, size/step/time limits,
origin checks, threads bound to the user, redacted audit events.

Per-operation hints go in the spec as `x-agent`: `{ approval, description, invalidates: ["tag"], responseFields: ["id"] }`.

## Client (`sideagent`)

```tsx
import { AgentChat } from "sideagent";

<AgentChat
  endpoint="/agent"
  mode="floating"            // "floating" | "sidebar"; the user can switch
  hooks={{ onInvalidate: (tag) => tag === "invoices" && refetchInvoices() }}
/>
```

### sideagent Cloud

With an agent hosted on sideagent Cloud, pass its publishable key instead of `endpoint`. The key names the agent and its host, so the chat derives the URL (`https://<host>/v1/agents/<agentId>`) and sends the key in the `x-sideagent-key` header on every request. The key is public: it is safe in the browser and proves nothing on its own.

```tsx
<AgentChat publishableKey="pk_live_…" />
```

Pass `endpoint` as well to send the requests somewhere else, such as a proxy in front of sideagent Cloud. A malformed key, or neither prop, throws during render. `parsePublishableKey` and `publishableEndpoint` are exported from `sideagent/keys`.

Signed-in users: pass `getHeaders`, which the chat calls before every request, so a login token that expires is fetched fresh each time. Pass `storageKey` (the user's ID) so the last conversation the chat remembers in `localStorage` belongs to that user; on a shared browser another user starts from their own.

```tsx
<AgentChat
  publishableKey="pk_live_…"
  getHeaders={async () => ({ Authorization: `Bearer ${await getToken()}` })}
  storageKey={user.id}
/>
```

`getHeaders` works with `endpoint` too. Its headers are merged under `headers`, which wins on a clash, so it cannot replace the publishable key. If it throws, the request is not sent and the chat shows an error.

### Docked sidebar

Wrap your app in `AgentProvider` to dock the chat on the right, side by side with the app instead of over it. It takes the same props as `AgentChat`. The user drags the panel's left edge (or uses the arrow keys on it) to resize; the width is remembered. Outside `AgentProvider`, sidebar mode overlays the page.

```tsx
import { AgentProvider } from "sideagent";

<AgentProvider endpoint="/agent" mode="sidebar" defaultOpen>
  <App />
</AgentProvider>
```

`AgentProvider` fills the viewport height (`100dvh`); override with the `className` or `style` props.

Anything under `AgentProvider` can call `useAgent()` to get `{ open, setOpen }`, e.g. an "Ask assistant" button in your toolbar.

## Try the demo (no API key needed)

```
pnpm install
pnpm demo       # fake invoices API + agent + mock LLM on :8787, UI on http://localhost:5173
```
The demo has a dark mode toggle and uses `AgentProvider`. Run `pnpm demo:api` alone for just the API.
Set `LLM_API_KEY` (and optionally `LLM_BASE_URL`, `LLM_MODEL`) to use a real model.

## Development

```
pnpm build       # tsup -> dist/
pnpm test        # vitest
pnpm typecheck
```

## Theming

Neutral by default (grayscale, host font, 10px radius). `theme="auto"` follows the OS and a host `.dark` / `data-theme="dark"` / `data-bs-theme="dark"`; pass `"light"` or `"dark"` to force one. Match your design system with CSS variables on `:root`:

```css
:root {
  --sideagent-accent: var(--primary);      /* buttons */
  --sideagent-accent-fg: var(--primary-foreground);
  --sideagent-bg: var(--background);
  --sideagent-fg: var(--foreground);
  --sideagent-border: var(--border);
  --sideagent-surface: var(--muted);       /* user bubble, hovers */
  --sideagent-muted: var(--muted-foreground);
  --sideagent-radius: 10px;
  --sideagent-font: inherit;
}
```

## Results and icons

Tool results render as readable views: arrays of objects become tables (up to 50 rows and 8 columns, numbers right-aligned, dates and booleans formatted), objects become labelled fields, errors and rejections get their own state. Raw JSON stays under "Details". Tool results are plain text, never HTML. Assistant replies render as Markdown (GFM); raw HTML is dropped. Override per operation:

```tsx
<AgentChat resultRenderers={{ listInvoices: ({ result }) => <MyInvoiceTable rows={result as any[]} /> }} />
```

Icons come from [Radix Icons](https://github.com/radix-ui/icons) (MIT).

## Chat history

`AgentChat` has a History button (list, open, delete), reopens the last conversation after a refresh, and restores a pending approval. Messages live in your LangGraph `checkpointer`; the list lives in a `threadStore` (in-memory by default). Both must be persistent in production:

```ts
createAgent({ …, checkpointer: new PostgresSaver(…), threadStore: myThreadStore }); // ThreadStore: list / has / touch / delete
```
History is only ever shown from the user's own index, and tool results are rebuilt from the already-filtered copies.

## Knowledge (markdown and URLs)

```ts
createAgent({
  …,
  knowledge: {
    embeddings: { model: "text-embedding-3-small" }, // OpenAI-compatible /embeddings; baseUrl/apiKey default to llm's
    sources: [{ id: "guide", title: "Invoicing guide", content: markdownString }], // pass strings: no filesystem on the edge
    urls: ["https://docs.example.com/payment-terms", { url: "https://…", title: "Shipping" }], // fetched by the server only
  },
  vectorStore, // optional: your own VectorStore (pgvector, Vectorize…). Default is in-memory.
});
```

The agent gets a `search_knowledge` tool; answers show a "Sources" card (links only for your configured URLs). Passages reach the model as labelled untrusted data and never reach the browser. URLs come only from config, must be public http(s) (private ranges need `allowPrivateNetworks`, metadata addresses never), follow only same-host redirects, and are capped by `maxSourceBytes`. URL sources refresh in the background after `ttlMs` (default 1h) or on `agent.knowledge.refresh()`. A source that fails to load is skipped with a warning and shown in `doctor()`.

With the default in-memory store, every start re-embeds all sources (embedding cost). Use a persistent `vectorStore` for large knowledge.

## Cloudflare Workers

`sideagent/server` runs on Workers. Use `nodejs_compat` (or just `nodejs_als`) in `wrangler.jsonc`. LangGraph's approval pause (`interrupt()`) needs `AsyncLocalStorage`, and the Workers build of LangGraph does not register it. sideagent registers it for you when the runtime has it. Without the flag, reads work and the first approval fails (startup logs a warning).

```jsonc
{ "compatibility_date": "2025-09-01", "compatibility_flags": ["nodejs_compat"] }
```

**Export conditions.** `sideagent/server` resolves to the real build under `workerd` and `worker`, listed before `browser` (which stays a throwing stub for real browser bundles). Wrangler (esbuild) and `@cloudflare/vite-plugin` need no alias. Both also set `browser`, so the order in `exports` matters.

**Workers AI as the LLM.** `env.AI` is a binding, not an HTTP endpoint, so use the adapter from `sideagent/workers-ai` instead of `llm`:

```ts
import { createAgent } from "sideagent/server";
import { workersAiChatModel, workersAiEmbeddings } from "sideagent/workers-ai";

export default {
  async fetch(request: Request, env: Env) {
    agent ??= await createAgent({
      spec, baseUrl: env.API_URL, allow: ["listInvoices", "createInvoice"],
      allowedOrigins: ["https://app.example.com"], approvalSecret: env.APPROVAL_SECRET,
      getAuth,
      model: workersAiChatModel(env.AI, "@cf/openai/gpt-oss-120b"),
      knowledge: { sources }, // optional
      embeddings: workersAiEmbeddings(env.AI, "@cf/baai/bge-m3"), // replaces knowledge.embeddings
    });
    return agent.handler(request);
  },
};
let agent: Awaited<ReturnType<typeof createAgent>> | undefined;
```

`model` and `llm` are mutually exclusive; so are the `embeddings` option and `knowledge.embeddings`. `model` can be any LangChain chat model that supports `bindTools()`. `doctor()` checks an injected model with one `invoke`, not an HTTP call. The adapter takes the binding structurally (no `@cloudflare/workers-types` needed) and reads gpt-oss Responses-style output, chat-style `choices[0].message` and `{ response }`.

A custom `checkpointer` (D1, Durable Object storage) is a `BaseCheckpointSaver` with four methods: `getTuple`, `list`, `put`, `putWrites`. sideagent also calls `deleteThread` when a user deletes a thread.

## For AI agents

- Skill: `npx skills add egig/sideagent`, then ask your coding agent to "add an AI assistant to this app". See [Quickstart](https://egig.github.io/sideagent/quickstart).
- [`AGENTS.md`](AGENTS.md): commands, layout and rules for coding agents working on this repo.
- [`llms.txt`](https://egig.github.io/sideagent/llms.txt) and [`llms-full.txt`](https://egig.github.io/sideagent/llms-full.txt): the docs in LLM-friendly form.
