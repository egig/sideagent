import { createContext, useContext, useState, type ReactNode, type SVGProps } from "react";
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Menu } from "@base-ui/react/menu";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Select } from "@base-ui/react/select";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import type { AgentStatus } from "@shared/api";
import { STATUS_BADGE, initials } from "~/app/display";
import { config } from "~/config";
import { cn } from "~/lib/utils";
import { THEMES, useTheme, type Theme } from "~/theme";
import { LOCALES, LOCALE_NAME, storeLocale, useLocale, useT, type Locale } from "~/i18n";

// Icon paths from the design canvas (24×24, stroke 1.8).
const paths = {
  bot: (
    <>
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M12 8V4M9 13v2M15 13v2" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </>
  ),
  back: <path d="M19 12H5M11 18l-6-6 6-6" />,
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  docs: <path d="M4 19V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2zM20 19v2H6" />,
  signOut: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  chevrons: <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />,
  check: <path d="M5 12l5 5 9-10" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12l3 3 5-6" />
    </>
  ),
  xCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M17 6l3 3M14 9l2 2" />
    </>
  ),
  book: (
    <path d="M3 5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v15a2 2 0 0 0-2-2H3zM21 5a2 2 0 0 0-2-2h-5a2 2 0 0 0-2 2v15a2 2 0 0 1 2-2h7z" />
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6M8 13h8M8 17h6" />
    </>
  ),
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4M12 16h.01" />
    </>
  ),
};

export type IconName = keyof typeof paths;

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" {...props}>
      {paths[name]}
    </svg>
  );
}

export function Brand({ size = 36 }: { size?: 32 | 36 }) {
  return (
    <div className="flex items-center gap-2.5">
      <img
        src={`${config.basePath}/logo.png`}
        alt="sideagent"
        className="dark:hidden"
        style={{ height: size === 36 ? 22 : 18 }}
      />
      <img
        src={`${config.basePath}/logo-inverse.png`}
        alt="sideagent"
        className="hidden dark:block"
        style={{ height: size === 36 ? 22 : 18 }}
      />
    </div>
  );
}

// Centered card used by sign-in, check-email and verify.
export function AuthLayout({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-12">
      <Brand />
      <main className="card flex w-full max-w-[400px] flex-col gap-5 p-8 shadow-md">{children}</main>
      {footer && <p className="m-0 text-[13px] leading-[18px] text-ink-muted">{footer}</p>}
      <LanguageSelect />
    </div>
  );
}

