"use server";

import type { TaskPriority } from "@prisma/client";
import { atLocalTime, parseDateParam } from "@/lib/dates";
import { userActor } from "@/server/actor";
import { canAccessStudy, requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { completeTask, createTask, reopenTask } from "@/server/services/tasks";
import { act } from "./result";

async function authorizedTask(taskId: string) {
  const user = await requirePermission("tasks.manage");
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || !canAccessStudy(user, task.studyId)) throw new DomainError("Pendência não encontrada.");
  return { user, task };
}

export async function completeTaskAction(taskId: string) {
  return act(async () => {
    const { user, task } = await authorizedTask(taskId);
    await completeTask(taskId, userActor(user));
    return { message: `Pendência concluída: ${task.title}` };
  });
}

export async function reopenTaskAction(taskId: string) {
  return act(async () => {
    const { user, task } = await authorizedTask(taskId);
    await reopenTask(taskId, userActor(user));
    return { message: `Pendência reaberta: ${task.title}` };
  });
}

export async function createTaskAction(input: { title: string; priority: TaskPriority; dueDate: string; studyId: string; participantId?: string; assigneeId: string; description?: string }) {
  return act(async () => {
    const user = await requirePermission("tasks.manage");
    const title = input.title.trim();
    if (title.length < 4) throw new DomainError("Descreva a pendência com pelo menos 4 caracteres.");
    if (!canAccessStudy(user, input.studyId)) throw new DomainError("Estudo não acessível.");
    const day = parseDateParam(input.dueDate);
    if (!day) throw new DomainError("Informe um prazo válido.");
    const dueAt = atLocalTime(0, 18, 0, day);
    let participantId: string | null = null;
    if (input.participantId) {
      const p = await db.participant.findUnique({ where: { id: input.participantId } });
      if (!p || p.studyId !== input.studyId) throw new DomainError("Participante não pertence ao estudo selecionado.");
      participantId = p.id;
    }
    await createTask(
      { title, description: input.description?.trim() || null, priority: input.priority, dueAt, studyId: input.studyId, participantId, assigneeId: input.assigneeId, source: "MANUAL" },
      userActor(user),
    );
    return { message: "Pendência criada" };
  });
}
