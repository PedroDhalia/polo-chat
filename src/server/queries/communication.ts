import "server-only";
import type { ConversationStatus, Prisma } from "@prisma/client";
import { OPEN_TASK_STATUSES } from "@/domain/labels";
import { addDays, startOfDay } from "@/lib/dates";
import { isActionable } from "@/domain/assist-policy";
import { analyzeMessage } from "@/server/ai/assist";
import { getAssistPolicy, getAutomationSettings } from "@/server/services/assist";
import { canAccessStudy, type SessionUser, studyScope } from "@/server/auth/session";
import { db } from "@/server/db";

const ACTIVE_VISIT = ["AGUARDANDO_CONFIRMACAO", "CONFIRMADO", "REAGENDAMENTO_SOLICITADO"] as const;

export type InboxFilter = "todas" | "aguardando" | "atencao" | "novas";

/** Conversas exibidas por vez na lista (o restante vem em "Carregar mais"). */
export const INBOX_PAGE = 40;

export async function listConversations(user: SessionUser, f: { filter?: InboxFilter; studyId?: string; q?: string; limit?: number }, now = new Date()) {
  const where: Prisma.ConversationWhereInput = { ...studyScope(user) };
  if (f.studyId) where.studyId = canAccessStudy(user, f.studyId) ? f.studyId : "__none__";
  if (f.filter === "aguardando") where.status = "AGUARDANDO_RESPOSTA";
  if (f.filter === "atencao") where.status = "REQUER_ATENCAO";
  if (f.filter === "novas") where.OR = [{ status: "RESPONDIDA" }, { unreadCount: { gt: 0 } }];
  if (f.q) where.participant = { fullName: { contains: f.q } };

  const limit = Math.min(Math.max(f.limit ?? INBOX_PAGE, INBOX_PAGE), 400);
  const [conversations, matching] = await Promise.all([
    db.conversation.findMany({
    where,
    include: {
      participant: { select: { id: true, fullName: true } },
      study: { select: { code: true } },
      messages: { orderBy: { sentAt: "desc" }, take: 1, select: { body: true, direction: true, automated: true, sentAt: true } },
    },
    orderBy: { lastMessageAt: "desc" },
    take: limit,
  }),
    db.conversation.count({ where }),
  ]);
  const visits = await db.visit.findMany({
    where: { participantId: { in: conversations.map((c) => c.participantId) }, status: { in: [...ACTIVE_VISIT] }, scheduledAt: { gte: startOfDay(now) } },
    orderBy: { scheduledAt: "asc" },
    select: { participantId: true, scheduledAt: true, status: true },
  });
  const nextVisit = new Map<string, (typeof visits)[number]>();
  for (const v of visits) if (!nextVisit.has(v.participantId)) nextVisit.set(v.participantId, v);

  const counts = await db.conversation.groupBy({ by: ["status"], where: { ...studyScope(user) }, _count: true });
  const unread = await db.conversation.count({ where: { ...studyScope(user), OR: [{ status: "RESPONDIDA" }, { unreadCount: { gt: 0 } }] } });
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count])) as Partial<Record<ConversationStatus, number>>;

  return {
    // A lista mostra só o início da última mensagem: não enviar o texto inteiro ao navegador.
    items: conversations.map(({ messages, ...c }) => {
      const last = messages[0];
      return { ...c, lastMessage: last ? { ...last, body: last.body.length > 110 ? `${last.body.slice(0, 110)}…` : last.body } : null, nextVisit: nextVisit.get(c.participantId) ?? null };
    }),
    hasMore: matching > conversations.length,
    limit,
    counts: {
      todas: counts.reduce((a, c) => a + c._count, 0),
      aguardando: byStatus.AGUARDANDO_RESPOSTA ?? 0,
      atencao: byStatus.REQUER_ATENCAO ?? 0,
      novas: unread,
    },
  };
}

export type InboxItem = Awaited<ReturnType<typeof listConversations>>["items"][number];

