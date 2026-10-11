import type { Notification } from "@prisma/client";
import { formatLongDate } from "@/lib/dates";
import { capitalize } from "@/lib/format";
import { GlobalSearch } from "./global-search";
import { NotificationsMenu } from "./notifications-menu";

export function Topbar({ notifications, unread, canSearch }: { notifications: Notification[]; unread: number; canSearch: boolean }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line px-6">
      {canSearch ? <GlobalSearch /> : <div className="flex-1" />}
      <div className="ml-auto flex items-center gap-3">
        <span className="hidden text-[13px] text-ink-3 lg:inline">{capitalize(formatLongDate(new Date()))}</span>
        <span className="hidden h-4 w-px bg-line lg:inline-block" />
        <NotificationsMenu
          unread={unread}
          items={notifications.map((n) => ({ id: n.id, title: n.title, body: n.body, href: n.href, type: n.type, read: !!n.readAt, createdAt: n.createdAt.toISOString() }))}
        />
      </div>
    </header>
  );
}
