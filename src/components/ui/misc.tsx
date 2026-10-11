import Link from "@/components/ui/link";
import { Database, Lock, Workflow } from "lucide-react";
import type { Tone } from "@/domain/labels";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";
import { TONE_CLASSES } from "./badge";

const AVATAR_COLORS = ["bg-brand-100 text-brand-800", "bg-sky-100 text-sky-800", "bg-amber-100 text-amber-800", "bg-violet-100 text-violet-800", "bg-rose-100 text-rose-800", "bg-teal-100 text-teal-800", "bg-stone-200 text-stone-700"];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({ name, size = "sm", className }: { name: string; size?: "xs" | "sm" | "md" | "lg"; className?: string }) {
  const sz = { xs: "size-5 text-[9px]", sm: "size-7 text-[11px]", md: "size-9 text-xs", lg: "size-12 text-base" }[size];
  return (
    <span title={name} className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold", AVATAR_COLORS[hash(name) % AVATAR_COLORS.length], sz, className)}>
      {initials(name)}
    </span>
  );
}

export function Progress({ value, max = 100, tone = "brand", className, marker }: { value: number; max?: number; tone?: Tone; className?: string; marker?: number }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(max, 1)) * 100));
  const markerPct = marker !== undefined ? Math.max(0, Math.min(100, (marker / Math.max(max, 1)) * 100)) : null;
  return (
    <div className={cn("relative h-1.5 w-full rounded-full bg-stone-100", className)}>
      <div className={cn("h-full rounded-full", tone === "brand" ? "bg-brand-500" : TONE_CLASSES[tone].dot)} style={{ width: `${pct}%` }} />
      {markerPct !== null && <div title="Ritmo esperado" className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-ink/70" style={{ left: `calc(${markerPct}% - 1px)` }} />}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-[13px] text-ink-3">{eyebrow}</div>}
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[13.5px] text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1440px] px-8 py-7", className)}>{children}</div>;
}

export function EmptyState({ icon, title, description, className }: { icon?: React.ReactNode; title: string; description?: string; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-10 text-center", className)}>
      {icon && <div className="mb-3 rounded-full bg-stone-100 p-2.5 text-ink-3">{icon}</div>}
      <p className="font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-ink-3">{description}</p>}
    </div>
  );
}

/** Indica que o dado vem do sistema-fonte (Polo Trial) ou de automação. */
export function SourceTag({ kind, children }: { kind: "polo" | "auto" | "form"; children?: React.ReactNode }) {
  const map = {
    polo: { icon: <Database className="size-3" />, label: "Polo Trial", cls: "text-sky-700 bg-sky-50 ring-sky-200" },
    auto: { icon: <Workflow className="size-3" />, label: "Automação", cls: "text-violet-700 bg-violet-50 ring-violet-200" },
    form: { icon: <Workflow className="size-3" />, label: "Formulário", cls: "text-teal-700 bg-teal-50 ring-teal-200" },
  }[kind];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-px text-[11px] font-medium ring-1 ring-inset", map.cls)}>
      {map.icon}
      {children ?? map.label}
    </span>
  );
}

export function RestrictedAccess({ area, role }: { area: string; role: string }) {
  return (
    <Page>
      <div className="mx-auto mt-16 max-w-md rounded-xl border border-line bg-surface p-8 text-center">
        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-stone-100 text-ink-3">
          <Lock className="size-5" />
        </div>
        <h1 className="text-base font-semibold">Acesso restrito</h1>
        <p className="mt-1.5 text-[13px] text-ink-2">
          O perfil <strong>{role}</strong> não tem acesso a {area}. As permissões são definidas por função em Configurações → Permissões.
        </p>
        <Link href="/" className="mt-4 inline-block text-[13px] font-medium text-brand-700 hover:underline">
          Voltar ao Dashboard
        </Link>
      </div>
    </Page>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line bg-subtle px-1.5 py-px font-sans text-[11px] text-ink-3">{children}</kbd>;
}
