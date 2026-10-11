import "server-only";
import { addDays } from "@/lib/dates";
import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db";

export async function listUsers() {
  return db.user.findMany({
    include: { memberships: { include: { study: { select: { code: true } } } } },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
}

export async function listStudiesConfig() {
  const [studies, refs] = await Promise.all([
    db.study.findMany({ include: { owner: { select: { name: true } }, members: { include: { user: { select: { id: true, name: true } } } } }, orderBy: { code: "asc" } }),
    db.externalReference.findMany({ where: { entityType: "Study" } }),
  ]);
  return studies.map((s) => ({ ...s, externalId: refs.find((r) => r.entityId === s.id)?.externalId ?? null }));
}

export async function listAutomationRules(now = new Date()) {
  const [rules, counts, runs] = await Promise.all([
    db.automationRule.findMany({ orderBy: { createdAt: "asc" } }),
    db.automationRun.groupBy({ by: ["ruleId"], where: { createdAt: { gte: addDays(now, -7) } }, _count: true }),
    db.automationRun.findMany({ include: { rule: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  return { rules: rules.map((r) => ({ ...r, runs7d: counts.find((c) => c.ruleId === r.id)?._count ?? 0 })), runs };
}

export async function listAuditLogs(user: SessionUser) {
  return db.auditLog.findMany({
    where: user.studyIds ? { OR: [{ studyId: null }, { studyId: { in: user.studyIds } }] } : {},
    include: { study: { select: { code: true } } },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
}

export async function poloTrialSyncInfo() {
  const latest = await db.study.findFirst({ where: { sourceSyncedAt: { not: null } }, orderBy: { sourceSyncedAt: "desc" }, select: { sourceSyncedAt: true } });
  const refs = await db.externalReference.groupBy({ by: ["system"], _count: true });
  return { lastSync: latest?.sourceSyncedAt ?? null, refs: Object.fromEntries(refs.map((r) => [r.system, r._count])) as Record<string, number> };
}

/** Política da assistência e follow-up por estudo, com o desempenho recente da IA. */
export async function listAssistSettings(user: SessionUser, now = new Date()) {
  const studies = await db.study.findMany({
    where: user.studyIds ? { id: { in: user.studyIds } } : {},
    include: { automationSettings: true, assistPolicies: true },
    orderBy: { code: "asc" },
  });
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const ids = studies.map((s) => s.id);
  const [auto, reviewed, correct, pending] = await Promise.all([
    db.assistDecision.groupBy({ by: ["studyId"], where: { studyId: { in: ids }, outcome: "AUTOMATICA", createdAt: { gte: since } }, _count: true }),
    db.assistDecision.groupBy({ by: ["studyId"], where: { studyId: { in: ids }, outcome: "AUTOMATICA", verdict: { not: null } }, _count: true }),
    db.assistDecision.groupBy({ by: ["studyId"], where: { studyId: { in: ids }, outcome: "AUTOMATICA", verdict: "CORRETA" }, _count: true }),
    db.assistDecision.groupBy({ by: ["studyId"], where: { studyId: { in: ids }, outcome: "PENDENTE" }, _count: true }),
  ]);
  const n = (rows: { studyId: string; _count: number }[], id: string) => rows.find((r) => r.studyId === id)?._count ?? 0;
  return studies.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    settings: s.automationSettings,
    policies: s.assistPolicies.map((p) => ({ intent: p.intent, mode: p.mode, minConfidence: p.minConfidence })),
    stats: { auto30: n(auto, s.id), reviewed: n(reviewed, s.id), correct: n(correct, s.id), pending: n(pending, s.id) },
  }));
}
