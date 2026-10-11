// Contrato da segunda opinião da IA: recebe a mensagem e o contexto mínimo, devolve só um rótulo.

import type { AssistIntent } from "@/domain/assist-policy";
import type { TokenUsage } from "@/domain/assist-ai";
import type { AdapterMode } from "../types";

export interface AiInterpretInput {
  message: string;
  /** Últimas mensagens da conversa, da mais antiga para a mais recente (sem notas internas). */
  history: { from: "centro" | "participante"; text: string }[];
  context: {
    stage: "candidato" | "participante";
    hasPendingVisit: boolean;
    hasConfirmedVisit: boolean;
    hasDateProposal: boolean;
    hasScheduledCall: boolean;
  };
}

export interface AiInterpretation {
  intent: AssistIntent;
  /** 0–100. */
  confidence: number;
  ambiguous: boolean;
  faqTopic: "ressarcimento" | "documentos" | "endereco" | null;
  /** "hoje", "amanha", "segunda"… (null = sem preferência). */
  preferredDay: string | null;
  /** "HH:MM" (null = sem preferência). */
  preferredTime: string | null;
  rationale: string;
}

export interface AiCallUsage extends TokenUsage {
  /** Modelo que efetivamente respondeu (pode ser o de fallback). */
  model: string;
  latencyMs: number;
}

export interface AssistAiAdapter {
  readonly mode: AdapterMode;
  readonly model: string;
  interpret(input: AiInterpretInput): Promise<{ result: AiInterpretation; usage: AiCallUsage }>;
}
