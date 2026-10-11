// Horário da ligação de pré-triagem combinado pelo WhatsApp — regras simples, sem IA.
//
// Usa a preferência que o candidato escreveu ("amanhã de manhã", "depois das 14h", "na sexta")
// e, sem preferência, o próximo horário livre. Sempre em dia útil, dentro do horário de ligações.

import { addDays, atLocalTime, diffInDays, formatDayMonth, formatTime, localHour, weekdayIndex } from "@/lib/dates";

/** Horário em que a equipe liga para candidatos (dias úteis). */
export const CALL_HOURS = { start: 9, end: 18 } as const;

const WEEKDAYS = ["segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo"];
const WEEKDAY_LABEL = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo"];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export interface CallSlot {
  at: Date;
  /** O que foi entendido da mensagem (ex.: "amanhã, de manhã"); null = sem preferência. */
  preference: string | null;
}

/**
 * `defaultDay`: dia usado quando a pessoa só fala a hora (ex.: ao remarcar uma ligação,
 * "a partir das 17" vale para o mesmo dia da ligação combinada).
 */
export function pickCallSlot(text: string, now: Date = new Date(), opts: { defaultDay?: Date } = {}): CallSlot {
  const t = norm(text);
  const found: string[] = [];

  // Dia pedido.
  let dayOffset: number | null = null;
  if (/depois de amanha/.test(t)) {
    dayOffset = 2;
    found.push("depois de amanhã");
  } else if (/\bamanha\b/.test(t)) {
    dayOffset = 1;
    found.push("amanhã");
  } else if (/\bhoje\b/.test(t)) {
    dayOffset = 0;
    found.push("hoje");
  } else {
    const i = WEEKDAYS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(t));
    if (i >= 0) {
      dayOffset = (i - weekdayIndex(now) + 7) % 7;
      found.push(WEEKDAY_LABEL[i]);
    }
  }

  // Horário pedido: explícito ("às 10h", "10:30", "depois das 14h") ou período do dia.
  let minutes: number | null = null;
  // "a partir das 17", "às 15", "depois das 14h" (com preposição, o "h" é opcional) ou "10h"/"10:30".
  const m =
    t.match(/(depois das|apos as|a partir das|antes das|\bas|\bdas)\s+(\d{1,2})(?![\d/])(?:\s*(?:h|horas?)\b\s*(\d{2})?|:(\d{2}))?/) ??
    t.match(/()\b(\d{1,2})(?:\s*(?:h|horas?)\b\s*(\d{2})?|:(\d{2}))/);
  if (m) {
    let hour = Number(m[2]);
    if (hour >= 1 && hour <= 6) hour += 12; // "às 3h" = 15h: ninguém pede ligação de madrugada
    minutes = hour * 60 + Number(m[3] ?? m[4] ?? 0);
    if (m[1] === "depois das" || m[1] === "apos as") minutes += 30;
    if (m[1] === "antes das") minutes -= 60;
    found.push(m[0].trim());
  } else if (/(fim|final) da tarde/.test(t)) {
    minutes = 17 * 60;
    found.push("fim da tarde");
  } else if (/depois do almoco/.test(t)) {
    minutes = 14 * 60;
    found.push("depois do almoço");
  } else if (/\bmanha\b|\bcedo\b/.test(t)) {
    minutes = 10 * 60;
    found.push("de manhã");
  } else if (/\btarde\b/.test(t)) {
    minutes = 15 * 60;
    found.push("à tarde");
  } else if (/\bnoite\b/.test(t)) {
    minutes = CALL_HOURS.end * 60; // último horário de ligações
    found.push("à noite");
  }
  if (minutes !== null) minutes = Math.min(CALL_HOURS.end * 60, Math.max(CALL_HOURS.start * 60, minutes));
  if (dayOffset === null && minutes !== null && opts.defaultDay) dayOffset = Math.max(0, diffInDays(opts.defaultDay, now));

  const nowMinutes = localHour(now) * 60 + now.getUTCMinutes();
  const lead = now.getTime() + 60 * 60_000; // pelo menos 1h para a equipe se organizar
  let at: Date;
  if (dayOffset === null && minutes === null) {
    // Sem preferência: daqui a ~2h (arredondado para a meia hora), dentro do horário de ligações.
    const next = Math.ceil((nowMinutes + 120) / 30) * 30;
    at =
      next < CALL_HOURS.start * 60
        ? atLocalTime(0, 10, 0, now)
        : next > CALL_HOURS.end * 60
          ? atLocalTime(1, 10, 0, now)
          : atLocalTime(0, Math.floor(next / 60), next % 60, now);
  } else {
    const mins = minutes ?? 10 * 60;
    at = atLocalTime(dayOffset ?? 0, Math.floor(mins / 60), mins % 60, now);
    if (at.getTime() < lead) at = addDays(at, dayOffset === null || dayOffset === 0 ? 1 : 7);
  }
  while (weekdayIndex(at) >= 5) at = addDays(at, 1); // fim de semana → segunda, mesmo horário

  return { at, preference: found.length ? found.join(", ") : null };
}

/** "hoje às 15:00", "amanhã às 10:00" ou "na segunda-feira, 13/10, às 10:00". */
export function callLabel(at: Date, now: Date = new Date()): string {
  const diff = diffInDays(at, now);
  const day = diff === 0 ? "hoje" : diff === 1 ? "amanhã" : `na ${WEEKDAY_LABEL[weekdayIndex(at)]}, ${formatDayMonth(at)},`;
  return `${day} às ${formatTime(at)}`;
}
