import { createFileRoute, redirect } from "@tanstack/react-router";
import { agentsQuery } from "~/app/api/agents";

// No agent-independent dashboard yet: open the newest agent (its setup while it is inactive), or start one.
export const Route = createFileRoute("/_authed/")({
  beforeLoad: async ({ context }) => {
    const [latest] = await context.queryClient.fetchQuery(agentsQuery);
    if (!latest) throw redirect({ to: "/new" });
    throw redirect({
      to: latest.status === "active" ? "/agents/$agentId" : "/agents/$agentId/setup",
      params: { agentId: latest.id },
    });
  },
});
