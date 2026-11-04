import { useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { NAME_MAX } from "@shared/limits";
import { agentQuery, agentsQuery, createAgent } from "~/app/api/agents";
import { errorMessage } from "~/app/api/client";
import { Alert, Field, Page } from "~/app/ui";
import { useT } from "~/i18n";

export const Route = createFileRoute("/_authed/new")({
  component: NewAgent,
});

function NewAgent() {
  const t = useT().newAgent;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: createAgent,
    onSuccess: async (detail) => {
      queryClient.setQueryData(agentQuery(detail.agent.id).queryKey, detail);
      await queryClient.invalidateQueries({ queryKey: agentsQuery.queryKey, exact: true });
      await navigate({ to: "/agents/$agentId/knowledge", params: { agentId: detail.agent.id } });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate({ name: name.trim() });
  }

  return (
    <Page title={t.title}>
      <form className="card m-0 flex max-w-[640px] flex-col gap-5 p-6" onSubmit={onSubmit}>
        {create.error && <Alert>{errorMessage(create.error, t.failed)}</Alert>}
        <Field id="agent-name" label={t.name} hint={t.nameHint}>
          <input
            id="agent-name"
            className="input"
            required
            maxLength={NAME_MAX}
            placeholder={t.namePlaceholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <p className="m-0 text-[13px] text-ink-muted">{t.draftNote}</p>
        <div>
          <button className="btn btn-primary" type="submit" disabled={create.isPending}>
            {create.isPending ? t.creating : t.create}
          </button>
        </div>
      </form>
    </Page>
  );
}
