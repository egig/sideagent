# sideagent

Add a docs chat to your app. A server you run holds the dashboard, the knowledge (markdown and URLs) and the model; a React component, given a publishable key, is the chat. It answers from your docs and shows its sources.

```
npm i sideagent
```

Docs: https://egig.github.io/sideagent/

## Server (`sideagent/server`)

```
npx sideagent        # http://localhost:8788; set DATABASE_URL and SIDEAGENT_SECRET for real use
```

Open the dashboard, create an agent, add knowledge, set the model, list the origins that may embed the chat, switch the agent to Active and copy its publishable key. Or in your own code:

```ts
import { createServer } from "sideagent/server/node";

const server = createServer({
  database: process.env.DATABASE_URL!,   // Postgres with pgvector; or a Drizzle db, or your own AdminStore
  publicUrl: "https://agent.example.com",
  secret: process.env.SIDEAGENT_SECRET!, // openssl rand -base64 32
});
await server.listen(8788);               // or mount server.fetch anywhere: Hono, Next, Workers (sideagent/server)
```

One call gives you the dashboard, its sign-in (email link, GitHub, Google, or your own via `auth`), the agents' endpoints, audit logs and traces. One workspace by default; multi-tenant through a `scope` hook. See [Server](./website/docs/server.md), [Self-hosting](./website/docs/self-hosting.md) and [Cloudflare Workers](./website/docs/cloudflare-workers.md).

Secure by default: origin checks, threads bound to the user, size, step and time limits, SSRF guards on every page the server fetches, LLM keys sealed at rest, passages given to the model as untrusted data and kept from the browser. The agent has one tool, knowledge search, and cannot call your API or change anything.

## Client (`sideagent`)

```tsx
import { AgentChat } from "sideagent";

<AgentChat
  publishableKey="pk_…"                 // from the dashboard; names the agent and its server
  getToken={() => auth.getAccessToken()} // signed-in users; omit for public docs
  storageKey={user.id}                   // keeps each user's last conversation apart
  mode="floating"                        // "floating" | "sidebar"; the user can switch
  hooks={{ onTurnEnd: () => track("agent_turn") }}
/>
```

The key is public: it is safe in the browser and proves nothing on its own. Hide the launcher with `launcher={false}` and open the panel through `useAgent().setOpen`; turn history off with `history={false}`; add header buttons with `headerActions`.

### Docked sidebar

Wrap your app in `AgentProvider` to dock the chat beside the app instead of over it. It takes the same props as `AgentChat`. The user drags the panel's left edge to resize.

```tsx
import { AgentProvider } from "sideagent";

<AgentProvider publishableKey="pk_…" mode="sidebar" defaultOpen>
  <App />
</AgentProvider>
```

Anything under `AgentProvider` can call `useAgent()` to get `{ open, setOpen, available }`.

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

## Sources and icons

A search shows as a "Sources" card: the titles of the sources the answer came from, linked only for the URLs in your config. Raw arguments stay under "Details". Assistant replies render as Markdown (GFM); raw HTML is dropped.

Icons come from [Radix Icons](https://github.com/radix-ui/icons) (MIT).

## Development

```
pnpm dev         # server on :8788 + dashboard with hot reload on :5174
pnpm build       # tsup -> dist/ and the dashboard
pnpm test        # vitest
pnpm typecheck
```

## For AI agents

- Skill: `npx skills add egig/sideagent`, then ask your coding agent to "add an AI assistant to this app". See [Quickstart](https://egig.github.io/sideagent/quickstart).
- [`AGENTS.md`](AGENTS.md): commands, layout and rules for coding agents working on this repo.
- [`llms.txt`](https://egig.github.io/sideagent/llms.txt) and [`llms-full.txt`](https://egig.github.io/sideagent/llms-full.txt): the docs in LLM-friendly form.
