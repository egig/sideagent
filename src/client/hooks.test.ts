import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../protocol.js";
import { turnHooks, type AgentHooks } from "./hooks.js";

function recorder() {
  const calls: string[] = [];
  const hooks: AgentHooks = {
    onTurnStart: () => calls.push("turnStart"),
    onTurnEnd: () => calls.push("turnEnd"),
    onOperationStart: (e) => calls.push(`start:${e.callId}:${e.operationId}`),
    onOperationAbort: (e) => calls.push(`abort:${e.callId}:${e.operationId}`),
    onAnyOperation: (e) => calls.push(`complete:${e.operationId}:${e.status}`),
    onError: (e) => calls.push(`error:${e.code}`),
  };
  return { calls, hooks };
}

const start = (callId: string, operationId: string): AgentEvent => ({ type: "tool.start", callId, operationId });
const complete = (callId: string, operationId: string, status = 200): AgentEvent => ({
  type: "tool.complete",
  callId,
  operationId,
  status,
  args: {},
  result: {},
  invalidates: [],
});

describe("turnHooks", () => {
  it("brackets each operation with start and complete inside the turn", () => {
    const { calls, hooks } = recorder();
    const turn = turnHooks(hooks);
    turn.event(start("c1", "listInvoices"));
    turn.event(complete("c1", "listInvoices"));
    turn.event(start("c2", "createInvoice"));
    turn.event(complete("c2", "createInvoice", 0));
    turn.end();
    expect(calls).toEqual([
      "turnStart",
      "start:c1:listInvoices",
      "complete:listInvoices:200",
      "start:c2:createInvoice",
      "complete:createInvoice:0",
      "turnEnd",
    ]);
  });

  it("aborts an operation whose result never arrived, before onTurnEnd", () => {
    const { calls, hooks } = recorder();
    const turn = turnHooks(hooks);
    turn.event(start("c1", "createInvoice"));
    turn.end();
    expect(calls).toEqual(["turnStart", "start:c1:createInvoice", "abort:c1:createInvoice", "turnEnd"]);
  });

  it("does not abort twice when end runs again", () => {
    const { calls, hooks } = recorder();
    const turn = turnHooks(hooks);
    turn.event(start("c1", "createInvoice"));
    turn.end();
    turn.end();
    expect(calls.filter((c) => c.startsWith("abort"))).toHaveLength(1);
  });

  it("fires no operation start for a rejected approval", () => {
    const { calls, hooks } = recorder();
    const turn = turnHooks(hooks);
    turn.event({ type: "tool.rejected", callId: "c1", operationId: "deleteInvoice" });
    turn.event({ type: "error", code: "timeout", message: "Timed out" });
    turn.end();
    expect(calls).toEqual(["turnStart", "error:timeout", "turnEnd"]);
  });

  it("keeps going when a hook throws", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { calls, hooks } = recorder();
    hooks.onOperationStart = () => {
      throw new Error("boom");
    };
    const turn = turnHooks(hooks);
    turn.event(start("c1", "createInvoice"));
    turn.end();
    expect(calls).toEqual(["turnStart", "abort:c1:createInvoice", "turnEnd"]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
