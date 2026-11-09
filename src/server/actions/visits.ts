"use server";

import type { VisitCategory, VisitStatus } from "@prisma/client";
import { VISIT_CATEGORY } from "@/domain/labels";
import { isWithinWindow } from "@/domain/visit-window";
import { addDays, formatTime, parseDateParam, parseLocalDateTime as parseLocal } from "@/lib/dates";
import { getVisitsInRange } from "@/server/queries/agenda";
import { visitDateLabel } from "@/domain/templates";
import { userActor } from "@/server/actor";
import { can, canAccessStudy, requirePermission } from "@/server/auth/session";
import { confirmProposedDate, dispatch, scheduleVisitFromTeam, type DomainEvent } from "@/server/automations/engine";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { hasWhatsAppConsent, sendTemplateMessage } from "@/server/services/messaging";
import { changeVisitStatus, proposeVisitDate, rescheduleVisit } from "@/server/services/visits";
import { createTask, findOpenTasks } from "@/server/services/tasks";
import { act } from "./result";

const EVENT_FOR: Partial<Record<VisitStatus, DomainEvent["type"]>> = {
  CONFIRMADO: "visit.confirmed",
  REALIZADO: "visit.completed",
  FALTOU: "visit.missed",
};

const MESSAGE_FOR: Partial<Record<VisitStatus, string>> = {
  CONFIRMADO: "Visita confirmada",
  REALIZADO: "Visita marcada como realizada",
  FALTOU: "Falta registrada",
  REAGENDAMENTO_SOLICITADO: "Remarcação solicitada",
  CANCELADO: "Visita cancelada",
};

async function loadAuthorized(visitId: string) {
  const user = await requirePermission("agenda.manage");
  const visit = await db.visit.findUnique({ where: { id: visitId }, include: { participant: true } });
  if (!visit || !canAccessStudy(user, visit.studyId)) throw new DomainError("Visita não encontrada.");
  return { user, visit };
}

export async function setVisitStatusAction(visitId: string, status: VisitStatus) {
  return act(async () => {
    const { user, visit } = await loadAuthorized(visitId);
    await changeVisitStatus(visitId, status, userActor(user));
    const details: string[] = [];
    const evt = EVENT_FOR[status];
    if (evt) details.push(...(await dispatch({ type: evt, visitId } as DomainEvent)));
    if (status === "REAGENDAMENTO_SOLICITADO" && (await findOpenTasks({ visitId })).length === 0) {
      await createTask(
        {
          title: `Reagendar visita ${visit.name} de ${visit.participant.fullName}`,
          priority: "MEDIA",
          dueAt: new Date(Date.now() + 24 * 3_600_000),
          studyId: visit.studyId,
          participantId: visit.participantId,
          visitId,
          assigneeId: visit.participant.ownerId,
          source: "COMUNICACAO",
        },
        userActor(user),
      );
      details.push("Pendência de reagendamento criada");
    }
    return { message: `${MESSAGE_FOR[status] ?? "Status atualizado"} — ${visit.participant.fullName}`, details };
  });
}

/** `date` = AAAA-MM-DD e `time` = HH:MM, no horário local do centro. */
function parseLocalDateTime(date: string, time: string): Date {
  const when = parseLocal(date, time);
  if (!when) throw new DomainError("Informe data e horário válidos.");
  return when;
}

/**
 * Propõe nova data ao participante e pergunta se ele pode (modelo aprovado "Proposta de nova data").
 * A visita só muda na agenda quando ele confirmar.
 */
export async function proposeVisitDateAction(visitId: string, date: string, time: string) {
  return act(async () => {
    const { user, visit } = await loadAuthorized(visitId);
    if (!can(user, "communication.send")) throw new DomainError("Seu perfil não pode enviar mensagens ao participante.");
    const when = parseLocalDateTime(date, time);
    await proposeVisitDate(visitId, when, userActor(user));
    const label = `${visitDateLabel(when)} às ${formatTime(when)}`;
    if (!(await hasWhatsAppConsent(visit.participantId))) {
      return {
        message: `Nova data proposta: ${label}`,
        details: ["Sem consentimento de WhatsApp: combine por telefone e use “Confirmar nova data”."],
      };
    }
    await sendTemplateMessage({ participantId: visit.participantId, templateKey: "tpl-proposta-data", extraVars: { nova_data: visitDateLabel(when), nova_hora: formatTime(when) }, actor: userActor(user) });
    return {
      message: `Nova data proposta a ${visit.participant.fullName}: ${label}`,
      details: ["Mensagem “Proposta de nova data” enviada (simulado).", "A visita só muda na agenda quando o participante confirmar."],
    };
  });
}

export interface DayAgendaItem {
  id: string;
  start: Date;
  durationMin: number;
  name: string;
  status: VisitStatus;
  studyCode: string;
  participantName: string;
  staffName: string | null;
}

/** Visitas de um dia (AAAA-MM-DD), para conferir disponibilidade ao agendar ou propor data. */
export async function dayAgendaAction(date: string): Promise<DayAgendaItem[]> {
  const user = await requirePermission("agenda.view");
  const day = parseDateParam(date);
  if (!day) return [];
  const visits = await getVisitsInRange(user, day, addDays(day, 1));
  return visits
    .filter((v) => v.status !== "CANCELADO")
    .map((v) => ({ id: v.id, start: v.scheduledAt, durationMin: v.durationMin, name: v.name, status: v.status, studyCode: v.study.code, participantName: v.participant.fullName, staffName: v.staff?.name ?? null }));
}

/** A equipe agenda uma visita combinada com o participante (ex.: na ligação de pré-triagem). */
export async function scheduleVisitAction(participantId: string, input: { name: string; category: VisitCategory; date: string; time: string; confirmed: boolean }) {
  return act(async () => {
    const user = await requirePermission("agenda.manage");
    const p = await db.participant.findUnique({ where: { id: participantId } });
    if (!p || !canAccessStudy(user, p.studyId)) throw new DomainError("Participante não encontrado.");
    if (!(input.category in VISIT_CATEGORY)) throw new DomainError("Tipo de visita inválido.");
    const when = parseLocalDateTime(input.date, input.time);
    const details = await scheduleVisitFromTeam({ participantId, name: input.name, category: input.category, when, confirmed: input.confirmed }, userActor(user));
    return { message: `Visita agendada — ${p.fullName}`, details };
  });
}

/** A equipe confirma a data proposta (ex.: combinada por telefone). */
export async function confirmProposedDateAction(visitId: string) {
  return act(async () => {
    const { user, visit } = await loadAuthorized(visitId);
    const details = await confirmProposedDate(visitId, userActor(user));
    return { message: `Nova data confirmada — ${visit.participant.fullName}`, details };
  });
}

export async function rescheduleVisitAction(visitId: string, date: string, time: string) {
  return act(async () => {
    const { user, visit } = await loadAuthorized(visitId);
    const when = parseLocalDateTime(date, time);
    if (when.getTime() < Date.now()) throw new DomainError("A nova data precisa estar no futuro.");
    await rescheduleVisit(visitId, when, userActor(user));
    const outside = !isWithinWindow(when, visit);
    return {
      message: `Visita de ${visit.participant.fullName} reagendada`,
      details: outside ? ["Atenção: a nova data está fora da janela informada pelo Polo Trial."] : ["Status voltou para “Aguardando confirmação”."],
    };
  });
}