export async function getConversation(user: SessionUser, id: string, now = new Date()) {
  const c = await db.conversation.findUnique({
    where: { id },
    include: {
      study: { select: { id: true, code: true } },
      messages: { orderBy: { sentAt: "asc" }, include: { template: { select: { name: true, version: true } }, sentBy: { select: { name: true } } } },
      participant: {
        include: {
          owner: { select: { name: true } },
          consents: { orderBy: { recordedAt: "desc" } },
          tasks: { where: { status: { in: OPEN_TASK_STATUSES } }, orderBy: { dueAt: "asc" }, include: { assignee: { select: { name: true } } } },
          visits: { where: { status: { in: [...ACTIVE_VISIT] }, scheduledAt: { gte: startOfDay(now) } }, orderBy: { scheduledAt: "asc" }, take: 1 },
        },
      },
    },
  });
  if (!c || !canAccessStudy(user, c.studyId)) return null;

  const templates = await db.messageTemplate.findMany({
    where: { OR: [{ studyId: null }, { studyId: c.studyId }] },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  const wa = c.participant.consents.find((x) => x.purpose === "CONTATO_WHATSAPP");
  const whatsappConsent = !!wa && wa.granted && !wa.revokedAt;
  // Visita do banner: a que tem nova data proposta; senão a próxima ativa; senão uma falta ou
  // remarcação ainda dentro da janela (para a equipe propor nova data).
  const visit =
    (await db.visit.findFirst({ where: { participantId: c.participantId, proposedAt: { not: null } } })) ??
    c.participant.visits[0] ??
    (await db.visit.findFirst({
      where: {
        participantId: c.participantId,
        status: { in: ["FALTOU", "REAGENDAMENTO_SOLICITADO"] },
        OR: [{ windowEnd: { gte: now } }, { windowEnd: null, scheduledAt: { gte: addDays(now, -14) } }],
      },
      orderBy: { scheduledAt: "desc" },
    })) ??
    null;
  const lastInbound = [...c.messages].reverse().find((m) => m.direction === "INBOUND") ?? null;
  const lastMessage = c.messages.filter((m) => m.direction !== "INTERNAL_NOTE").at(-1);
  const unanswered = !!lastInbound && lastMessage?.id === lastInbound.id;

  // Decisão registrada da assistência para a última mensagem do participante (fila de revisão / automática).
  const decision = lastInbound
    ? await db.assistDecision.findUnique({ where: { communicationId: lastInbound.id }, include: { reviewedBy: { select: { name: true } } } })
    : null;
  const policy = decision && isActionable(decision.intent) ? await getAssistPolicy(c.studyId, decision.intent) : null;
  // Análise (para exibir o raciocínio); sem decisão registrada, só para mensagem ainda não respondida.
  // Com decisão registrada, reconstrói o contexto daquele momento (uma confirmação aplicada
  // já deixou a visita "Confirmada"; sem isso a explicação não bateria com a intenção).
  const pendingVisitNow = !!visit && (!!visit.proposedAt || (visit.status !== "CONFIRMADO" && visit.status !== "FALTOU"));
  const assist =
    lastInbound && (decision || unanswered)
      ? analyzeMessage(lastInbound.body, { hasPendingVisit: decision?.intent === "CONFIRMACAO" || pendingVisitNow, hasUpcomingVisit: !!c.participant.visits[0] || !!visit?.proposedAt })
      : null;

  // Situação do follow-up automático.
  const cfg = await getAutomationSettings(c.studyId);
  const waiting = c.status === "AGUARDANDO_RESPOSTA" && lastMessage?.direction === "OUTBOUND";
  const enabled = cfg.followUpEnabled && cfg.followUpMaxAttempts > 0;
  // Mesmo critério do motor: com pendência aberta, a equipe já está cuidando e o follow-up não sai.
  const paused = waiting && enabled && c.participant.tasks.length > 0;
  const followUp = {
    enabled,
    attempts: c.followUpAttempts,
    max: cfg.followUpMaxAttempts,
    intervalHours: cfg.followUpIntervalHours,
    window: `${cfg.sendWindowStart}h–${cfg.sendWindowEnd}h`,
    nextAt: waiting && enabled && !paused && c.followUpAttempts < cfg.followUpMaxAttempts ? new Date(c.lastMessageAt.getTime() + cfg.followUpIntervalHours * 3_600_000) : null,
    exhausted: waiting && enabled && !paused && c.followUpAttempts >= cfg.followUpMaxAttempts,
    paused,
    waiting,
  };

  // Consumo da IA na última mensagem do participante (quando foi consultada).
  const aiUsage = lastInbound ? await db.aiUsage.findFirst({ where: { communicationId: lastInbound.id }, orderBy: { createdAt: "desc" } }) : null;

  return { conversation: c, templates, whatsappConsent, visit, assist, lastInbound, decision, policy, followUp, aiUsage };
}

/** Fila de revisão da assistência e decisões automáticas recentes (revisão por amostragem). */
export async function listAssistReview(user: SessionUser, now = new Date()) {
  const scope = studyScope(user);
  const include = {
    participant: { select: { id: true, fullName: true } },
    study: { select: { code: true } },
    communication: { select: { body: true, sentAt: true, conversationId: true } },
    reviewedBy: { select: { name: true } },
  } as const;
  const since7 = new Date(now.getTime() - 7 * 86_400_000);
  const [pending, automatic, auto7, reviewed, correct, escalated7, approved7] = await Promise.all([
    db.assistDecision.findMany({ where: { ...scope, outcome: "PENDENTE" }, include, orderBy: { createdAt: "asc" } }),
    db.assistDecision.findMany({ where: { ...scope, outcome: "AUTOMATICA", createdAt: { gte: new Date(now.getTime() - 14 * 86_400_000) } }, include, orderBy: { createdAt: "desc" }, take: 30 }),
    db.assistDecision.count({ where: { ...scope, outcome: "AUTOMATICA", createdAt: { gte: since7 } } }),
    db.assistDecision.count({ where: { ...scope, outcome: "AUTOMATICA", verdict: { not: null } } }),
    db.assistDecision.count({ where: { ...scope, outcome: "AUTOMATICA", verdict: "CORRETA" } }),
    db.assistDecision.count({ where: { ...scope, outcome: "ENCAMINHADA", createdAt: { gte: since7 } } }),
    db.assistDecision.count({ where: { ...scope, outcome: "APROVADA", createdAt: { gte: since7 } } }),
  ]);
  return { pending, automatic, stats: { pending: pending.length, auto7, reviewed, correct, escalated7, approved7 } };
}

export type ReviewDecision = Awaited<ReturnType<typeof listAssistReview>>["pending"][number];

export async function countPendingReview(user: SessionUser) {
  return db.assistDecision.count({ where: { ...studyScope(user), outcome: "PENDENTE" } });
}
