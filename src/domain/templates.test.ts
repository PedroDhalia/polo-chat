import { describe, expect, it } from "vitest";
import { brt, WED_10H } from "@/test/time";
import { buildTemplateVars, combineAnswers, renderTemplate, systemVariablesIn, visitDateLabel } from "./templates";

describe("renderTemplate", () => {
  it("preenche as variáveis conhecidas e não inventa as que faltam", () => {
    expect(renderTemplate("Olá, {{nome}}! Sua visita é {{data}} às {{hora}}.", { nome: "Ana", data: "amanhã" })).toBe(
      "Olá, Ana! Sua visita é amanhã às {{hora}}.",
    );
  });
});

describe("combineAnswers: várias respostas aprovadas numa mensagem só", () => {
  it("mantém a saudação só na primeira e liga as respostas com ', e'", () => {
    expect(combineAnswers(["Olá, Ana! O centro fica na Rua das Flores, 100.", "Olá, Ana! Para a visita, traga um documento com foto."])).toBe(
      "Olá, Ana! O centro fica na Rua das Flores, 100, e para a visita, traga um documento com foto.",
    );
  });

  it("não mexe em siglas no início da resposta", () => {
    expect(combineAnswers(["Olá, Ana! O estacionamento é gratuito.", "Olá, Ana! RG e CPF são obrigatórios."])).toBe(
      "Olá, Ana! O estacionamento é gratuito, e RG e CPF são obrigatórios.",
    );
  });

  it("a resposta que fecha a conversa ('Qualquer dúvida…') vai por último", () => {
    expect(combineAnswers(["Qualquer dúvida, estamos à disposição.", "Olá, Ana! O estacionamento é gratuito."])).toBe(
      "Olá, Ana! O estacionamento é gratuito, e qualquer dúvida, estamos à disposição.",
    );
  });
});

describe("variáveis dos modelos", () => {
  it("identifica variáveis que só o sistema preenche", () => {
    expect(systemVariablesIn("Ligação {{ligacao}}; nova data {{nova_data}} às {{nova_hora}}, {{nome}}.")).toEqual(["ligacao", "nova_data", "nova_hora"]);
  });

  it("monta nome, estudo, data relativa e hora da visita", () => {
    const vars = buildTemplateVars({ participantName: "Ana Paula Souza", studyCode: "VAC-2026", visitAt: brt("2026-10-15", "09:00"), now: WED_10H });
    expect(vars).toEqual({ nome: "Ana", estudo: "VAC-2026", data: "amanhã", hora: "09:00" });
  });

  it("data da visita: 'hoje', 'amanhã' ou 'dia dd/mm'", () => {
    expect(visitDateLabel(brt("2026-10-14", "15:00"), WED_10H)).toBe("hoje");
    expect(visitDateLabel(brt("2026-10-19", "09:00"), WED_10H)).toBe("dia 19/10");
  });
});
