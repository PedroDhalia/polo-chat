"use server";

import type { AssistMode } from "@prisma/client";
import { CONFIDENCE_OPTIONS, INTENT_LABEL, INTERVAL_OPTIONS, ATTEMPT_OPTIONS, isActionable, type AssistIntent } from "@/domain/assist-policy";
import { AI_CONFIDENCE_OPTIONS, AI_MODE_LABEL, isAiMode } from "@/domain/assist-ai";
import { parseLocalDateTime } from "@/lib/dates";
import { userActor } from "@/server/actor";
import { can, canAccessStudy, ForbiddenError, getCurrentUser, requirePermission } from "@/server/auth/session";
import { applyAssistDecision } from "@/server/automations/engine";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { recordAudit } from "@/server/services/audit";
import { act } from "./result";

async function authorizedDecision(decisionId: string) {
  const d = await db.assistDecision.findUnique({ where: { id: decisionId }, include: { participant: { select: { fullName: true } } } });
  return d;
}

/** Equipe aprova a sugestão da assistência: a ação é aplicada em nome de quem aprovou. */
/** `callTime` (opcional): a equipe aprova a remarcação da ligação para outro horário (AAAA-MM-DD, HH:MM). */
export async function approveAssistDecisionAction(decisionId: string, callTime?: { date: string; time: string }) {
  return act(async () => {
    const user = await requirePermission("communication.send");
    const d = await authorizedDecision(decisionId);
    if (!d || !canAccessStudy(user, d.studyId)) throw new DomainError("Sugestão não encontrada.");
    const callAt = callTime ? parseLocalDateTime(callTime.date, callTime.time) : undefined;
    if (callTime && !callAt) throw new DomainError("Informe data e horário válidos.");
    const lines = await applyAssistDecision(decisionId, userActor(user), { callAt: callAt ?? undefined });
    await recordAudit({ actor: userActor(user), action: "assist.approved", entityType: "AssistDecision", entityId: d.id, studyId: d.studyId, summary: `Sugestão da assistência aprovada (${INTENT_LABEL[d.intent as AssistIntent] ?? d.intent}) — ${d.participant.fullName}` });
    return { message: `Sugestão aprovada — ${d.participant.fullName}`, details: lines };
  });
}

/** Equipe tira a sugestão da fila e trata a mensagem por conta própria. */
export async function dismissAssistDecisionAction(decisionId: string) {
  return act(async () => {
    const user = await requirePermission("communication.send");
    const d = await authorizedDecision(decisionId);
    if (!d || !canAccessStudy(user, d.studyId)) throw new DomainError("Sugestão não encontrada.");
    if (d.outcome !== "PENDENTE") throw new DomainError("Esta sugestão já foi tratada.");
    await db.assistDecision.update({ where: { id: d.id }, data: { outcome: "TRATADA", reviewedById: user.id, reviewedAt: new Date() } });
    await recordAudit({ actor: userActor(user), action: "assist.dismissed", entityType: "AssistDecision", entityId: d.id, studyId: d.studyId, summary: `Sugestão da assistência tratada manualmente — ${d.participant.fullName}` });
    return { message: "Sugestão retirada da fila — responda pela conversa" };
  });
}

/** Revisão por amostragem do que a assistência aplicou sozinha (mede a taxa de acerto). */
export async function reviewAutoDecisionAction(decisionId: string, verdict: "CORRETA" | "INCORRETA") {
  return act(async () => {
    const user = await getCurrentUser();
    if (!can(user, "communication.send") && !can(user, "audit.view")) throw new ForbiddenError("communication.send");
    const d = await authorizedDecision(decisionId);
    if (!d || !canAccessStudy(user, d.studyId)) throw new DomainError("Decisão não encontrada.");
    if (d.outcome !== "AUTOMATICA") throw new DomainError("Só decisões aplicadas automaticamente entram na revisão por amostragem.");
    await db.assistDecision.update({ where: { id: d.id }, data: { verdict, reviewedById: user.id, reviewedAt: new Date() } });
    await recordAudit({ actor: userActor(user), action: "assist.reviewed", entityType: "AssistDecision", entityId: d.id, studyId: d.studyId, summary: `Decisão automática revisada como ${verdict === "CORRETA" ? "correta" : "incorreta"} — ${d.participant.fullName}` });
    return { message: verdict === "CORRETA" ? "Marcada como correta" : "Marcada como incorreta — considere aumentar a confiança mínima ou voltar ao modo sugestão" };
  });
}

