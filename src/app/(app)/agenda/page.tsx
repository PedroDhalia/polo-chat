import type { VisitStatus } from "@prisma/client";
import { CalendarDays, ChevronLeft, ChevronRight, CircleAlert, RotateCcw, TriangleAlert } from "lucide-react";
import Link from "@/components/ui/link";
import { Card } from "@/components/ui/card";
import { EmptyState, Page, PageHeader, RestrictedAccess } from "@/components/ui/misc";
import { hrefWith, Tabs } from "@/components/ui/nav";
import { UrlSelect } from "@/components/ui/url-filters";
import { ROLE, VISIT_STATUS } from "@/domain/labels";
import { VisitTable } from "@/features/visits/visit-table";
import { addDays, formatDayMonth, formatLongDate, formatTime, formatWeekdayShort, isSameDay, parseDateParam, startOfDay, startOfWeek, toDateParam } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { capitalize } from "@/lib/format";
import { can, getCurrentUser } from "@/server/auth/session";
import { getAgendaAlerts, getVisitsInRange, staffOptions } from "@/server/queries/agenda";
import { studyOptions } from "@/server/queries/studies";

export const metadata = { title: "Agenda" };

type SP = Promise<Record<string, string | undefined>>;

const STATUS_BORDER: Record<VisitStatus, string> = {
  AGUARDANDO_CONFIRMACAO: "border-l-amber-400",
  CONFIRMADO: "border-l-brand-500",
  REAGENDAMENTO_SOLICITADO: "border-l-violet-400",
  REALIZADO: "border-l-emerald-500",
  FALTOU: "border-l-red-500",
  CANCELADO: "border-l-stone-300",
};

