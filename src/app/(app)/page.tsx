import { ArrowRight, CalendarDays, CircleAlert, ClipboardList, FlaskConical, Info, Microscope, Play, ReceiptText, TriangleAlert, TrendingUp, UserRoundSearch, Users, Workflow } from "lucide-react";
import Link from "@/components/ui/link";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/ui/action-button";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar, EmptyState, Page, PageHeader, Progress, SourceTag } from "@/components/ui/misc";
import { StatTile } from "@/components/ui/stat-tile";
import { STUDY_STATUS, TASK_PRIORITY, TASK_SOURCE, VISIT_STATUS } from "@/domain/labels";
import { PACE_LABEL } from "@/domain/pace";
import { formatAgo, formatLongDate, formatRelativeDateTime, formatTime, toDateParam, addDays, startOfDay } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { capitalize, firstName, formatNumber, formatPct, ratio } from "@/lib/format";
import { runAutomationCycleAction } from "@/server/actions/admin";
import { can, getCurrentUser } from "@/server/auth/session";
import { getDashboardData, type AttentionItem } from "@/server/queries/dashboard";

export const metadata = { title: "Dashboard" };

function greeting(now: Date) {
  const h = Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hourCycle: "h23", timeZone: "America/Sao_Paulo" }).format(now));
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

