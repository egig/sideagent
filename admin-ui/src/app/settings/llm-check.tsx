// "Test connection": one tiny chat call and one embedding call on the saved LLM settings, so a wrong key or model
// shows here, before any knowledge fails to index.
import { useMutation } from "@tanstack/react-query";
import type { LlmCheck as Result } from "@shared/api";
import { checkLlm } from "~/app/api/agents";
import { Alert, Callout } from "~/app/ui";
import { useT } from "~/i18n";

export const checkPassed = (r: Result | undefined) => !!r && r.chat.ok && r.embeddings.ok;

export function useLlmCheck(agentId: string) {
  return useMutation({ mutationFn: () => checkLlm(agentId) });
}

export function LlmCheckResult({ check }: { check: ReturnType<typeof useLlmCheck> }) {
  const t = useT().settings.llm;
  if (check.error) return <Alert>{t.checkFailed}</Alert>;
  const r = check.data;
  if (!r) return null;
  if (checkPassed(r)) return <Callout tone="ok">{t.checkOk}</Callout>;
  return (
    <Callout tone="bad">
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {!r.chat.ok && <li>{t.checkPart(t.model, t.reasons[r.chat.reason] ?? t.reasons.llm_error)}</li>}
        {!r.embeddings.ok && (
          <li>{t.checkPart(t.embeddingModel, t.reasons[r.embeddings.reason] ?? t.reasons.llm_error)}</li>
        )}
      </ul>
    </Callout>
  );
}

/** The button and its result, for the LLM settings tab. Setup step 1 combines the check with "Continue". */
export function LlmCheckPanel({ agentId, disabled }: { agentId: string; disabled?: boolean }) {
  const t = useT().settings.llm;
  const check = useLlmCheck(agentId);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn" disabled={disabled || check.isPending} onClick={() => check.mutate()}>
          {check.isPending ? t.checking : t.check}
        </button>
        <span className="text-[13px] text-ink-muted">{disabled ? t.checkSaveFirst : t.checkHint}</span>
      </div>
      <LlmCheckResult check={check} />
    </div>
  );
}
