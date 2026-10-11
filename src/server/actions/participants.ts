"use server";

import type { ParticipantStatus } from "@prisma/client";
import { getIntegrations } from "@/integrations";
import { userActor } from "@/server/actor";
import { canAccessStudy, getCurrentUser, requirePermission } from "@/server/auth/session";
import { dispatch } from "@/server/automations/engine";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { changeParticipantStatus, ingestLead, logPhoneContact, revealContact } from "@/server/services/participants";
import { act } from "./result";

async function authorized(participantId: string, permission: "participants.edit" | "participants.contact") {
  const user = await requirePermission(permission);
  const p = await db.participant.findUnique({ where: { id: participantId } });
  if (!p || !canAccessStudy(user, p.studyId)) throw new DomainError("Participante não encontrado.");
  return { user, participant: p };
}

/** Exibe o telefone completo — ação auditada. */
export async function revealPhoneAction(participantId: string) {
  return act<string>(async () => {
    const { user } = await authorized(participantId, "participants.contact");
    const phone = await revealContact(participantId, userActor(user));
    return { data: phone };
  });
}

export async function changeParticipantStatusAction(participantId: string, status: ParticipantStatus) {
  return act(async () => {
    const { user, participant } = await authorized(participantId, "participants.edit");
    await changeParticipantStatus(participantId, status, userActor(user));
    return { message: `Status de ${participant.fullName} atualizado` };
  });
}

export async function logContactAction(participantId: string, note: string) {
  return act(async () => {
    const { user, participant } = await authorized(participantId, "participants.edit");
    await logPhoneContact(participantId, note.trim(), { type: "USER", user });
    return { message: `Contato com ${participant.fullName} registrado` };
  });
}

/** Simula a chegada de um formulário de interesse (Google Forms / landing page). */
export async function simulateFormSubmissionAction() {
  return act(async () => {
    const user = await getCurrentUser();
    if (!user) throw new DomainError("Sessão inválida.");
    await requirePermission("participants.edit");
    const forms = getIntegrations().forms;
    const [submission] = await forms.fetchNewSubmissions();
    const lead = forms.normalize(submission);
    const participant = await ingestLead(lead, { type: "INTEGRATION", system: "Formulários" });
    const details = await dispatch({ type: "form.received", participantId: participant.id });
    return { message: `Formulário recebido: ${participant.fullName} (${lead.studyCode})`, details: ["Candidato cadastrado automaticamente", ...details] };
  });
}
