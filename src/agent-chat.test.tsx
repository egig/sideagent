import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentChat } from "./client/AgentChat";

// Here, not in client/: the isolation test forbids any "server" import there, react-dom/server included.
describe("AgentChat with a publishable key", () => {
  it("throws during render on a malformed key", () => {
    expect(() => renderToStaticMarkup(<AgentChat publishableKey="pk_nope" />)).toThrow(
      "sideagent: invalid publishableKey",
    );
  });
});
