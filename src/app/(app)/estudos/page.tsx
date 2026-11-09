import type { StudyStatus } from "@prisma/client";
import { CalendarDays, ClipboardList, FlaskConical, UserRoundSearch } from "lucide-react";
import Link from "@/components/ui/link";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, EmptyState, Page, PageHeader, Progress, RestrictedAccess, SourceTag } from "@/components/ui/misc";
import { UrlSearch, UrlSelect } from "@/components/ui/url-filters";
import { ROLE, STUDY_STATUS } from "@/domain/labels";
import { PACE_LABEL } from "@/domain/pace";
import { formatDate } from "@/lib/dates";
import { formatPct, ratio } from "@/lib/format";
import { can, getCurrentUser } from "@/server/auth/session";
import { listStudies } from "@/server/queries/studies";

export const metadata = { title: "Estudos" };

type SP = Promise<{ status?: string; q?: string }>;

export default async function StudiesPage({ searchParams }: { searchParams: SP }) {
  const user = await getCurrentUser();
  if (!can(user, "studies.view")) return <RestrictedAccess area="Estudos" role={ROLE[user.role].label} />;
  const sp = await searchParams;
  const status = sp.status && sp.status in STUDY_STATUS ? (sp.status as StudyStatus) : undefined;
  const studies = await listStudies(user, { status, q: sp.q });

  return (
    <Page>
      <PageHeader
        title="Estudos"
        description="Visão operacional de cada estudo. Contagens de inclusão e triagem são espelhadas do Polo Trial; o Polo Chat acompanha o ritmo e a operação em torno delas."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <UrlSearch placeholder="Buscar por código, patrocinador ou indicação" className="w-80" />
        <UrlSelect param="status" placeholder="Todos os status" options={Object.entries(STUDY_STATUS).map(([value, s]) => ({ value, label: s.label }))} />
        <span className="ml-auto text-[12.5px] text-ink-3">
          {studies.length} {studies.length === 1 ? "estudo" : "estudos"}
          {user.studyIds && " · exibindo apenas estudos da sua equipe"}
        </span>
      </div>

      {studies.length === 0 ? (
        <Card>
          <EmptyState icon={<FlaskConical className="size-5" />} title="Nenhum estudo encontrado" description="Ajuste a busca ou os filtros." />
        </Card>
      ) : (
        <div className="space-y-3">
          {studies.map((s) => {
            const pct = ratio(s.enrolledCount, s.targetEnrollment);
            return (
              <Link key={s.id} href={`/estudos/${s.code}`} className="group block rounded-xl border border-line bg-surface shadow-[var(--shadow-card)] transition-colors hover:border-line-strong">
                <div className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,0.9fr)]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[16px] font-semibold tracking-tight text-ink group-hover:text-brand-700">{s.code}</span>
                      <StatusBadge map={STUDY_STATUS} value={s.status} />
                      {s.pace && <Badge tone={PACE_LABEL[s.pace.status].tone}>{PACE_LABEL[s.pace.status].label}</Badge>}
                    </div>
                    <p className="mt-1 text-[13.5px] text-ink">{s.name}</p>
                    <p className="mt-0.5 text-[12.5px] text-ink-3">
                      {s.sponsor} · {s.studyType} · {s.phase}
                    </p>
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <span className="text-[12.5px] text-ink-3">Recrutados</span>
                      <span className="text-[13px] text-ink-2 tnum">
                        <strong className="text-[15px] font-semibold text-ink">{s.enrolledCount}</strong> de {s.targetEnrollment} · {formatPct(pct)}
                      </span>
                    </div>
                    <Progress value={s.enrolledCount} max={s.targetEnrollment} marker={s.pace?.expected} tone={s.pace?.status === "abaixo" ? "amber" : "brand"} />
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-3">
                      <span>
                        Em triagem: <strong className="font-medium text-ink-2">{s.screeningCount}</strong>
                      </span>
                      <SourceTag kind="polo" />
                      {s.pace && s.pace.status === "abaixo" && <span className="text-amber-700">{s.pace.expected} previstos para hoje</span>}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
                    <div>
                      <div className="text-ink-3">Início</div>
                      <div className="text-ink-2 tnum">{formatDate(s.startDate)}</div>
                    </div>
                    <div>
                      <div className="text-ink-3">Previsão de encerramento</div>
                      <div className="text-ink-2 tnum">{formatDate(s.expectedEndDate)}</div>
                    </div>
                    <div className="col-span-2 flex items-center gap-2">
                      <Avatar name={s.owner.name} size="xs" />
                      <span className="text-ink-2">{s.owner.name}</span>
                      <span className="text-ink-3">· responsável</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line bg-subtle/60 px-5 py-2.5 text-[12.5px] text-ink-2">
                  <span className="inline-flex items-center gap-1.5">
                    <UserRoundSearch className="size-3.5 text-ink-3" /> {s.pipeline} candidatos no pipeline
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="size-3.5 text-ink-3" /> {s.visits7d} visitas nos próximos 7 dias
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <ClipboardList className="size-3.5 text-ink-3" /> {s.openTasks} pendências abertas
                  </span>
                  <span className="ml-auto text-ink-3">{s.indication}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </Page>
  );
}
