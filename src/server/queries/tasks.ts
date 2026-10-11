import "server-only";
import type { Prisma } from "@prisma/client";
import { OPEN_TASK_STATUSES, PIPELINE_STATUSES, PRIORITY_ORDER } from "@/domain/labels";
import { addDays, startOfDay } from "@/lib/dates";
import { canAccessStudy, type SessionUser } from "@/server/auth/session";
import { db } from "@/server/db";

export type TaskFilter = "todas" | "minhas" | "atrasadas" | "hoje" | "alta";

function scopeWhere(user: SessionUser): Prisma.TaskWhereInput {
  return user.studyIds ? { OR: [{ studyId: null }, { studyId: { in: user.studyIds } }] } : {};
}

export async function listTasks(user: SessionUser, f: { filter: TaskFilter; studyId?: string; done?: boolean; q?: string }, now = new Date()) {
  const today = startOfDay(now);
  const where: Prisma.TaskWhereInput = { AND: [scopeWhere(user)] };
  const and = where.AND as Prisma.TaskWhereInput[];
  and.push({ status: f.done ? "CONCLUIDA" : { in: OPEN_TASK_STATUSES } });
  if (f.studyId) and.push({ studyId: canAccessStudy(user, f.studyId) ? f.studyId : "__none__" });
  if (f.q) and.push({ OR: [{ title: { contains: f.q } }, { participant: { fullName: { contains: f.q } } }] });
  if (f.filter === "minhas") and.push({ assigneeId: user.id });
  if (f.filter === "atrasadas") and.push({ dueAt: { lt: now } });
  if (f.filter === "hoje") and.push({ dueAt: { gte: today, lt: addDays(today, 1) } });
  if (f.filter === "alta") and.push({ priority: "ALTA" });

  const tasks = await db.task.findMany({
    where,
    include: {
      participant: { select: { id: true, fullName: true } },
      study: { select: { code: true } },
      assignee: { select: { id: true, name: true } },
      completedBy: { select: { name: true } },
    },
    orderBy: f.done ? [{ completedAt: "desc" }] : [{ dueAt: "asc" }],
    take: f.done ? 50 : undefined,
  });
  if (f.done) return tasks;
  // Faixas de prazo (atrasadas → hoje → amanhã → depois) e, dentro de cada faixa, prioridade.
  const band = (d: Date) => (d < now ? 0 : d < addDays(today, 1) ? 1 : d < addDays(today, 2) ? 2 : 3);
  return tasks.sort((a, b) => band(a.dueAt) - band(b.dueAt) || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.dueAt.getTime() - b.dueAt.getTime());
}

export type TaskRow = Awaited<ReturnType<typeof listTasks>>[number];

export async function taskSummary(user: SessionUser, now = new Date()) {
  const today = startOfDay(now);
  const base: Prisma.TaskWhereInput = { AND: [scopeWhere(user), { status: { in: OPEN_TASK_STATUSES } }] };
  const and = (extra: Prisma.TaskWhereInput): Prisma.TaskWhereInput => ({ AND: [base, extra] });
  const [open, mine, overdue, dueToday, high, done7d] = await Promise.all([
    db.task.count({ where: base }),
    db.task.count({ where: and({ assigneeId: user.id }) }),
    db.task.count({ where: and({ dueAt: { lt: now } }) }),
    db.task.count({ where: and({ dueAt: { gte: today, lt: addDays(today, 1) } }) }),
    db.task.count({ where: and({ priority: "ALTA" }) }),
    db.task.count({ where: { AND: [scopeWhere(user), { status: "CONCLUIDA", completedAt: { gte: addDays(now, -7) } }] } }),
  ]);
  return { open, mine, overdue, dueToday, high, done7d };
}

/** Opções para o formulário de nova pendência. */
export async function taskFormOptions(user: SessionUser) {
  const [studies, users, participants] = await Promise.all([
    db.study.findMany({ where: user.studyIds ? { id: { in: user.studyIds } } : {}, select: { id: true, code: true }, orderBy: { code: "asc" } }),
    db.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.participant.findMany({
      where: { ...(user.studyIds ? { studyId: { in: user.studyIds } } : {}), status: { in: [...PIPELINE_STATUSES, "INCLUIDO"] } },
      select: { id: true, fullName: true, studyId: true },
      orderBy: { fullName: "asc" },
    }),
  ]);
  return { studies, users, participants };
}
