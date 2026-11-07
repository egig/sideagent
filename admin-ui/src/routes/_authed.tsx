import { Link, Outlet, createFileRoute, redirect, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AgentProvider } from "sideagent";
import { config } from "~/config";
import { authClient, sessionQuery } from "~/app/auth";
import { agentsQuery } from "~/app/api/agents";
import { AgentSwitcher } from "~/app/switcher";
import { Brand, Icon, UserMenu } from "~/app/ui";
import { useLocale, useT } from "~/i18n";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.fetchQuery(sessionQuery);
    if (!session) throw redirect({ to: "/sign-in" });
    return { user: session.user };
  },
  component: Shell,
});

function Shell() {
  const { user } = Route.useRouteContext();
  const appAgent = config.assistant;
  const { agentId } = useParams({ strict: false });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const t = useT();
  const locale = useLocale();
  // Setup stays in the menu until the agent is active; after that it is reached from the Overview.
  const { data: agents } = useQuery(agentsQuery);
  const inSetup = agents?.find((a) => a.id === agentId)?.status === "inactive";

  async function signOut() {
    await authClient.signOut();
    queryClient.clear();
    queryClient.setQueryData(sessionQuery.queryKey, null);
    await navigate({ to: "/sign-in" });
  }

  const shell = (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex flex-col gap-5 border-b border-line bg-sidebar p-4 md:sticky md:top-0 md:h-screen md:w-64 md:flex-none md:overflow-y-auto md:border-r md:border-b-0">
        <div className="px-2 py-1">
          <Brand size={32} />
        </div>
        <AgentSwitcher currentId={agentId} />
        {agentId && (
          <nav aria-label={t.shell.agentNav} className="flex flex-col gap-0.5">
            {inSetup && (
              <Link to="/agents/$agentId/setup" params={{ agentId }} className="nav-item">
                <Icon name="list" />
                {t.shell.setup}
              </Link>
            )}
            <Link to="/agents/$agentId" params={{ agentId }} className="nav-item" activeOptions={{ exact: true }}>
              <Icon name="grid" />
              {t.shell.overview}
            </Link>
            <Link to="/agents/$agentId/knowledge" params={{ agentId }} className="nav-item">
              <Icon name="book" />
              {t.shell.knowledge}
            </Link>
            <Link to="/agents/$agentId/audit" params={{ agentId }} className="nav-item">
              <Icon name="file" />
              {t.shell.audit}
            </Link>
            <Link to="/agents/$agentId/settings" params={{ agentId }} className="nav-item">
              <Icon name="sliders" />
              {t.shell.settings}
            </Link>
          </nav>
        )}
        <div className="mt-auto flex flex-col gap-2">
          {config.docsUrl && (
            <a className="nav-item" href={config.docsUrl}>
              <Icon name="docs" />
              {t.common.docs}
            </a>
          )}
          <div className="border-t border-line pt-3">
            <UserMenu email={user.email} onSignOut={signOut} />
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col bg-canvas">
        <Outlet />
      </div>
    </div>
  );
  return appAgent ? (
    // locale: the model sees the UI language, so it can answer in it.
    <AgentProvider
      endpoint={`/v1/agents/${appAgent.agentId}`}
      publishableKey={appAgent.publishableKey}
      mode="sidebar"
      credentials="same-origin"
      placeholder={t.common.askPlaceholder}
      context={{ app: "dashboard", agentId, locale }}
    >
      {shell}
    </AgentProvider>
  ) : (
    shell
  );
}
