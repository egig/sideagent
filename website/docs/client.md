---
sidebar_position: 3
title: Client
---

```tsx
import { AgentChat } from "sideagent";

<AgentChat
  endpoint="/agent"
  mode="floating"            // "floating" | "sidebar"; the user can switch
  hooks={{ onTurnEnd: () => track("agent_turn") }}
/>
```

## sideagent Cloud

With an agent hosted on sideagent Cloud, pass its publishable key instead of `endpoint`. The key names the agent and its host, so the chat derives the URL (`https://<host>/v1/agents/<agentId>`) and sends the key in the `x-sideagent-key` header on every request. The key is public: it is safe in the browser and proves nothing on its own.

```tsx
<AgentChat publishableKey="pk_…" />
```

Pass `endpoint` as well to send the requests somewhere else, such as a proxy in front of sideagent Cloud. A malformed key, or neither prop, throws during render. `parsePublishableKey` and `publishableEndpoint` are exported from `sideagent/keys`.

The panel title is the agent's name from the Cloud dashboard. The chat asks for it once with `{ "action": "agent.info" }` and shows "Assistant" until it answers, or if the request fails. Pass `title` to use your own text. Without a `publishableKey` the title is "Assistant" and nothing is asked.

The same answer can carry `"available": false`, when the agent would refuse every message because a usage cap is reached (sideagent Cloud does this for anonymous visitors). The chat then renders nothing, launcher included, until the next page load.

Under `AgentProvider`, `useAgent().available` is `false` too, so hide your own "ask" button.

Signed-in users: pass `getHeaders`, which the chat calls before every request, so a login token that expires is fetched fresh each time. Pass `storageKey` (the user's ID) so the last conversation the chat remembers in `localStorage` belongs to that user; on a shared browser another user starts from their own.

```tsx
<AgentChat
  publishableKey="pk_…"
  getHeaders={async () => ({ Authorization: `Bearer ${await getToken()}` })}
  storageKey={user.id}
/>
```

`getHeaders` works with `endpoint` too. Its headers are merged under `headers`, which wins on a clash, so it cannot replace the publishable key. If it throws, the request is not sent and the chat shows an error.

Hide the floating launcher with `launcher={false}` and open the panel from your own button through `useAgent().setOpen`. Turn off chat history with `history={false}`: no History button, and the chat does not remember or reopen the last conversation. Hide the New chat button with `newChatButton={false}`. Add your own buttons to the panel header with `headerActions`.

## Docked sidebar

Wrap your app in `AgentProvider` to dock the chat on the right, side by side with the app instead of over it. It takes the same props as `AgentChat`. The user drags the panel's left edge (or uses the arrow keys on it) to resize; the width is remembered. Outside `AgentProvider`, sidebar mode overlays the page.

```tsx
import { AgentProvider } from "sideagent";

<AgentProvider endpoint="/agent" mode="sidebar" defaultOpen>
  <App />
</AgentProvider>
```

`AgentProvider` fills the viewport height (`100dvh`); override with the `className` or `style` props.

Anything under `AgentProvider` can call `useAgent()` to get `{ open, setOpen, available }`, e.g. an "Ask assistant" button in your toolbar.

## Small screens

At 640px wide or less, the panel opens full screen in every mode (floating, sidebar and docked) and the layout switcher and resize handle are hidden. It respects the safe-area insets when your page sets `viewport-fit=cover`. On touch devices the buttons are larger and the keyboard hint is hidden.

The page needs a responsive viewport tag: `<meta name="viewport" content="width=device-width, initial-scale=1">`.

## Limits

- Without `AgentProvider`, `mode="sidebar"` overlays the page instead of docking.
- The sidebar width is remembered in the browser. It is not shared across devices.
