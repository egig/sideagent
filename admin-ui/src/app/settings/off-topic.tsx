// Off-topic reply: Markdown the chat shows for a question the knowledge does not cover. On the Knowledge page.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Agent } from "@shared/api";
import { OFF_TOPIC_MAX } from "@shared/limits";
import { updateGeneral } from "~/app/api/agents";
import { errorMessage, fieldErrors } from "~/app/api/client";
import { Alert, Field, Section } from "~/app/ui";
import { useApply, SaveFooter } from "~/app/settings/form";
import { formatNumber, useLocale, useT } from "~/i18n";

export function OffTopic({ agent }: { agent: Agent }) {
  const {
    common,
    settings: { general: t },
  } = useT();
  const locale = useLocale();
  const apply = useApply(agent.id);
  const [offTopic, setOffTopic] = useState(agent.offTopic);
  const save = useMutation({ mutationFn: () => updateGeneral(agent.id, { offTopic }), onSuccess: apply });
  const errors = fieldErrors(save.error) ?? {};
  const dirty = offTopic !== agent.offTopic;

  return (
    <form
      className="card m-0"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Section id="off-topic-section" title={t.offTopic} explanation={t.offTopicExplanation}>
        {save.error && !Object.keys(errors).length && <Alert>{errorMessage(save.error, common.notSaved)}</Alert>}
        <Field
          id="off-topic"
          label={t.offTopic}
          hint={t.offTopicHint(formatNumber(offTopic.length, locale), formatNumber(OFF_TOPIC_MAX, locale))}
          error={errors.offTopic}
        >
          <textarea
            id="off-topic"
            className="input min-h-20 py-2"
            maxLength={OFF_TOPIC_MAX}
            placeholder={t.offTopicPlaceholder}
            value={offTopic}
            onChange={(e) => setOffTopic(e.target.value)}
          />
        </Field>
      </Section>
      <SaveFooter dirty={dirty} pending={save.isPending} onDiscard={() => setOffTopic(agent.offTopic)} />
    </form>
  );
}
