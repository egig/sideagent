// Allowed origins: the pages that may embed the chat. In Settings, General and in setup step 4.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Agent } from "@shared/api";
import { updateGeneral } from "~/app/api/agents";
import { errorMessage, fieldErrors } from "~/app/api/client";
import { Alert, Icon, Section } from "~/app/ui";
import { useApply, SaveFooter, sameList } from "~/app/settings/form";
import { useT } from "~/i18n";

const clean = (value: string) => value.trim().replace(/\/$/, "");

export function Origins({ agent }: { agent: Agent }) {
  const {
    common,
    settings: { general: t },
  } = useT();
  const apply = useApply(agent.id);
  const [origins, setOrigins] = useState(agent.allowedOrigins);
  const [origin, setOrigin] = useState("");
  // A value typed but not yet added is saved too, so it is never lost.
  const pending = clean(origin);
  const next = pending && !origins.includes(pending) ? [...origins, pending] : origins;
  const save = useMutation({
    mutationFn: () => updateGeneral(agent.id, { allowedOrigins: next }),
    onSuccess: async (detail) => {
      setOrigins(detail.agent.allowedOrigins);
      setOrigin("");
      await apply(detail);
    },
  });
  const errors = fieldErrors(save.error) ?? {};
  const dirty = !sameList(next, agent.allowedOrigins);

  function addOrigin() {
    if (pending && !origins.includes(pending)) setOrigins([...origins, pending]);
    setOrigin("");
  }

  return (
    <form
      className="card m-0"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Section id="origins-section" title={t.origins} explanation={t.originsExplanation}>
        {save.error && !Object.keys(errors).length && <Alert>{errorMessage(save.error, common.notSaved)}</Alert>}
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
      </Section>
      <SaveFooter
        dirty={dirty}
        pending={save.isPending}
        onDiscard={() => {
          setOrigins(agent.allowedOrigins);
          setOrigin("");
        }}
      />
    </form>
  );
}
