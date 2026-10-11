import "server-only";
import type { ConversationStatus, TemplateCategory } from "@prisma/client";
import { buildTemplateVars, FREE_TEXT_MAX, renderTemplate, SERVICE_WINDOW_HOURS, systemVariablesIn, templateUsesVisit } from "@/domain/templates";
import { getIntegrations } from "@/integrations";
import { diffInDays } from "@/lib/dates";
import { actorSource, type Actor } from "@/server/actor";
import { analyzeMessage, type AssistResult } from "@/server/ai/assist";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { markPendingDecisionsHandled } from "./assist";
import { findPendingProposal } from "./visits";
import { addTimelineEvent, recordAudit } from "./audit";

const ACTIVE_VISIT_STATUSES = ["AGUARDANDO_CONFIRMACAO", "CONFIRMADO", "REAGENDAMENTO_SOLICITADO"] as const;

/** Modelos que pedem retorno do participante deixam a conversa "aguardando resposta". */
const EXPECTS_REPLY: TemplateCategory[] = ["PRIMEIRO_CONTATO", "SEGUNDO_CONTATO", "LEMBRETE_VISITA", "SOLICITACAO_CONTATO"];
/** Modelos de outras categorias que também pedem retorno. */
const EXPECTS_REPLY_KEYS = ["tpl-falta-visita", "tpl-proposta-data"];

export async function hasWhatsAppConsent(participantId: string): Promise<boolean> {
  const consent = await db.consentRecord.findFirst({
    where: { participantId, purpose: "CONTATO_WHATSAPP" },
    orderBy: { recordedAt: "desc" },
  });
  return !!consent && consent.granted && !consent.revokedAt;
}

export async function nextActiveVisit(participantId: string) {
  return db.visit.findFirst({
    where: { participantId, status: { in: [...ACTIVE_VISIT_STATUSES] }, scheduledAt: { gte: new Date(Date.now() - 12 * 3_600_000) } },
    orderBy: { scheduledAt: "asc" },
  });
}

async function ensureConversation(participantId: string, studyId: string, assignedToId: string | null) {
  return db.conversation.upsert({
    where: { participantId_channel: { participantId, channel: "WHATSAPP" } },
    update: {},
    create: { participantId, studyId, channel: "WHATSAPP", status: "RESOLVIDA", assignedToId, lastMessageAt: new Date() },
  });
}

/**
 * Envia um modelo APROVADO ao participante (WhatsApp simulado).
 * Bloqueia: modelos não aprovados, modelos de outro estudo e participantes sem consentimento.
 */
