// Instructions: added to the system prompt. On the Knowledge page and in setup step 2, beside the knowledge it shapes.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Agent } from "@shared/api";
import { INSTRUCTIONS_MAX } from "@shared/limits";
import { updateGeneral } from "~/app/api/agents";
import { errorMessage, fieldErrors } from "~/app/api/client";
import { Alert, Field, Section } from "~/app/ui";
import { useApply, SaveFooter } from "~/app/settings/form";
import { formatNumber, useLocale, useT } from "~/i18n";

export function Instructions({ agent }: { agent: Agent }) {
  const {
    common,
    settings: { general: t },
  } = useT();
  const locale = useLocale();
  const apply = useApply(agent.id);
  const [instructions, setInstructions] = useState(agent.instructions);
  const save = useMutation({ mutationFn: () => updateGeneral(agent.id, { instructions }), onSuccess: apply });
  const errors = fieldErrors(save.error) ?? {};
  const dirty = instructions !== agent.instructions;

  return (
    <form
      className="card m-0"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Section id="instructions-section" title={t.instructions} explanation={t.instructionsExplanation}>
        {save.error && !Object.keys(errors).length && <Alert>{errorMessage(save.error, common.notSaved)}</Alert>}
        <Field
          id="instructions"
          label={t.instructions}
          hint={t.instructionsHint(formatNumber(instructions.length, locale), formatNumber(INSTRUCTIONS_MAX, locale))}
          error={errors.instructions}
        >
          <textarea
            id="instructions"
            className="input min-h-28 py-2"
            maxLength={INSTRUCTIONS_MAX}
            placeholder={t.instructionsPlaceholder}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </Field>
      </Section>
      <SaveFooter dirty={dirty} pending={save.isPending} onDiscard={() => setInstructions(agent.instructions)} />
    </form>
  );
}
