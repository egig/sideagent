import type { ToolMessage } from "@langchain/core/messages";
import { interrupt } from "@langchain/langgraph";
import { signApproval } from "../../security/approval.js";
import type { AgentConfig } from "../../config.js";
import { executeOperation } from "../../executor.js";
import { validateArgs, type Operation } from "../../openapi.js";
import { wrapToolResult, type AuditEvent } from "../../security/policy.js";
import type { PendingApproval } from "../types.js";
import { toolResult, type ToolContext } from "./context.js";

const APPROVAL_TTL_MS = 10 * 60_000;

/** Validates, asks for approval when the operation needs it, then calls the API. */
export async function runOperation(op: Operation, rawArgs: unknown, deps: { config: AgentConfig; secret: string }, ctx: ToolContext): Promise<ToolMessage> {
  const { config, secret } = deps;
  const { callId, threadId, run, write, audit, base } = ctx;

  let args: Record<string, any>;
  try {
    args = validateArgs(op, rawArgs);
  } catch (e) {
    const msg = (e as Error).message;
    audit({ ...base, args: rawArgs, status: "error", approval: "auto", error: msg });
    return toolResult(callId, `Error: invalid arguments: ${msg}`, { error: "invalid arguments" });
  }

  let approval: AuditEvent["approval"] = "auto";
  if (op.needsApproval) {
    // The token binds the exact args shown to the user; see verifyApproval in http/turn.ts.
    const claims = { threadId, callId, operationId: op.operationId, args };
    const { token, expiresAt } = await signApproval(secret, claims, APPROVAL_TTL_MS);
    const pending: PendingApproval = {
      callId,
      operationId: op.operationId,
      method: op.method.toUpperCase(),
      path: op.path,
      args,
      token,
      expiresAt,
    };
    const answer = interrupt(pending) as { decision: "approve" | "reject" };
    if (answer.decision !== "approve") {
      audit({ ...base, args, status: "rejected", approval: "rejected" });
      write({ type: "tool.rejected", callId, operationId: op.operationId });
      return toolResult(callId, "The user rejected this action. Do not retry it.", { rejected: true });
    }
    approval = "approved";
  }

  write({ type: "tool.start", callId, operationId: op.operationId });
  const started = Date.now();
  try {
    const res = await executeOperation(
      op,
      args,
      {
        baseUrl: config.baseUrl,
        headers: run.headers,
        callTimeoutMs: config.limits.callTimeoutMs,
        maxResultBytes: config.limits.maxResultBytes,
        allowPrivateNetworks: config.allowPrivateNetworks,
      },
      ctx.signal,
    );
    audit({ ...base, args, status: "executed", approval, httpStatus: res.status, durationMs: Date.now() - started });
    write({
      type: "tool.complete",
      callId,
      operationId: op.operationId,
      status: res.status,
      args,
      result: res.body,
      invalidates: res.status < 400 ? (op.ext.invalidates ?? []) : [],
    });
    // res.body is already filtered by responseFields and size-capped.
    return toolResult(callId, wrapToolResult(op.operationId, res.status, res.body, res.truncated), res.body);
  } catch (e) {
    const msg = (e as Error).message;
    audit({ ...base, args, status: "error", approval, durationMs: Date.now() - started, error: msg });
    write({ type: "tool.complete", callId, operationId: op.operationId, status: 0, args, result: { error: msg }, invalidates: [] });
    return toolResult(callId, `Error calling ${op.operationId}: ${msg}`, { error: msg });
  }
}
