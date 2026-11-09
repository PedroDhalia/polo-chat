import type { ParticipantStatus, RecruitmentChannel } from "@prisma/client";
import { BarList } from "@/components/charts/bar-list";
import { ColumnChart } from "@/components/charts/column-chart";
import { LineChart } from "@/components/charts/line-chart";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PARTICIPANT_STATUS, REIMBURSEMENT_STATUS } from "@/domain/labels";
import { recruitmentPace } from "@/domain/pace";
import { formatBRL, formatNumber, formatPct, ratio } from "@/lib/format";
import type { SessionUser } from "@/server/auth/session";
import { getChannelBreakdown, getEnrollmentProgress } from "@/server/queries/recruitment";
import { participantsByStatus, recruitmentByStudy, reimbursementsByStatus, visitsWeekly } from "@/server/queries/reports";

const STATUS_ORDER: ParticipantStatus[] = ["NOVO", "EM_CONTATO", "PRE_TRIAGEM", "AGUARDANDO_AGENDAMENTO", "AGENDADO", "INCLUIDO", "INELEGIVEL", "RETIRADO"];

export async function ReportsView({ user, studyId, weeks, periodLabel, channel }: { user: SessionUser; studyId?: string; weeks?: number; periodLabel: string; channel?: RecruitmentChannel }) {
  const [studies, channels, byStatus, weekly, reimb] = await Promise.all([
    recruitmentByStudy(user, studyId),
    getChannelBreakdown(user, { studyId, weeks, channel }),
    participantsByStatus(user, studyId),
    visitsWeekly(user, studyId),
    reimbursementsByStatus(user, studyId),
  ]);
  const evolutionStudies = studies.filter((s) => s.status === "RECRUTAMENTO_ATIVO" || studyId);
  const progress = await Promise.all(evolutionStudies.map((s) => getEnrollmentProgress(s.id)));
  const single = progress.length === 1;
  const totalVisits = weekly.reduce((a, w) => a + w.realized + w.missed, 0);
  const missed = weekly.reduce((a, w) => a + w.missed, 0);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Evolução da meta" description="Incluídos acumulados (Polo Trial) × plano linear de recrutamento até a meta." />
        <CardBody>
          <div className={single ? "" : "grid grid-cols-1 gap-6 lg:grid-cols-3"}>
            {progress.map(({ study, points }) => {
              const pace = recruitmentPace(study);
              return (
                <div key={study.id}>
                  {!single && (
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="text-[13px] font-semibold">{study.code}</span>
                      <span className="text-[12px] text-ink-3">
                        {study.enrolledCount} de {study.targetEnrollment}
                        {pace && ` · ${pace.status === "abaixo" ? "abaixo do ritmo" : pace.status === "acima" ? "acima do ritmo" : "no ritmo"}`}
                      </span>
                    </div>
                  )}
                  <LineChart
                    height={single ? 260 : 210}
                    data={points.map((p) => ({ label: p.label, title: p.title, values: { actual: p.actual, planned: p.planned } }))}
                    series={[
                      { key: "actual", label: "Incluídos", color: "var(--color-chart-accent)" },
                      { key: "planned", label: "Planejado", color: "var(--color-chart-muted)", muted: true },
                    ]}
                    target={{ value: study.targetEnrollment, label: `Meta ${study.targetEnrollment}` }}
                  />
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Recrutamento por estudo" description="Incluídos e percentual da meta" />
          <CardBody>
            <BarList
              items={studies.map((s) => ({ label: s.code, value: s.enrolledCount, hint: `de ${s.targetEnrollment} · ${formatPct(ratio(s.enrolledCount, s.targetEnrollment))}`, href: `/estudos/${s.code}` }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recrutamento por canal" description={`Incluídos por canal de origem · ${periodLabel}`} />
          <CardBody>
            {channels.length ? (
              <BarList items={channels.map((c) => ({ label: c.label, value: c.included, hint: `${formatPct(c.conversion, 1)} da base` }))} />
            ) : (
              <p className="py-6 text-center text-[13px] text-ink-3">Sem dados no período.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Participantes por etapa" description="Situação operacional no Polo Chat" />
          <CardBody>
            <BarList items={STATUS_ORDER.map((s) => ({ label: PARTICIPANT_STATUS[s].label, value: byStatus[s] ?? 0, emphasis: s === "INELEGIVEL" || s === "RETIRADO" ? false : undefined }))} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Visitas realizadas × perdidas"
            description={`Últimas 8 semanas · ${totalVisits} visitas registradas · comparecimento ${formatPct(1 - ratio(missed, totalVisits))}`}
          />
          <CardBody>
            <ColumnChart
              height={190}
              data={weekly.map((w) => ({ label: w.label, title: w.title, values: { realized: w.realized, missed: w.missed } }))}
              series={[
                { key: "realized", label: "Realizadas", color: "var(--color-chart-accent)" },
                { key: "missed", label: "Faltas", color: "var(--color-chart-critical)" },
              ]}
            />
            <details className="mt-3 text-[12.5px]">
              <summary className="cursor-pointer text-ink-3 hover:text-ink-2">Ver dados em tabela</summary>
              <table className="mt-2 w-full text-left tnum">
                <thead className="text-ink-3">
                  <tr>
                    <th className="py-1 font-medium">Semana</th>
                    <th className="py-1 text-right font-medium">Realizadas</th>
                    <th className="py-1 text-right font-medium">Faltas</th>
                  </tr>
                </thead>
                <tbody>
                  {weekly.map((w) => (
                    <tr key={w.label} className="border-t border-line">
                      <td className="py-1 text-ink-2">{w.title}</td>
                      <td className="py-1 text-right text-ink">{w.realized}</td>
                      <td className="py-1 text-right text-ink">{w.missed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Reembolsos" description="Valor por status" />
          <CardBody>
            <BarList
              valueFormatter={formatBRL}
              items={(["PAGO", "EM_CONCILIACAO", "PENDENTE"] as const).map((s) => {
                const r = reimb.find((x) => x.status === s);
                return { label: REIMBURSEMENT_STATUS[s].label, value: r?._sum.amountCents ?? 0, hint: `${formatNumber(r?._count ?? 0)} reembolsos` };
              })}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
