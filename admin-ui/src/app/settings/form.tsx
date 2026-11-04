// Pieces shared by the settings sections: apply a saved agent to the cache, the Save/Discard footer.
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AgentDetail } from "@shared/api";
import { agentQuery, agentsQuery } from "~/app/api/agents";
import { CardFooter } from "~/app/ui";
import { useT } from "~/i18n";

export function useApply(agentId: string) {
  const queryClient = useQueryClient();
  return async (detail: AgentDetail) => {
    queryClient.setQueryData(agentQuery(agentId).queryKey, detail);
    await queryClient.invalidateQueries({ queryKey: agentsQuery.queryKey, exact: true });
  };
}

export function SaveFooter({
  dirty,
  pending,
  onDiscard,
  label,
  note,
}: {
  dirty: boolean;
  pending: boolean;
  onDiscard: () => void;
  label?: string;
  note?: ReactNode;
}) {
  const t = useT().common;
  return (
    <CardFooter>
      {note && <span className="mr-auto text-[13px] text-ink-muted">{note}</span>}
      <button type="button" className="btn" disabled={!dirty || pending} onClick={onDiscard}>
        {t.discard}
      </button>
      <button type="submit" className="btn btn-primary" disabled={!dirty || pending}>
        {pending ? t.saving : (label ?? t.saveChanges)}
      </button>
    </CardFooter>
  );
}

export const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
