import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/dates";
import { WED_10H } from "@/test/time";
import { recruitmentPace } from "./pace";

// Recrutamento na metade: 100 dias corridos de 200, meta de 500 → esperados 250 incluídos.
const study = (enrolledCount: number) => ({
  status: "RECRUTAMENTO_ATIVO" as const,
  enrolledCount,
  targetEnrollment: 500,
  startDate: addDays(WED_10H, -100),
  recruitmentEndDate: addDays(WED_10H, 100),
});

describe("recruitmentPace: incluídos × plano linear", () => {
  it("abaixo do ritmo, com a diferença e quantos faltam por semana", () => {
    expect(recruitmentPace(study(200), WED_10H)).toMatchObject({ expected: 250, status: "abaixo", gap: -50, weeksLeft: 14 });
  });

  it("no ritmo e acima do ritmo", () => {
    expect(recruitmentPace(study(250), WED_10H)?.status).toBe("no_ritmo");
    expect(recruitmentPace(study(300), WED_10H)?.status).toBe("acima");
  });

  it("só calcula para estudos recrutando e com data de fim", () => {
    expect(recruitmentPace({ ...study(200), status: "RECRUTAMENTO_PAUSADO" }, WED_10H)).toBeNull();
    expect(recruitmentPace({ ...study(200), recruitmentEndDate: null }, WED_10H)).toBeNull();
  });
});
