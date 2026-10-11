"use client";

import type { UserRole } from "@prisma/client";
import { Check, ChevronsUpDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { ROLE } from "@/domain/labels";
import { switchDemoUserAction } from "@/server/actions/admin";
import { Avatar } from "@/components/ui/misc";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Spinner, useActionRunner } from "@/components/ui/toast";

type U = { id: string; name: string; role: UserRole; jobTitle: string };

export function UserSwitcher({ current, users }: { current: U; users: U[] }) {
  const { run, pending } = useActionRunner();
  const router = useRouter();
  return (
    <Menu
      side="top"
      className="w-full"
      panelClassName="w-[260px]"
      trigger={() => (
        <button type="button" className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-stone-200/50">
          <Avatar name={current.name} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-medium text-ink">{current.name}</div>
            <div className="truncate text-[11.5px] text-ink-3">{current.jobTitle}</div>
          </div>
          {pending ? <Spinner className="text-ink-3" /> : <ChevronsUpDown className="size-3.5 text-ink-3" />}
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-ink-3 uppercase">Ver o sistema como</div>
          {users.map((u) => (
            <MenuItem
              key={u.id}
              onClick={() => {
                close();
                if (u.id !== current.id) run(() => switchDemoUserAction(u.id), { onSuccess: () => router.refresh() });
              }}
            >
              <Avatar name={u.name} size="xs" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ink">{u.name}</span>
                <span className="block text-[11.5px] text-ink-3">{ROLE[u.role].label}</span>
              </span>
              {u.id === current.id && <Check className="size-3.5 text-brand-600" />}
            </MenuItem>
          ))}
          <p className="border-t border-line px-2.5 pt-2 pb-1 text-[11px] leading-snug text-ink-3">Troca de perfil sem senha — apenas para demonstrar as permissões por função.</p>
        </>
      )}
    </Menu>
  );
}
