// Settings, Danger zone: delete.
import { useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Agent } from "@shared/api";
import { agentQuery, agentsQuery, deleteAgent } from "~/app/api/agents";
import { Alert } from "~/app/ui";
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
        <AlertDialog.Root open={confirming} onOpenChange={setConfirming}>
          <AlertDialog.Trigger className="btn btn-danger">{t.delete}</AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-scrim" />
            <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-[20px] border border-line bg-surface-raised p-6 shadow-lg outline-none">
              <AlertDialog.Title className="m-0 text-[17px] leading-6 font-semibold">{t.deleteTitle}</AlertDialog.Title>
              <AlertDialog.Description className="mt-1 mb-0 text-ink-muted">{t.deleteHint}</AlertDialog.Description>
              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <AlertDialog.Close className="btn" disabled={remove.isPending}>
                  {common.cancel}
                </AlertDialog.Close>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => remove.mutate()}
                  disabled={remove.isPending}
                >
                  {remove.isPending ? t.deleting : t.deleteNamed(agent.name)}
                </button>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </div>
      {remove.error && (
        <div className="px-6 pb-4">
          <Alert>{common.retry}</Alert>
        </div>
      )}
    </section>
  );
}
