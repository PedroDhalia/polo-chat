"use client";

import { Bell } from "lucide-react";
import Link from "@/components/ui/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { formatAgo } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { markNotificationsReadAction } from "@/server/actions/admin";
import { Menu } from "@/components/ui/menu";

type Item = { id: string; title: string; body: string | null; href: string | null; type: string; read: boolean; createdAt: string };

export function NotificationsMenu({ items, unread }: { items: Item[]; unread: number }) {
  const router = useRouter();
  const [, start] = useTransition();
  return (
    <Menu
      align="right"
      panelClassName="w-[360px] p-0"
      trigger={(open) => (
        <button type="button" aria-label="Notificações" className={cn("relative flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-stone-100", open && "bg-stone-100")}>
          <Bell className="size-[18px]" />
          {unread > 0 && <span className="absolute top-1.5 right-1.5 flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">{unread}</span>}
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-[13px] font-semibold">Notificações</span>
            {unread > 0 && (
              <button
                className="text-[12px] font-medium text-brand-700 hover:underline"
                onClick={() =>
                  start(async () => {
                    await markNotificationsReadAction();
                    router.refresh();
                  })
                }
              >
                Marcar todas como lidas
              </button>
            )}
          </div>
          <ul className="max-h-[360px] overflow-y-auto py-1 scrollbar-thin">
            {items.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-ink-3">Nenhuma notificação.</li>}
            {items.map((n) => (
              <li key={n.id}>
                <Link href={n.href ?? "#"} onClick={close} className="flex gap-3 px-4 py-2.5 hover:bg-subtle">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-brand-500")} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-[13px] leading-snug", n.read ? "text-ink-2" : "font-medium text-ink")}>{n.title}</span>
                    {n.body && <span className="mt-0.5 block text-[12px] text-ink-3">{n.body}</span>}
                    <span className="mt-0.5 block text-[11.5px] text-ink-3">{formatAgo(new Date(n.createdAt))}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Menu>
  );
}
