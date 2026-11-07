// Settings, Danger zone: delete.
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Agent } from "@shared/api";
import { agentQuery, agentsQuery, deleteAgent } from "~/app/api/agents";
import { Alert, ConfirmDialog } from "~/app/ui";
import { useT } from "~/i18n";

export function DangerZone({ agent }: { agent: Agent }) {
  const {
    common,
    settings: { danger: t },
  } = useT();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => deleteAgent(agent.id),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: agentQuery(agent.id).queryKey });
      await queryClient.invalidateQueries({ queryKey: agentsQuery.queryKey, exact: true });
      await navigate({ to: "/" });
    },
  });

  return (
    <section className="card border-line-strong" aria-labelledby="danger-heading">
      <div className="border-b border-line px-6 py-4">
        <h2 id="danger-heading" className="m-0 text-[17px] leading-6 font-semibold">
          {t.title}
        </h2>
        <p className="hint">{t.hint}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
        <div>
          <p className="m-0 font-medium">{t.deleteTitle}</p>
          <p className="m-0 text-[13px] text-ink-muted">{t.deleteHint}</p>
        </div>
        <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>
          {t.delete}
        </button>
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t.deleteTitle}
          description={t.deleteHint}
          confirmLabel={remove.isPending ? t.deleting : t.deleteNamed(agent.name)}
          pending={remove.isPending}
          onConfirm={() => remove.mutate()}
        />
      </div>
      {remove.error && (
        <div className="px-6 pb-4">
          <Alert>{common.retry}</Alert>
        </div>
      )}
    </section>
  );
}