const SEVERITY: Record<AttentionItem["severity"], { icon: React.ReactNode; cls: string }> = {
  critical: { icon: <CircleAlert className="size-4" />, cls: "bg-red-50 text-red-600" },
  warning: { icon: <TriangleAlert className="size-4" />, cls: "bg-amber-50 text-amber-600" },
  info: { icon: <Info className="size-4" />, cls: "bg-stone-100 text-ink-3" },
};

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const now = new Date();
  const d = await getDashboardData(user, now);
  const k = d.kpis;
  const nextVisit = d.visitsToday.find((v) => v.scheduledAt > now && v.status !== "REALIZADO");
  const tomorrowParam = toDateParam(addDays(startOfDay(now), 1));

  return (
    <Page>
      <PageHeader
        eyebrow={capitalize(formatLongDate(now))}
        title={`${greeting(now)}, ${firstName(user.name)}`}
        description={
          <>
            Hoje há <strong className="font-semibold text-ink">{k.visitsToday} visitas</strong>,{" "}
            <strong className="font-semibold text-ink">{k.openTasks} pendências abertas</strong> ({k.critical} críticas) e{" "}
            <strong className="font-semibold text-ink">{k.awaitingTomorrow} visitas de amanhã</strong> aguardando confirmação.
          </>
        }
        actions={
          <>
            <ButtonLink href="/pendencias" variant="secondary">
              <ClipboardList className="size-4" /> Pendências
            </ButtonLink>
            <ButtonLink href="/agenda" variant="primary">
              <CalendarDays className="size-4" /> Agenda de hoje
            </ButtonLink>
          </>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Estudos ativos" value={k.activeStudies} sub={`${k.recruitingStudies} em recrutamento`} icon={<FlaskConical />} href="/estudos" />
        <StatTile label="Participantes em recrutamento" value={k.inRecruitment} sub="Candidatos no pipeline operacional" icon={<UserRoundSearch />} href="/recrutamento?aba=pipeline" />
        <StatTile label="Participantes em triagem" value={k.screening} sub={<SourceTag kind="polo">Dado do Polo Trial</SourceTag>} icon={<Microscope />} href="/estudos" />
        <StatTile label="Visitas hoje" value={k.visitsToday} sub={nextVisit ? `Próxima às ${formatTime(nextVisit.scheduledAt)} · ${nextVisit.participant.fullName}` : "Sem novas visitas hoje"} icon={<CalendarDays />} href="/agenda" />
        <StatTile label="Visitas amanhã" value={k.visitsTomorrow} sub={`${k.awaitingTomorrow} aguardando confirmação`} subTone={k.awaitingTomorrow > 0 ? "amber" : undefined} icon={<CalendarDays />} href={`/agenda?data=${tomorrowParam}`} />
        <StatTile label="Pendências críticas" value={k.critical} sub={`${k.openTasks} abertas · ${k.overdue} atrasadas`} subTone={k.critical > 0 ? "red" : undefined} icon={<CircleAlert />} href="/pendencias?filtro=alta" />
        <StatTile
          label="Taxa de recrutamento"
          value={formatPct(ratio(k.enrolled, k.target))}
          sub={`${formatNumber(k.enrolled)} de ${formatNumber(k.target)} incluídos (estudos em recrutamento)`}
          icon={<TrendingUp />}
          href="/recrutamento"
          footer={<Progress value={k.enrolled} max={k.target} />}
        />
        <StatTile label="Reembolsos pendentes" value={k.pendingReimbLabel} sub={`${k.pendingReimbCount} reembolsos aguardando pagamento`} icon={<ReceiptText />} href={can(user, "finance.view") ? "/financeiro" : undefined} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* Coluna principal */}
        <div className="space-y-5 xl:col-span-8">
          <Card>
            <CardHeader title="Atenção necessária" description="O que pede ação da equipe agora, consolidado de todas as fontes." />
            {d.attention.length === 0 ? (
              <EmptyState title="Tudo em dia" description="Nenhum item exige atenção imediata." />
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {d.attention.map((a) => (
                  <li key={a.id}>
                    <Link href={a.href} className="group flex items-center gap-3.5 px-5 py-3 hover:bg-subtle">
                      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", SEVERITY[a.severity].cls)}>{SEVERITY[a.severity].icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] font-medium text-ink">{a.title}</span>
                        {a.detail && <span className="block truncate text-[12.5px] text-ink-3">{a.detail}</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-ink-3 group-hover:text-brand-700">
                        {a.cta} <ArrowRight className="size-3.5" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Pendências prioritárias"
              description="Ordenadas por prioridade e prazo."
              action={
                <Link href="/pendencias" className="text-[12.5px] font-medium text-brand-700 hover:underline">
                  Ver todas ({k.openTasks})
                </Link>
              }
            />
            <ul className="divide-y divide-line border-t border-line">
              {d.priorityTasks.map((t) => {
                const late = t.dueAt < now;
                return (
                  <li key={t.id} className="flex items-center gap-3 px-5 py-2.5">
                    <StatusBadge map={TASK_PRIORITY} value={t.priority} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-ink">{t.title}</div>
                      <div className="flex items-center gap-1.5 text-[12px] text-ink-3">
                        {t.study?.code && <span>{t.study.code}</span>}
                        <span>·</span>
                        <span>{TASK_SOURCE[t.source]}</span>
                      </div>
                    </div>
                    <span className={cn("shrink-0 text-[12.5px] tnum", late ? "font-medium text-red-600" : "text-ink-2")}>{late ? `Atrasada · ${formatRelativeDateTime(t.dueAt, now)}` : formatRelativeDateTime(t.dueAt, now)}</span>
                    {t.assignee && <Avatar name={t.assignee.name} size="xs" />}
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <CardHeader
              title="Estudos"
              description="Incluídos (Polo Trial) frente à meta. O traço indica o ritmo esperado pelo plano de recrutamento."
              action={
                <Link href="/estudos" className="text-[12.5px] font-medium text-brand-700 hover:underline">
                  Ver estudos
                </Link>
              }
            />
            <CardBody className="space-y-4">
              {d.studies.map((s) => (
                <Link key={s.id} href={`/estudos/${s.code}`} className="group block">
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-[13px] font-semibold text-ink group-hover:text-brand-700">{s.code}</span>
                      <span className="truncate text-[12.5px] text-ink-3">{s.sponsor}</span>
                      {s.pace ? <Badge tone={PACE_LABEL[s.pace.status].tone}>{PACE_LABEL[s.pace.status].label}</Badge> : <StatusBadge map={STUDY_STATUS} value={s.status} dot={false} />}
                    </div>
                    <span className="text-[13px] text-ink-2 tnum">
                      <strong className="font-semibold text-ink">{s.enrolledCount}</strong> de {s.targetEnrollment}
                    </span>
                  </div>
                  <Progress value={s.enrolledCount} max={s.targetEnrollment} marker={s.pace?.expected} tone={s.pace?.status === "abaixo" ? "amber" : "brand"} />
                </Link>
              ))}
            </CardBody>
          </Card>
        </div>

        {/* Coluna lateral */}
        <div className="space-y-5 xl:col-span-4">
          <Card>
            <CardHeader
              title="Próximos eventos"
              description="Visitas de hoje"
              action={
                <Link href="/agenda" className="text-[12.5px] font-medium text-brand-700 hover:underline">
                  Agenda
                </Link>
              }
            />
            <ol className="border-t border-line px-5 py-2">
              {d.visitsToday.length === 0 && <li className="py-6 text-center text-[13px] text-ink-3">Sem visitas hoje.</li>}
              {d.visitsToday.map((v) => {
                const isPast = v.scheduledAt < now;
                return (
                  <li key={v.id} className={cn("flex items-start gap-3 py-2", isPast && v.status === "CONFIRMADO" && "opacity-70")}>
                    <span className="w-11 shrink-0 pt-px text-[13px] font-semibold text-ink tnum">{formatTime(v.scheduledAt)}</span>
                    <div className="min-w-0 flex-1 border-l border-line pl-3">
                      <Link href={`/participantes/${v.participant.id}`} className="block truncate text-[13px] font-medium text-ink hover:text-brand-700">
                        {v.participant.fullName}
                      </Link>
                      <div className="truncate text-[12px] text-ink-3">
                        {v.study.code} · {v.name}
                      </div>
                    </div>
                    <StatusBadge map={VISIT_STATUS} value={v.status} />
                  </li>
                );
              })}
            </ol>
            {d.visitsTomorrow.length > 0 && (
              <div className="border-t border-line px-5 py-3">
                <div className="mb-1.5 text-[11.5px] font-medium tracking-wide text-ink-3 uppercase">Amanhã</div>
                <ul className="space-y-1.5">
                  {d.visitsTomorrow.map((v) => (
                    <li key={v.id} className="flex items-center gap-3 text-[12.5px]">
                      <span className="w-11 shrink-0 font-medium text-ink-2 tnum">{formatTime(v.scheduledAt)}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-2">
                        {v.participant.fullName} <span className="text-ink-3">· {v.study.code}</span>
                      </span>
                      {v.status === "AGUARDANDO_CONFIRMACAO" ? <Badge tone="amber">Aguardando</Badge> : <span className="text-[11.5px] text-ink-3">{VISIT_STATUS[v.status].label}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Automações"
              description="Últimas 24 horas"
              icon={<Workflow className="size-4 text-violet-500" />}
              action={<ActionButton action={runAutomationCycleAction} size="xs" icon={<Play className="size-3" />}>Executar ciclo</ActionButton>}
            />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {d.automation.byRule.map((r) => (
                  <span key={r.name} className="inline-flex items-center gap-1.5 rounded-md bg-violet-50 px-2 py-1 text-[12px] text-violet-800">
                    {r.name}<strong className="font-semibold tnum">{r.count}</strong>
                  </span>
                ))}
                {d.automation.byRule.length === 0 && <span className="text-[12.5px] text-ink-3">Nenhuma execução nas últimas 24h.</span>}
              </div>
              <ul className="space-y-2">
                {d.automation.runs.map((r) => (
                  <li key={r.id} className="flex gap-2 text-[12.5px]">
                    <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", r.status === "SUCESSO" ? "bg-violet-400" : "bg-amber-400")} />
                    <span className="min-w-0 flex-1 text-ink-2">
                      {r.summary}
                      <span className="ml-1 text-ink-3">· {formatAgo(r.createdAt, now)}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <Link href="/configuracoes?secao=automacoes" className="inline-block text-[12.5px] font-medium text-brand-700 hover:underline">
                Ver regras e histórico
              </Link>
            </CardBody>
          </Card>

          <Card className="bg-subtle">
            <CardBody className="pt-4">
              <div className="flex items-start gap-2.5 text-[12.5px] text-ink-2">
                <Users className="mt-0.5 size-4 shrink-0 text-ink-3" />
                <p>
                  Contagens de triagem e inclusão e as janelas de visita são <strong className="font-medium text-ink">espelhadas do Polo Trial</strong>. O Polo Chat organiza a operação em torno delas — não as recalcula.
                </p>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </Page>
  );
}
