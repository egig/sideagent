// The audit row of a turn: how the router records it, and the SSE rewrite that finds out how it ended.
import type { AuditInput } from "../store/types.js";
import { llmErrorCode } from "./preview.js";

/** Records one audit event of the current request. `event` defaults to the turn itself. */
export type Log = (input: Omit<AuditInput, "agentId" | "event">, event?: string) => Promise<unknown>;

/**
 * The turn is logged when its stream ends, so a provider failure shows as one. The library says only
 * "the agent failed"; the owner previewing is told why (D-31), the audit row gets a fixed reason.
 */
export function auditStream(
  res: Response,
  opts: { previewOwner: string | null; takeFailure: () => unknown; log: Log },
): Response {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let tail = "";
  let reason: string | null = null;
  const rewrite = (block: string) => {
    if (!block.startsWith("data: ")) return block;
    try {
      const e = JSON.parse(block.slice(6)) as { type?: string; code?: string };
      if (e.type !== "error") return block;
      reason = e.code === "error" ? "llm_error" : (e.code ?? "error");
      const cause = opts.takeFailure();
      if (!opts.previewOwner || e.code !== "error" || cause === undefined) return block;
      return `data: ${JSON.stringify({ ...e, code: llmErrorCode(cause) })}`;
    } catch {
      return block;
    }
  };
  const out = res.body!.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const blocks = (tail + decoder.decode(chunk, { stream: true })).split("\n\n");
        tail = blocks.pop()!;
        if (blocks.length) controller.enqueue(encoder.encode(blocks.map((b) => `${rewrite(b)}\n\n`).join("")));
      },
      async flush(controller) {
        if (tail) controller.enqueue(encoder.encode(rewrite(tail)));
        await opts.log(reason ? { result: "error", reason } : { result: "ok" });
      },
    }),
  );
  return new Response(out, { status: res.status, headers: res.headers });
}
