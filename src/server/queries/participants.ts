import "server-only";
import type { ParticipantStatus, Prisma, RecruitmentChannel } from "@prisma/client";
import { OPEN_TASK_STATUSES } from "@/domain/labels";
import { addDays, startOfDay } from "@/lib/dates";
import { canAccessStudy, type SessionUser, studyScope } from "@/server/auth/session";
import { db } from "@/server/db";

export const PAGE_SIZE = 25;

export interface ParticipantFilters {
  q?: string;
  studyId?: string;
  status?: ParticipantStatus;
  channel?: RecruitmentChannel;
  ownerId?: string;
  /** "hoje" = próxima ação vencendo até o fim do dia. */
  acao?: string;
  page?: number;
}

const ACTIVE_VISIT = ["AGUARDANDO_CONFIRMACAO", "CONFIRMADO", "REAGENDAMENTO_SOLICITADO"] as const;

export async function listParticipants(user: SessionUser, f: ParticipantFilters, now = new Date()) {
  const where: Prisma.ParticipantWhereInput = { ...studyScope(user) };
  if (f.studyId) where.studyId = canAccessStudy(user, f.studyId) ? f.studyId : "__none__";
  if (f.status) where.status = f.status;
  if (f.channel) where.channel = f.channel;
  if (f.ownerId) where.ownerId = f.ownerId;
  if (f.q) where.OR = [{ fullName: { contains: f.q } }, { code: { contains: f.q.toUpperCase() } }];
  if (f.acao === "hoje") {
    where.nextActionDueAt = { lt: addDays(startOfDay(now), 1) };
    where.status = { in: ["NOVO", "EM_CONTATO", "PRE_TRIAGEM", "AGUARDANDO_AGENDAMENTO"] };
  }
  const page = Math.max(1, f.page ?? 1);
  const [total, rows] = await Promise.all([
    db.participant.count({ where }),
    db.participant.findMany({
      where,
      include: {
        study: { select: { code: true } },
        owner: { select: { name: true } },
        visits: { where: { scheduledAt: { gte: startOfDay(now) }, status: { in: [...ACTIVE_VISIT] } }, orderBy: { scheduledAt: "asc" }, take: 1 },
      },
      orderBy: [{ nextActionDueAt: { sort: "asc", nulls: "last" } }, { fullName: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export type ParticipantRow = Awaited<ReturnType<typeof listParticipants>>["rows"][number];

export async function getParticipantDetail(user: SessionUser, id: string) {
  const p = await db.participant.findUnique({
    where: { id },
    include: {
      study: { select: { id: true, code: true, name: true } },
      owner: { select: { id: true, name: true, jobTitle: true } },
      recruitment: { include: { stage: true } },
      consents: { orderBy: { recordedAt: "desc" } },
      visits: { orderBy: { scheduledAt: "asc" }, include: { staff: { select: { name: true } } } },
      tasks: { where: { status: { in: OPEN_TASK_STATUSES } }, include: { assignee: { select: { name: true } } }, orderBy: { dueAt: "asc" } },
      timeline: { orderBy: { occurredAt: "desc" }, include: { actor: { select: { name: true } } } },
      conversations: { select: { id: true, status: true } },
      reimbursements: { orderBy: { requestedAt: "desc" }, include: { visit: { select: { name: true } } } },
    },
  });
  if (!p || !canAccessStudy(user, p.studyId)) return null;
  const externalRefs = await db.externalReference.findMany({ where: { entityType: "Participant", entityId: p.id } });
  return { ...p, externalRefs };
}

export async function ownerOptions(user: SessionUser) {
  const users = await db.user.findMany({
    where: { role: { in: ["ASSISTENTE", "COORDENADOR"] }, ...(user.studyIds ? { memberships: { some: { studyId: { in: user.studyIds } } } } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return users.map((u) => ({ value: u.id, label: u.name }));
}
