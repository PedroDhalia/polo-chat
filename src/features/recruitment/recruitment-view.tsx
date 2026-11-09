import type { ParticipantStatus, RecruitmentChannel } from "@prisma/client";
import Link from "@/components/ui/link";
import { ColumnChart } from "@/components/charts/column-chart";
import { Funnel } from "@/components/charts/funnel";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/misc";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { CHANNEL, PARTICIPANT_STATUS, PIPELINE_STATUSES } from "@/domain/labels";
import { formatRelativeDateTime } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { formatNumber, formatPct } from "@/lib/format";
import type { SessionUser } from "@/server/auth/session";
import { funnelRates, getChannelBreakdown, getFunnel, getPipeline, getWeeklyInclusions } from "@/server/queries/recruitment";

export async function RecruitmentView({
  user,
  studyId,
  channel,
  weeks,
  status,
  periodLabel,
}: {
  user: SessionUser;
  studyId?: string;
  channel?: RecruitmentChannel;
  weeks?: number;
  status?: ParticipantStatus;
  periodLabel: string;
}) {
  const filters = { studyId, channel, weeks };
  const [funnel, channels, weekly, pipeline] = await Promise.all([
    getFunnel(user, filters),
    getChannelBreakdown(user, filters),
    getWeeklyInclusions(user, filters),
    getPipeline(user, { studyId, channel, status }),
  ]);
  const r = funnelRates(funnel);
  const now = new Date();
  const maxConversion = Math.max(0.0001, ...channels.map((c) => c.conversion));
  const columns = (status ? [status] : PIPELINE_STATUSES).filter((s) => PIPELINE_STATUSES.includes(s));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Total de candidatos" value={formatNumber(r.candidates)} sub={periodLabel} />
        <StatTile label="Taxa de resposta" value={formatPct(r.responseRate)} sub="Responderam / contatados" />
        <StatTile label="Taxa de elegibilidade" value={formatPct(r.eligibilityRate)} sub="Elegíveis / pré-triagem" />
        <StatTile label="Taxa de agendamento" value={formatPct(r.schedulingRate)} sub="Agendados / elegíveis" />
        <StatTile label="Taxa de inclusão" value={formatPct(r.inclusionRate)} sub={`${formatNumber(r.included)} incluídos · ${formatPct(r.overallRate, 1)} da base`} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Card className="xl:col-span-6">
          <CardHeader title="Funil de recrutamento" description={`${periodLabel} · elegibilidade é sempre avaliada pela equipe`} />
          <CardBody>
            <Funnel stages={funnel} />
          </CardBody>
        </Card>
        <Card className="xl:col-span-6">
          <CardHeader title="Desempenho por canal" description="Onde investir esforço de captação" />
          <Table className="border-t border-line [&_td]:px-3 [&_th]:px-3">
            <THead>
              <Th>Canal</Th>
              <Th className="text-right">Candidatos</Th>
              <Th className="text-right">Resposta</Th>
              <Th className="text-right">Incluídos</Th>
              <Th>Conversão</Th>
            </THead>
            <tbody>
              {channels.map((c) => (
                <Tr key={c.channel}>
                  <Td className="whitespace-nowrap font-medium text-ink">{c.label}</Td>
                  <Td className="text-right text-ink-2 tnum">{formatNumber(c.base)}</Td>
                  <Td className="text-right text-ink-2 tnum">{formatPct(c.responseRate)}</Td>
                  <Td className="text-right font-medium text-ink tnum">{formatNumber(c.included)}</Td>
                  <Td>
                    <div className="flex items-center gap-2" title={`Conversão base → incluídos: ${formatPct(c.conversion, 1)}`}>
                      <div className="h-1.5 w-10 rounded-full bg-stone-100">
                        <div className="h-full rounded-full bg-chart-accent" style={{ width: `${(c.conversion / maxConversion) * 100}%` }} />
                      </div>
                      <span className="text-[12px] text-ink-2 tnum">{formatPct(c.conversion, 1)}</span>
                    </div>
                  </Td>
                </Tr>
              ))}
              {channels.length === 0 && (
                <Tr>
                  <Td colSpan={5} className="py-8 text-center text-ink-3">
                    Sem dados no período.
                  </Td>
                </Tr>
              )}
            </tbody>
          </Table>
        </Card>
      </div>

      <Card>
        <CardHeader title="Inclusões por semana" description={`${periodLabel} · fonte: registros de inclusão (Polo Trial, simulado)`} />
        <CardBody>
          {weekly.length > 0 ? (
            <ColumnChart data={weekly.map((w) => ({ label: w.label, title: `Semana de ${w.label}`, values: { incl: w.value } }))} series={[{ key: "incl", label: "Inclusões", color: "var(--color-chart-accent)" }]} />
          ) : (
            <p className="py-8 text-center text-[13px] text-ink-3">Sem inclusões no período selecionado.</p>
          )}
        </CardBody>
      </Card>

      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">Pipeline de candidatos</h2>
            <p className="text-[13px] text-ink-3">Candidatos em andamento no Polo Chat, por etapa operacional.</p>
          </div>
          <span className="text-[12.5px] text-ink-3">{pipeline.length} candidatos</span>
        </div>
        <div className="grid gap-3 overflow-x-auto pb-1 scrollbar-thin" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(200px, 1fr))` }}>
          {columns.map((s) => {
            const items = pipeline.filter((p) => p.status === s);
            return (
              <div key={s} className="flex max-h-[560px] flex-col rounded-xl border border-line bg-subtle">
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-[12.5px] font-semibold text-ink">{PARTICIPANT_STATUS[s].label}</span>
                  <span className="rounded bg-stone-200/70 px-1.5 text-[11px] font-semibold text-ink-2 tnum">{items.length}</span>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2 scrollbar-thin">
                  {items.map((p) => {
                    const overdue = p.nextActionDueAt && p.nextActionDueAt < now;
                    return (
                      <Link key={p.id} href={`/participantes/${p.id}`} className="block rounded-lg border border-line bg-surface p-2.5 shadow-[var(--shadow-card)] hover:border-line-strong">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-[13px] font-medium text-ink">{p.fullName}</span>
                          {p.owner && <Avatar name={p.owner.name} size="xs" />}
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-ink-3">
                          {p.study.code} · {CHANNEL[p.channel].short}
                        </div>
                        {p.nextAction && (
                          <div className={cn("mt-1.5 text-[12px]", overdue ? "font-medium text-red-600" : "text-ink-2")}>
                            {p.nextAction}
                            {p.nextActionDueAt && <span className="block text-[11.5px] font-normal tnum">{formatRelativeDateTime(p.nextActionDueAt, now)}</span>}
                          </div>
                        )}
                      </Link>
                    );
                  })}
                  {items.length === 0 && <p className="px-1 py-4 text-center text-[12px] text-ink-3">Nenhum candidato</p>}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
