import type { Tone } from "@/domain/labels";
import { cn } from "@/lib/cn";

export const TONE_CLASSES: Record<Tone, { badge: string; dot: string; soft: string; text: string }> = {
  neutral: { badge: "bg-stone-100 text-stone-700 ring-stone-200", dot: "bg-stone-400", soft: "bg-stone-50", text: "text-stone-700" },
  brand: { badge: "bg-brand-50 text-brand-700 ring-brand-200", dot: "bg-brand-500", soft: "bg-brand-50", text: "text-brand-700" },
  green: { badge: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500", soft: "bg-emerald-50", text: "text-emerald-700" },
  blue: { badge: "bg-sky-50 text-sky-700 ring-sky-200", dot: "bg-sky-500", soft: "bg-sky-50", text: "text-sky-700" },
  amber: { badge: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500", soft: "bg-amber-50", text: "text-amber-800" },
  red: { badge: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-500", soft: "bg-red-50", text: "text-red-700" },
  violet: { badge: "bg-violet-50 text-violet-700 ring-violet-200", dot: "bg-violet-500", soft: "bg-violet-50", text: "text-violet-700" },
};

export function Badge({ tone = "neutral", dot = false, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: React.ReactNode }) {
  const t = TONE_CLASSES[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset", t.badge, className)}>
      {dot && <span className={cn("size-1.5 rounded-full", t.dot)} />}
      {children}
    </span>
  );
}

/** Rótulo de status vindo do mapa de domínio. */
export function StatusBadge<K extends string>({ map, value, dot = true }: { map: Record<K, { label: string; tone: Tone }>; value: K; dot?: boolean }) {
  const s = map[value];
  return (
    <Badge tone={s.tone} dot={dot}>
      {s.label}
    </Badge>
  );
}
