import "server-only";
import { AI_MODE, AI_MODEL } from "@/integrations";
import { addDays, formatDayMonth, formatLongDate, startOfDay, toDateParam } from "@/lib/dates";
import { studyScope, type SessionUser } from "@/server/auth/session";
import { db } from "@/server/db";

export const AI_USAGE_PERIODS = [7, 30, 90] as const;

/** Como a análise da IA terminou (a partir da decisão registrada). */
export type AiOutcome = "AUTOMATICA" | "EQUIPE" | "ENCAMINHADA" | "SEM_GANHO" | "ERRO";

/** Consumo e resultado da segunda opinião da IA no período (tela "Consumo da IA"). */
export async function getAiUsageReport(user: SessionUser, days: number, now = new Date()) {
  const since = addDays(startOfDay(now), -(days - 1));
  // Registros anteriores a uma restauração da demo apontam para IDs antigos: o escopo usa também o código do estudo.
  const scopeCodes = user.studyIds ? (await db.study.findMany({ where: { id: { in: user.studyIds } }, select: { code: true } })).map((s) => s.code) : null;
  const rows = await db.aiUsage.findMany({
    where: { createdAt: { gte: since }, ...(user.studyIds ? { OR: [studyScope(user), { studyCode: { in: scopeCodes ?? [] } }] } : {}) },
    orderBy: { createdAt: "desc" },
  });

  const decisionIds = rows.map((r) => r.decisionId).filter((id): id is string => !!id);
  const [decisions, studies, participants, messages] = await Promise.all([
    db.assistDecision.findMany({ where: { id: { in: decisionIds } }, select: { id: true, outcome: true } }),
    db.study.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.studyId))] } }, select: { id: true, code: true } }),
    db.participant.findMany({ where: { id: { in: [...new Set(rows.slice(0, 50).map((r) => r.participantId))] } }, select: { id: true, fullName: true } }),
    db.communication.findMany({ where: { id: { in: rows.slice(0, 50).map((r) => r.communicationId) } }, select: { id: true, body: true, conversationId: true } }),
  ]);
  const decisionOutcome = new Map(decisions.map((d) => [d.id, d.outcome]));
  const outcomeOf = (r: (typeof rows)[number]): AiOutcome => {
    if (r.outcome) return r.outcome as AiOutcome;
    if (r.status !== "OK") return "ERRO";
    const o = r.decisionId ? decisionOutcome.get(r.decisionId) : undefined;
    if (!o) return "SEM_GANHO"; // a IA não acrescentou: valeu a leitura das regras
    if (o === "AUTOMATICA") return "AUTOMATICA";
    if (o === "ENCAMINHADA") return "ENCAMINHADA";
    return "EQUIPE";
  };

  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + pick(r), 0);
  const ok = rows.filter((r) => r.status === "OK");
  const totals = {
    calls: rows.length,
    errors: rows.length - ok.length,
    input: sum((r) => r.inputTokens),
    cacheRead: sum((r) => r.cacheReadTokens),
    cacheWrite: sum((r) => r.cacheWriteTokens),
    output: sum((r) => r.outputTokens),
    cost: sum((r) => r.costUsd),
    avgLatencyMs: ok.length ? Math.round(ok.reduce((a, r) => a + r.latencyMs, 0) / ok.length) : 0,
  };

  const outcomes: Record<AiOutcome, number> = { AUTOMATICA: 0, EQUIPE: 0, ENCAMINHADA: 0, SEM_GANHO: 0, ERRO: 0 };
  for (const r of rows) outcomes[outcomeOf(r)]++;

  const byDay = Array.from({ length: days }, (_, i) => {
    const day = addDays(since, i);
    const key = toDateParam(day);
    const dayRows = rows.filter((r) => toDateParam(r.createdAt) === key);
    return {
      key,
      label: formatDayMonth(day),
      title: formatLongDate(day),
      calls: dayRows.length,
      input: dayRows.reduce((a, r) => a + r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens, 0),
      output: dayRows.reduce((a, r) => a + r.outputTokens, 0),
      cost: dayRows.reduce((a, r) => a + r.costUsd, 0),
    };
  });

  const code = new Map(studies.map((s) => [s.id, s.code]));
  const keyOf = (r: (typeof rows)[number]) => r.studyCode ?? r.studyId;
  const byStudy = [...new Set(rows.map(keyOf))]
    .map((id) => {
      const rs = rows.filter((r) => keyOf(r) === id);
      return { code: rs[0].studyCode ?? code.get(id) ?? "—", calls: rs.length, cost: rs.reduce((a, r) => a + r.costUsd, 0) };
    })
    .sort((a, b) => b.cost - a.cost);

  const name = new Map(participants.map((p) => [p.id, p.fullName]));
  const message = new Map(messages.map((m) => [m.id, m]));
  const recent = rows.slice(0, 50).map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    // Mensagem que não existe mais = análise anterior a uma restauração da demo (os IDs podem ter sido reaproveitados).
    participantName: message.has(r.communicationId) ? (name.get(r.participantId) ?? null) : null,
    conversationId: message.get(r.communicationId)?.conversationId ?? null,
    body: message.get(r.communicationId)?.body ?? "",
    studyCode: r.studyCode ?? code.get(r.studyId) ?? "—",
    intent: r.intent,
    confidence: r.confidence,
    outcome: outcomeOf(r),
    error: r.error,
    mode: r.mode,
    model: r.model,
    input: r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens,
    cached: r.cacheReadTokens,
    output: r.outputTokens,
    cost: r.costUsd,
    latencyMs: r.latencyMs,
  }));

  return { days, since, totals, outcomes, byDay, byStudy, recent, mode: AI_MODE, model: AI_MODEL };
}

export type AiUsageReport = Awaited<ReturnType<typeof getAiUsageReport>>;
