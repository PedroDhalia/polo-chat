import "server-only";
import type { Visit, VisitCategory, VisitStatus } from "@prisma/client";
import { VISIT_STATUS } from "@/domain/labels";
import { checkVisitSlot, type SlotCheck } from "@/domain/visit-slot";
import { isWithinWindow } from "@/domain/visit-window";
import { addDays, formatDateTime, formatDayMonth, startOfDay } from "@/lib/dates";
import type { Actor } from "@/server/actor";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { markPendingDecisionsHandled } from "./assist";
import { addTimelineEvent, recordAudit } from "./audit";

/** Transições permitidas a partir de cada status. */
const TRANSITIONS: Record<VisitStatus, VisitStatus[]> = {
  AGUARDANDO_CONFIRMACAO: ["CONFIRMADO", "REAGENDAMENTO_SOLICITADO", "REALIZADO", "FALTOU", "CANCELADO"],
  CONFIRMADO: ["REAGENDAMENTO_SOLICITADO", "REALIZADO", "FALTOU", "CANCELADO", "AGUARDANDO_CONFIRMACAO"],
  REAGENDAMENTO_SOLICITADO: ["AGUARDANDO_CONFIRMACAO", "CONFIRMADO", "CANCELADO"],
  REALIZADO: [],
  FALTOU: ["AGUARDANDO_CONFIRMACAO"],
  CANCELADO: [],
};

const TIMELINE_FOR: Partial<Record<VisitStatus, { type: "VISIT_CONFIRMED" | "VISIT_COMPLETED" | "VISIT_MISSED" | "VISIT_RESCHEDULE_REQUESTED"; title: (n: string) => string }>> = {
  CONFIRMADO: { type: "VISIT_CONFIRMED", title: (n) => `Visita ${n} confirmada` },
  REALIZADO: { type: "VISIT_COMPLETED", title: (n) => `${n} realizada` },
  FALTOU: { type: "VISIT_MISSED", title: (n) => `Faltou à visita ${n}` },
  REAGENDAMENTO_SOLICITADO: { type: "VISIT_RESCHEDULE_REQUESTED", title: (n) => `Remarcação solicitada: ${n}` },
};

export async function changeVisitStatus(visitId: string, to: VisitStatus, actor: Actor) {
  const visit = await db.visit.findUnique({ where: { id: visitId }, include: { participant: true } });
  if (!visit) throw new DomainError("Visita não encontrada.");
  if (visit.status === to) return visit;
  if (!TRANSITIONS[visit.status].includes(to)) {
    throw new DomainError(`Não é possível alterar de “${VISIT_STATUS[visit.status].label}” para “${VISIT_STATUS[to].label}”.`);
  }
  const now = new Date();
  const updated = await db.visit.update({
    where: { id: visitId },
    data: {
      status: to,
      confirmedAt: to === "CONFIRMADO" ? now : visit.confirmedAt,
      completedAt: to === "REALIZADO" ? now : visit.completedAt,
    },
  });
  await markPendingDecisionsHandled(visit.participantId, actor);
  const tl = TIMELINE_FOR[to];
  if (tl) {
    await addTimelineEvent({ participantId: visit.participantId, studyId: visit.studyId, type: tl.type, title: tl.title(visit.name), actor });
  }
  await recordAudit({
    actor,
    action: "visit.status_changed",
    entityType: "Visit",
    entityId: visit.id,
    studyId: visit.studyId,
    summary: `Visita ${visit.name} de ${visit.participant.fullName}: ${VISIT_STATUS[visit.status].label} → ${VISIT_STATUS[to].label}`,
    metadata: { from: visit.status, to },
  });
  return updated;
}

const ACTIVE_STATUSES: VisitStatus[] = ["AGUARDANDO_CONFIRMACAO", "CONFIRMADO", "REAGENDAMENTO_SOLICITADO"];

/**
 * Agenda uma visita combinada com o participante (ex.: triagem marcada na ligação de pré-triagem).
 * Agendamento operacional: o nome segue o protocolo e a janela vem do Polo Trial quando a visita for registrada lá.
 */
