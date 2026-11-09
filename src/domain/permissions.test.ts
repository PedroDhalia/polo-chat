import { describe, expect, it } from "vitest";
import { roleCan } from "./permissions";

describe("RBAC por função", () => {
  it("Financeiro não vê comunicação nem dados de contato dos participantes", () => {
    expect(roleCan("FINANCEIRO", "communication.view")).toBe(false);
    expect(roleCan("FINANCEIRO", "participants.contact")).toBe(false);
    expect(roleCan("FINANCEIRO", "finance.manage")).toBe(true);
  });

  it("Diretor vê tudo, mas não lança no financeiro", () => {
    expect(roleCan("DIRETOR", "audit.view")).toBe(true);
    expect(roleCan("DIRETOR", "finance.manage")).toBe(false);
  });

  it("Assistente opera o dia a dia, mas não muda configurações nem modelos", () => {
    expect(roleCan("ASSISTENTE", "communication.send")).toBe(true);
    expect(roleCan("ASSISTENTE", "settings.manage")).toBe(false);
    expect(roleCan("ASSISTENTE", "templates.manage")).toBe(false);
  });

  it("Qualidade audita e cuida dos modelos aprovados, sem enviar mensagens", () => {
    expect(roleCan("QUALIDADE", "audit.view")).toBe(true);
    expect(roleCan("QUALIDADE", "templates.manage")).toBe(true);
    expect(roleCan("QUALIDADE", "communication.send")).toBe(false);
  });
});
