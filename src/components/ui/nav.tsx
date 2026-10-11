import Link from "@/components/ui/link";
import { cn } from "@/lib/cn";

export interface NavItem {
  label: string;
  href: string;
  active: boolean;
  count?: number;
  tone?: "default" | "alert";
}

/** Abas baseadas em URL (server component). */
export function Tabs({ items, className }: { items: NavItem[]; className?: string }) {
  return (
    <nav className={cn("flex gap-1 border-b border-line", className)}>
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          scroll={false}
          className={cn(
            "relative -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors",
            t.active ? "border-brand-600 text-ink" : "border-transparent text-ink-3 hover:text-ink-2",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className={cn("rounded px-1.5 text-[11px] tnum", t.active ? "bg-brand-50 text-brand-700" : "bg-stone-100 text-ink-3")}>{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** Filtros rápidos em formato de "chips" (server component). */
export function FilterChips({ items, className }: { items: NavItem[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {items.map((c) => (
        <Link
          key={c.href}
          href={c.href}
          scroll={false}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium ring-1 ring-inset transition-colors",
            c.active ? "bg-ink text-white ring-ink" : "bg-surface text-ink-2 ring-line-strong hover:bg-subtle",
          )}
        >
          {c.label}
          {c.count !== undefined && (
            <span
              className={cn(
                "rounded px-1 text-[11px] tnum",
                c.active ? "bg-white/15 text-white" : c.tone === "alert" && c.count > 0 ? "bg-red-50 text-red-700" : "bg-stone-100 text-ink-3",
              )}
            >
              {c.count}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}

/** Monta uma URL preservando os parâmetros atuais e aplicando alterações. */
export function hrefWith(path: string, current: Record<string, string | undefined>, updates: Record<string, string | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) if (v) p.set(k, v);
  for (const [k, v] of Object.entries(updates)) {
    if (v === null || v === undefined || v === "") p.delete(k);
    else p.set(k, v);
  }
  const qs = p.toString();
  return qs ? `${path}?${qs}` : path;
}
