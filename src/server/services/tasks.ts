import "server-only";
import type { TaskPriority, TaskSource } from "@prisma/client";
import { OPEN_TASK_STATUSES } from "@/domain/labels";
import { actorSource, type Actor } from "@/server/actor";
import type { AutomationRuleKey } from "@/server/automations/rules";
import { db } from "@/server/db";
import { addTimelineEvent, notifyUser, recordAudit } from "./audit";

export async function createTask(
  input: {
    title: string;
    description?: string | null;
    priority: TaskPriority;
    dueAt: Date;
    studyId?: string | null;
    participantId?: string | null;
    visitId?: string | null;
    assigneeId?: string | null;
    source: TaskSource;
    automationKey?: AutomationRuleKey | null;
  },
  actor: Actor,
) {
  const task = await db.task.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      priority: input.priority,
      status: "ABERTA",
      dueAt: input.dueAt,
      studyId: input.studyId ?? null,
      participantId: input.participantId ?? null,
      visitId: input.visitId ?? null,
      assigneeId: input.assigneeId ?? null,
      createdById: actor.type === "USER" ? actor.user.id : null,
      source: input.source,
      automationKey: input.automationKey ?? null,
    },
  });
  if (input.participantId && input.studyId) {
    await addTimelineEvent({
      participantId: input.participantId,
      studyId: input.studyId,
      type: "TASK_CREATED",
      title: `Pendência criada: ${input.title}`,
      source: actorSource(actor),
      actor,
    });
  }
  await recordAudit({ actor, action: "task.created", entityType: "Task", entityId: task.id, studyId: input.studyId, summary: `Pendência criada: ${input.title}` });
  if (input.assigneeId && !(actor.type === "USER" && actor.user.id === input.assigneeId)) {
    await notifyUser(input.assigneeId, { type: "TASK", title: `Nova pendência: ${input.title}`, href: "/pendencias" });
  }
  return task;
}

export async function completeTask(taskId: string, actor: Actor, note?: string) {
  const task = await db.task.update({
    where: { id: taskId },
    data: { status: "CONCLUIDA", completedAt: new Date(), completedById: actor.type === "USER" ? actor.user.id : null },
  });
  if (task.participantId && task.studyId) {
    await addTimelineEvent({
      participantId: task.participantId,
      studyId: task.studyId,
      type: "TASK_COMPLETED",
      title: `Pendência concluída: ${task.title}`,
      description: note ?? null,
      source: actorSource(actor),
      actor,
    });
  }
  await recordAudit({ actor, action: "task.completed", entityType: "Task", entityId: task.id, studyId: task.studyId, summary: `Pendência concluída: ${task.title}${note ? ` — ${note}` : ""}` });
  return task;
}

export async function reopenTask(taskId: string, actor: Actor) {
  const task = await db.task.update({ where: { id: taskId }, data: { status: "ABERTA", completedAt: null, completedById: null } });
  await recordAudit({ actor, action: "task.reopened", entityType: "Task", entityId: task.id, studyId: task.studyId, summary: `Pendência reaberta: ${task.title}` });
  return task;
}

export async function findOpenTasks(where: { visitId?: string; participantId?: string; automationKey?: string }) {
  return db.task.findMany({ where: { ...where, status: { in: OPEN_TASK_STATUSES } } });
}

/** Encerra pendências abertas que perderam o motivo de existir (ex.: visita confirmada). */
export async function closeTasks(tasks: { id: string }[], actor: Actor, note: string) {
  for (const t of tasks) await completeTask(t.id, actor, note);
  return tasks.length;
}
