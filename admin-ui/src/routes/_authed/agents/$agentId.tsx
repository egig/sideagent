import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { agentQuery } from "~/app/api/agents";
import { ApiError } from "~/app/api/client";
import { PreviewProvider } from "~/app/preview/preview";
import { Page } from "~/app/ui";
import { useT } from "~/i18n";

export const Route = createFileRoute("/_authed/agents/$agentId")({
  component: AgentLayout,
});

function AgentLayout() {
  const { agentId } = Route.useParams();
  const { isPending, error } = useQuery(agentQuery(agentId));
  const t = useT();

  if (isPending) {
    return (
      <Page title={t.common.loading}>
        <p className="m-0 text-ink-muted">{t.agent.loading}</p>
      </Page>
    );
  }
  if (error) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <Page title={missing ? t.agent.notFound : t.agent.unavailable}>
        <p className="m-0 text-ink-muted">{missing ? t.agent.notFoundHint : t.agent.unavailableHint}</p>
        <div>
          <Link to="/" className="btn">
            {t.agent.goToAgents}
          </Link>
        </div>
      </Page>
    );
  }
  return (
    <PreviewProvider agentId={agentId}>
      <Outlet />
    </PreviewProvider>
  );
}
