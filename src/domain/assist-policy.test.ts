import { describe, expect, it } from "vitest";
import { approveLabel, confidenceLabel, evaluatePolicy, FAQ_MULTI_PREFIX, isWithinSendWindow } from "./assist-policy";

const auto = { mode: "AUTOMATICO" as const, minConfidence: 85 };
const ready = { ruleEnabled: true, applicable: true };
const confirm = (score: number, ambiguous = false) => ({ intent: "CONFIRMACAO" as const, score, ambiguous });

describe("evaluatePolicy: automático na regra, humano na exceção", () => {
  it("aplica sozinha com modo automático e confiança no mínimo ou acima", () => {
    expect(evaluatePolicy(confirm(95), auto, ready).outcome).toBe("AUTOMATICA");
    expect(evaluatePolicy(confirm(85), auto, ready).outcome).toBe("AUTOMATICA");
  });

  it("possível relato clínico é sempre encaminhado, mesmo no automático", () => {
    const r = evaluatePolicy({ intent: "POSSIVEL_RELATO_CLINICO", score: 99, ambiguous: false }, auto, ready);
    expect(r.outcome).toBe("ENCAMINHADA");
  });

  it("mensagem não classificada fica com a equipe", () => {
    expect(evaluatePolicy({ intent: "OUTRO", score: 0, ambiguous: false }, auto, ready).outcome).toBe("PENDENTE");
  });

  it("confiança abaixo do mínimo vai para a fila, com o motivo", () => {
    expect(evaluatePolicy(confirm(72), auto, ready)).toEqual({ outcome: "PENDENTE", reason: "Confiança 72 abaixo do mínimo 85" });
  });

  it("mais de uma intenção na mesma mensagem nunca é automática", () => {
    expect(evaluatePolicy(confirm(95, true), auto, ready).outcome).toBe("PENDENTE");
  });

  it("sem política configurada, o padrão é só sugerir", () => {
    expect(evaluatePolicy(confirm(99), null, ready)).toEqual({ outcome: "PENDENTE", reason: "Modo sugestão neste estudo" });
  });

  it("desligar a regra de automação desliga toda aplicação automática", () => {
    expect(evaluatePolicy(confirm(99), auto, { ...ready, ruleEnabled: false }).outcome).toBe("PENDENTE");
  });

  it("sem nada concreto a aplicar, explica por quê", () => {
    const r = evaluatePolicy(confirm(99), auto, { ruleEnabled: true, applicable: false, notApplicableReason: "Nenhuma visita aguardando confirmação" });
    expect(r).toEqual({ outcome: "PENDENTE", reason: "Nenhuma visita aguardando confirmação" });
  });
});

describe("approveLabel", () => {
  it("conta as respostas quando várias dúvidas saem juntas", () => {
    expect(approveLabel("DUVIDA_FREQUENTE", `${FAQ_MULTI_PREFIX}“Endereço”, “Documentos” e “Estacionamento”`)).toBe("Enviar as 3 respostas");
  });
});

describe("confidenceLabel", () => {
  it("separa alta (≥ 85), média (≥ 60) e baixa", () => {
    expect([85, 84, 60, 59].map(confidenceLabel)).toEqual(["alta", "média", "média", "baixa"]);
  });
});

describe("isWithinSendWindow", () => {
  it("janela [início, fim): envia às 7h, não envia às 21h", () => {
    expect(isWithinSendWindow(6, 7, 21)).toBe(false);
    expect(isWithinSendWindow(7, 7, 21)).toBe(true);
    expect(isWithinSendWindow(20, 7, 21)).toBe(true);
    expect(isWithinSendWindow(21, 7, 21)).toBe(false);
  });
});
