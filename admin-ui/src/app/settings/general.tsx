// Settings, General: the agent's name and its allowed origins. Instructions live on the Knowledge page.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Agent } from "@shared/api";
import { NAME_MAX } from "@shared/limits";
import { updateGeneral } from "~/app/api/agents";
import { errorMessage, fieldErrors } from "~/app/api/client";
import { Alert, Field, Section } from "~/app/ui";
import { useApply, SaveFooter } from "~/app/settings/form";
import { Origins } from "~/app/settings/origins";
import { useT } from "~/i18n";

export function General({ agent }: { agent: Agent }) {
  const {
    common,
    settings: { general: t },
  } = useT();
  const apply = useApply(agent.id);
  const [name, setName] = useState(agent.name);
  const save = useMutation({ mutationFn: () => updateGeneral(agent.id, { name: name.trim() }), onSuccess: apply });
  const errors = fieldErrors(save.error) ?? {};
  const dirty = name.trim() !== agent.name;

  return (
    <div className="flex flex-col gap-6">
      <form
        className="card m-0"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Section id="general" title={t.name} explanation={t.explanation}>
          {save.error && !Object.keys(errors).length && <Alert>{errorMessage(save.error, common.notSaved)}</Alert>}
          <Field id="agent-name" label={t.name} error={errors.name}>
            <input
              id="agent-name"
              className="input"
              required
              maxLength={NAME_MAX}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </Section>
        <SaveFooter dirty={dirty} pending={save.isPending} onDiscard={() => setName(agent.name)} />
      </form>
      <Origins agent={agent} />
    </div>
  );
}
