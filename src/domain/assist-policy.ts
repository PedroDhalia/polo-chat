// Política da assistência (IA) e do follow-up automático — regras puras, sem acesso a dados.
//
// Princípio: automático na regra, humano na exceção. A assistência só age sozinha quando
// o estudo liga o modo automático para aquela intenção E a confiança atinge o mínimo
// configurado. Relato clínico e mensagens não classificadas nunca são automáticos.

import type { AssistMode } from "@prisma/client";

export type AssistIntent =
  | "CONFIRMACAO"
  | "REAGENDAMENTO"
  | "POSSIVEL_RELATO_CLINICO"
  | "DUVIDA_FREQUENTE"
  | "INTERESSE"
  | "DESCADASTRO"
  | "OUTRO";

export const INTENT_LABEL: Record<AssistIntent, string> = {
  CONFIRMACAO: "Confirmação de presença",
  REAGENDAMENTO: "Pedido de remarcação",
  POSSIVEL_RELATO_CLINICO: "Possível relato clínico",
  DUVIDA_FREQUENTE: "Dúvida frequente",
  INTERESSE: "Interesse em participar",
  DESCADASTRO: "Pedido para não receber contatos",
  OUTRO: "Não classificada",
};

/** Intenções que podem ser configuradas como automáticas, na ordem de exibição. */
export const ACTIONABLE_INTENTS = ["CONFIRMACAO", "DUVIDA_FREQUENTE", "REAGENDAMENTO", "DESCADASTRO", "INTERESSE"] as const;
export type ActionableIntent = (typeof ACTIONABLE_INTENTS)[number];

/** Nunca automáticas, em nenhum estudo. */
export const LOCKED_INTENTS: { intent: AssistIntent; rule: string }[] = [
  { intent: "POSSIVEL_RELATO_CLINICO", rule: "Sempre encaminhada à equipe médica, sem resposta automática" },
  { intent: "OUTRO", rule: "Sempre respondida pela equipe" },
];

export function isActionable(intent: string): intent is ActionableIntent {
  return (ACTIONABLE_INTENTS as readonly string[]).includes(intent);
}

/** O que a assistência faz quando a intenção é aplicada (automaticamente ou por aprovação). */
export const INTENT_ACTION: Record<ActionableIntent, string> = {
  CONFIRMACAO: "Confirma a visita e envia “Confirmação de agendamento”",
  DUVIDA_FREQUENTE: "Envia a resposta aprovada para a dúvida",
  REAGENDAMENTO: "Visita: registra o pedido, cria pendência e envia “Reagendamento”. Ligação agendada: a equipe aprova o horário pedido e o candidato é avisado",
  DESCADASTRO: "Revoga o consentimento de WhatsApp e avisa o responsável",
  INTERESSE: "Agenda a ligação de pré-triagem (no horário pedido ou no próximo livre), cria a pendência e envia “Ligação agendada”",
};

/** Rótulo do botão de aprovação na fila de revisão. */
export const APPROVE_LABEL: Record<ActionableIntent, string> = {
  CONFIRMACAO: "Confirmar visita",
  DUVIDA_FREQUENTE: "Enviar resposta aprovada",
  REAGENDAMENTO: "Registrar pedido",
  DESCADASTRO: "Registrar descadastro",
  INTERESSE: "Agendar ligação e avisar",
};

/** Sugestão de novo horário de ligação: sempre aprovada pela equipe antes de o candidato ser avisado. */
export const CALL_RESCHEDULE_PREFIX = "Remarcar a ligação para ";

export function isCallReschedule(action: string | null | undefined): boolean {
  return !!action?.startsWith(CALL_RESCHEDULE_PREFIX);
}

/** Rótulo do botão de aprovação (o novo horário de ligação tem rótulo próprio). */
export function approveLabel(intent: ActionableIntent, action?: string | null): string {
  return isCallReschedule(action) ? "Aprovar novo horário" : APPROVE_LABEL[intent];
}

export const DEFAULT_POLICY: { mode: AssistMode; minConfidence: number } = { mode: "SUGERIR", minConfidence: 85 };
export const CONFIDENCE_OPTIONS = [60, 70, 80, 85, 90, 95];

export const DEFAULT_FOLLOW_UP = { followUpEnabled: true, followUpMaxAttempts: 1, followUpIntervalHours: 24, sendWindowStart: 7, sendWindowEnd: 21 };
export const ATTEMPT_OPTIONS = [0, 1, 2, 3];
export const INTERVAL_OPTIONS = [24, 48, 72];

export function confidenceLabel(score: number): "alta" | "média" | "baixa" {
  return score >= 85 ? "alta" : score >= 60 ? "média" : "baixa";
}

export interface PolicyEvaluation {
  outcome: "AUTOMATICA" | "PENDENTE" | "ENCAMINHADA";
  reason: string;
}

/**
 * Decide se a assistência aplica sozinha ou deixa para a equipe.
 * `applicable` = existe algo concreto a fazer (ex.: há visita aguardando confirmação).
 */
export function evaluatePolicy(
  analysis: { intent: AssistIntent; score: number; ambiguous: boolean },
  policy: { mode: AssistMode; minConfidence: number } | null,
  opts: { ruleEnabled: boolean; applicable: boolean; notApplicableReason?: string },
): PolicyEvaluation {
  if (analysis.intent === "POSSIVEL_RELATO_CLINICO") return { outcome: "ENCAMINHADA", reason: "Possível relato clínico: sempre encaminhado à equipe médica" };
  if (analysis.intent === "OUTRO") return { outcome: "PENDENTE", reason: "Sem correspondência com as respostas aprovadas" };
  if (!opts.ruleEnabled) return { outcome: "PENDENTE", reason: "Aplicação automática desligada em Configurações → Automações" };
  const p = policy ?? DEFAULT_POLICY;
  if (p.mode === "SUGERIR") return { outcome: "PENDENTE", reason: "Modo sugestão neste estudo" };
  if (analysis.ambiguous) return { outcome: "PENDENTE", reason: "Mais de uma intenção na mesma mensagem" };
  if (analysis.score < p.minConfidence) return { outcome: "PENDENTE", reason: `Confiança ${analysis.score} abaixo do mínimo ${p.minConfidence}` };
  if (!opts.applicable) return { outcome: "PENDENTE", reason: opts.notApplicableReason ?? "Nada a aplicar automaticamente" };
  return { outcome: "AUTOMATICA", reason: `Confiança ${analysis.score} ≥ mínimo ${p.minConfidence} · modo automático` };
}

/** Hora local (0–23) dentro da janela de envio [start, end). */
export function isWithinSendWindow(localHour: number, start: number, end: number): boolean {
  return localHour >= start && localHour < end;
}
