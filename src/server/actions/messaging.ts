"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { userActor } from "@/server/actor";
import { canAccessStudy, requirePermission } from "@/server/auth/session";
import { dispatch } from "@/server/automations/engine";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { addInternalNote, markConversationRead, openConversation, receiveSimulatedMessage, sendFreeTextMessage, sendTemplateMessage, setConversationStatus } from "@/server/services/messaging";
import { revokeWhatsAppConsent } from "@/server/services/participants";
import { act } from "./result";

async function authorizedParticipant(participantId: string, permission: "communication.send" | "communication.view") {
  const user = await requirePermission(permission);
  const p = await db.participant.findUnique({ where: { id: participantId } });
  if (!p || !canAccessStudy(user, p.studyId)) throw new DomainError("Participante não encontrado.");
  return { user, participant: p };
}

/** Abre a conversa de WhatsApp do participante (criada vazia se ainda não existe) e leva até ela. */
export async function startConversationAction(participantId: string) {
  const { participant } = await authorizedParticipant(participantId, "communication.view");
  const conversation = await openConversation(participant.id);
  revalidatePath("/comunicacao");
  redirect(`/comunicacao?c=${conversation.id}`);
}

export async function sendTemplateAction(participantId: string, templateId: string) {
  return act(async () => {
    const { user } = await authorizedParticipant(participantId, "communication.send");
    const { template, participant } = await sendTemplateMessage({ participantId, templateId, actor: userActor(user) });
    return { message: `“${template.name}” enviado para ${participant.fullName}`, details: ["Envio simulado — nenhuma mensagem real foi enviada."] };
  });
}

export async function sendFreeTextAction(participantId: string, body: string, expectsReply: boolean) {
  return act(async () => {
    const { user } = await authorizedParticipant(participantId, "communication.send");
    const { participant, windowOpen } = await sendFreeTextMessage({ participantId, body, expectsReply, actor: { type: "USER", user } });
    return {
      message: `Mensagem livre enviada para ${participant.fullName}`,
      details: [
        "Envio simulado — nenhuma mensagem real foi enviada.",
        ...(windowOpen ? [] : ["Fora da janela de 24h: no WhatsApp real este texto seria recusado; seria preciso um modelo aprovado."]),
      ],
    };
  });
}

/** Simulação de resposta do participante (apenas para demonstração). */
export async function simulateReplyAction(participantId: string, body: string) {
  return act(async () => {
    const { user } = await authorizedParticipant(participantId, "communication.view");
    const { communicationId, assist } = await receiveSimulatedMessage({ participantId, body, simulatedBy: userActor(user) });
    const details = await dispatch({ type: "message.received", communicationId });
    return { message: `Mensagem recebida — classificada como “${assist.label}”`, details };
  });
}

export async function addNoteAction(conversationId: string, body: string) {
  return act(async () => {
    const user = await requirePermission("communication.send");
    const c = await db.conversation.findUnique({ where: { id: conversationId } });
    if (!c || !canAccessStudy(user, c.studyId)) throw new DomainError("Conversa não encontrada.");
    await addInternalNote({ conversationId, body, actor: { type: "USER", user } });
    return { message: "Nota interna registrada" };
  });
}

export async function markConversationReadAction(conversationId: string) {
  const user = await requirePermission("communication.view");
  const c = await db.conversation.findUnique({ where: { id: conversationId } });
  if (!c || !canAccessStudy(user, c.studyId) || c.unreadCount === 0) return;
  await markConversationRead(conversationId);
  revalidatePath("/", "layout");
}

export async function resolveConversationAction(conversationId: string) {
  return act(async () => {
    const user = await requirePermission("communication.send");
    const c = await db.conversation.findUnique({ where: { id: conversationId } });
    if (!c || !canAccessStudy(user, c.studyId)) throw new DomainError("Conversa não encontrada.");
    await setConversationStatus(conversationId, "RESOLVIDA", userActor(user));
    return { message: "Conversa marcada como resolvida" };
  });
}

export async function revokeConsentAction(participantId: string) {
  return act(async () => {
    const { user, participant } = await authorizedParticipant(participantId, "communication.send");
    await revokeWhatsAppConsent(participantId, userActor(user));
    return { message: `Consentimento de WhatsApp revogado — ${participant.fullName}`, details: ["Novos envios por WhatsApp ficam bloqueados para este participante."] };
  });
}
