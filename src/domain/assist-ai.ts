// Segunda opinião da IA — regras puras, sem acesso a dados.
//
// As regras de palavras-chave resolvem a maior parte das mensagens sem custo. Só o que elas
// não resolvem (confiança abaixo do mínimo, "não classificada" ou mais de uma intenção) vai
// para a IA, que apenas ROTULA a mensagem: a ação continua sendo decidida pela política do
// estudo e executada com modelos aprovados.

export type AiMode = "DESLIGADA" | "SUGERIR" | "AUTOMATICO";

export const AI_MODE_LABEL: Record<AiMode, string> = {
  DESLIGADA: "Desligada",
  SUGERIR: "Só sugerir",
  AUTOMATICO: "Automático",
};

export const DEFAULT_AI: { aiMode: AiMode; aiMinConfidence: number } = { aiMode: "AUTOMATICO", aiMinConfidence: 80 };
export const AI_CONFIDENCE_OPTIONS = [80, 85, 90, 95];

export function isAiMode(value: string): value is AiMode {
  return value === "DESLIGADA" || value === "SUGERIR" || value === "AUTOMATICO";
}

/** Modelo padrão da interpretação (pode ser trocado por ASSIST_AI_MODEL). */
export const DEFAULT_AI_MODEL = "claude-opus-5-5";

/**
 * Preço público por milhão de tokens (US$). Leitura de cache ≈ 0,1× e escrita ≈ 1,25× a entrada
 * quando a tabela oficial não informa. O custo exibido é estimativa — a fatura oficial é a da Anthropic.
 */
export const MODEL_PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function estimateCostUsd(model: string, u: TokenUsage): number {
  const p = MODEL_PRICES[model] ?? MODEL_PRICES[DEFAULT_AI_MODEL];
  return (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) / 1_000_000;
}

/** A mensagem é "resíduo" das regras e merece a segunda opinião da IA? */
export function needsAiReview(analysis: { intent: string; score: number; ambiguous: boolean }, policyMin: number | null): boolean {
  if (analysis.intent === "POSSIVEL_RELATO_CLINICO") return false; // clínico já vai para a equipe médica
  if (analysis.intent === "OUTRO" || analysis.ambiguous) return true;
  return policyMin !== null && analysis.score < policyMin;
}
