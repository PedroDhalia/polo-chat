import { describe, expect, it } from "vitest";
import { brt } from "@/test/time";
import { isWindowClosed, isWithinWindow } from "./visit-window";

// Janela informada pelo Polo Trial: 14/10 a 20/10. As horas gravadas nas pontas não importam.
const window = { windowStart: brt("2026-10-14", "15:00"), windowEnd: brt("2026-10-20", "09:00") };

describe("isWithinWindow", () => {
  it("inclui o primeiro e o último dia inteiros", () => {
    expect(isWithinWindow(brt("2026-10-14", "08:00"), window)).toBe(true);
    expect(isWithinWindow(brt("2026-10-20", "17:00"), window)).toBe(true);
  });

  it("recusa o dia anterior e o seguinte", () => {
    expect(isWithinWindow(brt("2026-10-13", "23:59"), window)).toBe(false);
    expect(isWithinWindow(brt("2026-10-21", "00:00"), window)).toBe(false);
  });

  it("sem janela informada, qualquer data cabe", () => {
    expect(isWithinWindow(brt("2030-01-01"), { windowStart: null, windowEnd: null })).toBe(true);
  });
});

describe("isWindowClosed", () => {
  it("só fecha depois do fim do último dia", () => {
    expect(isWindowClosed(window, brt("2026-10-20", "23:00"))).toBe(false);
    expect(isWindowClosed(window, brt("2026-10-21", "00:00"))).toBe(true);
  });

  it("sem fim informado, nunca fecha", () => {
    expect(isWindowClosed({ windowStart: null, windowEnd: null }, brt("2030-01-01"))).toBe(false);
  });
});
