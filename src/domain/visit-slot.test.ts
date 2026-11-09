import { describe, expect, it } from "vitest";
import { brt, WED_10H } from "@/test/time";
import { checkVisitSlot, overlaps, readRequestedVisitTime, type DayVisit } from "./visit-slot";

describe("readRequestedVisitTime: dia e hora exatos pedidos para a visita", () => {
  it("ignora o trecho negado e fica com a alternativa", () => {
    expect(readRequestedVisitTime("Não posso amanhã, pode ser sexta às 10h?", WED_10H)).toEqual({ at: brt("2026-10-16", "10:00") });
  });

  it("junta dia e hora escritos em frases separadas", () => {
    expect(readRequestedVisitTime("Amanhã. Às 14h", WED_10H)).toEqual({ at: brt("2026-10-15", "14:00") });
  });

  it("período do dia não é pedido de horário", () => {
    expect(readRequestedVisitTime("Pode ser amanhã de manhã?", WED_10H)).toBeNull();
  });

  it("mais de uma opção: não escolhe pelo participante", () => {
    expect(readRequestedVisitTime("sexta às 10 ou segunda às 9", WED_10H)).toBeNull();
  });

  it("'sexta às 10' escrito na própria sexta, depois das 10h, é a sexta seguinte", () => {
    expect(readRequestedVisitTime("sexta às 10", brt("2026-10-16", "11:00"))).toEqual({ at: brt("2026-10-23", "10:00") });
  });
});

describe("overlaps", () => {
  it("visitas encostadas não conflitam; sobrepostas sim", () => {
    expect(overlaps(brt("2026-10-15", "09:00"), 60, brt("2026-10-15", "10:00"), 60)).toBe(false);
    expect(overlaps(brt("2026-10-15", "09:30"), 60, brt("2026-10-15", "10:00"), 60)).toBe(true);
  });
});

describe("checkVisitSlot: o horário serve para a visita?", () => {
  const paulo: DayVisit = { start: brt("2026-10-15", "10:30"), durationMin: 60, staffId: "beatriz", name: "V3 · Dia 29", participantName: "Paulo Resende" };
  const ctx = {
    now: WED_10H,
    window: { windowStart: brt("2026-10-14"), windowEnd: brt("2026-10-23") },
    ownerId: "beatriz",
    ownerName: "Beatriz Lima",
    dayVisits: [] as DayVisit[],
  };

  it("aceita um horário livre, em dia útil, dentro da janela", () => {
    expect(checkVisitSlot(brt("2026-10-15", "10:00"), ctx)).toEqual({ ok: true });
  });

  it("aceita o último início do dia (17h) e recusa depois disso", () => {
    expect(checkVisitSlot(brt("2026-10-15", "17:00"), ctx)).toEqual({ ok: true });
    expect(checkVisitSlot(brt("2026-10-15", "18:00"), ctx)).toMatchObject({ ok: false, reason: expect.stringContaining("fora do horário de visitas") });
  });

  it("exige pelo menos 1h de antecedência", () => {
    expect(checkVisitSlot(brt("2026-10-14", "10:30"), ctx)).toMatchObject({ ok: false, reason: expect.stringContaining("menos de 1 hora") });
  });

  it("recusa fim de semana", () => {
    expect(checkVisitSlot(brt("2026-10-17", "10:00"), ctx)).toMatchObject({ ok: false, reason: "cai no fim de semana" });
  });

  it("recusa fora da janela do Polo Trial", () => {
    expect(checkVisitSlot(brt("2026-10-26", "10:00"), ctx)).toEqual({ ok: false, reason: "fora da janela do Polo Trial (14/10 a 23/10)" });
  });

  it("recusa conflito com outra visita do mesmo responsável", () => {
    expect(checkVisitSlot(brt("2026-10-15", "10:00"), { ...ctx, dayVisits: [paulo] })).toEqual({
      ok: false,
      reason: "Beatriz já tem V3 · Dia 29 de Paulo Resende às 10:30",
    });
  });

  it("visita de outro responsável no mesmo horário não é conflito", () => {
    expect(checkVisitSlot(brt("2026-10-15", "10:00"), { ...ctx, dayVisits: [{ ...paulo, staffId: "lucas" }] })).toEqual({ ok: true });
  });
});