export async function sendTemplateMessage(input: {
  participantId: string;
  templateKey?: string;
  templateId?: string;
  visitId?: string | null;
  /** Variáveis que só a automação conhece (ex.: {{ligacao}}). */
  extraVars?: Record<string, string>;
  actor: Actor;
}) {
  const participant = await db.participant.findUnique({ where: { id: input.participantId }, include: { study: true } });
  if (!participant) throw new DomainError("Participante não encontrado.");

  const template = await db.messageTemplate.findFirst({
    where: input.templateId ? { id: input.templateId } : { key: input.templateKey },
  });
  if (!template) throw new DomainError("Modelo de mensagem não encontrado.");
  if (template.approvalStatus !== "APROVADO") throw new DomainError(`O modelo “${template.name}” não está aprovado pelo CEP e não pode ser enviado.`);
  if (template.studyId && template.studyId !== participant.studyId) throw new DomainError("Este modelo pertence a outro estudo.");
  if (!(await hasWhatsAppConsent(participant.id))) throw new DomainError(`${participant.fullName} não tem consentimento registrado para contato por WhatsApp.`);

  const visit = input.visitId ? await db.visit.findUnique({ where: { id: input.visitId } }) : templateUsesVisit(template.body) ? await nextActiveVisit(participant.id) : null;
  if (templateUsesVisit(template.body) && !visit) throw new DomainError("Este modelo exige uma visita agendada.");
  if (systemVariablesIn(template.body).some((v) => !input.extraVars?.[v])) throw new DomainError(`“${template.name}” é enviado pelo sistema (ligação agendada ou proposta de nova data), não à mão.`);

  const variables = { ...buildTemplateVars({ participantName: participant.fullName, studyCode: participant.study.code, visitAt: visit?.scheduledAt }), ...input.extraVars };
  const body = renderTemplate(template.body, variables);
  const result = await getIntegrations().whatsapp.sendTemplate({ to: participant.phone, templateKey: template.key, variables, renderedBody: body });

  const conversation = await ensureConversation(participant.id, participant.studyId, participant.ownerId);
  const automated = input.actor.type === "AUTOMATION";
  const message = await db.communication.create({
    data: {
      conversationId: conversation.id,
      participantId: participant.id,
      studyId: participant.studyId,
      channel: "WHATSAPP",
      direction: "OUTBOUND",
      body,
      templateId: template.id,
      status: result.status === "FAILED" ? "FAILED" : "SENT",
      automated,
      automationKey: input.actor.type === "AUTOMATION" ? input.actor.ruleKey : null,
      sentById: input.actor.type === "USER" ? input.actor.user.id : null,
      externalId: result.externalId,
      sentAt: result.sentAt,
    },
  });
  const status: ConversationStatus = EXPECTS_REPLY.includes(template.category) || EXPECTS_REPLY_KEYS.includes(template.key) ? "AGUARDANDO_RESPOSTA" : "RESOLVIDA";
  await db.conversation.update({ where: { id: conversation.id }, data: { status, lastMessageAt: result.sentAt, unreadCount: 0 } });
  await db.participant.update({ where: { id: participant.id }, data: { lastContactAt: result.sentAt } });
  // Só um envio na véspera conta como "o lembrete da véspera"; um pedido de confirmação antecipado
  // não impede que a automação lembre o participante no dia anterior.
  if (visit && template.category === "LEMBRETE_VISITA" && diffInDays(visit.scheduledAt, result.sentAt) <= 1) {
    await db.visit.update({ where: { id: visit.id }, data: { reminderSentAt: result.sentAt } });
  }
  await markPendingDecisionsHandled(participant.id, input.actor);

  await addTimelineEvent({
    participantId: participant.id,
    studyId: participant.studyId,
    type: "MESSAGE_SENT",
    title: `${template.name} enviado`,
    description: "Modelo aprovado pelo CEP — envio simulado.",
    source: actorSource(input.actor) ?? "WhatsApp",
    actor: input.actor,
  });
  await recordAudit({
    actor: input.actor,
    action: "message.sent",
    entityType: "Participant",
    entityId: participant.id,
    studyId: participant.studyId,
    summary: `Modelo “${template.name}” enviado a ${participant.fullName}`,
    metadata: { templateKey: template.key, templateVersion: template.version, externalId: result.externalId, mode: "mock" },
  });
  return { message, template, participant };
}

/**
 * Envia um texto escrito pela equipe (não é modelo aprovado pelo CEP) — WhatsApp simulado.
 * Só para pessoas da equipe; automações e IA continuam restritas aos modelos aprovados.
 */
export async function sendFreeTextMessage(input: { participantId: string; body: string; expectsReply: boolean; actor: Actor & { type: "USER" } }) {
  const participant = await db.participant.findUnique({ where: { id: input.participantId } });
  if (!participant) throw new DomainError("Participante não encontrado.");
  const body = input.body.trim();
  if (!body) throw new DomainError("A mensagem está vazia.");
  if (body.length > FREE_TEXT_MAX) throw new DomainError(`A mensagem passa de ${FREE_TEXT_MAX} caracteres.`);
  if (!(await hasWhatsAppConsent(participant.id))) throw new DomainError(`${participant.fullName} não tem consentimento registrado para contato por WhatsApp.`);

  const conversation = await ensureConversation(participant.id, participant.studyId, participant.ownerId);
  const lastInbound = await db.communication.findFirst({ where: { conversationId: conversation.id, direction: "INBOUND" }, orderBy: { sentAt: "desc" } });
  const windowOpen = !!lastInbound && lastInbound.sentAt.getTime() > Date.now() - SERVICE_WINDOW_HOURS * 3_600_000;

  const result = await getIntegrations().whatsapp.sendMessage({ to: participant.phone, body });
  const message = await db.communication.create({
    data: {
      conversationId: conversation.id,
      participantId: participant.id,
      studyId: participant.studyId,
      channel: "WHATSAPP",
      direction: "OUTBOUND",
      body,
      templateId: null,
      status: result.status === "FAILED" ? "FAILED" : "SENT",
      automated: false,
      sentById: input.actor.user.id,
      externalId: result.externalId,
      sentAt: result.sentAt,
    },
  });
  await db.conversation.update({
    where: { id: conversation.id },
    data: { status: input.expectsReply ? "AGUARDANDO_RESPOSTA" : "RESOLVIDA", lastMessageAt: result.sentAt, unreadCount: 0 },
  });
  await db.participant.update({ where: { id: participant.id }, data: { lastContactAt: result.sentAt } });
  await markPendingDecisionsHandled(participant.id, input.actor);

  await addTimelineEvent({
    participantId: participant.id,
    studyId: participant.studyId,
    type: "MESSAGE_SENT",
    title: "Mensagem livre enviada",
    description: "Texto escrito pela equipe (não é modelo aprovado pelo CEP) — envio simulado.",
    source: "WhatsApp",
    actor: input.actor,
  });
  await recordAudit({
    actor: input.actor,
    action: "message.free_text_sent",
    entityType: "Participant",
    entityId: participant.id,
    studyId: participant.studyId,
    summary: `Mensagem livre enviada a ${participant.fullName}`,
    metadata: { body, length: body.length, expectsReply: input.expectsReply, serviceWindowOpen: windowOpen, externalId: result.externalId, mode: "mock" },
  });
  return { message, participant, windowOpen };
}

