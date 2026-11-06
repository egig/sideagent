// Where an agent is in setup (the guided flow on /agents/:id/setup). Steps are read from the server, not kept in the
// page, so a reload or another browser shows the same progress: the readiness items (D-26) for the settings, and the
// audit log for "tried it in the preview" and "a real request arrived".
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AgentDetail } from "@shared/api";
import { auditQuery, type AuditFilters } from "~/app/api/agents";

export const STEPS = ["llm", "knowledge", "try", "deploy", "live"] as const;
export type Step = (typeof STEPS)[number];

export const filters = (event: string, result: AuditFilters["result"], range: AuditFilters["range"]): AuditFilters => ({
  event,
  result,
  range,
  user: "",
  page: 1,
});

// "Skip for now" on the preview step is remembered in this browser only.
const skipKey = (agentId: string) => `sideagent.setup.skipTry.${agentId}`;
function readSkip(agentId: string) {
  try {
    return localStorage.getItem(skipKey(agentId)) === "1";
  } catch {
    return false;
  }
}

export function useSetupProgress({ agent, readiness }: AgentDetail, opts: { watch?: Step } = {}) {
  const ready = (id: string) => readiness.find((r) => r.id === id)?.ok ?? false;
  const [skipped, setSkipped] = useState(() => readSkip(agent.id));
  // Polled only while that step is on screen and not done yet.
  const tried = useQuery({
    ...auditQuery(agent.id, filters("preview.turn", "ok", "30d")),
    refetchInterval: (q) => (opts.watch === "try" && !q.state.data?.total ? 3000 : false),
  });
  const active = agent.status === "active";
  const turns = useQuery({
    ...auditQuery(agent.id, filters("chat.turn", "", "30d")),
    enabled: active,
    refetchInterval: (q) => (opts.watch === "live" && !q.state.data?.total ? 3000 : false),
  });

  const done: Record<Step, boolean> = {
    llm: ready("llm"),
    knowledge: ready("content"),
    try: skipped || (tried.data?.total ?? 0) > 0,
    deploy: ready("origins") && ready("auth"),
    live: active && (turns.data?.total ?? 0) > 0,
  };
  const count = STEPS.filter((s) => done[s]).length;
  // A step opens once every step before it is done.
  const unlocked = (s: Step) => STEPS.slice(0, STEPS.indexOf(s)).every((p) => done[p]);
  const next = STEPS.find((s) => !done[s]) ?? null;

  function skipTry() {
    try {
      localStorage.setItem(skipKey(agent.id), "1");
    } catch {
      // Storage blocked: the skip lasts until the page reloads.
    }
    setSkipped(true);
  }

  return { done, count, total: STEPS.length, unlocked, next, active, skipped, skipTry, loading: tried.isPending };
}
