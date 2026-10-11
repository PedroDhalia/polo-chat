import "server-only";
import type { StudyStatus } from "@prisma/client";
import { OPEN_TASK_STATUSES, PIPELINE_STATUSES } from "@/domain/labels";
import { recruitmentPace } from "@/domain/pace";
import { addDays, startOfDay } from "@/lib/dates";
import { canAccessStudy, type SessionUser } from "@/server/auth/session";
import { db } from "@/server/db";

export async function listStudies(user: SessionUser, f: { status?: StudyStatus; q?: string } = {}, now = new Date()) {
  const today = startOfDay(now);
  const studies = await db.study.findMany({
    where: {
      ...(user.studyIds ? { id: { in: user.studyIds } } : {}),
      ...(f.status ? { status: f.status } : {}),
      ...(f.q ? { OR: [{ code: { contains: f.q } }, { name: { contains: f.q } }, { sponsor: { contains: f.q } }, { indication: { contains: f.q } }] } : {}),
    },
    include: { owner: { select: { name: true } } },
    orderBy: [{ status: "asc" }, { code: "asc" }],
  });
  const ids = studies.map((s) => s.id);
  const [pipeline, visits7d, openTasks] = await Promise.all([
    db.participant.groupBy({ by: ["studyId"], where: { studyId: { in: ids }, status: { in: PIPELINE_STATUSES } }, _count: true }),
    db.visit.groupBy({ by: ["studyId"], where: { studyId: { in: ids }, scheduledAt: { gte: today, lt: addDays(today, 7) }, status: { not: "CANCELADO" } }, _count: true }),
    db.task.groupBy({ by: ["studyId"], where: { studyId: { in: ids }, status: { in: OPEN_TASK_STATUSES } }, _count: true }),
  ]);
  const count = (rows: { studyId: string | null; _count: number }[], id: string) => rows.find((r) => r.studyId === id)?._count ?? 0;
  return studies.map((s) => ({
    ...s,
    pace: recruitmentPace(s, now),
    pipeline: count(pipeline, s.id),
    visits7d: count(visits7d, s.id),
    openTasks: count(openTasks, s.id),
  }));
}

export async function getStudyByCode(user: SessionUser, code: string, now = new Date()) {
  const study = await db.study.findUnique({
    where: { code },
    include: {
      owner: { select: { name: true, jobTitle: true } },
      members: { include: { user: { select: { id: true, name: true, jobTitle: true, role: true } } } },
    },
  });
  if (!study || !canAccessStudy(user, study.id)) return null;
  const today = startOfDay(now);
  const [pipeline, openTasks, upcomingVisits, ref] = await Promise.all([
    db.participant.groupBy({ by: ["status"], where: { studyId: study.id }, _count: true }),
    db.task.findMany({
      where: { studyId: study.id, status: { in: OPEN_TASK_STATUSES } },
      include: { participant: { select: { id: true, fullName: true } }, assignee: { select: { name: true } } },
      orderBy: [{ dueAt: "asc" }],
    }),
    db.visit.findMany({
      where: { studyId: study.id, scheduledAt: { gte: today }, status: { in: ["AGUARDANDO_CONFIRMACAO", "CONFIRMADO", "REAGENDAMENTO_SOLICITADO"] } },
      include: { participant: { select: { id: true, fullName: true } } },
      orderBy: { scheduledAt: "asc" },
      take: 6,
    }),
    db.externalReference.findFirst({ where: { system: "POLO_TRIAL", entityType: "Study", entityId: study.id } }),
  ]);
  return {
    study,
    pace: recruitmentPace(study, now),
    statusCounts: Object.fromEntries(pipeline.map((p) => [p.status, p._count])) as Partial<Record<string, number>>,
    openTasks,
    upcomingVisits,
    externalId: ref?.externalId ?? null,
  };
}

export async function studyOptions(user: SessionUser) {
  const studies = await db.study.findMany({ where: user.studyIds ? { id: { in: user.studyIds } } : {}, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } });
  return studies.map((s) => ({ value: s.id, label: s.code, name: s.name }));
}
