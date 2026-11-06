import { Link, createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { agentQuery } from "~/app/api/agents";
import { SETTINGS_TABS, type SettingsTab } from "~/app/settings/tabs";
import { Page } from "~/app/ui";
import { useT } from "~/i18n";
import { General } from "~/app/settings/general";
import { Llm } from "~/app/settings/llm";
import { LlmCheckPanel } from "~/app/settings/llm-check";
import { UserAuth } from "~/app/settings/user-auth";
import { DangerZone } from "~/app/settings/danger-zone";

export const Route = createFileRoute("/_authed/agents/$agentId/settings")({
  validateSearch: (search: Record<string, unknown>): { tab?: SettingsTab } =>
    SETTINGS_TABS.includes(search.tab as SettingsTab) ? { tab: search.tab as SettingsTab } : {},
  component: Settings,
});

function Settings() {
  const { agentId } = Route.useParams();
  const { tab = "general" } = Route.useSearch();
  const { data } = useSuspenseQuery(agentQuery(agentId));
  const { agent } = data;
  const t = useT().settings;
  return (
    <Page title={t.title}>
      {/* Tabs are links: each tab has its own URL, so "Set up" links can open one. */}
      <nav aria-label={t.sections} className="-mb-2 flex gap-1 overflow-x-auto border-b border-line">
        {SETTINGS_TABS.map((id) => (
          <Link
            key={id}
            to="/agents/$agentId/settings"
            params={{ agentId }}
            search={{ tab: id }}
            aria-current={tab === id ? "page" : undefined}
            className={`inline-flex min-h-10 items-center border-b-2 px-3 font-medium whitespace-nowrap no-underline ${
              tab === id ? "border-ink-muted text-ink" : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t.tabs[id]}
          </Link>
        ))}
      </nav>
      {/* key: a different agent starts the form fresh. */}
      {tab === "general" && <General key={agent.id} agent={agent} />}
      {tab === "llm" && (
        <>
          <Llm key={agent.id} detail={data} />
          <div className="card p-5">
            <LlmCheckPanel
              key={agent.id}
              agentId={agent.id}
              disabled={!data.readiness.find((r) => r.id === "llm")?.ok}
            />
          </div>
        </>
      )}
      {tab === "auth" && <UserAuth key={agent.id} agent={agent} />}
      {tab === "danger" && <DangerZone agent={agent} />}
    </Page>
  );
}
