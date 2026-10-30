import { describe, expect, it, vi } from "vitest";
import { turnHooks, type AgentHooks } from "./hooks.js";

function recorder() {
  const calls: string[] = [];
  const hooks: AgentHooks = {
    onTurnStart: () => calls.push("turnStart"),
    onTurnEnd: () => calls.push("turnEnd"),
    onError: (e) => calls.push(`error:${e.code}`),
  };
  return { calls, hooks };
}

describe("turnHooks", () => {
  it("brackets a turn and reports its errors", () => {
    const { calls, hooks } = recorder();
    const turn = turnHooks(hooks);
    turn.event({ type: "text.delta", text: "hi" });
    turn.event({ type: "error", code: "timeout", message: "Timed out" });
    turn.end();
    expect(calls).toEqual(["turnStart", "error:timeout", "turnEnd"]);
  });

  it("keeps going when a hook throws", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { calls, hooks } = recorder();
    hooks.onTurnStart = () => {
      throw new Error("boom");
    };
    const turn = turnHooks(hooks);
    turn.end();
    expect(calls).toEqual(["turnEnd"]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("works without hooks", () => {
    const turn = turnHooks(undefined);
    expect(() => {
      turn.event({ type: "turn.end" });
      turn.end();
    }).not.toThrow();
  });
});
