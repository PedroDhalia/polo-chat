import "server-only";
import type { ParticipantStatus } from "@prisma/client";
import { PARTICIPANT_STATUS } from "@/domain/labels";
import type { NormalizedLead } from "@/integrations/forms/types";
import type { Actor } from "@/server/actor";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { markPendingDecisionsHandled } from "./assist";
import { addTimelineEvent, recordAudit } from "./audit";

const STAGE_FOR_STATUS: Record<ParticipantStatus, string> = {
  NOVO: "BASE",
  EM_CONTATO: "CONTATADOS",
  PRE_TRIAGEM: "PRE_TRIAGEM",
  AGUARDANDO_AGENDAMENTO: "ELEGIVEIS",
  AGENDADO: "AGENDADOS",
  INCLUIDO: "INCLUIDOS",
  INELEGIVEL: "PRE_TRIAGEM",
  RETIRADO: "INCLUIDOS",
};

export async function changeParticipantStatus(participantId: string, to: ParticipantStatus, actor: Actor) {
  const p = await db.participant.findUnique({ where: { id: participantId } });
  if (!p) throw new DomainError("Participante não encontrado.");
  if (p.status === to) return p;
  const stage = await db.recruitmentStage.findUnique({ where: { key: STAGE_FOR_STATUS[to] } });
  const updated = await db.participant.update({ where: { id: participantId }, data: { status: to } });
  if (stage) {
    const outcome = to === "INCLUIDO" ? "INCLUIDO" : to === "INELEGIVEL" ? "NAO_ELEGIVEL" : to === "RETIRADO" ? "DESISTENCIA" : "EM_ANDAMENTO";
    await db.recruitment.updateMany({ where: { participantId }, data: { stageId: stage.id, outcome, stageUpdatedAt: new Date() } });
  }
  await addTimelineEvent({
    participantId,
    studyId: p.studyId,
    type: "STATUS_CHANGED",
    title: `Status alterado para “${PARTICIPANT_STATUS[to].label}”`,
    description: `Anterior: ${PARTICIPANT_STATUS[p.status].label}`,
    actor,
  });
  await recordAudit({ actor, action: "participant.status_changed", entityType: "Participant", entityId: p.id, studyId: p.studyId, summary: `${p.fullName}: ${PARTICIPANT_STATUS[p.status].label} → ${PARTICIPANT_STATUS[to].label}`, metadata: { from: p.status, to } });
  return updated;
}

/** Exibir dado de contato é uma ação auditada (minimização de exposição). */
export async function revealContact(participantId: string, actor: Actor) {
  const p = await db.participant.findUnique({ where: { id: participantId } });
  if (!p) throw new DomainError("Participante não encontrado.");
  await recordAudit({ actor, action: "participant.contact_viewed", entityType: "Participant", entityId: p.id, studyId: p.studyId, summary: `Telefone de ${p.fullName} exibido` });
  return p.phone;
}

export async function logPhoneContact(participantId: string, note: string, actor: Actor & { type: "USER" }) {
  const p = await db.participant.findUnique({ where: { id: participantId } });
  if (!p) throw new DomainError("Participante não encontrado.");
  const now = new Date();
  await db.communication.create({
    data: { participantId, studyId: p.studyId, channel: "TELEFONE", direction: "OUTBOUND", body: note || "Contato telefônico registrado.", status: "SENT", sentById: actor.user.id, sentAt: now },
  });
  await db.participant.update({ where: { id: participantId }, data: { lastContactAt: now } });
  await addTimelineEvent({ participantId, studyId: p.studyId, type: "CALL_LOGGED", title: "Contato telefônico registrado", description: note || null, source: "Telefone", actor });
  await recordAudit({ actor, action: "participant.contact_logged", entityType: "Participant", entityId: p.id, studyId: p.studyId, summary: `Contato telefônico registrado com ${p.fullName}` });
}

export async function revokeWhatsAppConsent(participantId: string, actor: Actor) {
  const p = await db.participant.findUnique({ where: { id: participantId } });
  if (!p) throw new DomainError("Participante não encontrado.");
  const now = new Date();
  await db.consentRecord.updateMany({ where: { participantId, purpose: "CONTATO_WHATSAPP", revokedAt: null }, data: { revokedAt: now } });
  await markPendingDecisionsHandled(participantId, actor);
  await addTimelineEvent({ participantId, studyId: p.studyId, type: "NOTE", title: "Consentimento de contato por WhatsApp revogado", source: "WhatsApp", actor });
  await recordAudit({ actor, action: "consent.revoked", entityType: "Participant", entityId: p.id, studyId: p.studyId, summary: `Consentimento de WhatsApp revogado por ${p.fullName}` });
}

/** Cadastra um interessado vindo de formulário — elimina o recadastro manual. */
export async function ingestLead(lead: NormalizedLead, actor: Actor) {
  const study = await db.study.findUnique({ where: { code: lead.studyCode }, include: { members: { include: { user: true } } } });
  if (!study) throw new DomainError(`Estudo ${lead.studyCode} não encontrado.`);
  const owner = study.members.find((m) => m.user.role === "ASSISTENTE")?.userId ?? study.ownerId;
  const count = await db.participant.count();
  const stage = await db.recruitmentStage.findUniqueOrThrow({ where: { key: "BASE" } });
  const participant = await db.participant.create({
    data: {
      code: `PLT-${String(count + 1).padStart(4, "0")}`,
      fullName: lead.fullName,
      phone: lead.phone,
      email: null, // minimização: o MVP não armazena e-mail
      studyId: study.id,
      status: "NOVO",
      channel: lead.channel,
      ownerId: owner,
      nextAction: "Fazer primeiro contato",
      nextActionDueAt: new Date(Date.now() + 8 * 3_600_000),
      recruitment: { create: { studyId: study.id, stageId: stage.id, outcome: "EM_ANDAMENTO", enteredAt: lead.submittedAt, stageUpdatedAt: lead.submittedAt, campaign: "Formulário de interesse" } },
      consents: {
        create: [
          { purpose: "CONTATO_TELEFONE", granted: lead.contactConsent, source: "Formulário de interesse", recordedAt: lead.submittedAt },
          { purpose: "CONTATO_WHATSAPP", granted: lead.contactConsent, source: "Formulário de interesse", recordedAt: lead.submittedAt },
        ],
      },
      // Com consentimento, a conversa já aparece em Comunicação, vazia, pronta para o primeiro contato.
      conversations: lead.contactConsent
        ? { create: { studyId: study.id, channel: "WHATSAPP", status: "RESOLVIDA", assignedToId: owner, lastMessageAt: lead.submittedAt } }
        : undefined,
    },
  });
  await db.externalReference.create({ data: { system: "FORMS", entityType: "Participant", entityId: participant.id, externalId: lead.externalId, lastSyncedAt: new Date() } });
  await addTimelineEvent({ participantId: participant.id, studyId: study.id, type: "FORM_RECEIVED", title: "Formulário recebido", description: "Cadastro automático a partir do formulário — sem digitação manual.", source: "Formulário (simulado)", actor });
  await recordAudit({ actor, action: "participant.created_from_form", entityType: "Participant", entityId: participant.id, studyId: study.id, summary: `${participant.fullName} cadastrado a partir de formulário (${study.code})` });
  return participant;
}
