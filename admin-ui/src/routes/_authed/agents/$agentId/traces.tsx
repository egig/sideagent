import { createFileRoute } from "@tanstack/react-router";
import { Traces } from "~/app/traces";
import { Page } from "~/app/ui";
import { useT } from "~/i18n";

export const Route = createFileRoute("/_authed/agents/$agentId/traces")({
  component: TracesPage,
});

function TracesPage() {
  const { agentId } = Route.useParams();
  const { traces: t } = useT();
  return (
    <Page title={t.title}>
      <Traces agentId={agentId} />
    </Page>
  );
}
