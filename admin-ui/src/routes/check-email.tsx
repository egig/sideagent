import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { readPendingEmail, requestMagicLink, type MagicLinkError } from "~/app/auth";
import { Alert, AuthLayout, Icon } from "~/app/ui";
import { useT } from "~/i18n";

export const Route = createFileRoute("/check-email")({
  component: CheckEmail,
});

function CheckEmail() {
  const t = useT();
  const [email] = useState(readPendingEmail);
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<MagicLinkError | null>(null);

  async function resend() {
    if (!email) return;
    setStatus("sending");
    setError(null);
    const message = await requestMagicLink(email);
    setStatus(message ? "idle" : "sent");
    setError(message);
  }

  return (
    <AuthLayout footer={t.auth.checkFooter}>
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-info-soft text-info">
        <Icon name="mail" style={{ width: 24, height: 24 }} />
      </span>
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 text-[22px] font-semibold">{t.auth.checkEmail}</h1>
        <p className="m-0 text-ink-muted">
          {t.auth.sentTo}
          {email ? <strong className="font-semibold text-ink">{email}</strong> : t.auth.yourEmail}
          {t.auth.sentAfter}
        </p>
      </div>
      {error && <Alert>{t.auth[error]}</Alert>}
      {email && (
        <button className="btn btn-lg w-full" type="button" onClick={resend} disabled={status === "sending"}>
          <Icon name="refresh" />
          {status === "sending" ? t.auth.sending : status === "sent" ? t.auth.resent : t.auth.resend}
        </button>
      )}
      <Link to="/sign-in" className="inline-flex min-h-11 items-center gap-1.5 text-[13px]">
        <Icon name="back" style={{ width: 16, height: 16 }} />
        {t.auth.differentEmail}
      </Link>
    </AuthLayout>
  );
}