// Dashboard language (D-26): stored in this browser, so it also applies on the next visit.
export function LanguageSelect() {
  const locale = useLocale();
  const t = useT();
  const items = LOCALES.map((l) => ({ value: l, label: LOCALE_NAME[l] }));
  return (
    <Select.Root items={items} value={locale} onValueChange={(v) => v && storeLocale(v as Locale)}>
      <Select.Trigger
        aria-label={t.common.language}
        className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-[10px] border-0 bg-transparent px-2.5 text-[13px] leading-[18px] text-ink-muted transition-colors hover:bg-hover hover:text-ink data-[popup-open]:bg-hover"
      >
        <Icon name="globe" style={{ width: 16, height: 16 }} />
        <Select.Value />
        <Select.Icon>
          <Icon name="chevrons" style={{ width: 14, height: 14 }} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner side="top" align="start" sideOffset={6} className="z-50">
          <Select.Popup className="min-w-36 rounded-[14px] border border-line bg-surface-raised p-1.5 shadow-md outline-none">
            {items.map((l) => (
              <Select.Item
                key={l.value}
                value={l.value}
                lang={l.value}
                className="flex h-8 cursor-pointer items-center gap-2 rounded-[8px] px-2.5 text-[14px] text-ink outline-none data-[highlighted]:bg-hover"
              >
                <Select.ItemText className="flex-1">{l.label}</Select.ItemText>
                <Select.ItemIndicator>
                  <Icon name="check" style={{ width: 14, height: 14 }} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

// Account menu in the sidebar footer: theme, language and sign out.
export function UserMenu({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const locale = useLocale();
  const t = useT();
  const [theme, setTheme] = useTheme();
  const themeLabel: Record<Theme, string> = { system: t.common.system, light: t.common.light, dark: t.common.dark };
  const label = "flex items-center gap-2 px-1.5 pt-1 text-[12px] text-ink-muted";
  const item =
    "flex h-8 cursor-pointer items-center gap-2 rounded-[8px] px-2.5 text-[14px] text-ink outline-none data-[highlighted]:bg-hover";
  return (
    <Menu.Root>
      <Menu.Trigger className="flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-[10px] border-0 bg-transparent px-2.5 text-left font-[inherit] text-ink-muted transition-colors hover:bg-hover hover:text-ink data-[popup-open]:bg-hover">
        <Avatar name={email} />
        <span className="min-w-0 flex-1 truncate text-[13px]">{email}</span>
        <Icon name="chevrons" style={{ width: 14, height: 14 }} className="text-ink-muted" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={6} className="z-50">
          <Menu.Popup className="min-w-[var(--anchor-width)] rounded-[14px] border border-line bg-surface-raised p-1.5 shadow-md outline-none">
            <div className="flex flex-col gap-1 px-1 pb-1.5">
              <span className={label}>{t.common.theme}</span>
              <Segmented
                label={t.common.theme}
                value={theme}
                options={THEMES.map((v) => ({ value: v, label: themeLabel[v] }))}
                onChange={setTheme}
              />
            </div>
            <div className="flex flex-col gap-1 px-1 pb-1.5">
              <span className={label}>
                <Icon name="globe" style={{ width: 14, height: 14 }} />
                {t.common.language}
              </span>
              <Segmented
                label={t.common.language}
                value={locale}
                options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAME[l] }))}
                onChange={storeLocale}
              />
            </div>
            <Menu.Separator className="my-1.5 h-px bg-line" />
            <Menu.Item className={item} onClick={onSignOut}>
              <Icon name="signOut" style={{ width: 16, height: 16 }} />
              {t.shell.signOut}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function Avatar({ name, tone = "mute" }: { name: string; tone?: "current" | "mute" }) {
  return (
    <AvatarPrimitive.Root
      aria-hidden="true"
      className={cn(
        "inline-flex size-8 flex-none items-center justify-center rounded-[10px] text-[13px] font-semibold",
        tone === "current" ? "bg-accent-soft text-accent" : "bg-selected text-ink",
      )}
    >
      <AvatarPrimitive.Fallback>{initials(name)}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the value stays selectable on screen.
    }
  }
  return (
    <button type="button" className="btn btn-sm" onClick={copy} aria-label={label}>
      <Icon name={copied ? "check" : "copy"} />
      <span aria-live="polite">{copied ? t.common.copied : t.common.copy}</span>
    </button>
  );
}

// Content column of the app shell: white header bar, then the page body.
export const HeaderActionsContext = createContext<ReactNode>(null);

export function Page({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const shared = useContext(HeaderActionsContext);
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-canvas px-8 py-5">
        <h1 className="m-0 text-[22px] leading-7 font-semibold tracking-[-0.01em]">{title}</h1>
        {(actions || shared) && (
          <div className="flex items-center gap-3">
            {actions}
            {shared}
          </div>
        )}
      </header>
      <main className="box-border flex w-full max-w-[1200px] flex-col gap-6 p-8">{children}</main>
    </>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-[10px] bg-danger-soft px-3 py-2 text-[13px] leading-[18px] text-danger"
    >
      <Icon name="alert" style={{ width: 16, height: 16, marginTop: 2 }} />
      <span>{children}</span>
    </div>
  );
}

export function StatusBadge({ status }: { status: AgentStatus }) {
  const t = useT();
  return (
    <span className={`badge ${STATUS_BADGE[status]}`}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {t.status[status]}
    </span>
  );
}

type CalloutTone = "warn" | "note" | "ok" | "bad";
const CALLOUT: Record<CalloutTone, string> = {
  warn: "bg-warning-soft text-warning",
  note: "border border-line bg-surface-subtle text-ink",
  ok: "bg-success-soft text-success",
  bad: "bg-danger-soft text-danger",
};

export function Callout({ tone = "note", children }: { tone?: CalloutTone; children: ReactNode }) {
  return (
    <div role="status" className={`flex items-start gap-2.5 rounded-[14px] px-4 py-3.5 ${CALLOUT[tone]}`}>
      {tone !== "note" && (
        <Icon name={tone === "ok" ? "checkCircle" : "alert"} style={{ marginTop: 1 }} className="icon" />
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// Settings layout: heading and explanation on the left, fields on the right.
export function Section({
  id,
  title,
  explanation,
  children,
}: {
  id?: string;
  title: string;
  explanation: ReactNode;
  children: ReactNode;
}) {
  return (
    <div id={id} className="flex scroll-mt-6 flex-wrap gap-x-8 gap-y-4 p-6">
      <div className="flex-[1_1_220px]">
        <h2 className="m-0 text-[17px] leading-6 font-semibold">{title}</h2>
        <p className="hint">{explanation}</p>
      </div>
      <div className="flex min-w-0 flex-[2_1_360px] flex-col gap-5">{children}</div>
    </div>
  );
}

export function CardFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 rounded-b-[14px] border-t border-line bg-surface-subtle px-6 py-4">
      {children}
    </div>
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 mb-0 text-[13px] text-danger">
          {error}
        </p>
      )}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(v) => v[0] && onChange(v[0] as T)}
      className="inline-flex gap-0.5 self-start rounded-[10px] bg-selected p-0.5"
    >
      {options.map((o) => (
        <Toggle
          key={o.value}
          value={o.value}
          className="h-8 cursor-pointer rounded-[8px] border-0 bg-transparent px-3.5 font-[inherit] font-semibold text-ink-muted transition-colors hover:text-ink data-[pressed]:bg-surface-raised data-[pressed]:text-ink data-[pressed]:shadow-sm"
        >
          {o.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

export function Checkbox({
  checked,
  onChange,
  disabled,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <CheckboxPrimitive.Root
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className="mt-px flex size-[18px] flex-none cursor-pointer items-center justify-center rounded-[6px] border border-control-border bg-canvas text-on-primary data-[checked]:border-primary data-[checked]:bg-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45"
    >
      <CheckboxPrimitive.Indicator>
        <Icon name="check" style={{ width: 14, height: 14, strokeWidth: 2.4 }} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

// A form select styled like .input.
export function SelectInput<T extends string>({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <Select.Root items={options} value={value} onValueChange={(v) => v !== null && onChange(v as T)}>
      <Select.Trigger id={id} className="input flex cursor-pointer items-center justify-between gap-2 text-left">
        <Select.Value />
        <Select.Icon>
          <Icon name="chevrons" style={{ width: 14, height: 14 }} className="icon text-ink-muted" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={6} className="z-50">
          <Select.Popup className="min-w-[var(--anchor-width)] rounded-[14px] border border-line bg-surface-raised p-1.5 shadow-md outline-none">
            {options.map((o) => (
              <Select.Item
                key={o.value}
                value={o.value}
                className="flex h-8 cursor-pointer items-center gap-2 rounded-[8px] px-2.5 text-[14px] text-ink outline-none data-[highlighted]:bg-hover"
              >
                <Select.ItemText className="flex-1">{o.label}</Select.ItemText>
                <Select.ItemIndicator>
                  <Icon name="check" style={{ width: 14, height: 14 }} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

// Radio choices that read as cards: title, then a line saying what the choice does.
export function OptionGroup<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: T | null;
  options: { value: T; title: string; description: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
      <legend className="label">{legend}</legend>
      <RadioGroup value={value ?? ""} onValueChange={(v) => onChange(v as T)} className="flex flex-col gap-2.5">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-[14px] border bg-surface-raised p-4 transition-colors hover:bg-surface-subtle",
              value === o.value ? "border-control-border bg-surface-subtle" : "border-line-strong",
            )}
          >
            <Radio.Root
              value={o.value}
              className="mt-0.5 flex size-[18px] flex-none cursor-pointer items-center justify-center rounded-full border border-control-border bg-canvas data-[checked]:border-primary data-[checked]:bg-primary"
            >
              <Radio.Indicator className="size-[6px] rounded-full bg-on-primary" />
            </Radio.Root>
            <span className="flex flex-col gap-0.5">
              <span className="font-semibold">{o.title}</span>
              <span className="text-[13px] leading-[18px] text-ink-muted">{o.description}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
    </fieldset>
  );
}

export function CodeBlock({ title, code }: { title: string; code: string }) {
  const t = useT();
  return (
    <div className="overflow-hidden rounded-[14px] border border-line">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-subtle px-4 py-2">
        <span className="text-[13px] font-medium">{title}</span>
        <CopyButton value={code} label={t.common.copyLabel(title)} />
      </div>
      <pre className="m-0 overflow-x-auto bg-surface-subtle p-4 font-mono text-[13px] leading-5 text-ink">
        <code>{code}</code>
      </pre>
    </div>
  );
}
