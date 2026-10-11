import "server-only";
import type { ParticipantStatus, Prisma, RecruitmentChannel } from "@prisma/client";
import { CHANNEL, CHANNELS } from "@/domain/labels";
import { addDays, formatDayMonth, startOfWeek } from "@/lib/dates";
import { type SessionUser, studyScope } from "@/server/auth/session";
import { db } from "@/server/db";

export interface RecruitmentFilters {
  studyId?: string;
  channel?: RecruitmentChannel;
  /** Semanas para trás (inclui a atual). `undefined` = todo o período. */
  weeks?: number;
}

export const PERIOD_OPTIONS = [
  { value: "4", label: "Últimas 4 semanas" },
  { value: "12", label: "Últimas 12 semanas" },
  { value: "26", label: "Últimos 6 meses" },
  { value: "todo", label: "Todo o período" },
];

export function parsePeriod(value: string | undefined, fallback = 12): number | undefined {
  if (value === "todo") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function metricWhere(user: SessionUser, f: RecruitmentFilters, now = new Date()): Prisma.RecruitmentMetricWhereInput {
  const where: Prisma.RecruitmentMetricWhereInput = { ...studyScope(user) };
  if (f.studyId) where.studyId = user.studyIds && !user.studyIds.includes(f.studyId) ? "__none__" : f.studyId;
  if (f.channel) where.channel = f.channel;
  if (f.weeks) where.weekStart = { gte: addDays(startOfWeek(now), -7 * (f.weeks - 1)) };
  return where;
}

export async function getFunnel(user: SessionUser, f: RecruitmentFilters) {
  const [stages, sums] = await Promise.all([
    db.recruitmentStage.findMany({ orderBy: { order: "asc" } }),
    db.recruitmentMetric.groupBy({ by: ["stageId"], where: metricWhere(user, f), _sum: { count: true } }),
  ]);
  const byStage = new Map(sums.map((s) => [s.stageId, s._sum.count ?? 0]));
  return stages.map((s) => ({ key: s.key, name: s.name, description: s.description, value: byStage.get(s.id) ?? 0 }));
}

export type FunnelData = Awaited<ReturnType<typeof getFunnel>>;

export function funnelRates(funnel: FunnelData) {
  const v = (k: string) => funnel.find((s) => s.key === k)?.value ?? 0;
  const safe = (a: number, b: number) => (b > 0 ? a / b : 0);
  return {
    candidates: v("BASE"),
    included: v("INCLUIDOS"),
    responseRate: safe(v("RESPONDERAM"), v("CONTATADOS")),
    eligibilityRate: safe(v("ELEGIVEIS"), v("PRE_TRIAGEM")),
    schedulingRate: safe(v("AGENDADOS"), v("ELEGIVEIS")),
    inclusionRate: safe(v("INCLUIDOS"), v("AGENDADOS")),
    overallRate: safe(v("INCLUIDOS"), v("BASE")),
  };
}

/** Desempenho por canal: candidatos, resposta e inclusões. */
export async function getChannelBreakdown(user: SessionUser, f: RecruitmentFilters) {
  const [stages, rows] = await Promise.all([
    db.recruitmentStage.findMany(),
    db.recruitmentMetric.groupBy({ by: ["channel", "stageId"], where: metricWhere(user, { ...f, channel: undefined }), _sum: { count: true } }),
  ]);
  const key = new Map(stages.map((s) => [s.id, s.key]));
  const out = CHANNELS.map((c) => ({ channel: c, label: CHANNEL[c].label, base: 0, contacted: 0, responded: 0, included: 0 }));
  for (const r of rows) {
    const item = out.find((o) => o.channel === r.channel)!;
    const n = r._sum.count ?? 0;
    const k = key.get(r.stageId);
    if (k === "BASE") item.base += n;
    if (k === "CONTATADOS") item.contacted += n;
    if (k === "RESPONDERAM") item.responded += n;
    if (k === "INCLUIDOS") item.included += n;
  }
  return out
    .map((o) => ({ ...o, responseRate: o.contacted ? o.responded / o.contacted : 0, conversion: o.base ? o.included / o.base : 0 }))
    .filter((o) => o.base > 0)
    .sort((a, b) => b.included - a.included);
}

/** Inclusões por semana (série temporal). */
export async function getWeeklyInclusions(user: SessionUser, f: RecruitmentFilters) {
  const stage = await db.recruitmentStage.findUniqueOrThrow({ where: { key: "INCLUIDOS" } });
  const rows = await db.recruitmentMetric.groupBy({ by: ["weekStart"], where: { ...metricWhere(user, f), stageId: stage.id }, _sum: { count: true }, orderBy: { weekStart: "asc" } });
  return rows.map((r) => ({ weekStart: r.weekStart, label: formatDayMonth(r.weekStart), value: r._sum.count ?? 0 }));
}

/** Evolução acumulada de inclusões de um estudo vs. plano linear até a meta. */
export async function getEnrollmentProgress(studyId: string) {
  const study = await db.study.findUniqueOrThrow({ where: { id: studyId } });
  const stage = await db.recruitmentStage.findUniqueOrThrow({ where: { key: "INCLUIDOS" } });
  const rows = await db.recruitmentMetric.groupBy({ by: ["weekStart"], where: { studyId, stageId: stage.id }, _sum: { count: true }, orderBy: { weekStart: "asc" } });
  const start = study.startDate.getTime();
  const end = (study.recruitmentEndDate ?? study.expectedEndDate).getTime();
  let acc = 0;
  return {
    study,
    points: rows.map((r) => {
      acc += r._sum.count ?? 0;
      const t = Math.min(1, Math.max(0, (r.weekStart.getTime() + 7 * 86_400_000 - start) / (end - start)));
      return { label: formatDayMonth(r.weekStart), title: `Semana de ${formatDayMonth(r.weekStart)}`, actual: acc, planned: Math.round(study.targetEnrollment * t) };
    }),
  };
}

/** Candidatos do pipeline operacional agrupados por status. */
export async function getPipeline(user: SessionUser, f: { studyId?: string; channel?: RecruitmentChannel; status?: ParticipantStatus }) {
  const where: Prisma.ParticipantWhereInput = { ...studyScope(user), status: { in: ["NOVO", "EM_CONTATO", "PRE_TRIAGEM", "AGUARDANDO_AGENDAMENTO", "AGENDADO"] } };
  if (f.studyId) where.studyId = user.studyIds && !user.studyIds.includes(f.studyId) ? "__none__" : f.studyId;
  if (f.channel) where.channel = f.channel;
  if (f.status) where.status = f.status;
  return db.participant.findMany({
    where,
    include: { study: { select: { code: true } }, owner: { select: { name: true } } },
    orderBy: [{ nextActionDueAt: "asc" }],
  });
}