export async function createVisit(input: { participantId: string; name: string; category: VisitCategory; when: Date; actor: Actor }) {
  const participant = await db.participant.findUnique({ where: { id: input.participantId } });
  if (!participant) throw new DomainError("Participante não encontrado.");
  const name = input.name.trim();
  if (!name || name.length > 60) throw new DomainError("Informe o tipo de visita (até 60 caracteres).");
  if (Number.isNaN(input.when.getTime()) || input.when.getTime() < Date.now() + 30 * 60_000) throw new DomainError("A visita precisa estar no futuro.");
  const active = await db.visit.findFirst({ where: { participantId: participant.id, status: { in: ACTIVE_STATUSES }, scheduledAt: { gte: new Date(Date.now() - 12 * 3_600_000) } } });
  if (active) throw new DomainError(`${participant.fullName} já tem a visita ${active.name} em ${formatDateTime(active.scheduledAt)}: remarque essa visita em vez de criar outra.`);
  const visit = await db.visit.create({
    data: { participantId: participant.id, studyId: participant.studyId, name, category: input.category, scheduledAt: input.when, durationMin: 60, status: "AGUARDANDO_CONFIRMACAO", staffId: participant.ownerId },
  });
  await addTimelineEvent({ participantId: participant.id, studyId: participant.studyId, type: "VISIT_SCHEDULED", title: "Visita agendada", description: `${name} em ${formatDateTime(input.when)}`, actor: input.actor });
  await recordAudit({
    actor: input.actor,
    action: "visit.scheduled",
    entityType: "Visit",
    entityId: visit.id,
    studyId: participant.studyId,
    summary: `Visita ${name} de ${participant.fullName} agendada para ${formatDateTime(input.when)}`,
    metadata: { category: input.category, scheduledAt: input.when.toISOString() },
  });
  return { visit, participant };
}

/** Visitas que podem receber proposta de nova data: pedido de remarcação ou falta. */
const PROPOSABLE: VisitStatus[] = ["REAGENDAMENTO_SOLICITADO", "FALTOU"];

/**
 * Visita com falta ou remarcação pedida que ainda espera nova data, mesmo com a data original já
 * passada: a mais recente cuja janela do Polo Trial não encerrou (sem janela, até 14 dias depois).
 */
export async function findVisitAwaitingNewDate(participantId: string, now: Date = new Date()) {
  return db.visit.findFirst({
    where: {
      participantId,
      status: { in: PROPOSABLE },
      // Último dia da janela incluído: ainda vale até o fim do dia.
      OR: [{ windowEnd: { gte: startOfDay(now) } }, { windowEnd: null, scheduledAt: { gte: addDays(now, -14) } }],
    },
    orderBy: { scheduledAt: "desc" },
  });
}

/** O horário pedido para a visita está livre? Confere janela, horário de visitas e a agenda do responsável no dia. */
export async function checkRequestedVisitSlot(visit: Visit, at: Date, now: Date = new Date()): Promise<SlotCheck> {
  const participant = await db.participant.findUnique({ where: { id: visit.participantId }, select: { ownerId: true, owner: { select: { name: true } } } });
  const day = startOfDay(at);
  const visits = await db.visit.findMany({
    where: { scheduledAt: { gte: day, lt: addDays(day, 1) }, status: { not: "CANCELADO" }, id: { not: visit.id } },
    include: { participant: { select: { fullName: true } } },
  });
  return checkVisitSlot(at, {
    now,
    window: visit,
    ownerId: participant?.ownerId ?? null,
    ownerName: participant?.owner?.name ?? null,
    dayVisits: visits.map((v) => ({ start: v.scheduledAt, durationMin: v.durationMin, staffId: v.staffId, name: v.name, participantName: v.participant.fullName })),
  });
}

/** Visita com nova data proposta aguardando resposta do participante. */
export async function findPendingProposal(participantId: string) {
  return db.visit.findFirst({ where: { participantId, proposedAt: { not: null } }, orderBy: { proposedAt: "asc" } });
}

/**
 * Registra a nova data proposta ao participante. A visita continua na data atual até ele confirmar.
 * A janela é a informada pelo Polo Trial: a proposta precisa caber nela.
 */
/** `byParticipant`: a data foi pedida pelo próprio participante e a equipe só a confirmou. */
export async function proposeVisitDate(visitId: string, when: Date, actor: Actor, opts: { byParticipant?: boolean } = {}) {
  const visit = await db.visit.findUnique({ where: { id: visitId }, include: { participant: true } });
  if (!visit) throw new DomainError("Visita não encontrada.");
  if (!PROPOSABLE.includes(visit.status)) throw new DomainError("Só é possível propor nova data para visitas com remarcação solicitada ou falta.");
  if (Number.isNaN(when.getTime())) throw new DomainError("Data inválida.");
  if (when.getTime() < Date.now() + 60 * 60_000) throw new DomainError("A nova data precisa estar no futuro (pelo menos 1h a partir de agora).");
  if (!isWithinWindow(when, visit)) {
    throw new DomainError(`Fora da janela informada pelo Polo Trial (${formatDayMonth(visit.windowStart ?? when)} a ${formatDayMonth(visit.windowEnd ?? when)}).`);
  }
  const updated = await db.visit.update({ where: { id: visitId }, data: { proposedAt: when } });
  await addTimelineEvent({
    participantId: visit.participantId,
    studyId: visit.studyId,
    type: "VISIT_RESCHEDULE_REQUESTED",
    title: opts.byParticipant ? "Nova data pedida pelo participante" : "Nova data proposta",
    description: `${visit.name} em ${formatDateTime(when)} — ${opts.byParticipant ? "horário livre, confirmado pela equipe" : "aguardando resposta do participante"}`,
    actor,
  });
  await recordAudit({
    actor,
    action: "visit.date_proposed",
    entityType: "Visit",
    entityId: visit.id,
    studyId: visit.studyId,
    summary: `Nova data ${opts.byParticipant ? "pedida pelo participante" : "proposta"} para ${visit.name} de ${visit.participant.fullName}: ${formatDateTime(when)}`,
    metadata: { current: visit.scheduledAt.toISOString(), proposed: when.toISOString(), previousProposal: visit.proposedAt?.toISOString() ?? null },
  });
  return { visit: updated, participant: visit.participant };
}

