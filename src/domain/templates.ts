// Renderização de modelos de mensagem aprovados.
// O texto do modelo é fixo (aprovado pelo CEP); apenas variáveis operacionais são preenchidas.

import { diffInDays, formatDayMonth, formatTime } from "@/lib/dates";
import { firstName } from "@/lib/format";

export const TEMPLATE_VARIABLES: Record<string, string> = {
  nome: "Primeiro nome do participante",
  estudo: "Código do estudo",
  data: "Data da visita (hoje, amanhã ou dia dd/mm)",
  hora: "Horário da visita",
  ligacao: "Dia e horário da ligação combinada (preenchido pela automação ao agendar a ligação)",
  nova_data: "Dia da nova data proposta na remarcação (preenchido pelo sistema)",
  nova_hora: "Horário da nova data proposta na remarcação (preenchido pelo sistema)",
};

/** Variáveis que só o sistema conhece (horário combinado, data proposta): modelos com elas não são escolhidos à mão. */
const SYSTEM_VARIABLES = ["ligacao", "nova_data", "nova_hora"];

export function systemVariablesIn(body: string): string[] {
  return SYSTEM_VARIABLES.filter((v) => body.includes(`{{${v}}}`));
}

export function renderTemplate(body: string, vars: Record<string, string | undefined>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? match);
}

/** "hoje", "amanhã" ou "dia 10/10". */
export function visitDateLabel(scheduledAt: Date, now: Date = new Date()): string {
  const diff = diffInDays(scheduledAt, now);
  if (diff === 0) return "hoje";
  if (diff === 1) return "amanhã";
  return `dia ${formatDayMonth(scheduledAt)}`;
}

export function buildTemplateVars(input: {
  participantName: string;
  studyCode: string;
  visitAt?: Date | null;
  now?: Date;
}): Record<string, string> {
  const vars: Record<string, string> = { nome: firstName(input.participantName), estudo: input.studyCode };
  if (input.visitAt) {
    vars.data = visitDateLabel(input.visitAt, input.now);
    vars.hora = formatTime(input.visitAt);
  }
  return vars;
}

export function templateUsesVisit(body: string): boolean {
  return /\{\{(data|hora)\}\}/.test(body);
}

/** Texto livre (escrito pela equipe, fora dos modelos aprovados): limite de tamanho. */
export const FREE_TEXT_MAX = 1000;

/** No WhatsApp Business, texto fora de modelo só é aceito até 24h após a última mensagem do participante. */
export const SERVICE_WINDOW_HOURS = 24;
