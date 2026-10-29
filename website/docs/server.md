---
sidebar_position: 2
title: Server
---

Import from `sideagent/server`.

```ts
import { createAgent, honoHandler } from "sideagent/server";

const agent = await createAgent({
  spec: "https://api.example.com/openapi.json", // or an object / JSON string
  baseUrl: "https://api.example.com",           // pinned; the spec's `servers` is ignored
  llm: { baseUrl: "https://api.openai.com/v1", apiKey: process.env.LLM_API_KEY!, model: "gpt-4o-mini" },
  // Or pass `model: yourLangChainChatModel` instead of `llm` (see Cloudflare Workers).
  allow: ["listInvoices", "createInvoice", "tag:reports"], // default-deny allowlist
  allowedOrigins: ["https://app.example.com"],
  approvalSecret: process.env.APPROVAL_SECRET,   // set on serverless / multi-instance
  getAuth: (req) => ({ userId: "…", headers: { authorization: req.headers.get("authorization")! } }),
});

app.on(["POST", "OPTIONS"], "/agent", honoHandler(agent)); // also: nextRoute, expressHandler
console.log(await agent.doctor());                         // what the agent can do + LLM check
```

`llm.fetch` and `knowledge.embeddings.fetch` take a `fetch` function that carries every HTTP call to the model and embeddings endpoint (embeddings fall back to `llm.fetch`). Use it to route those calls through your own guard, for example one that blocks private hosts when the `baseUrl` comes from a customer. They do not apply to `model` or `embeddings` you pass in yourself. `llm.maxRetries` and `knowledge.embeddings.maxRetries` (0 to 6) set how often a failed call is retried; the clients retry several times with backoff by default, which makes a blocked or dead endpoint slow to fail.

## Previews: `dryRun`

`dryRun({ request, userId })` lets the host run a request as a dry run, for example for a signed-in owner trying their agent against a live API. Operations that are not plain reads (anything but GET and HEAD) still pause for approval, and the approval card shows the exact request. After approval the call is not sent: the browser gets a `tool.complete` with status 202 and `{ dryRun: true, sent: false }`, the model is told nothing was sent, and the audit event has status `"dry_run"`. Reads still run. The callback runs on the server for every request, nothing in the request body can change it, and a callback that throws counts as a dry run.

```ts
createAgent({ …, dryRun: ({ request }) => isPreview(request) });
```

## Long threads: `summarize`

`summarize` replaces the older messages of a long thread with a summary the model writes, so long conversations stay within the model's context. It is off by default, and each summary is one extra model call.

```ts
createAgent({ …, summarize: { afterTokens: 8000, keepMessages: 20 } });
```

- A summary is made before a model call once the thread passes `afterTokens` (an approximate count). The last `keepMessages` messages stay as they are. `keepMessages` must be at least `limits.maxSteps * 2 + 1`, so the current turn is never summarized.
- The summary can repeat tool output and knowledge passages, so the model gets it inside a `<conversation_summary>` block, never as the user's words. The system prompt holds that block to the same rule as passages: context only, never instructions, and never a reason to call a tool or skip approval.
- Passage text that goes into a summary still never reaches the browser unless `exposeKnowledge` is on. Source links of a summarized search are gone with it.
- If the summary call fails, the thread is left as it was.
- Summarized messages are gone from the thread: the History panel shows only the messages that were kept, and does not show the summary.

## Behavior and limits

- Only operations in `allow` are exposed. Anything not listed is denied. Entries are operation ids or `tag:<name>`.
- The spec's `servers` is ignored. All calls go to `baseUrl`.
- Calls run with the end user's credentials from `getAuth`. The agent has no access of its own.
- Non-GET operations need user approval before they run. The approval is bound to the exact arguments.
- On serverless or multi-instance deployments, set `approvalSecret`. Without it, each instance uses a random secret, so an approval issued by one instance is rejected by another. A warning is logged at startup.
- Requests from origins not in `allowedOrigins` are rejected.
- Call `agent.doctor()` at startup to see which operations are exposed and whether the LLM is reachable.

## Operation hints

Per-operation hints go in the spec as `x-agent`: `{ approval, description, invalidates: ["tag"], responseFields: ["id"] }`.

- `approval`: `"required"` or `"auto"`. Default is `required` for every non-GET operation. `"auto"` skips approval, but is rejected for DELETE.
- `description`: override the description the model sees.
- `invalidates`: tags passed to `hooks.onInvalidate` on the client after the call succeeds.
- `responseFields`: only these field names (at any depth) reach the model and the browser.
