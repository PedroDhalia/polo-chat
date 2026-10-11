import type { ReimbursementStatus } from "@prisma/client";
import { Card, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/misc";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusBadge } from "@/components/ui/badge";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { FINANCIAL_CATEGORY, FINANCIAL_STATUS } from "@/domain/labels";
import { formatMonthYear } from "@/lib/dates";
import { formatBRL, formatBRLShort, formatNumber, formatPct, ratio } from "@/lib/format";
import { can, type SessionUser } from "@/server/auth/session";
import { getFinanceOverview, getReimbursementSummary, listFinancialRecords, listReimbursements } from "@/server/queries/finance";
import { ReimbursementTable } from "./reimbursement-table";

export async function FinanceView({ user, studyId, status }: { user: SessionUser; studyId?: string; status?: ReimbursementStatus }) {
  const [overview, summary, reimbursements, records] = await Promise.all([
    getFinanceOverview(user, studyId),
    getReimbursementSummary(user, studyId),
    listReimbursements(user, { studyId, status }),
    listFinancialRecords(user, studyId),
  ]);
  const canManage = can(user, "finance.manage");

  return (
    <div className="space-y-5">
      <div className={`grid grid-cols-1 gap-3 ${overview.length > 1 ? "lg:grid-cols-2" : ""}`}>
        {overview.map((o) => (
          <Card key={o.study.id} className="p-5">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <div>
                <span className="text-[15px] font-semibold text-ink">{o.study.code}</span>
                <span className="ml-2 text-[12.5px] text-ink-3">{o.study.sponsor}</span>
              </div>
              <span className="text-[12.5px] text-ink-3">{formatPct(ratio(o.executed, o.budget))} executado</span>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Figure label="Orçamento" value={formatBRL(o.budget)} />
              <Figure label="Executado" value={formatBRL(o.executed)} />
              <Figure label="Restante" value={formatBRL(o.remaining)} />
            </div>
            <Progress className="mt-3" value={o.executed} max={o.budget} />
            <div className="mt-4 grid grid-cols-3 gap-4 border-t border-line pt-3 text-[12.5px]">
              <Small label="Visitas realizadas" value={formatNumber(o.visitsRealized)} />
              <Small label="Visitas pagas" value={formatNumber(o.visitsPaid)} />
              <Small label="Visitas pendentes" value={formatNumber(o.visitsPending)} tone={o.visitsPending > 0 ? "text-amber-700" : undefined} />
              <Small label="Reembolsos pagos" value={formatBRLShort(o.reimbPaid)} />
              <Small label="Reembolsos em aberto" value={`${formatBRLShort(o.reimbOpen)} · ${o.reimbOpenCount}`} tone={o.reimbOpenCount > 0 ? "text-amber-700" : undefined} />
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Reembolsos pendentes" value={formatBRL(summary.pending.cents)} sub={`${summary.pending.count} aguardando pagamento`} subTone={summary.pending.count > 0 ? "amber" : undefined} />
        <StatTile label="Em conciliação" value={formatBRL(summary.reconciling.cents)} sub={`${summary.reconciling.count} com o financeiro`} />
        <StatTile label="Pagos em 30 dias" value={formatBRL(summary.paidMonth.cents)} sub={`${summary.paidMonth.count} reembolsos`} />
        <StatTile label="Recibos faltantes" value={summary.missingReceipts} sub="Reembolsos pendentes sem comprovante" subTone={summary.missingReceipts > 0 ? "red" : undefined} />
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title="Reembolsos a participantes"
          description={canManage ? "Selecione itens para enviar à conciliação ou registrar pagamento." : "Somente o perfil Financeiro altera status de reembolsos."}
        />
        <div className="border-t border-line">
          <ReimbursementTable
            canManage={canManage}
            rows={reimbursements.map((r) => ({
              id: r.id,
              code: r.code,
              participantId: r.participant.id,
              participantName: r.participant.fullName,
              studyCode: r.study.code,
              visitName: r.visit?.name ?? null,
              amountCents: r.amountCents,
              requestedAt: r.requestedAt,
              paidAt: r.paidAt,
              receiptReceived: r.receiptReceived,
              status: r.status,
            }))}
          />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Faturamento ao patrocinador" description="Lançamentos por competência (últimos meses) — valores ilustrativos." />
        <Table className="border-t border-line">
          <THead>
            <Th>Competência</Th>
            <Th>Estudo</Th>
            <Th>Categoria</Th>
            <Th className="text-right">Qtd.</Th>
            <Th className="text-right">Valor unitário</Th>
            <Th className="text-right">Total</Th>
            <Th>Status</Th>
          </THead>
          <tbody>
            {records.map((r) => (
              <Tr key={r.id}>
                <Td className="text-ink-2 capitalize">{formatMonthYear(r.competence)}</Td>
                <Td className="font-medium text-ink-2">{r.study.code}</Td>
                <Td className="text-ink">{FINANCIAL_CATEGORY[r.category]}</Td>
                <Td className="text-right text-ink-2 tnum">{formatNumber(r.quantity)}</Td>
                <Td className="text-right text-ink-2 tnum">{formatBRL(r.unitAmountCents)}</Td>
                <Td className="text-right font-medium text-ink tnum">{formatBRL(r.amountCents)}</Td>
                <Td>
                  <StatusBadge map={FINANCIAL_STATUS} value={r.status} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className="mt-0.5 text-[17px] font-semibold tracking-tight text-ink">{value}</div>
    </div>
  );
}

function Small({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-ink-3">{label}</div>
      <div className={`font-medium tnum ${tone ?? "text-ink"}`}>{value}</div>
    </div>
  );
}
