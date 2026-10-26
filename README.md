# sideagent

Embed a chat agent in your app. You give it an OpenAPI spec and an OpenAI-compatible host and key. It gives you a secure agent endpoint and a React chat UI.

```
npm i sideagent
```

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

Tool results render as readable views: arrays of objects become tables (up to 50 rows and 8 columns, numbers right-aligned, dates and booleans formatted), objects become labelled fields, errors and rejections get their own state. Raw JSON stays under "Details". Everything is plain text, never HTML. Override per operation:

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