export default async function AgendaPage({ searchParams }: { searchParams: SP }) {
  const user = await getCurrentUser();
  if (!can(user, "agenda.view")) return <RestrictedAccess area="Agenda" role={ROLE[user.role].label} />;
  const sp = await searchParams;
  const now = new Date();
  const view = sp.visao === "semana" ? "semana" : "dia";
  const day = parseDateParam(sp.data) ?? startOfDay(now);
  const from = view === "semana" ? startOfWeek(day) : day;
  const to = addDays(from, view === "semana" ? 7 : 1);
  const status = sp.status && sp.status in VISIT_STATUS ? (sp.status as VisitStatus) : undefined;
  const filters = { studyId: sp.estudo, status, staffId: sp.responsavel };

  const [visits, alerts, studies, staff] = await Promise.all([getVisitsInRange(user, from, to, filters), getAgendaAlerts(user, now), studyOptions(user), staffOptions(user)]);
  const current = { visao: sp.visao, data: sp.data, estudo: sp.estudo, status: sp.status, responsavel: sp.responsavel };
  const step = view === "semana" ? 7 : 1;
  const nav = (delta: number) => hrefWith("/agenda", current, { data: toDateParam(addDays(day, delta)) });
  const count = (s: VisitStatus) => visits.filter((v) => v.status === s).length;
  const title = view === "semana" ? `Semana de ${formatDayMonth(from)} a ${formatDayMonth(addDays(to, -1))}` : capitalize(formatLongDate(day));

  return (
    <Page>
      <PageHeader
        title="Agenda"
        description="Visitas do dia e da semana com status de confirmação. Nomes de visita e janelas protocolares vêm do Polo Trial — o Plátano Ops não calcula janelas."
      />

      {alerts.length > 0 && (
        <div className="mb-5 grid grid-cols-1 gap-2 lg:grid-cols-2">
          {alerts.slice(0, 6).map((a) => (
            <Link
              key={a.id}
              href={a.href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13px] transition-colors",
                a.tone === "red" ? "border-red-200 bg-red-50 text-red-800 hover:bg-red-100/70" : a.tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100/70" : "border-violet-200 bg-violet-50 text-violet-900 hover:bg-violet-100/70",
              )}
            >
              {a.tone === "red" ? <CircleAlert className="size-4 shrink-0" /> : a.tone === "amber" ? <TriangleAlert className="size-4 shrink-0" /> : <RotateCcw className="size-4 shrink-0" />}
              {a.text}
            </Link>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg ring-1 ring-line-strong">
          <Link href={nav(-step)} scroll={false} aria-label="Anterior" className="flex h-8 w-8 items-center justify-center rounded-l-lg hover:bg-subtle">
            <ChevronLeft className="size-4" />
          </Link>
          <Link href={hrefWith("/agenda", current, { data: null })} scroll={false} className="flex h-8 items-center border-x border-line-strong px-3 text-[13px] font-medium hover:bg-subtle">
            Hoje
          </Link>
          <Link href={nav(step)} scroll={false} aria-label="Próximo" className="flex h-8 w-8 items-center justify-center rounded-r-lg hover:bg-subtle">
            <ChevronRight className="size-4" />
          </Link>
        </div>
        <span className="ml-1 text-[15px] font-semibold tracking-tight">{title}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <UrlSelect param="estudo" placeholder="Todos os estudos" options={studies} />
          <UrlSelect param="status" placeholder="Todos os status" options={Object.entries(VISIT_STATUS).map(([value, s]) => ({ value, label: s.label }))} />
          <UrlSelect param="responsavel" placeholder="Toda a equipe" options={staff} />
          <Tabs
            className="ml-1 border-b-0"
            items={[
              { label: "Dia", href: hrefWith("/agenda", current, { visao: null }), active: view === "dia" },
              { label: "Semana", href: hrefWith("/agenda", current, { visao: "semana" }), active: view === "semana" },
            ]}
          />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-ink-2">
        <span>
          <strong className="text-ink">{visits.length}</strong> visitas
        </span>
        {(["CONFIRMADO", "AGUARDANDO_CONFIRMACAO", "REAGENDAMENTO_SOLICITADO", "REALIZADO", "FALTOU"] as VisitStatus[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", { AGUARDANDO_CONFIRMACAO: "bg-amber-400", CONFIRMADO: "bg-brand-500", REAGENDAMENTO_SOLICITADO: "bg-violet-400", REALIZADO: "bg-emerald-500", FALTOU: "bg-red-500", CANCELADO: "bg-stone-300" }[s])} />
            {VISIT_STATUS[s].label}: <strong className="font-medium text-ink">{count(s)}</strong>
          </span>
        ))}
      </div>

      {view === "dia" ? (
        <Card className="overflow-hidden">
          {visits.length === 0 ? (
            <EmptyState icon={<CalendarDays className="size-5" />} title="Nenhuma visita neste dia" description="Use as setas para navegar ou ajuste os filtros." />
          ) : (
            <VisitTable visits={visits} canManage={can(user, "agenda.manage")} now={now} />
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((d) => {
            const dayVisits = visits.filter((v) => isSameDay(v.scheduledAt, d));
            const isToday = isSameDay(d, now);
            return (
              <div key={d.toISOString()} className={cn("flex min-h-[420px] flex-col rounded-xl border", isToday ? "border-brand-300 bg-brand-50/40" : "border-line bg-subtle/60")}>
                <Link href={hrefWith("/agenda", current, { visao: null, data: toDateParam(d) })} className="flex items-baseline justify-between px-3 py-2.5 hover:bg-stone-100/60">
                  <span className={cn("text-[12.5px] font-semibold capitalize", isToday ? "text-brand-700" : "text-ink")}>
                    {formatWeekdayShort(d)} {formatDayMonth(d)}
                  </span>
                  <span className="text-[11.5px] text-ink-3">{dayVisits.length || ""}</span>
                </Link>
                <div className="flex-1 space-y-1.5 px-2 pb-2">
                  {dayVisits.map((v) => (
                    <Link
                      key={v.id}
                      href={`/participantes/${v.participant.id}`}
                      title={`${v.participant.fullName} · ${v.name} · ${VISIT_STATUS[v.status].label}`}
                      className={cn("block rounded-md border border-l-[3px] border-line bg-surface px-2 py-1.5 text-[12px] shadow-[var(--shadow-card)] hover:border-line-strong", STATUS_BORDER[v.status])}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold text-ink tnum">{formatTime(v.scheduledAt)}</span>
                        <span className="text-[10.5px] text-ink-3">{v.study.code}</span>
                      </div>
                      <div className="truncate text-ink-2">{v.participant.fullName}</div>
                      <div className="truncate text-[11px] text-ink-3">{v.name}</div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Page>
  );
}
