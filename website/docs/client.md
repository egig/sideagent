---
sidebar_position: 3
title: Client
---

```tsx
import { AgentChat } from "sideagent";

<AgentChat
  publishableKey="pk_…"
  mode="floating"            // "floating" | "sidebar"; the user can switch
  hooks={{ onTurnEnd: () => track("agent_turn") }}
/>
```

The publishable key names the agent and the server that runs it. The chat derives the URL (`https://<host>/v1/agents/<agentId>`) and sends the key in the `x-sideagent-key` header on every request. The key is public: it is safe in the browser and proves nothing on its own. A malformed key throws during render.

The panel title is the agent's name from the dashboard. Pass `title` to use your own text.

When the agent would refuse every message because a usage cap is reached (anonymous visitors), the chat renders nothing, launcher included, until the next page load. Under `AgentProvider`, `useAgent().available` is `false` too, so hide your own "ask" button.

## Signed-in users

Pass `getToken`, which the chat calls before every request, so a token that expires is fetched fresh each time. Return `null` for a visitor who is not signed in. The agent's **User auth** setting in the dashboard says how the server checks the token (a JWT against your JWKS, or your userinfo URL). If `getToken` throws, the request is not sent and the chat shows an error.

Pass `storageKey` (the user's ID) so the last conversation the chat remembers in `localStorage` belongs to that user; on a shared browser another user starts from their own.

```tsx
<AgentChat publishableKey="pk_…" getToken={() => auth.getAccessToken()} storageKey={user.id} />
```

## Layout

If the connection breaks while an answer streams, the chat shows "The connection was interrupted" instead of passing the partial answer off as complete. If the server no longer has the conversation (restart, expiry), the chat starts a new one with your next message.

Hide the floating launcher with `launcher={false}` and open the panel from your own button through `useAgent().setOpen`. Turn off chat history with `history={false}`. Hide the New chat button with `newChatButton={false}`. Add your own buttons to the panel header with `headerActions`.

### Docked sidebar

Wrap your app in `AgentProvider` to dock the chat on the right, side by side with the app instead of over it. It takes the same props as `AgentChat`. The user drags the panel's left edge (or uses the arrow keys on it) to resize; the width is remembered. Outside `AgentProvider`, sidebar mode overlays the page.

```tsx
import { AgentProvider } from "sideagent";

<AgentProvider publishableKey="pk_…" mode="sidebar" defaultOpen>
  <App />
</AgentProvider>
```

`AgentProvider` fills the viewport height (`100dvh`); override with the `className` or `style` props. Anything under it can call `useAgent()` to get `{ open, setOpen, available }`.

## Small screens

At 640px wide or less, the panel opens full screen in every mode and the layout switcher and resize handle are hidden. It respects the safe-area insets when your page sets `viewport-fit=cover`. The page needs `<meta name="viewport" content="width=device-width, initial-scale=1">`.

## Limits

- Without `AgentProvider`, `mode="sidebar"` overlays the page instead of docking.
- The sidebar width is remembered in the browser. It is not shared across devices.
