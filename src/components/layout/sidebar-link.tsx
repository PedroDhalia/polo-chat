"use client";

import Link from "@/components/ui/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function SidebarLink({ href, icon, badge, badgeTone = "default", children }: { href: string; icon: React.ReactNode; badge?: number; badgeTone?: "default" | "alert"; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cn(
        "group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors [&_svg]:size-[17px]",
        active ? "bg-surface text-ink shadow-[var(--shadow-card)] ring-1 ring-line" : "text-ink-2 hover:bg-stone-200/50 hover:text-ink",
      )}
    >
      <span className={cn(active ? "text-brand-600" : "text-ink-3 group-hover:text-ink-2")}>{icon}</span>
      <span className="flex-1">{children}</span>
      {badge !== undefined && badge > 0 && (
        <span className={cn("min-w-5 rounded-md px-1.5 py-px text-center text-[11px] font-semibold tnum", badgeTone === "alert" ? "bg-red-100 text-red-700" : "bg-stone-200/80 text-ink-2")}>
          {badge}
        </span>
      )}
    </Link>
  );
}
