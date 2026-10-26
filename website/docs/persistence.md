---
sidebar_position: 6
title: Persistence
---

By default everything is kept in memory and lost on restart. In production, pass your own storage to `createAgent`. All three options are independent and optional.

| Option | Holds | Default |
|---|---|---|
| `checkpointer` | Chat messages and pending approvals | In-memory |
| `threadStore` | History list per user (id, title, updatedAt) | In-memory |
| `vectorStore` | Knowledge embeddings | In-memory |

```ts
createAgent({ …, checkpointer, threadStore, vectorStore });
```

Startup logs a warning when `checkpointer` is missing, or when it is set without `threadStore`.

## Messages: `checkpointer`

Any LangGraph `BaseCheckpointSaver`. Postgres example:

```ts
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

const checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL!);
await checkpointer.setup(); // creates the tables; run once at startup
```

When a user deletes a thread, sideagent calls `checkpointer.deleteThread(threadId)` if the saver has it.

## History list: `threadStore`

Implement `ThreadStore`. Key every row by `(userId, threadId)`.

```ts
import type { ThreadStore } from "sideagent/server";

const threadStore: ThreadStore = {
  // newest first
  list: async (userId) => /* SELECT id, title, updated_at AS "updatedAt" … ORDER BY updated_at DESC */,
  has: async (userId, threadId) => /* SELECT 1 … WHERE user_id = $1 AND id = $2 */,
  // create with `title` if new; otherwise only bump updatedAt. Never overwrite the title.
  touch: async (userId, threadId, title) => /* INSERT … ON CONFLICT (user_id, id) DO UPDATE SET updated_at = now() */,
  delete: async (userId, threadId) => /* DELETE … WHERE user_id = $1 AND id = $2 */,
};
```

- `has` is the ownership check. A thread that is not in the user's own index returns 404, even if the id is guessed.
- `updatedAt` is a number of milliseconds since epoch.
- The client shows at most 50 threads. `MemoryThreadStore` keeps at most 200 per user; your store has no such cap unless you add one.

## Knowledge: `vectorStore`

Implement `VectorStore`. `replace` swaps all chunks of one source. `search` returns the nearest chunks.

```ts
import type { VectorStore } from "sideagent/server";

const vectorStore: VectorStore = {
  replace: async (sourceId, chunks) => {
    // chunks: { text, vector: number[], meta: { sourceId, title, url? } }[]
    // delete rows for sourceId, then insert chunks (one transaction)
  },
  search: async (vector, k) => {
    // return { text, score, meta }[], best first. Example with pgvector: ORDER BY embedding <=> $1 LIMIT $2
  },
};
```

- `vector` size is set by your embedding model. The column dimension must match it. Changing `embeddings.model` needs re-embedding, so clear the table first.
- With a persistent store, the agent still re-embeds sources on every start. The store only avoids keeping them in process memory.
