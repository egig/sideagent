import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Menu } from "@base-ui/react/menu";
import { agentsQuery } from "~/app/api/agents";
import { Avatar, Icon } from "~/app/ui";
import { useT } from "~/i18n";

// Same shape as UserMenu: a quiet trigger, a short popup. Items are links.
export function AgentSwitcher({ currentId }: { currentId?: string }) {
  const t = useT().switcher;
  const { data: agents = [] } = useQuery(agentsQuery);
  const current = agents.find((a) => a.id === currentId);
  const item =
    "flex h-9 cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 text-[14px] text-ink no-underline outline-none data-[highlighted]:bg-hover";
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t.switch}
        className="flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-[10px] border border-line-strong bg-transparent px-2.5 text-left font-[inherit] text-ink transition-colors hover:bg-hover data-[popup-open]:bg-hover"
      >
        {current ? <Avatar name={current.name} tone="current" /> : null}
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
          {current ? current.name : agents.length ? t.choose : t.empty}
        </span>
        <Icon name="chevrons" style={{ width: 14, height: 14 }} className="text-ink-muted" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
          <Menu.Popup className="max-h-[360px] min-w-[var(--anchor-width)] overflow-y-auto rounded-[14px] border border-line bg-surface-raised p-1.5 shadow-md outline-none">
            {agents.map((a) => (
              <Menu.LinkItem
                key={a.id}
                className={item}
                aria-current={a.id === currentId ? "page" : undefined}
                render={<Link to="/agents/$agentId" params={{ agentId: a.id }} />}
              >
                <Avatar name={a.name} tone={a.id === currentId ? "current" : "mute"} />
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                {a.id === currentId && <Icon name="check" style={{ width: 14, height: 14 }} />}
              </Menu.LinkItem>
            ))}
            {agents.length > 0 && <Menu.Separator className="my-1.5 h-px bg-line" />}
            <Menu.LinkItem className={item} render={<Link to="/new" />}>
              <Icon name="plus" style={{ width: 16, height: 16 }} />
              {t.newAgent}
            </Menu.LinkItem>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
