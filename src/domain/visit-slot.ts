// Horário de visita pedido pelo participante e conferência com a agenda — regras puras.
//
// Usadas pela assistência (servidor), ao sugerir "Confirmar novo horário", e pela agenda do dia na
// conversa (navegador): as duas leem conflito do mesmo jeito e nunca divergem.

import { addDays, atLocalTime, formatDayMonth, formatTime, localHour, weekdayIndex } from "@/lib/dates";
import { readDayAndTime } from "./call-slot";
import { isWithinWindow } from "./visit-window";

/** Visitas em dias úteis, começando entre 8h e 17h (a última termina às 18h). */
export const VISIT_HOURS = { firstStart: 8, lastStart: 17 } as const;
/** Duração considerada para a visita nova ou remarcada ao checar conflitos. */
export const NEW_VISIT_MIN = 60;

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Dia e hora exatos pedidos pelo participante ("sexta às 10h", "dia 20 às 14:30"); null se faltar
 * um dos dois ou se houver mais de uma opção. Trechos negados ("não consigo amanhã", "às 10h30 não
 * dá") falam do horário que NÃO serve e são ignorados: "Não posso amanhã, pode ser sexta às 10h?" = sexta 10h.
 */
export function readRequestedVisitTime(text: string, sentAt: Date): { at: Date } | null {
  const parts = norm(text)
    .split(/[.,;!?\n]+|\bmas\b|\bou\b/)
    .filter((c) => c.trim() && !/\b(nao|nem)\b/.test(c))
    .map((c) => readDayAndTime(c, sentAt));
  const days = parts.filter((r) => r.dayOffset !== null);
  // Só hora exata conta: período ("de manhã", "boa tarde") não é pedido de horário.
  const times = parts.filter((r) => r.minutes !== null && r.exact);
  if (days.length !== 1 || times.length !== 1) return null;
  const day = days[0];
  const minutes = times[0].minutes as number;
  let at = atLocalTime(day.dayOffset as number, Math.floor(minutes / 60), minutes % 60, sentAt);
  // "sexta às 10" escrito na própria sexta, depois das 10h: a próxima sexta.
  if (day.byWeekday && at <= sentAt) at = addDays(at, 7);
  return { at };
}

/** Os dois intervalos (início + duração em minutos) se sobrepõem? */
export function overlaps(aStart: Date, aMin: number, bStart: Date, bMin: number): boolean {
  return aStart.getTime() < bStart.getTime() + bMin * 60_000 && bStart.getTime() < aStart.getTime() + aMin * 60_000;
}

export interface DayVisit {
  start: Date;
  durationMin: number;
  staffId: string | null;
  name: string;
  participantName: string;
}

export type SlotCheck = { ok: true } | { ok: false; reason: string };

/**
 * O horário serve para a visita? Pelo menos 1h à frente, em dia útil, no horário de visitas,
 * dentro da janela do Polo Trial e sem outra visita do responsável no mesmo horário.
 */
export function checkVisitSlot(
  at: Date,
  ctx: { now: Date; window: { windowStart: Date | null; windowEnd: Date | null }; ownerId: string | null; ownerName: string | null; dayVisits: DayVisit[] },
): SlotCheck {
  if (at.getTime() < ctx.now.getTime() + 60 * 60_000) return { ok: false, reason: "já passou ou é daqui a menos de 1 hora" };
  if (weekdayIndex(at) >= 5) return { ok: false, reason: "cai no fim de semana" };
  const minutes = localHour(at) * 60 + at.getUTCMinutes();
  if (minutes < VISIT_HOURS.firstStart * 60 || minutes > VISIT_HOURS.lastStart * 60) {
    return { ok: false, reason: `fora do horário de visitas (início entre ${VISIT_HOURS.firstStart}h e ${VISIT_HOURS.lastStart}h)` };
  }
  if (!isWithinWindow(at, ctx.window)) {
    const w = ctx.window;
    return { ok: false, reason: `fora da janela do Polo Trial (${w.windowStart ? formatDayMonth(w.windowStart) : "…"} a ${w.windowEnd ? formatDayMonth(w.windowEnd) : "…"})` };
  }
  const busy = ctx.dayVisits.find((v) => ctx.ownerId && v.staffId === ctx.ownerId && overlaps(at, NEW_VISIT_MIN, v.start, v.durationMin));
  if (busy) return { ok: false, reason: `${ctx.ownerName?.split(" ")[0] ?? "o responsável"} já tem ${busy.name} de ${busy.participantName} às ${formatTime(busy.start)}` };
  return { ok: true };
}
