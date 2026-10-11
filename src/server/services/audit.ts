import "server-only";
import type { Prisma, TimelineEventType } from "@prisma/client";
import { actorFields, type Actor } from "@/server/actor";
import { db } from "@/server/db";

/** Registra uma ação relevante na trilha de auditoria. */
export async function recordAudit(entry: {
  actor: Actor;
  action: string;
  entityType: string;
  entityId?: string | null;
  studyId?: string | null;
  summary: string;
  metadata?: Prisma.InputJsonValue;
}) {
  const { actorType, actorId, actorLabel } = actorFields(entry.actor);
  await db.auditLog.create({
    data: {
      actorType,
      actorId,
      actorLabel,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      studyId: entry.studyId ?? null,
      summary: entry.summary,
      metadata: entry.metadata,
    },
  });
}

/** Adiciona um evento à linha do tempo operacional do participante. */
export async function addTimelineEvent(input: {
  participantId: string;
  studyId: string;
  type: TimelineEventType;
  title: string;
  description?: string | null;
  source?: string | null;
  actor: Actor;
  occurredAt?: Date;
}) {
  const { actorType, actorId } = actorFields(input.actor);
  await db.timelineEvent.create({
    data: {
      participantId: input.participantId,
      studyId: input.studyId,
      type: input.type,
      title: input.title,
      description: input.description ?? null,
      source: input.source ?? null,
      actorType,
      actorId,
      occurredAt: input.occurredAt ?? new Date(),
    },
  });
}

export async function notifyUser(userId: string | null | undefined, n: { type: Prisma.NotificationCreateInput["type"]; title: string; body?: string; href?: string }) {
  if (!userId) return;
  await db.notification.create({ data: { userId, type: n.type, title: n.title, body: n.body ?? null, href: n.href ?? null } });
}
