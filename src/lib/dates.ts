// Datas sempre interpretadas no fuso do centro (America/Sao_Paulo, UTC-3, sem horário de verão).
// Assim a renderização é idêntica no servidor e no navegador, independente do fuso da máquina.

export const TIME_ZONE = "America/Sao_Paulo";
const OFFSET_HOURS = -3;
const HOUR = 3_600_000;
export const DAY = 86_400_000;

/** Instante UTC correspondente a 00:00 (horário de Brasília) do dia de `d`. */
export function startOfDay(d: Date = new Date()): Date {
  const local = new Date(d.getTime() + OFFSET_HOURS * HOUR);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - OFFSET_HOURS * HOUR);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY);
}

export function addHours(d: Date, hours: number): Date {
  return new Date(d.getTime() + hours * HOUR);
}

/** Hora local (0–23) no fuso do centro. */
export function localHour(d: Date = new Date()): number {
  return (d.getUTCHours() + 24 + OFFSET_HOURS) % 24;
}

/** `dayOffset` dias a partir de hoje, no horário local hh:mm. */
export function atLocalTime(dayOffset: number, hour: number, minute = 0, base: Date = new Date()): Date {
  return new Date(addDays(startOfDay(base), dayOffset).getTime() + hour * HOUR + minute * 60_000);
}

/** Segunda-feira 00:00 da semana de `d`. */
export function startOfWeek(d: Date = new Date()): Date {
  const day = startOfDay(d);
  const weekday = weekdayIndex(day); // 0 = segunda
  return addDays(day, -weekday);
}

export function startOfMonth(d: Date = new Date()): Date {
  const local = new Date(d.getTime() + OFFSET_HOURS * HOUR);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - OFFSET_HOURS * HOUR);
}

/** 0 = segunda … 6 = domingo, no fuso local. */
export function weekdayIndex(d: Date): number {
  const local = new Date(d.getTime() + OFFSET_HOURS * HOUR);
  return (local.getUTCDay() + 6) % 7;
}

export function diffInDays(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / DAY);
}

export function isSameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

/** Converte "AAAA-MM-DD" (parâmetro de URL) para 00:00 local. */
export function parseDateParam(value: string | undefined | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - OFFSET_HOURS * HOUR);
}

/** `date` = AAAA-MM-DD e `time` = HH:MM no horário do centro; null se inválido. */
export function parseLocalDateTime(date: string, time: string): Date | null {
  const day = parseDateParam(date);
  const m = time.match(/^(\d{2}):(\d{2})$/);
  if (!day || !m) return null;
  return new Date(day.getTime() + (Number(m[1]) * 60 + Number(m[2])) * 60_000);
}

export function toDateParam(d: Date): string {
  const local = new Date(d.getTime() + OFFSET_HOURS * HOUR);
  return local.toISOString().slice(0, 10);
}

// ─── Formatação ──────────────────────────────────────────────────────────

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, ...opts });

const fDayMonth = fmt({ day: "2-digit", month: "2-digit" });
const fDate = fmt({ day: "2-digit", month: "2-digit", year: "numeric" });
const fTime = fmt({ hour: "2-digit", minute: "2-digit" });
const fWeekdayShort = fmt({ weekday: "short" });
const fWeekdayLong = fmt({ weekday: "long" });
const fLongDate = fmt({ day: "numeric", month: "long" });
const fMonthYear = fmt({ month: "short", year: "2-digit" });
const fMonthLong = fmt({ month: "long", year: "numeric" });

const clean = (s: string) => s.replace(".", "");

export const formatDayMonth = (d: Date) => fDayMonth.format(d);
export const formatDate = (d: Date) => fDate.format(d);
export const formatTime = (d: Date) => fTime.format(d);
export const formatDateTime = (d: Date) => `${fDayMonth.format(d)} ${fTime.format(d)}`;
export const formatWeekdayShort = (d: Date) => clean(fWeekdayShort.format(d));
export const formatMonthYear = (d: Date) => clean(fMonthYear.format(d));
export const formatMonthLong = (d: Date) => fMonthLong.format(d);

/** "quinta-feira, 8 de outubro" */
export function formatLongDate(d: Date): string {
  return `${fWeekdayLong.format(d)}, ${fLongDate.format(d)}`;
}

/** "Hoje", "Amanhã", "Ontem" ou "qui, 10/10". */
export function formatRelativeDay(d: Date, now: Date = new Date()): string {
  const diff = diffInDays(d, now);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Amanhã";
  if (diff === -1) return "Ontem";
  return `${formatWeekdayShort(d)}, ${formatDayMonth(d)}`;
}

/** "Hoje 09:00", "Amanhã 14:30", "qui, 10/10 08:00" */
export function formatRelativeDateTime(d: Date, now: Date = new Date()): string {
  return `${formatRelativeDay(d, now)} ${formatTime(d)}`;
}

/** "há 5 min", "há 3 h", "há 2 dias", "em 4 dias". */
export function formatAgo(d: Date, now: Date = new Date()): string {
  const ms = now.getTime() - d.getTime();
  const future = ms < 0;
  const abs = Math.abs(ms);
  const min = Math.round(abs / 60_000);
  let label: string;
  if (min < 1) return "agora";
  if (min < 60) label = `${min} min`;
  else if (min < 60 * 24) label = `${Math.round(min / 60)} h`;
  else {
    const days = Math.round(min / (60 * 24));
    label = days === 1 ? "1 dia" : `${days} dias`;
  }
  return future ? `em ${label}` : `há ${label}`;
}
