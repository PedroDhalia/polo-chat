import { ArrowLeft, Database, RefreshCw, Workflow } from "lucide-react";
import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { LineChart } from "@/components/charts/line-chart";
import { ActionButton } from "@/components/ui/action-button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar, EmptyState, Page, Progress, RestrictedAccess, SourceTag } from "@/components/ui/misc";
import { hrefWith, Tabs } from "@/components/ui/nav";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { UrlSearch, UrlSelect } from "@/components/ui/url-filters";
import { CONVERSATION_STATUS, PARTICIPANT_STATUS, PIPELINE_STATUSES, ROLE, STUDY_STATUS, TASK_PRIORITY, VISIT_STATUS } from "@/domain/labels";
import { PACE_LABEL } from "@/domain/pace";
import { TemplatesView } from "@/features/communication/templates-view";
import { FinanceView } from "@/features/finance/finance-view";
import { Pagination, ParticipantsTable } from "@/features/participants/participants-table";
import { RecruitmentView } from "@/features/recruitment/recruitment-view";
import { ReportsView } from "@/features/reports/reports-view";
import { VisitTable } from "@/features/visits/visit-table";
import { addDays, formatAgo, formatDate, formatRelativeDateTime, startOfDay } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { formatNumber, formatPct, ratio } from "@/lib/format";
import { syncPoloTrialAction } from "@/server/actions/admin";
import { can, getCurrentUser, type SessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { getVisitsInRange } from "@/server/queries/agenda";
import { listParticipants, PAGE_SIZE } from "@/server/queries/participants";
import { getEnrollmentProgress, parsePeriod, PERIOD_OPTIONS } from "@/server/queries/recruitment";
import { getStudyByCode } from "@/server/queries/studies";

export const metadata = { title: "Estudo" };

const TABS = [
  { key: "visao-geral", label: "Visão geral" },
  { key: "recrutamento", label: "Recrutamento" },
  { key: "participantes", label: "Participantes" },
  { key: "agenda", label: "Agenda" },
  { key: "comunicacao", label: "Comunicação" },
  { key: "financeiro", label: "Financeiro" },
  { key: "relatorios", label: "Relatórios" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

type Props = { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> };

export default async function StudyPage({ params, searchParams }: Props) {
  const user = await getCurrentUser();
  if (!can(user, "studies.view")) return <RestrictedAccess area="Estudos" role={ROLE[user.role].label} />;
  const { code } = await params;
  const sp = await searchParams;
  const data = await getStudyByCode(user, decodeURIComponent(code));
  if (!data) notFound();
  const { study, pace } = data;
  const now = new Date();
  const base = `/estudos/${study.code}`;
  const visibleTabs = TABS.filter((t) => (t.key === "financeiro" ? can(user, "finance.view") : t.key === "comunicacao" ? can(user, "communication.view") : t.key === "relatorios" ? can(user, "reports.view") : true));
  const tab: TabKey = visibleTabs.some((t) => t.key === sp.aba) ? (sp.aba as TabKey) : "visao-geral";

  return (
    <Page>
      <Link href="/estudos" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink">
        <ArrowLeft className="size-3.5" /> Estudos
      </Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[24px] font-semibold tracking-tight">{study.code}</h1>
            <StatusBadge map={STUDY_STATUS} value={study.status} />
            {pace && <Badge tone={PACE_LABEL[pace.status].tone}>{PACE_LABEL[pace.status].label}</Badge>}
          </div>
          <p className="mt-1 max-w-3xl text-[14px] text-ink">{study.title}</p>
          <p className="mt-1 text-[13px] text-ink-3">
            {study.sponsor} · {study.indication} · {study.studyType} · {study.phase}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <ActionButton action={syncPoloTrialAction} icon={<RefreshCw className="size-3.5" />}>
            Sincronizar com Polo Trial
          </ActionButton>
          <span className="flex items-center gap-1 text-[11.5px] text-ink-3">
            <Database className="size-3" /> {data.externalId ?? "Sem vínculo"} · {study.sourceSyncedAt ? `sincronizado ${formatAgo(study.sourceSyncedAt, now)}` : "nunca sincronizado"} · simulado
          </span>
        </div>
      </div>

      <Tabs className="mb-6" items={visibleTabs.map((t) => ({ label: t.label, href: t.key === "visao-geral" ? base : `${base}?aba=${t.key}`, active: tab === t.key }))} />

      {tab === "visao-geral" && <Overview data={data} now={now} canTasks={can(user, "tasks.view")} />}
      {tab === "recrutamento" && (
        <>
          <div className="mb-4 flex items-center gap-2">
            <UrlSelect param="periodo" placeholder="Últimas 12 semanas" options={PERIOD_OPTIONS.filter((p) => p.value !== "12")} />
          </div>
          <RecruitmentView user={user} studyId={study.id} weeks={parsePeriod(sp.periodo)} periodLabel={PERIOD_OPTIONS.find((p) => p.value === (sp.periodo ?? "12"))?.label ?? "Últimas 12 semanas"} />
        </>
      )}
      {tab === "participantes" && <ParticipantsTab user={user} studyId={study.id} base={base} sp={sp} />}
      {tab === "agenda" && <AgendaTab user={user} now={now} studyId={study.id} canManage={can(user, "agenda.manage")} />}
      {tab === "comunicacao" && <CommunicationTab user={user} now={now} studyId={study.id} />}
      {tab === "financeiro" && <FinanceView user={user} studyId={study.id} />}
      {tab === "relatorios" && <ReportsView user={user} studyId={study.id} weeks={12} periodLabel="Últimas 12 semanas" />}
    </Page>
  );
}

async function ParticipantsTab({ user, studyId, base, sp }: { user: SessionUser; studyId: string; base: string; sp: Record<string, string | undefined> }) {
    const page = Number(sp.pagina) || 1;
    const result = await listParticipants(user, { studyId, q: sp.q, status: sp.status && sp.status in PARTICIPANT_STATUS ? (sp.status as never) : undefined, page });
    const current = { aba: "participantes", q: sp.q, status: sp.status };
    return (
      <>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <UrlSearch placeholder="Nome ou código" className="w-64" />
          <UrlSelect param="status" placeholder="Todos os status" options={Object.entries(PARTICIPANT_STATUS).map(([value, s]) => ({ value, label: s.label }))} />
        </div>
        <Card className="overflow-hidden">
          {result.rows.length === 0 ? (
            <EmptyState title="Nenhum participante encontrado" />
          ) : (
            <>
              <ParticipantsTable rows={result.rows} showStudy={false} />
              <Pagination page={result.page} pages={result.pages} total={result.total} pageSize={PAGE_SIZE} hrefFor={(p) => hrefWith(base, current, { pagina: String(p) })} />
            </>
          )}
        </Card>
      </>
    );
  }

async function AgendaTab({ user, now, studyId, canManage }: { user: SessionUser; now: Date; studyId: string; canManage: boolean }) {
    const visits = await getVisitsInRange(user, startOfDay(now), addDays(startOfDay(now), 15), { studyId });
    return (
      <Card className="overflow-hidden">
        <CardHeader title="Próximas visitas" description="Hoje e próximos 14 dias" />
        <div className="border-t border-line">{visits.length ? <VisitTable visits={visits} canManage={canManage} showDate now={now} /> : <EmptyState title="Nenhuma visita agendada" />}</div>
      </Card>
    );
  }

async function CommunicationTab({ user, now, studyId }: { user: SessionUser; now: Date; studyId: string }) {
    const conversations = await db.conversation.findMany({
      where: { studyId },
      include: { participant: { select: { fullName: true } }, messages: { orderBy: { sentAt: "desc" }, take: 1 } },
      orderBy: { lastMessageAt: "desc" },
      take: 12,
    });
    return (
      <div className="space-y-5">
        <Card className="overflow-hidden">
          <CardHeader title="Conversas recentes" description="Abra na central de Comunicação para responder." />
          <Table className="border-t border-line">
            <THead>
              <Th>Participante</Th>
              <Th>Status</Th>
              <Th>Última mensagem</Th>
              <Th>Quando</Th>
            </THead>
            <tbody>
              {conversations.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <Link href={`/comunicacao?c=${c.id}`} className="font-medium whitespace-nowrap text-ink hover:text-brand-700">
                      {c.participant.fullName}
                    </Link>
                  </Td>
                  <Td>
                    <StatusBadge map={CONVERSATION_STATUS} value={c.status} />
                  </Td>
                  <Td className="max-w-[460px] truncate text-ink-2">
                    {c.messages[0]?.automated && <Workflow className="mr-1 inline size-3 text-violet-500" />}
                    {c.messages[0]?.body}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-3">{formatAgo(c.lastMessageAt, now)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <div>
          <h2 className="mb-3 text-[15px] font-semibold tracking-tight">Modelos disponíveis para este estudo</h2>
          <TemplatesView user={user} studyId={studyId} />
        </div>
      </div>
    );
}

async function Overview({ data, now, canTasks }: { data: NonNullable<Awaited<ReturnType<typeof getStudyByCode>>>; now: Date; canTasks: boolean }) {
  const { study, pace, statusCounts, openTasks, upcomingVisits } = data;
  const progress = await getEnrollmentProgress(study.id);
  const pipeline = PIPELINE_STATUSES.reduce((a, s) => a + (statusCounts[s] ?? 0), 0);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Recrutados"
          value={
            <>
              {formatNumber(study.enrolledCount)} <span className="text-[16px] font-medium text-ink-3">de {formatNumber(study.targetEnrollment)}</span>
            </>
          }
          sub={`${formatPct(ratio(study.enrolledCount, study.targetEnrollment))} da meta`}
          footer={<Progress value={study.enrolledCount} max={study.targetEnrollment} marker={pace?.expected} tone={pace?.status === "abaixo" ? "amber" : "brand"} />}
        />
        <StatTile label="Em triagem" value={study.screeningCount} sub={<SourceTag kind="polo">Dado do Polo Trial</SourceTag>} />
        <StatTile
          label="Ritmo de recrutamento"
          value={pace ? PACE_LABEL[pace.status].label : "—"}
          sub={pace ? `${pace.expected} previstos para hoje · ${pace.neededPerWeek}/semana até a meta` : "Recrutamento encerrado"}
          subTone={pace?.status === "abaixo" ? "red" : undefined}
        />
        <StatTile label="Candidatos no pipeline" value={pipeline} sub={`${statusCounts.AGENDADO ?? 0} com triagem agendada`} href={`/estudos/${study.code}?aba=participantes`} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          <CardHeader title="Evolução do recrutamento" description="Incluídos acumulados × plano linear até a meta" />
          <CardBody>
            <LineChart
              height={300}
              data={progress.points.map((p) => ({ label: p.label, title: p.title, values: { actual: p.actual, planned: p.planned } }))}
              series={[
                { key: "actual", label: "Incluídos", color: "var(--color-chart-accent)" },
                { key: "planned", label: "Planejado", color: "var(--color-chart-muted)", muted: true },
              ]}
              target={{ value: study.targetEnrollment, label: `Meta ${study.targetEnrollment}` }}
            />
          </CardBody>
        </Card>
        <Card className="xl:col-span-4">
          <CardHeader title="Informações do estudo" />
          <CardBody>
            <dl className="grid grid-cols-[130px_1fr] gap-y-2.5 text-[13px]">
              <dt className="text-ink-3">Patrocinador</dt>
              <dd className="text-ink">{study.sponsor}</dd>
              <dt className="text-ink-3">Indicação</dt>
              <dd className="text-ink">{study.indication}</dd>
              <dt className="text-ink-3">Tipo · fase</dt>
              <dd className="text-ink">
                {study.studyType} · {study.phase}
              </dd>
              <dt className="text-ink-3">Início</dt>
              <dd className="text-ink tnum">{formatDate(study.startDate)}</dd>
              <dt className="text-ink-3">Fim do recrutamento</dt>
              <dd className="text-ink tnum">{study.recruitmentEndDate ? formatDate(study.recruitmentEndDate) : "—"}</dd>
              <dt className="text-ink-3">Previsão de encerramento</dt>
              <dd className="text-ink tnum">{formatDate(study.expectedEndDate)}</dd>
              <dt className="text-ink-3">Responsável</dt>
              <dd className="flex items-center gap-2 text-ink">
                <Avatar name={study.owner.name} size="xs" /> {study.owner.name}
              </dd>
            </dl>
            <div className="mt-4 border-t border-line pt-3">
              <div className="mb-2 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">Equipe</div>
              <ul className="space-y-2">
                {study.members.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 text-[13px]">
                    <Avatar name={m.user.name} size="xs" />
                    <span className="text-ink">{m.user.name}</span>
                    <span className="text-ink-3">· {m.studyRole}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Próximas visitas"
            action={
              <Link href={`/estudos/${study.code}?aba=agenda`} className="text-[12.5px] font-medium text-brand-700 hover:underline">
                Ver agenda
              </Link>
            }
          />
          <ul className="border-t border-line">
            {upcomingVisits.length === 0 && <li className="px-5 py-6 text-center text-[13px] text-ink-3">Nenhuma visita agendada.</li>}
            {upcomingVisits.map((v) => (
              <li key={v.id} className="flex items-center gap-3 border-b border-line px-5 py-2.5 last:border-0">
                <span className="w-28 shrink-0 text-[12.5px] text-ink-2 tnum">{formatRelativeDateTime(v.scheduledAt, now)}</span>
                <Link href={`/participantes/${v.participant.id}`} className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink hover:text-brand-700">
                  {v.participant.fullName} <span className="font-normal text-ink-3">· {v.name}</span>
                </Link>
                <StatusBadge map={VISIT_STATUS} value={v.status} />
              </li>
            ))}
          </ul>
        </Card>
        {canTasks && (
          <Card>
            <CardHeader
              title="Pendências do estudo"
              description={`${openTasks.length} abertas`}
              action={
                <Link href={`/pendencias?estudo=${study.id}`} className="text-[12.5px] font-medium text-brand-700 hover:underline">
                  Ver todas
                </Link>
              }
            />
            <ul className="border-t border-line">
              {openTasks.length === 0 && <li className="px-5 py-6 text-center text-[13px] text-ink-3">Nenhuma pendência aberta.</li>}
              {openTasks.slice(0, 6).map((t) => (
                <li key={t.id} className="flex items-center gap-3 border-b border-line px-5 py-2.5 last:border-0">
                  <StatusBadge map={TASK_PRIORITY} value={t.priority} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{t.title}</span>
                  <span className={cn("shrink-0 text-[12px] tnum", t.dueAt < now ? "font-medium text-red-600" : "text-ink-3")}>{formatRelativeDateTime(t.dueAt, now)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
