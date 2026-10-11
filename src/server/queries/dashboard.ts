import "server-only";
import { OPEN_TASK_STATUSES, PIPELINE_STATUSES, PRIORITY_ORDER } from "@/domain/labels";
import { recruitmentPace } from "@/domain/pace";
import { RESCHEDULE_LIMIT } from "@/domain/rules";
import { addDays, addHours, formatDayMonth, formatTime, startOfDay, toDateParam } from "@/lib/dates";
import { formatBRL } from "@/lib/format";
import { type SessionUser, studyScope } from "@/server/auth/session";
import { db } from "@/server/db";

export { RESCHEDULE_LIMIT };

export interface AttentionItem {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail?: string;
  href: string;
  cta: string;
}

export async function getDashboardData(user: SessionUser, now = new Date()) {
  const scope = studyScope(user);
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const dayAfter = addDays(today, 2);
  const taskScope = user.studyIds ? { OR: [{ studyId: null }, { studyId: { in: user.studyIds } }] } : {};

  const [
    studies,
    inRecruitment,
    visitsToday,
    visitsTomorrow,
    openTasks,
    pendingReimb,
    contactsDueToday,
    nearLimit,
    recentMisses,
    clinicalConversations,
    automationRuns,
  ] = await Promise.all([
    db.study.findMany({ where: user.studyIds ? { id: { in: user.studyIds } } : {}, orderBy: { code: "asc" } }),
    db.participant.count({ where: { ...scope, status: { in: PIPELINE_STATUSES } } }),
    db.visit.findMany({
      where: { ...scope, scheduledAt: { gte: today, lt: tomorrow }, status: { not: "CANCELADO" } },
      include: { participant: { select: { id: true, fullName: true } }, study: { select: { code: true } }, staff: { select: { name: true } } },
      orderBy: { scheduledAt: "asc" },
    }),
    db.visit.findMany({
      where: { ...scope, scheduledAt: { gte: tomorrow, lt: dayAfter }, status: { not: "CANCELADO" } },
      include: { participant: { select: { id: true, fullName: true } }, study: { select: { code: true } } },
      orderBy: { scheduledAt: "asc" },
    }),
    db.task.findMany({
      where: { ...taskScope, status: { in: OPEN_TASK_STATUSES } },
      include: { participant: { select: { id: true, fullName: true } }, study: { select: { code: true } }, assignee: { select: { name: true } } },
    }),
    db.reimbursement.aggregate({ where: { ...scope, status: "PENDENTE" }, _sum: { amountCents: true }, _count: true }),
    db.participant.count({ where: { ...scope, status: { in: ["NOVO", "EM_CONTATO", "PRE_TRIAGEM", "AGUARDANDO_AGENDAMENTO"] }, nextActionDueAt: { lt: tomorrow } } }),
    db.visit.findMany({
      where: { ...scope, rescheduleCount: { gte: RESCHEDULE_LIMIT - 1 }, status: { in: ["AGUARDANDO_CONFIRMACAO", "CONFIRMADO", "REAGENDAMENTO_SOLICITADO"] } },
      include: { participant: { select: { id: true, fullName: true } } },
    }),
    db.visit.findMany({
      where: { ...scope, status: "FALTOU", scheduledAt: { gte: addDays(today, -3) }, tasks: { some: { status: { in: OPEN_TASK_STATUSES } } } },
      include: { participant: { select: { id: true, fullName: true } } },
      orderBy: { scheduledAt: "desc" },
    }),
    db.conversation.findMany({ where: { ...scope, status: "REQUER_ATENCAO" }, include: { participant: { select: { fullName: true } } } }),
    db.automationRun.findMany({
      where: { createdAt: { gte: addHours(now, -24) }, ...(user.studyIds ? { OR: [{ studyId: null }, { studyId: { in: user.studyIds } }] } : {}) },
      include: { rule: { select: { key: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const activeStudies = studies.filter((s) => s.status !== "ENCERRADO");
  const recruiting = studies.filter((s) => s.status === "RECRUTAMENTO_ATIVO");
  const screening = studies.reduce((a, s) => a + s.screeningCount, 0);
  const enrolled = recruiting.reduce((a, s) => a + s.enrolledCount, 0);
  const target = recruiting.reduce((a, s) => a + s.targetEnrollment, 0);
  const awaitingTomorrow = visitsTomorrow.filter((v) => v.status === "AGUARDANDO_CONFIRMACAO");
  const overdue = openTasks.filter((t) => t.dueAt < now);
  const critical = openTasks.filter((t) => t.priority === "ALTA");
  const studyRows = studies.map((s) => ({ ...s, pace: recruitmentPace(s, now) }));

  const pendingReview = await db.assistDecision.count({ where: { ...scope, outcome: "PENDENTE" } });

  // ── Atenção necessária ──
  const attention: AttentionItem[] = [];
  for (const c of clinicalConversations) {
    attention.push({ id: `clin-${c.id}`, severity: "critical", title: `Mensagem de ${c.participant.fullName} com possível relato clínico`, detail: "Encaminhar à equipe médica — sem resposta automática.", href: `/comunicacao?c=${c.id}`, cta: "Abrir conversa" });
  }
  for (const v of recentMisses) {
    attention.push({ id: `miss-${v.id}`, severity: "critical", title: `${v.participant.fullName} faltou à visita. Necessário contato.`, detail: `${v.name} · ${formatDayMonth(v.scheduledAt)} às ${formatTime(v.scheduledAt)}`, href: `/participantes/${v.participant.id}`, cta: "Ver participante" });
  }
  for (const t of openTasks.filter((t) => t.source === "POLO_TRIAL")) {
    attention.push({ id: `win-${t.id}`, severity: "critical", title: t.title, detail: "Alerta recebido do Polo Trial", href: "/pendencias?filtro=alta", cta: "Ver pendência" });
  }
  if (pendingReview > 0) {
    attention.push({
      id: "assist-review",
      severity: "warning",
      title: `${pendingReview} ${pendingReview === 1 ? "mensagem aguardando" : "mensagens aguardando"} revisão da IA`,
      detail: "Sugestões que a assistência não aplicou sozinha (modo sugestão, confiança baixa ou ambiguidade)",
      href: "/comunicacao?aba=revisao",
      cta: "Revisar",
    });
  }
  if (contactsDueToday > 0) {
    attention.push({ id: "contacts", severity: "warning", title: `${contactsDueToday} ${contactsDueToday === 1 ? "participante precisa" : "participantes precisam"} de contato hoje`, detail: "Candidatos com próxima ação vencendo hoje", href: "/participantes?acao=hoje", cta: "Ver lista" });
  }
  if (awaitingTomorrow.length > 0) {
    attention.push({ id: "confirm", severity: "warning", title: `${awaitingTomorrow.length} ${awaitingTomorrow.length === 1 ? "visita aguardando" : "visitas aguardando"} confirmação`, detail: `Amanhã: ${awaitingTomorrow.map((v) => v.participant.fullName.split(" ")[0]).join(", ")}`, href: `/agenda?data=${toDateParam(tomorrow)}`, cta: "Ver agenda" });
  }
  if (nearLimit.length > 0) {
    const p = nearLimit[0].participant;
    attention.push({
      id: "limit",
      severity: "warning",
      title: `${nearLimit.length} ${nearLimit.length === 1 ? "participante próximo" : "participantes próximos"} do limite de remarcação`,
      detail: nearLimit.length === 1 ? `${p.fullName} — ${nearLimit[0].rescheduleCount} de ${RESCHEDULE_LIMIT} remarcações` : `Limite operacional: ${RESCHEDULE_LIMIT} remarcações por visita`,
      href: nearLimit.length === 1 ? `/participantes/${p.id}` : "/agenda",
      cta: nearLimit.length === 1 ? "Ver participante" : "Ver agenda",
    });
  }
  for (const s of studyRows.filter((s) => s.pace?.status === "abaixo")) {
    attention.push({ id: `pace-${s.id}`, severity: "warning", title: `Estudo ${s.code} está abaixo do ritmo esperado`, detail: `${s.enrolledCount} incluídos de ${s.pace!.expected} previstos para hoje · ${s.pace!.neededPerWeek}/semana para atingir a meta`, href: `/estudos/${s.code}`, cta: "Ver estudo" });
  }
  if (overdue.length > 0) {
    attention.push({ id: "overdue", severity: "info", title: `${overdue.length} ${overdue.length === 1 ? "pendência atrasada" : "pendências atrasadas"}`, href: "/pendencias?filtro=atrasadas", cta: "Ver pendências" });
  }

  const priorityTasks = [...openTasks]
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.dueAt.getTime() - b.dueAt.getTime())
    .slice(0, 6);

  const byRule = new Map<string, { name: string; count: number }>();
  for (const r of automationRuns) {
    if (r.status === "FALHA") continue;
    const cur = byRule.get(r.rule.key) ?? { name: r.rule.name, count: 0 };
    cur.count++;
    byRule.set(r.rule.key, cur);
  }

  return {
    kpis: {
      activeStudies: activeStudies.length,
      recruitingStudies: recruiting.length,
      inRecruitment,
      screening,
      visitsToday: visitsToday.length,
      visitsTomorrow: visitsTomorrow.length,
      awaitingTomorrow: awaitingTomorrow.length,
      critical: critical.length,
      openTasks: openTasks.length,
      overdue: overdue.length,
      enrolled,
      target,
      pendingReimbCents: pendingReimb._sum.amountCents ?? 0,
      pendingReimbCount: pendingReimb._count,
      pendingReimbLabel: formatBRL(pendingReimb._sum.amountCents ?? 0),
    },
    attention,
    visitsToday,
    visitsTomorrow,
    priorityTasks,
    studies: studyRows,
    automation: { runs: automationRuns.slice(0, 5), byRule: [...byRule.values()].sort((a, b) => b.count - a.count), total: automationRuns.length },
  };
}
