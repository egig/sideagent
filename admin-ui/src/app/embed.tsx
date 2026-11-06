// The code that puts the chat in the integrator's app. On the Overview and in setup step 4.
import type { Agent } from "@shared/api";
import { CodeBlock } from "~/app/ui";
import { useT } from "~/i18n";

export function Embed({ agent }: { agent: Agent }) {
  const t = useT().overview;
  // Token modes (D-29): the chat asks the host app for a fresh token before every request.
  const token = agent.auth?.mode === "jwks" || agent.auth?.mode === "userinfo";
  const headers = token ? `\n  getToken={getToken}\n  storageKey={user.id}` : "";
  return (
    <section className="card flex flex-col gap-4 p-5" aria-labelledby="embed-heading">
      <h2 id="embed-heading" className="m-0 text-[17px] leading-6 font-semibold">
        {t.embed}
      </h2>
      <CodeBlock title={t.install} code="npm install sideagent" />
      <CodeBlock
        title="React"
        code={`import { AgentChat } from "sideagent";\n\n<AgentChat\n  publishableKey="${agent.publishableKey}"${headers}\n/>`}
      />
      {token && (
        <p className="m-0 text-[13px] text-ink-muted">
          <code className="font-mono">getToken</code>
          {t.getTokenNote}
          <code className="font-mono">user.id</code>
          {t.storageKeyNote}
        </p>
      )}
      {!agent.auth && <p className="m-0 text-[13px] text-ink-muted">{t.embedNoAuth}</p>}
    </section>
  );
}