/** O participante (ou a equipe, por telefone) aceitou a data proposta: a visita muda de dia e fica confirmada. */
export async function acceptProposedDate(visitId: string, actor: Actor) {
  const visit = await db.visit.findUnique({ where: { id: visitId }, include: { participant: true } });
  if (!visit?.proposedAt) throw new DomainError("Não há nova data proposta para esta visita.");
  const when = visit.proposedAt;
  const updated = await db.visit.update({
    where: { id: visitId },
    data: { scheduledAt: when, status: "CONFIRMADO", confirmedAt: new Date(), proposedAt: null, rescheduleCount: { increment: 1 }, reminderSentAt: null },
  });
  await markPendingDecisionsHandled(visit.participantId, actor);
  await addTimelineEvent({
    participantId: visit.participantId,
    studyId: visit.studyId,
    type: "VISIT_CONFIRMED",
    title: "Visita remarcada e confirmada",
    description: `${visit.name}: ${formatDateTime(visit.scheduledAt)} → ${formatDateTime(when)}`,
    actor,
  });
  await recordAudit({
    actor,
    action: "visit.rescheduled",
    entityType: "Visit",
    entityId: visit.id,
    studyId: visit.studyId,
    summary: `Visita ${visit.name} de ${visit.participant.fullName} remarcada para ${formatDateTime(when)} e confirmada`,
    metadata: { from: visit.scheduledAt.toISOString(), to: when.toISOString(), previousStatus: visit.status, rescheduleCount: updated.rescheduleCount },
  });
  return { visit: updated, participant: visit.participant, from: visit.scheduledAt };
}

/** O participante não pode na data proposta: a proposta cai e a equipe propõe outra. */
export async function declineProposedDate(visitId: string, actor: Actor) {
  const visit = await db.visit.findUnique({ where: { id: visitId } });
  if (!visit?.proposedAt) return;
  await db.visit.update({ where: { id: visitId }, data: { proposedAt: null } });
  await addTimelineEvent({
    participantId: visit.participantId,
    studyId: visit.studyId,
    type: "VISIT_RESCHEDULE_REQUESTED",
    title: "Data proposta recusada",
    description: `${formatDateTime(visit.proposedAt)} não serve — propor outra data`,
    actor,
  });
}

/** Reagenda a visita para nova data/hora. A janela continua sendo a informada pelo Polo Trial. */
export async function rescheduleVisit(visitId: string, newDate: Date, actor: Actor) {
  const visit = await db.visit.findUnique({ where: { id: visitId }, include: { participant: true } });
  if (!visit) throw new DomainError("Visita não encontrada.");
  if (visit.status === "REALIZADO" || visit.status === "CANCELADO") throw new DomainError("Esta visita não pode ser reagendada.");
  if (Number.isNaN(newDate.getTime())) throw new DomainError("Data inválida.");
  const updated = await db.visit.update({
    where: { id: visitId },
    data: { scheduledAt: newDate, status: "AGUARDANDO_CONFIRMACAO", rescheduleCount: { increment: 1 }, reminderSentAt: null, confirmedAt: null },
  });
  await addTimelineEvent({
    participantId: visit.participantId,
    studyId: visit.studyId,
    type: "VISIT_SCHEDULED",
    title: "Visita reagendada",
    description: `${visit.name} em ${formatDateTime(newDate)}`,
    actor,
  });
  await recordAudit({
    actor,
    action: "visit.rescheduled",
    entityType: "Visit",
    entityId: visit.id,
    studyId: visit.studyId,
    summary: `Visita ${visit.name} de ${visit.participant.fullName} reagendada para ${formatDateTime(newDate)}`,
    metadata: { from: visit.scheduledAt.toISOString(), to: newDate.toISOString(), rescheduleCount: updated.rescheduleCount },
  });
  return updated;
}
