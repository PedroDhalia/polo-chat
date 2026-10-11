const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlCompact = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("pt-BR");

export const formatBRL = (cents: number) => brl.format(cents / 100);
export const formatBRLShort = (cents: number) => brlCompact.format(cents / 100);
export const formatNumber = (n: number) => num.format(n);

export function formatPct(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits).replace(".", ",")}%`;
}

export function ratio(part: number, total: number): number {
  return total > 0 ? part / total : 0;
}

/** Mascara telefone mantendo DDD e 4 últimos dígitos: (11) 9••••-0123 */
export function maskPhone(phone: string): string {
  const m = phone.match(/^\((\d{2})\)\s*(\d)\d{3,4}-(\d{4})$/);
  if (!m) return "••••••••";
  return `(${m[1]}) ${m[2]}••••-${m[3]}`;
}

export function initials(name: string): string {
  const parts = name.replace(/^(Dra?\.)\s+/i, "").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function firstName(name: string): string {
  return name.replace(/^(Dra?\.)\s+/i, "").split(/\s+/)[0] ?? name;
}

export function pluralize(n: number, singular: string, plural: string): string {
  return `${formatNumber(n)} ${n === 1 ? singular : plural}`;
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
