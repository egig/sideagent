import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { AgentConfig } from "./config.js";
import type { KnowledgeBase } from "./knowledge/index.js";
import type { Operation } from "./openapi.js";

export interface DoctorReport {
  ok: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
  tools: { operationId: string; method: string; path: string; approval: "required" | "auto" }[];
  knowledge?: { id: string; title: string; url?: string; chunks: number; error?: string }[];
}

type Check = DoctorReport["checks"][number];

const PING_TOOL = {
  type: "function" as const,
  function: { name: "ping", description: "ping", parameters: { type: "object", properties: {} } },
};

async function checkInjectedModel(m: BaseChatModel): Promise<Check> {
  try {
    if (!m.bindTools) return { name: "llm tool calling", ok: false, detail: "model has no bindTools()" };
    const reply = await m.bindTools([PING_TOOL]).invoke("Call the ping tool.");
    const called = ((reply as { tool_calls?: unknown[] }).tool_calls?.length ?? 0) > 0;
    return { name: "llm tool calling", ok: called, detail: called ? "supported" : "model did not return a tool call" };
  } catch (e) {
    return { name: "llm", ok: false, detail: (e as Error).message };
  }
}

async function checkHttpLlm(cfg: NonNullable<AgentConfig["llm"]>): Promise<Check> {
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: "user", content: "Call the ping tool." }],
        tools: [PING_TOOL],
        tool_choice: { type: "function", function: { name: "ping" } },
      }),
    });
    if (!res.ok) return { name: "llm", ok: false, detail: `HTTP ${res.status}` };
    const j: any = await res.json();
    const called = j?.choices?.[0]?.message?.tool_calls?.length > 0;
    return { name: "llm tool calling", ok: called, detail: called ? "supported" : "model did not return a tool call" };
  } catch (e) {
    return { name: "llm", ok: false, detail: (e as Error).message };
  }
}

export interface DoctorDeps {
  config: AgentConfig;
  ops: Operation[];
  /** The model passed to createAgent, if any; otherwise config.llm is probed over HTTP. */
  givenModel?: BaseChatModel;
  knowledge?: KnowledgeBase;
}

export async function runDoctor({ config, ops, givenModel, knowledge }: DoctorDeps): Promise<DoctorReport> {
  const checks: Check[] = [];
  checks.push({ name: "spec", ok: true, detail: `${ops.length} operation(s) exposed` });
  if (config.approvalSecret) checks.push({ name: "approvalSecret", ok: true, detail: "set" });
  else checks.push({ name: "approvalSecret", ok: false, detail: "not set; random per instance" });
  checks.push(await (givenModel ? checkInjectedModel(givenModel) : checkHttpLlm(config.llm!)));
  if (knowledge) {
    const st = knowledge.status();
    const bad = st.filter((x) => x.error);
    checks.push({
      name: "knowledge",
      ok: bad.length === 0 && st.some((x) => x.chunks > 0),
      detail: `${st.reduce((n, x) => n + x.chunks, 0)} chunk(s) from ${st.length} source(s)${bad.length ? `; failed: ${bad.map((b) => b.id).join(", ")}` : ""}`,
    });
  }
  return {
    ok: checks.every((c) => c.ok),
    checks,
    knowledge: knowledge?.status().map(({ id, title, url, chunks, error }) => ({ id, title, url, chunks, error })),
    tools: ops.map((o) => ({
      operationId: o.operationId,
      method: o.method.toUpperCase(),
      path: o.path,
      approval: o.needsApproval ? "required" : "auto",
    })),
  };
}
