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

## Limits

- Without `AgentProvider`, `mode="sidebar"` overlays the page instead of docking.
- The sidebar width is remembered in the browser. It is not shared across devices.
