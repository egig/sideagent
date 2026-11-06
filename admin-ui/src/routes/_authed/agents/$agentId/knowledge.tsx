import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { agentQuery } from "~/app/api/agents";
import { NeedsModel, Sources } from "~/app/knowledge/sources";
import { Instructions } from "~/app/settings/instructions";
import { Page, StatusBadge } from "~/app/ui";
import { useT } from "~/i18n";

export const Route = createFileRoute("/_authed/agents/$agentId/knowledge")({
  component: Knowledge,
});

function Knowledge() {
  const { agentId } = Route.useParams();
  const { data: detail } = useSuspenseQuery(agentQuery(agentId));
  const { agent } = detail;
  const t = useT().knowledge;

  return (
    <Page title={t.title} actions={<StatusBadge status={agent.status} />}>
      <p className="m-0 text-ink-muted">{t.lead}</p>
      <NeedsModel agent={agent} />
      <Sources agentId={agentId} />
      {/* key: a different agent starts the form fresh. */}
      <Instructions key={agent.id} agent={agent} />
    </Page>
  );
}
