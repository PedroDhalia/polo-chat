// Ritmo de recrutamento: compara incluídos (dado do Polo Trial) com o plano operacional
// linear da coordenação (início → fim do recrutamento). Não envolve regra protocolar.

import type { StudyStatus } from "@prisma/client";
import { DAY } from "@/lib/dates";

export type PaceStatus = "abaixo" | "no_ritmo" | "acima";

export interface Pace {
  expected: number;
  ratio: number;
  status: PaceStatus;
  gap: number;
  weeksLeft: number;
  neededPerWeek: number;
}

export const PACE_LABEL: Record<PaceStatus, { label: string; tone: "red" | "green" | "brand" }> = {
  abaixo: { label: "Abaixo do ritmo", tone: "red" },
  no_ritmo: { label: "No ritmo", tone: "brand" },
  acima: { label: "Acima do ritmo", tone: "green" },
};

export function recruitmentPace(
  s: { status: StudyStatus; enrolledCount: number; targetEnrollment: number; startDate: Date; recruitmentEndDate: Date | null },
  now: Date = new Date(),
): Pace | null {
  if (s.status !== "RECRUTAMENTO_ATIVO" || !s.recruitmentEndDate) return null;
  const total = s.recruitmentEndDate.getTime() - s.startDate.getTime();
  if (total <= 0) return null;
  const elapsed = Math.min(Math.max(now.getTime() - s.startDate.getTime(), 0), total);
  const expected = Math.round((s.targetEnrollment * elapsed) / total);
  const ratio = expected > 0 ? s.enrolledCount / expected : 1;
  const weeksLeft = Math.max(1, (s.recruitmentEndDate.getTime() - now.getTime()) / (7 * DAY));
  return {
    expected,
    ratio,
    status: ratio < 0.92 ? "abaixo" : ratio > 1.08 ? "acima" : "no_ritmo",
    gap: s.enrolledCount - expected,
    weeksLeft: Math.round(weeksLeft),
    neededPerWeek: Math.max(0, Math.ceil((s.targetEnrollment - s.enrolledCount) / weeksLeft)),
  };
}