/** Simula a chegada de uma mensagem do participante (no produto real: webhook do WhatsApp). */
export async function receiveSimulatedMessage(input: { participantId: string; body: string; simulatedBy: Actor }): Promise<{ communicationId: string; assist: AssistResult }> {
  const participant = await db.participant.findUnique({ where: { id: input.participantId } });
  if (!participant) throw new DomainError("Participante não encontrado.");
  const body = input.body.trim();
  if (!body) throw new DomainError("Mensagem vazia.");

  const visit = await nextActiveVisit(participant.id);
  const proposal = await findPendingProposal(participant.id);
  const assist = analyzeMessage(body, { hasPendingVisit: (!!visit && visit.status !== "CONFIRMADO") || !!proposal, hasUpcomingVisit: !!visit || !!proposal });
  const conversation = await ensureConversation(participant.id, participant.studyId, participant.ownerId);
  const now = new Date();
  const message = await db.communication.create({
    data: {
      conversationId: conversation.id,
      participantId: participant.id,
      studyId: participant.studyId,
      channel: "WHATSAPP",
      direction: "INBOUND",
      body,
      status: "RECEIVED",
      intent: assist.intent,
      externalId: `sim-wa-in-${now.getTime().toString(36)}`,
      sentAt: now,
    },
  });
  await db.conversation.update({
    where: { id: conversation.id },
    data: {
      status: assist.intent === "POSSIVEL_RELATO_CLINICO" ? "REQUER_ATENCAO" : "RESPONDIDA",
      lastMessageAt: now,
      unreadCount: { increment: 1 },
      // O participante respondeu: a contagem de follow-ups automáticos recomeça.
      followUpAttempts: 0,
    },
  });
  await db.participant.update({ where: { id: participant.id }, data: { lastContactAt: now } });
  await addTimelineEvent({
    participantId: participant.id,
    studyId: participant.studyId,
    type: "MESSAGE_RECEIVED",
    title: assist.intent === "POSSIVEL_RELATO_CLINICO" ? "Mensagem com possível relato clínico" : "Participante respondeu",
    description: `“${body}”`,
    source: "WhatsApp (simulado)",
    actor: { type: "INTEGRATION", system: "WhatsApp" },
  });
  await recordAudit({
    actor: { type: "INTEGRATION", system: "WhatsApp" },
    action: "message.received",
    entityType: "Participant",
    entityId: participant.id,
    studyId: participant.studyId,
    summary: `Mensagem recebida de ${participant.fullName} (classificada: ${assist.label})`,
    metadata: { simulated: true, simulatedBy: input.simulatedBy.type === "USER" ? input.simulatedBy.user.name : null, intent: assist.intent },
  });
  return { communicationId: message.id, assist };
}

export async function addInternalNote(input: { conversationId: string; body: string; actor: Actor & { type: "USER" } }) {
  const conversation = await db.conversation.findUnique({ where: { id: input.conversationId } });
  if (!conversation) throw new DomainError("Conversa não encontrada.");
  const body = input.body.trim();
  if (!body) throw new DomainError("A nota está vazia.");
  await db.communication.create({
    data: {
      conversationId: conversation.id,
      participantId: conversation.participantId,
      studyId: conversation.studyId,
      channel: "WHATSAPP",
      direction: "INTERNAL_NOTE",
      body,
      status: "SENT",
      sentById: input.actor.user.id,
      sentAt: new Date(),
    },
  });
  await recordAudit({ actor: input.actor, action: "conversation.note_added", entityType: "Conversation", entityId: conversation.id, studyId: conversation.studyId, summary: "Nota interna adicionada à conversa" });
}

export async function markConversationRead(conversationId: string) {
  await db.conversation.update({ where: { id: conversationId }, data: { unreadCount: 0 } });
}

export async function setConversationStatus(conversationId: string, status: ConversationStatus, actor: Actor) {
  const c = await db.conversation.update({ where: { id: conversationId }, data: { status, unreadCount: 0 } });
  await recordAudit({ actor, action: "conversation.status_changed", entityType: "Conversation", entityId: c.id, studyId: c.studyId, summary: `Conversa marcada como ${status.toLowerCase().replace("_", " ")}` });
}