/** Altera o modo e a confiança mínima de uma intenção em um estudo. */
export async function updateAssistPolicyAction(studyId: string, intent: string, mode: AssistMode, minConfidence: number) {
  return act(async () => {
    const user = await requirePermission("automations.manage");
    if (!canAccessStudy(user, studyId)) throw new DomainError("Estudo não acessível.");
    if (!isActionable(intent)) throw new DomainError("Relato clínico e mensagens não classificadas nunca podem ser automáticos.");
    if (mode !== "SUGERIR" && mode !== "AUTOMATICO") throw new DomainError("Modo inválido.");
    if (!CONFIDENCE_OPTIONS.includes(minConfidence)) throw new DomainError("Confiança mínima inválida.");
    const study = await db.study.findUniqueOrThrow({ where: { id: studyId }, select: { code: true } });
    const before = await db.assistPolicy.findUnique({ where: { studyId_intent: { studyId, intent } } });
    await db.assistPolicy.upsert({
      where: { studyId_intent: { studyId, intent } },
      update: { mode, minConfidence, updatedById: user.id },
      create: { studyId, intent, mode, minConfidence, updatedById: user.id },
    });
    await recordAudit({
      actor: userActor(user),
      action: "assist.policy_changed",
      entityType: "AssistPolicy",
      studyId,
      summary: `${study.code} · ${INTENT_LABEL[intent]}: ${mode === "AUTOMATICO" ? "automático" : "sugestão"}, confiança mínima ${minConfidence}`,
      metadata: { before: before ? { mode: before.mode, minConfidence: before.minConfidence } : null, after: { mode, minConfidence } },
    });
    return { message: `${study.code} · ${INTENT_LABEL[intent]}: ${mode === "AUTOMATICO" ? `automático a partir de ${minConfidence}` : "só sugestão"}` };
  });
}

/** Altera a cadência de follow-up e o horário de envio de um estudo. */
/** Interpretação por IA (segunda opinião) no estudo: modo e confiança mínima para aplicar sozinha. */
export async function updateAiSettingsAction(studyId: string, patch: { aiMode?: string; aiMinConfidence?: number }) {
  return act(async () => {
    const user = await requirePermission("automations.manage");
    if (!canAccessStudy(user, studyId)) throw new DomainError("Estudo não acessível.");
    if (patch.aiMode !== undefined && !isAiMode(patch.aiMode)) throw new DomainError("Modo da IA inválido.");
    if (patch.aiMinConfidence !== undefined && !AI_CONFIDENCE_OPTIONS.includes(patch.aiMinConfidence)) throw new DomainError("Confiança mínima inválida.");
    const study = await db.study.findUniqueOrThrow({ where: { id: studyId }, select: { code: true } });
    const saved = await db.studyAutomationSettings.upsert({ where: { studyId }, update: { ...patch, updatedById: user.id }, create: { studyId, ...patch, updatedById: user.id } });
    const label = isAiMode(saved.aiMode) ? AI_MODE_LABEL[saved.aiMode] : saved.aiMode;
    await recordAudit({
      actor: userActor(user),
      action: "assist.ai_settings_changed",
      entityType: "StudyAutomationSettings",
      entityId: saved.id,
      studyId,
      summary: `${study.code} · interpretação por IA: ${label.toLowerCase()}${saved.aiMode === "AUTOMATICO" ? `, confiança mínima ${saved.aiMinConfidence}` : ""}`,
      metadata: { patch },
    });
    return { message: `IA de ${study.code}: ${label.toLowerCase()}${saved.aiMode === "AUTOMATICO" ? ` a partir de ${saved.aiMinConfidence}` : ""}` };
  });
}

export async function updateFollowUpSettingsAction(
  studyId: string,
  patch: { followUpEnabled?: boolean; followUpMaxAttempts?: number; followUpIntervalHours?: number; sendWindowStart?: number; sendWindowEnd?: number },
) {
  return act(async () => {
    const user = await requirePermission("automations.manage");
    if (!canAccessStudy(user, studyId)) throw new DomainError("Estudo não acessível.");
    if (patch.followUpMaxAttempts !== undefined && !ATTEMPT_OPTIONS.includes(patch.followUpMaxAttempts)) throw new DomainError("Número de tentativas inválido.");
    if (patch.followUpIntervalHours !== undefined && !INTERVAL_OPTIONS.includes(patch.followUpIntervalHours)) throw new DomainError("Intervalo inválido.");
    const current = await db.studyAutomationSettings.findUnique({ where: { studyId } });
    const start = patch.sendWindowStart ?? current?.sendWindowStart ?? 7;
    const end = patch.sendWindowEnd ?? current?.sendWindowEnd ?? 21;
    if (start < 6 || end > 22 || start >= end) throw new DomainError("Horário de envio deve ficar entre 06h e 22h, com início antes do fim.");
    const study = await db.study.findUniqueOrThrow({ where: { id: studyId }, select: { code: true } });
    const saved = await db.studyAutomationSettings.upsert({
      where: { studyId },
      update: { ...patch, updatedById: user.id },
      create: { studyId, ...patch, updatedById: user.id },
    });
    await recordAudit({
      actor: userActor(user),
      action: "followup.settings_changed",
      entityType: "StudyAutomationSettings",
      entityId: saved.id,
      studyId,
      summary: `${study.code} · follow-up ${saved.followUpEnabled ? `até ${saved.followUpMaxAttempts} tentativa(s) a cada ${saved.followUpIntervalHours}h` : "desligado"}, envio das ${saved.sendWindowStart}h às ${saved.sendWindowEnd}h`,
      metadata: { patch },
    });
    return { message: `Follow-up de ${study.code} atualizado` };
  });
}
