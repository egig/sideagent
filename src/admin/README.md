# src/admin

Dashboard API and hosted data plane. Imports flow down only; `layering.test.ts` enforces the rules marked ✔.

```
app.ts, index.ts, node.ts          HTTP shell: createAdmin, static server
control/   data/   auth/           services: dashboard API, /v1/agents/:id, sign-in   (control ⟂ data ✔)
knowledge/  llm.ts  builtin.ts     ingestion, which model an agent uses, host-provided model
security/                          crypto, SSRF guard, bot challenge; no service imports ✔
store/types.ts, store/pg/          AdminStore port and its Postgres adapter; imports no service ✔
api.ts, config.ts, limits.ts,      contract: wire types, validation, constants; no I/O.
retention.ts                       admin-ui imports api.ts and limits.ts directly.
```

The library is reached only through `../server/index.js` ✔.

## Where to add

| Change                    | Files                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| New stored thing or query | `store/types.ts` (port), `store/contract.ts` (behaviour), `store/pg/<area>.ts`, `store/pg/schema.ts` + a new step in `store/pg/migrations.ts` |
| New dashboard route       | `control/<name>.ts`, mount in `control/router.ts`, wire type in `api.ts`                                                                      |
| New check before a turn   | origin, key, end user: `data/access.ts`. Caps and stale index: `data/quota.ts`                                                                |
| New audit reason          | `data/audit.ts` or the place that calls `log(...)`, plus `t.audit.reasons` in admin-ui                                                        |
| New model source          | `data/provider.ts`                                                                                                                            |
| New config field          | `config.ts` (validation), `api.ts` if the dashboard shows it                                                                                  |

Comments cite decision numbers (`D-12`); keep them.
