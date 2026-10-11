import "server-only";
import type { Prisma, VisitStatus } from "@prisma/client";
import { OPEN_TASK_STATUSES } from "@/domain/labels";
import { addDays, formatTime, formatWeekdayShort, startOfDay } from "@/lib/dates";
import { canAccessStudy, type SessionUser, studyScope } from "@/server/auth/session";
import { db } from "@/server/db";

export interface AgendaFilters {
  studyId?: string;
  status?: VisitStatus;
  staffId?: string;
}

export async function getVisitsInRange(user: SessionUser, from: Date, to: Date, f: AgendaFilters = {}) {
  const where: Prisma.VisitWhereInput = { ...studyScope(user), scheduledAt: { gte: from, lt: to } };
  if (f.studyId) where.studyId = canAccessStudy(user, f.studyId) ? f.studyId : "__none__";
  if (f.status) where.status = f.status;
  if (f.staffId) where.staffId = f.staffId;
  return db.visit.findMany({
    where,
    include: {
      participant: { select: { id: true, fullName: true, code: true } },
      study: { select: { code: true } },
      staff: { select: { name: true } },
    },
    orderBy: { scheduledAt: "asc" },
  });
}

export type AgendaVisit = Awaited<ReturnType<typeof getVisitsInRange>>[number];

export interface AgendaAlert {
  id: string;
  tone: "red" | "amber" | "violet";
  text: string;
  href: string;
}

export async function getAgendaAlerts(user: SessionUser, now = new Date()): Promise<AgendaAlert[]> {
  const scope = studyScope(user);
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const [awaiting, missed, reschedule] = await Promise.all([
    db.visit.findMany({ where: { ...scope, status: "AGUARDANDO_CONFIRMACAO", scheduledAt: { gte: tomorrow, lt: addDays(tomorrow, 1) } }, include: { participant: true }, orderBy: { scheduledAt: "asc" } }),
    db.visit.findMany({
      where: { ...scope, status: "FALTOU", scheduledAt: { gte: addDays(today, -3) }, tasks: { some: { status: { in: OPEN_TASK_STATUSES } } } },
      include: { participant: true },
      orderBy: { scheduledAt: "desc" },
    }),
    db.visit.findMany({ where: { ...scope, status: "REAGENDAMENTO_SOLICITADO" }, include: { participant: true }, orderBy: { scheduledAt: "asc" } }),
  ]);
  return [
    ...missed.map((v) => ({ id: `m-${v.id}`, tone: "red" as const, text: `${v.participant.fullName} faltou à visita ${v.name}. Necessário contato.`, href: `/participantes/${v.participantId}` })),
    ...awaiting.map((v) => ({ id: `a-${v.id}`, tone: "amber" as const, text: `${v.participant.fullName} ainda não confirmou a visita de amanhã (${formatTime(v.scheduledAt)}).`, href: `/participantes/${v.participantId}` })),
    ...reschedule.map((v) => ({
      id: `r-${v.id}`,
      tone: "violet" as const,
      text: `${v.participant.fullName} pediu remarcação: ${v.name} (${formatWeekdayShort(v.scheduledAt)} ${formatTime(v.scheduledAt)}).`,
      href: `/participantes/${v.participantId}`,
    })),
  ];
}

export async function staffOptions(user: SessionUser) {
  const users = await db.user.findMany({
    where: { visits: { some: user.studyIds ? { studyId: { in: user.studyIds } } : {} } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return users.map((u) => ({ value: u.id, label: u.name }));
}
