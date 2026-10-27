---
sidebar_position: 3
title: Client
---

```tsx
import { AgentChat } from "sideagent";

<AgentChat
  endpoint="/agent"
  mode="floating"            // "floating" | "sidebar"; the user can switch
  hooks={{ onInvalidate: (tag) => tag === "invoices" && refetchInvoices() }}
/>
```

## sideagent Cloud

With an agent hosted on sideagent Cloud, pass its publishable key instead of `endpoint`. The key names the agent and its host, so the chat derives the URL (`https://<host>/v1/agents/<agentId>`) and sends the key in the `x-sideagent-key` header on every request. The key is public: it is safe in the browser and proves nothing on its own.

```tsx
<AgentChat publishableKey="pk_live_…" />
```

Pass `endpoint` as well to send the requests somewhere else, such as a proxy in front of sideagent Cloud. A malformed key, or neither prop, throws during render. `parsePublishableKey` and `publishableEndpoint` are exported from `sideagent/keys`.

## Docked sidebar

Wrap your app in `AgentProvider` to dock the chat on the right, side by side with the app instead of over it. It takes the same props as `AgentChat`. The user drags the panel's left edge (or uses the arrow keys on it) to resize; the width is remembered. Outside `AgentProvider`, sidebar mode overlays the page.

```tsx
import { AgentProvider } from "sideagent";

<AgentProvider endpoint="/agent" mode="sidebar" defaultOpen>
  <App />
</AgentProvider>
```

`AgentProvider` fills the viewport height (`100dvh`); override with the `className` or `style` props.

Anything under `AgentProvider` can call `useAgent()` to get `{ open, setOpen }`, e.g. an "Ask assistant" button in your toolbar.

## Small screens

At 640px wide or less, the panel opens full screen in every mode (floating, sidebar and docked) and the layout switcher and resize handle are hidden. It respects the safe-area insets when your page sets `viewport-fit=cover`. On touch devices the buttons are larger and the keyboard hint is hidden.

The page needs a responsive viewport tag: `<meta name="viewport" content="width=device-width, initial-scale=1">`.

## Limits

- Without `AgentProvider`, `mode="sidebar"` overlays the page instead of docking.
- The sidebar width is remembered in the browser. It is not shared across devices.
