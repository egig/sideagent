---
sidebar_position: 4
title: Hooks
---

Hooks are your code that runs at set points. There are server hooks (on `createAgent`) and client hooks (on `AgentChat` / `AgentProvider`).

## Server hooks

### `getAuth(request)`

Runs on every request, including history and approval calls. Return `{ userId, headers? }`. Throw, or return no `userId`, and the request gets `401`. `headers` go to your API on each tool call and never reach the model. See [Deployments](./deployments.md#authentication).

### `beforeTurn({ request, userId })`

Runs before a chat turn or an approval resume starts. It does not run for history list, open or delete. Throw to reject the turn with `429`. The error message is sent to the client.

```ts
beforeTurn: async ({ userId }) => {
  if (!(await limiter.allow(userId))) throw new Error("Too many requests. Try again in a minute.");
},
```

Use it for rate limits and quotas. It runs before the concurrent-turn check, so a rejected turn does not count as active.

### `onAudit(event)`

Called once per tool call, including denied and rejected ones.

```ts
onAudit: (e) => db.insert("agent_audit", e),
```

- It is fire-and-forget: the turn does not wait for it, and an error or rejected promise is swallowed. Handle your own errors and retries.
- `args` are redacted for sensitive-looking keys before the call. Fields: see [Audit log](./deployments.md#audit-log).
- `search_knowledge` calls are audited as well, with `operationId: "search_knowledge"`.

### `onError({ code, error, userId, threadId })`

Called when a turn fails, with the real error. The browser only sees "The agent failed. Try again." (or the step limit or timeout message), so use this to log the cause.

```ts
onError: ({ code, error, threadId }) => console.error("turn failed", { code, threadId, error }),
```

- `code` is `error`, `step_limit` or `timeout`, as sent to the client.
- It is fire-and-forget: the turn does not wait for it, and an error thrown here is swallowed.
- It does not run when the client disconnects.
- `error` can contain details from your model provider or API. Log it on the server; do not send it to the browser.

## Client hooks

Pass `hooks` to `AgentChat` or `AgentProvider`. They run after the server confirms something happened. The model cannot trigger a hook or any other client action.

```tsx
<AgentChat
  endpoint="/agent"
  hooks={{
    onInvalidate: (tag) => tag === "invoices" && refetchInvoices(),
    onOperationComplete: { createInvoice: (e) => toast(`Created ${(e.result as any).id}`) },
    onError: ({ code, message }) => report(code, message),
  }}
/>
```

| Hook                                        | Fires                                                                                                                                         |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `onTurnStart()`                             | When the user sends a message, or answers an approval restored from history                                                                   |
| `onTurnEnd()`                               | When the turn finishes, fails or is stopped                                                                                                   |
| `onApprovalRequested(event)`                | When the agent waits for the user to approve a call, including an approval restored from history. `event` has the operation and its arguments |
| `onOperationStart({ callId, operationId })` | When a tool call starts running, after any approval                                                                                           |
| `onOperationAbort({ callId, operationId })` | When a started call's result never arrived: the user started a new chat or opened another thread mid-call, or the connection dropped          |
| `onError({ code, message })`                | On an agent error. Server codes: `step_limit`, `timeout`, `error`. Client codes: `headers_failed`, `http_<status>`, `network`                 |
| `onAnyOperation(e)`                         | After every finished tool call, successful or not                                                                                             |
| `onOperationComplete[operationId](e)`       | Same, for one operation id                                                                                                                    |
| `onInvalidate(tag, e)`                      | Once per tag in the operation's `x-agent.invalidates`, only after a successful call                                                           |

`e` is `{ operationId, status, args, result }`.

### Blocking the app while an operation runs

Under `AgentProvider`, `useAgentBusy()` returns `true` while an operation runs:

```tsx
import { useAgentBusy } from "sideagent";

function SaveButton() {
  const busy = useAgentBusy();
  return <button disabled={busy}>Save</button>;
}
```

With `AgentChat` alone, count calls with the hooks. Every `onOperationStart` is followed by exactly one `onAnyOperation` (the call finished) or `onOperationAbort` (the outcome is unknown). Abort fires before `onTurnEnd`.

```tsx
const [busy, setBusy] = useState(0);

<AgentChat
  endpoint="/agent"
  hooks={{
    onOperationStart: () => setBusy((n) => n + 1),
    onAnyOperation: () => setBusy((n) => n - 1),
    onOperationAbort: () => setBusy((n) => n - 1),
  }}
/>;
```

- A call starts after the user approves, so the app is not blocked while the approval card waits.
- After an abort the call may still have run on the server. Refetch the data it touches.
- Blocking input only guards this tab. To prevent conflicting writes from other tabs or users, enforce it in your API.

### Details

- `status` is the HTTP status from your API. `0` means the call failed before a response: network error, timeout or a blocked request. `result` is then `{ error }`.
- `onInvalidate` fires only when `status < 400`. It does not fire for failures, rejected approvals or denied calls.
- A rejected approval fires no operation hook, because the call never ran.
- Knowledge search fires `onOperationStart` and `onAnyOperation` with `operationId: "search_knowledge"`. Filter on `operationId` if you only care about your own API.
- A pending approval restored after a page refresh fires `onApprovalRequested` once when it is shown. Answering it runs as a turn: `onTurnStart`, the operation hooks, then `onTurnEnd`. If the connection drops there, `onError` fires with code `network`.
- `result` is the response body after `responseFields` filtering and the `maxResultBytes` cap. It can be truncated.
- A hook that throws is caught and logged to the console as `[sideagent] hook threw:`. It never breaks the chat. Hooks are synchronous: do not rely on the chat waiting for a returned promise.
