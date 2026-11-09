// Janela de visita informada pelo Polo Trial — o Polo Chat não calcula, só lê.
//
// A janela do protocolo é contada em dias, com as duas pontas incluídas: "janela até 20/10"
// permite a visita em qualquer horário do dia 20. Por isso a hora gravada nas pontas não conta.

import { addDays, startOfDay } from "@/lib/dates";

type VisitWindow = { windowStart: Date | null; windowEnd: Date | null };

/** Primeiro instante em que a janela abre: 00:00 do primeiro dia. */
export function windowOpensAt(windowStart: Date): Date {
  return startOfDay(windowStart);
}

/** Instante em que a janela fecha: 00:00 do dia seguinte ao último dia. */
export function windowClosesAt(windowEnd: Date): Date {
  return addDays(startOfDay(windowEnd), 1);
}

/** A data cabe na janela (sem janela informada, qualquer data cabe). */
export function isWithinWindow(when: Date, w: VisitWindow): boolean {
  return (!w.windowStart || when >= windowOpensAt(w.windowStart)) && (!w.windowEnd || when < windowClosesAt(w.windowEnd));
}

/** O último dia da janela já passou. */
export function isWindowClosed(w: VisitWindow, now: Date = new Date()): boolean {
  return !!w.windowEnd && windowClosesAt(w.windowEnd) <= now;
}
