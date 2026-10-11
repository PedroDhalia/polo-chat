import "server-only";
import type { Prisma, ReimbursementStatus } from "@prisma/client";
import { addDays, startOfMonth } from "@/lib/dates";
import { canAccessStudy, type SessionUser, studyScope } from "@/server/auth/session";
import { db } from "@/server/db";

export async function getFinanceOverview(user: SessionUser, studyId?: string) {
  const studyWhere: Prisma.StudyWhereInput = user.studyIds ? { id: { in: user.studyIds } } : {};
  if (studyId) studyWhere.id = canAccessStudy(user, studyId) ? studyId : "__none__";
  const studies = await db.study.findMany({ where: studyWhere, orderBy: { code: "asc" } });
  const ids = studies.map((s) => s.id);
  const [executed, visits, visitsPaid, reimb] = await Promise.all([
    db.financialRecord.groupBy({ by: ["studyId"], where: { studyId: { in: ids } }, _sum: { amountCents: true } }),
    db.financialRecord.groupBy({ by: ["studyId"], where: { studyId: { in: ids }, category: "VISITA" }, _sum: { quantity: true } }),
    db.financialRecord.groupBy({ by: ["studyId"], where: { studyId: { in: ids }, category: "VISITA", status: "PAGO" }, _sum: { quantity: true } }),
    db.reimbursement.groupBy({ by: ["studyId", "status"], where: { studyId: { in: ids } }, _sum: { amountCents: true }, _count: true }),
  ]);
  const pick = <T extends { studyId: string }>(rows: T[], id: string) => rows.find((r) => r.studyId === id);
  return studies.map((s) => {
    const exec = pick(executed, s.id)?._sum.amountCents ?? 0;
    const realized = pick(visits, s.id)?._sum.quantity ?? 0;
    const paid = pick(visitsPaid, s.id)?._sum.quantity ?? 0;
    const r = (st: ReimbursementStatus) => reimb.find((x) => x.studyId === s.id && x.status === st);
    return {
      study: s,
      budget: s.budgetCents,
      executed: exec,
      remaining: s.budgetCents - exec,
      visitsRealized: realized,
      visitsPaid: paid,
      visitsPending: realized - paid,
      reimbPaid: r("PAGO")?._sum.amountCents ?? 0,
      reimbOpen: (r("PENDENTE")?._sum.amountCents ?? 0) + (r("EM_CONCILIACAO")?._sum.amountCents ?? 0),
      reimbOpenCount: (r("PENDENTE")?._count ?? 0) + (r("EM_CONCILIACAO")?._count ?? 0),
    };
  });
}

export async function getReimbursementSummary(user: SessionUser, studyId?: string, now = new Date()) {
  const where: Prisma.ReimbursementWhereInput = { ...studyScope(user) };
  if (studyId) where.studyId = canAccessStudy(user, studyId) ? studyId : "__none__";
  const [byStatus, paidThisMonth, missingReceipts] = await Promise.all([
    db.reimbursement.groupBy({ by: ["status"], where, _sum: { amountCents: true }, _count: true }),
    db.reimbursement.aggregate({ where: { ...where, status: "PAGO", paidAt: { gte: addDays(now, -30) } }, _sum: { amountCents: true }, _count: true }),
    db.reimbursement.count({ where: { ...where, status: "PENDENTE", receiptReceived: false } }),
  ]);
  const get = (s: ReimbursementStatus) => byStatus.find((b) => b.status === s);
  return {
    pending: { cents: get("PENDENTE")?._sum.amountCents ?? 0, count: get("PENDENTE")?._count ?? 0 },
    reconciling: { cents: get("EM_CONCILIACAO")?._sum.amountCents ?? 0, count: get("EM_CONCILIACAO")?._count ?? 0 },
    paidMonth: { cents: paidThisMonth._sum.amountCents ?? 0, count: paidThisMonth._count },
    missingReceipts,
  };
}

export async function listReimbursements(user: SessionUser, f: { studyId?: string; status?: ReimbursementStatus }) {
  const where: Prisma.ReimbursementWhereInput = { ...studyScope(user) };
  if (f.studyId) where.studyId = canAccessStudy(user, f.studyId) ? f.studyId : "__none__";
  if (f.status) where.status = f.status;
  return db.reimbursement.findMany({
    where,
    include: { participant: { select: { id: true, fullName: true } }, study: { select: { code: true } }, visit: { select: { name: true } } },
    orderBy: [{ requestedAt: "desc" }],
  });
}

export async function listFinancialRecords(user: SessionUser, studyId?: string, now = new Date()) {
  const where: Prisma.FinancialRecordWhereInput = { ...studyScope(user), competence: { gte: startOfMonth(addDays(startOfMonth(now), -100)) } };
  if (studyId) where.studyId = canAccessStudy(user, studyId) ? studyId : "__none__";
  return db.financialRecord.findMany({ where, include: { study: { select: { code: true } } }, orderBy: [{ competence: "desc" }, { studyId: "asc" }, { category: "asc" }] });
}
