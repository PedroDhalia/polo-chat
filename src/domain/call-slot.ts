// Dia e horário escritos pelo participante e horário da ligação de pré-triagem — regras simples, sem IA.
//
// `readDayAndTime` lê o que a pessoa escreveu ("amanhã de manhã", "sexta às 10h", "dia 20 às 14h");
// serve à ligação (aqui) e à remarcação de visita (visit-slot.ts). A ligação usa a preferência ou,
// sem preferência, o próximo horário livre. Sempre em dia útil, dentro do horário de ligações.

import { addDays, atLocalTime, diffInDays, formatDayMonth, formatTime, localHour, parseDateParam, toDateParam, weekdayIndex } from "@/lib/dates";

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

/** Dia e horário que a pessoa escreveu, sem ajustes de agenda. */
export interface DayAndTime {
  /** Dias a partir de hoje (0 = hoje); null = não disse o dia. */
  dayOffset: number | null;
  /** Dia dito pelo nome da semana ("na sexta"): se já passou hoje, vale o da semana que vem. */
  byWeekday: boolean;
  /** Minutos desde 00:00; null = não disse o horário. */
  minutes: number | null;
  /** Hora exata ("às 10", "10h", "10:30"); falso para faixas ("depois das 14h") e períodos ("de manhã"). */
  exact: boolean;
  /** O que foi entendido (ex.: "sexta-feira, as 10"). */
  found: string[];
}

/** Data dita como "16/10" ou "dia 16": a próxima ocorrência, contada a partir de hoje. */
function readDate(t: string, now: Date): { dayOffset: number; found: string } | null {
  const [year, month, today] = toDateParam(now).split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const at = (y: number, m: number, d: number) => {
    const s = `${y}-${pad(m)}-${pad(d)}`;
    const date = parseDateParam(s);
    return date && toDateParam(date) === s ? date : null; // recusa 31/02 e afins
  };
  const full = t.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (full) {
    const d = Number(full[1]);
    const m = Number(full[2]);
    const date = at(year, m, d) && diffInDays(at(year, m, d)!, now) >= 0 ? at(year, m, d) : at(year + 1, m, d);
    return date ? { dayOffset: diffInDays(date, now), found: `${pad(d)}/${pad(m)}` } : null;
  }
  const day = t.match(/\bdia\s+(\d{1,2})\b/);
  if (day) {
    const d = Number(day[1]);
    const date = d >= today ? at(year, month, d) : month === 12 ? at(year + 1, 1, d) : at(year, month + 1, d);
    return date ? { dayOffset: diffInDays(date, now), found: `dia ${d}` } : null;
  }
  return null;
}

export function readDayAndTime(text: string, now: Date = new Date()): DayAndTime {
  const t = norm(text);
  const found: string[] = [];

  // Dia pedido.
  let dayOffset: number | null = null;
  let byWeekday = false;
  const date = readDate(t, now);
  if (date) {
    dayOffset = date.dayOffset;
    found.push(date.found);
  } else if (/depois de amanha/.test(t)) {
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
      byWeekday = true;
      found.push(WEEKDAY_LABEL[i]);
    }
  }

  // Horário pedido: explícito ("às 10h", "10:30", "depois das 14h") ou período do dia.
  let minutes: number | null = null;
  let exact = false;
  // "a partir das 17", "às 15", "depois das 14h" (com preposição, o "h" é opcional) ou "10h"/"10:30".
  const m =
    t.match(/(depois das|apos as|a partir das|antes das|\bas|\bdas)\s+(\d{1,2})(?![\d/])(?:\s*(?:h|horas?)\s*(\d{2})?\b|:(\d{2}))?/) ??
    t.match(/()\b(\d{1,2})(?:\s*(?:h|horas?)\s*(\d{2})?\b|:(\d{2}))/);
  if (m) {
    let hour = Number(m[2]);
    const after = t.slice((m.index ?? 0) + m[0].length);
    if (hour < 12 && /^\s*(da tarde|da noite)/.test(after)) hour += 12; // "às 3 da tarde"
    else if (hour >= 1 && hour <= 6) hour += 12; // "às 3h" = 15h: ninguém marca de madrugada
    minutes = hour * 60 + Number(m[3] ?? m[4] ?? 0);
    exact = m[1] === "" || m[1] === "as" || m[1] === "das";
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
    minutes = 18 * 60;
    found.push("à noite");
  }
  return { dayOffset, byWeekday, minutes, exact, found };
}

/**
 * `defaultDay`: dia usado quando a pessoa só fala a hora (ex.: ao remarcar uma ligação,
 * "a partir das 17" vale para o mesmo dia da ligação combinada).
 */
export function pickCallSlot(text: string, now: Date = new Date(), opts: { defaultDay?: Date } = {}): CallSlot {
  const read = readDayAndTime(text, now);
  const found = read.found;
  let { dayOffset, minutes } = read;
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

/** "sexta-feira, 16/10, às 10:00" — sem "hoje"/"amanhã", para continuar certo quando lido depois. */
export function dayTimeLabel(at: Date): string {
  return `${WEEKDAY_LABEL[weekdayIndex(at)]}, ${formatDayMonth(at)}, às ${formatTime(at)}`;
}

/** "hoje às 15:00", "amanhã às 10:00" ou "na segunda-feira, 13/10, às 10:00". */
export function callLabel(at: Date, now: Date = new Date()): string {
  const diff = diffInDays(at, now);
  const day = diff === 0 ? "hoje" : diff === 1 ? "amanhã" : `na ${WEEKDAY_LABEL[weekdayIndex(at)]}, ${formatDayMonth(at)},`;
  return `${day} às ${formatTime(at)}`;
}
