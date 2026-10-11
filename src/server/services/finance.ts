import "server-only";
import type { ReimbursementStatus } from "@prisma/client";
import { REIMBURSEMENT_STATUS } from "@/domain/labels";
import { formatBRL } from "@/lib/format";
import type { Actor } from "@/server/actor";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { addTimelineEvent, recordAudit } from "./audit";

const FALLBACK_CENTS = 8_000;

async function nextCode() {
  const last = await db.reimbursement.findFirst({ orderBy: { code: "desc" } });
  const n = last ? Number(last.code.replace(/\D/g, "")) + 1 : 1;
  return `RB-${String(n).padStart(4, "0")}`;
}

/** Gera o reembolso de transporte/alimentação de uma visita realizada. */
export async function createReimbursementForVisit(visitId: string, actor: Actor) {
  const visit = await db.visit.findUnique({ where: { id: visitId }, include: { participant: true } });
  if (!visit) throw new DomainError("Visita não encontrada.");
  const existing = await db.reimbursement.findFirst({ where: { visitId } });
  if (existing) return existing;
  // Valor de referência: último reembolso do mesmo estudo (no produto real, viria do contrato).
  const reference = await db.reimbursement.findFirst({ where: { studyId: visit.studyId, visit: { category: { not: "INCLUSAO" } } }, orderBy: { requestedAt: "desc" } });
  const amountCents = (reference?.amountCents ?? FALLBACK_CENTS) + (visit.category === "INCLUSAO" ? 4_000 : 0);
  const r = await db.reimbursement.create({
    data: {
      code: await nextCode(),
      participantId: visit.participantId,
      studyId: visit.studyId,
      visitId: visit.id,
      amountCents,
      description: "Transporte e alimentação",
      status: "PENDENTE",
      receiptReceived: false,
      requestedAt: new Date(),
    },
  });
  await addTimelineEvent({ participantId: visit.participantId, studyId: visit.studyId, type: "REIMBURSEMENT_CREATED", title: `Reembolso ${r.code} gerado`, description: `${formatBRL(amountCents)} — ${visit.name}`, actor });
  await recordAudit({ actor, action: "reimbursement.created", entityType: "Reimbursement", entityId: r.id, studyId: visit.studyId, summary: `Reembolso ${r.code} (${formatBRL(amountCents)}) gerado para ${visit.participant.fullName}` });
  return r;
}

export async function setReimbursementStatus(ids: string[], to: ReimbursementStatus, actor: Actor) {
  if (ids.length === 0) throw new DomainError("Nenhum reembolso selecionado.");
  const items = await db.reimbursement.findMany({ where: { id: { in: ids } } });
  for (const r of items) {
    await db.reimbursement.update({
      where: { id: r.id },
      data: { status: to, paidAt: to === "PAGO" ? new Date() : null, receiptReceived: to !== "PENDENTE" ? true : r.receiptReceived },
    });
    await recordAudit({ actor, action: "reimbursement.status_changed", entityType: "Reimbursement", entityId: r.id, studyId: r.studyId, summary: `Reembolso ${r.code}: ${REIMBURSEMENT_STATUS[r.status].label} → ${REIMBURSEMENT_STATUS[to].label}` });
  }
  return items.length;
}
