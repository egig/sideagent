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
  allow: ["listInvoices", "createInvoice", "tag:reports"], // default-deny allowlist
  allowedOrigins: ["https://app.example.com"],
  approvalSecret: process.env.APPROVAL_SECRET,   // set on serverless / multi-instance
  getAuth: (req) => ({ userId: "…", headers: { authorization: req.headers.get("authorization")! } }),
});

app.on(["POST", "OPTIONS"], "/agent", honoHandler(agent)); // also: nextRoute, expressHandler
console.log(await agent.doctor());                         // what the agent can do + LLM check
```

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
