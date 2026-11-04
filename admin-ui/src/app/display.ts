// Display helpers for agents: status badges, switcher subtitles, initials, dates in the UI language.
import type { AgentDetail, AgentStatus, AgentSummary, ReadinessItem } from "@shared/api";
import { formatDate as format, useLocale, useT } from "~/i18n";

export const STATUS_BADGE: Record<AgentStatus, string> = { active: "badge-ok", inactive: "badge-mute" };

// Switcher subtitle: says what to do where something is left to do.
export function useStatusDetail(): (a: AgentSummary) => { text: string; tone: "warn" | "mute" } {
  const t = useT().status;
  return (a) => {
    return { text: a.status === "active" ? t.active : t.inactive, tone: "mute" };
  };
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/** The line under a setup item, in the UI language, from the agent (D-26). */
export function useReadinessDetail({ agent, builtin }: AgentDetail): (id: ReadinessItem["id"]) => string {
  const { modes, overview } = useT();
  const t = overview.details;
  return (id) => {
    switch (id) {
      case "content": {
        const sources = agent.knowledge.sources - agent.knowledge.failed;
        const parts = [agent.instructions.trim() && t.instructions, sources > 0 && t.sources(sources)].filter(Boolean);
        return (
          (parts.length ? parts.join(", ") : t.noContent) +
          (agent.knowledge.failed ? t.failed(agent.knowledge.failed) : "")
        );
      }
      case "origins":
        return agent.allowedOrigins.length ? t.origins(agent.allowedOrigins.length) : t.noOrigins;
      case "llm":
        if (!agent.llm) return t.notChosen;
        if (agent.llm.provider === "builtin") return t.builtin(builtin?.model ?? "");
        return agent.llmKey ? agent.llm.model : t.keyMissing;
      case "auth":
        return agent.auth ? modes[agent.auth.mode] : t.notChosen;
    }
  };
}

/** Formats an ISO time in the UI language. */
export function useFormatDate(): (iso: string) => string {
  const locale = useLocale();
  return (iso) => format(iso, locale);
}
