import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentChat } from "./client/AgentChat";
import { BusyContext, useAgentBusy } from "./client/context";

// Here, not in client/: the isolation test forbids any "server" import there, react-dom/server included.
describe("AgentChat with a publishable key", () => {
  it("throws during render on a malformed key", () => {
    expect(() => renderToStaticMarkup(<AgentChat publishableKey="pk_nope" />)).toThrow(
      "sideagent: invalid publishableKey",
    );
  });
});

describe("useAgentBusy", () => {
  const Probe = () => <span>busy={String(useAgentBusy())}</span>;

  it("reads the busy state AgentProvider shares", () => {
    expect(
      renderToStaticMarkup(
        <BusyContext.Provider value={false}>
          <Probe />
        </BusyContext.Provider>,
      ),
    ).toContain("busy=false");
    expect(
      renderToStaticMarkup(
        <BusyContext.Provider value>
          <Probe />
        </BusyContext.Provider>,
      ),
    ).toContain("busy=true");
  });

  it("throws outside AgentProvider", () => {
    expect(() => renderToStaticMarkup(<Probe />)).toThrow("useAgentBusy must be used inside <AgentProvider>");
  });
});
