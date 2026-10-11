import "server-only";
import { OPEN_TASK_STATUSES } from "@/domain/labels";
import { type SessionUser, studyScope } from "@/server/auth/session";
import { db } from "@/server/db";

export async function getShellData(user: SessionUser) {
  const scope = studyScope(user);
  const [users, myOpenTasks, attentionConversations, notifications, unreadNotifications] = await Promise.all([
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true, jobTitle: true } }),
    db.task.count({ where: { assigneeId: user.id, status: { in: OPEN_TASK_STATUSES } } }),
    db.conversation.count({ where: { ...scope, OR: [{ status: "REQUER_ATENCAO" }, { unreadCount: { gt: 0 } }] } }),
    db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 8 }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return { users, myOpenTasks, attentionConversations, notifications, unreadNotifications };
}
