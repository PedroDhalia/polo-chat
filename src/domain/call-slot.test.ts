import { describe, expect, it } from "vitest";
import { brt, WED_10H } from "@/test/time";
import { callLabel, pickCallSlot, readDayAndTime } from "./call-slot";

describe("readDayAndTime: o que o participante escreveu", () => {
  it("entende dia relativo e período do dia, sem tratar período como hora exata", () => {
    expect(readDayAndTime("Pode ser amanhã de manhã", WED_10H)).toMatchObject({ dayOffset: 1, minutes: 10 * 60, exact: false });
  });

  it("entende dia da semana e hora exata", () => {
    // Quarta → sexta = 2 dias.
    expect(readDayAndTime("Na sexta às 10h", WED_10H)).toMatchObject({ dayOffset: 2, byWeekday: true, minutes: 10 * 60, exact: true });
  });

  it("entende data e hora com minutos", () => {
    expect(readDayAndTime("dia 20 às 14:30", WED_10H)).toMatchObject({ dayOffset: 6, minutes: 14 * 60 + 30, exact: true });
  });

  it("lê horas da tarde escritas no formato de 12h", () => {
    expect(readDayAndTime("às 3 da tarde", WED_10H).minutes).toBe(15 * 60);
    expect(readDayAndTime("às 3h", WED_10H).minutes).toBe(15 * 60); // ninguém marca de madrugada
  });

  it("trata faixas ('depois das 14h') como aproximadas", () => {
    expect(readDayAndTime("depois das 14h", WED_10H)).toMatchObject({ minutes: 14 * 60 + 30, exact: false });
  });

  it("recusa datas inexistentes", () => {
    expect(readDayAndTime("pode ser 31/02?", WED_10H).dayOffset).toBeNull();
  });

  it("não inventa dia nem hora quando a mensagem não tem nenhum", () => {
    expect(readDayAndTime("Tenho interesse!", WED_10H)).toMatchObject({ dayOffset: null, minutes: null, found: [] });
  });
});

describe("pickCallSlot: horário da ligação de pré-triagem", () => {
  it("sem preferência: cerca de 2h depois, arredondado para a meia hora", () => {
    expect(pickCallSlot("Tenho interesse", WED_10H)).toEqual({ at: brt("2026-10-14", "12:00"), preference: null });
  });

  it("sem preferência no fim do expediente: dia seguinte às 10h", () => {
    expect(pickCallSlot("Tenho interesse", brt("2026-10-14", "17:00")).at).toEqual(brt("2026-10-15", "10:00"));
  });

  it("nunca agenda no fim de semana: 'amanhã' numa sexta vira segunda", () => {
    const friday = brt("2026-10-16", "10:00");
    expect(pickCallSlot("amanhã de manhã", friday)).toEqual({ at: brt("2026-10-19", "10:00"), preference: "amanhã, de manhã" });
  });

  it("limita ao horário de ligações (9h–18h)", () => {
    expect(pickCallSlot("amanhã às 20h", WED_10H).at).toEqual(brt("2026-10-15", "18:00"));
  });

  it("menos de 1h de antecedência: mesmo horário no dia seguinte", () => {
    expect(pickCallSlot("hoje às 10:30", WED_10H).at).toEqual(brt("2026-10-15", "10:30"));
  });

  it("só a hora, na remarcação: vale o dia da ligação já combinada", () => {
    const callDay = brt("2026-10-16", "10:00");
    expect(pickCallSlot("a partir das 17", WED_10H, { defaultDay: callDay }).at).toEqual(brt("2026-10-16", "17:00"));
  });
});

describe("callLabel", () => {
  it("usa 'hoje'/'amanhã' quando perto e o dia da semana quando longe", () => {
    expect(callLabel(brt("2026-10-15", "10:00"), WED_10H)).toBe("amanhã às 10:00");
    expect(callLabel(brt("2026-10-19", "10:00"), WED_10H)).toBe("na segunda-feira, 19/10, às 10:00");
  });
});
