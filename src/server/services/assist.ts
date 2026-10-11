import "server-only";
import type { AssistMode } from "@prisma/client";
import { DEFAULT_AI } from "@/domain/assist-ai";
import { DEFAULT_FOLLOW_UP, DEFAULT_POLICY } from "@/domain/assist-policy";
import type { Actor } from "@/server/actor";
import { db } from "@/server/db";

/** Política da assistência para a intenção no estudo (padrão: só sugerir). */
export async function getAssistPolicy(studyId: string, intent: string): Promise<{ mode: AssistMode; minConfidence: number }> {
  const p = await db.assistPolicy.findUnique({ where: { studyId_intent: { studyId, intent } } });
  return p ? { mode: p.mode, minConfidence: p.minConfidence } : DEFAULT_POLICY;
}

/** Configuração de follow-up e horário de envio do estudo (padrão quando não configurado). */
export async function getAutomationSettings(studyId: string) {
  const s = await db.studyAutomationSettings.findUnique({ where: { studyId } });
  return s ?? { ...DEFAULT_FOLLOW_UP, ...DEFAULT_AI, studyId };
}

/**
 * Quando alguém da equipe age diretamente na conversa (envia mensagem, confirma visita,
 * registra descadastro), as sugestões pendentes daquele participante saem da fila de revisão.
 */
export async function markPendingDecisionsHandled(participantId: string, actor: Actor) {
  if (actor.type !== "USER") return;
  await db.assistDecision.updateMany({
    where: { participantId, outcome: "PENDENTE" },
    data: { outcome: "TRATADA", reviewedById: actor.user.id, reviewedAt: new Date() },
  });
}
