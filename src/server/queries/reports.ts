import "server-only";
import type { ParticipantStatus } from "@prisma/client";
import { addDays, formatDayMonth, startOfWeek } from "@/lib/dates";
import { canAccessStudy, type SessionUser, studyScope } from "@/server/auth/session";
import { db } from "@/server/db";

function scoped(user: SessionUser, studyId?: string) {
  if (studyId) return { studyId: canAccessStudy(user, studyId) ? studyId : "__none__" };
  return studyScope(user);
}

export async function recruitmentByStudy(user: SessionUser, studyId?: string) {
  const studies = await db.study.findMany({
    where: studyId ? { id: canAccessStudy(user, studyId) ? studyId : "__none__" } : user.studyIds ? { id: { in: user.studyIds } } : {},
    orderBy: { code: "asc" },
  });
  return studies;
}

export async function participantsByStatus(user: SessionUser, studyId?: string) {
  const rows = await db.participant.groupBy({ by: ["status"], where: scoped(user, studyId), _count: true });
  return Object.fromEntries(rows.map((r) => [r.status, r._count])) as Partial<Record<ParticipantStatus, number>>;
}

/** Visitas registradas no Polo Chat por semana: realizadas × faltas. */
export async function visitsWeekly(user: SessionUser, studyId?: string, weeks = 8, now = new Date()) {
  const first = addDays(startOfWeek(now), -7 * (weeks - 1));
  const visits = await db.visit.findMany({
    where: { ...scoped(user, studyId), scheduledAt: { gte: first, lt: addDays(startOfWeek(now), 7) }, status: { in: ["REALIZADO", "FALTOU"] } },
    select: { scheduledAt: true, status: true },
  });
  return Array.from({ length: weeks }, (_, i) => {
    const start = addDays(first, i * 7);
    const end = addDays(start, 7);
    const inWeek = visits.filter((v) => v.scheduledAt >= start && v.scheduledAt < end);
    return {
      label: formatDayMonth(start),
      title: `Semana de ${formatDayMonth(start)}`,
      realized: inWeek.filter((v) => v.status === "REALIZADO").length,
      missed: inWeek.filter((v) => v.status === "FALTOU").length,
    };
  });
}

export async function reimbursementsByStatus(user: SessionUser, studyId?: string) {
  const rows = await db.reimbursement.groupBy({ by: ["status"], where: scoped(user, studyId), _sum: { amountCents: true }, _count: true });
  return rows;
}
