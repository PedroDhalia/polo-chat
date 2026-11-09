import { describe, expect, it } from "vitest";
import { DEFAULT_AI_MODEL, estimateCostUsd, needsAiReview } from "./assist-ai";

describe("needsAiReview: só o resíduo das regras vai para a IA", () => {
  it("relato clínico nunca passa pela IA (vai direto para a equipe médica)", () => {
    expect(needsAiReview({ intent: "POSSIVEL_RELATO_CLINICO", score: 40, ambiguous: true }, 85)).toBe(false);
  });

  it("mensagem não classificada ou com mais de uma intenção vai para a IA", () => {
    expect(needsAiReview({ intent: "OUTRO", score: 0, ambiguous: false }, 85)).toBe(true);
    expect(needsAiReview({ intent: "CONFIRMACAO", score: 95, ambiguous: true }, 85)).toBe(true);
  });

  it("confiança abaixo do mínimo da política vai para a IA; acima, as regras bastam (sem custo)", () => {
    expect(needsAiReview({ intent: "CONFIRMACAO", score: 72, ambiguous: false }, 85)).toBe(true);
    expect(needsAiReview({ intent: "CONFIRMACAO", score: 95, ambiguous: false }, 85)).toBe(false);
  });
});

describe("estimateCostUsd", () => {
  const usage = { inputTokens: 2_000, outputTokens: 500, cacheReadTokens: 1_000, cacheWriteTokens: 0 };

  it("soma entrada, saída e cache pelo preço por milhão de tokens", () => {
    // (2000 × 4 + 500 × 20 + 1000 × 0,2) / 1.000.000
    expect(estimateCostUsd("claude-opus-5-5", usage)).toBeCloseTo(0.0182, 6);
  });

  it("modelo sem preço conhecido usa o preço do modelo padrão", () => {
    expect(estimateCostUsd("modelo-desconhecido", usage)).toBe(estimateCostUsd(DEFAULT_AI_MODEL, usage));
  });
});
