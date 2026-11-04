// Settings, General: name, API base URL, allowed origins, instructions.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Agent } from "@shared/api";
import { INSTRUCTIONS_MAX, NAME_MAX } from "@shared/limits";
import { updateGeneral } from "~/app/api/agents";
import { errorMessage, fieldErrors } from "~/app/api/client";
import { Alert, Field, Icon, Section } from "~/app/ui";
import { useApply, SaveFooter, sameList } from "~/app/settings/form";
import { formatNumber, useLocale, useT } from "~/i18n";

export function General({ agent }: { agent: Agent }) {
  const {
    common,
    settings: { general: t, tabs },
  } = useT();
  const locale = useLocale();
  const apply = useApply(agent.id);
  const [name, setName] = useState(agent.name);
  const [origins, setOrigins] = useState(agent.allowedOrigins);
  const [origin, setOrigin] = useState("");
  const [instructions, setInstructions] = useState(agent.instructions);
  const save = useMutation({
    mutationFn: () => updateGeneral(agent.id, { name: name.trim(), allowedOrigins: origins, instructions }),
    onSuccess: apply,
  });
  const errors = fieldErrors(save.error) ?? {};
  const dirty =
    name.trim() !== agent.name || !sameList(origins, agent.allowedOrigins) || instructions !== agent.instructions;

  function addOrigin() {
    const value = origin.trim().replace(/\/$/, "");
    if (value && !origins.includes(value)) setOrigins([...origins, value]);
    setOrigin("");
  }

  function reset() {
    setName(agent.name);
    setOrigins(agent.allowedOrigins);
    setInstructions(agent.instructions);
  }

  return (
    <form
      className="card m-0"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Section id="general" title={tabs.general} explanation={t.explanation}>
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
        <div>
          <label className="label" htmlFor="origin">
            {t.origins}
          </label>
          {origins.length > 0 && (
            <ul className="m-0 mb-2 flex list-none flex-wrap gap-2 p-0">
              {origins.map((o) => (
                <li
                  key={o}
                  className="inline-flex h-8 items-center gap-1 rounded-md bg-selected pr-1 pl-2.5 font-mono text-[13px]"
                >
                  {o}
                  <button
                    type="button"
                    className="inline-flex size-6 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-ink-muted hover:text-ink"
                    aria-label={common.removeLabel(o)}
                    onClick={() => setOrigins(origins.filter((x) => x !== o))}
                  >
                    <Icon name="x" style={{ width: 14, height: 14 }} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              id="origin"
              className="input font-mono"
              placeholder="https://app.example.com"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addOrigin();
                }
              }}
            />
            <button type="button" className="btn" onClick={addOrigin}>
              {common.add}
            </button>
          </div>
          {Object.entries(errors)
            .filter(([k]) => k.startsWith("allowedOrigins"))
            .slice(0, 1)
            .map(([k, v]) => (
              <p key={k} className="mt-1.5 mb-0 text-[13px] text-danger">
                {v}
              </p>
            ))}
          <p className="hint">{t.originsHint}</p>
        </div>
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
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </Field>
      </Section>
      <SaveFooter dirty={dirty} pending={save.isPending} onDiscard={reset} />
    </form>
  );
}
