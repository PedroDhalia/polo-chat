"use client";

import type { ReimbursementStatus } from "@prisma/client";
import { Check, CircleCheck, Clock } from "lucide-react";
import Link from "@/components/ui/link";
import { useState } from "react";
import { StatusBadge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { Spinner, useActionRunner } from "@/components/ui/toast";
import { REIMBURSEMENT_STATUS } from "@/domain/labels";
import { formatDate } from "@/lib/dates";
import { formatBRL } from "@/lib/format";
import { setReimbursementStatusAction } from "@/server/actions/admin";

export interface ReimbursementRow {
  id: string;
  code: string;
  participantId: string;
  participantName: string;
  studyCode: string;
  visitName: string | null;
  amountCents: number;
  requestedAt: Date;
  paidAt: Date | null;
  receiptReceived: boolean;
  status: ReimbursementStatus;
}

export function ReimbursementTable({ rows, canManage }: { rows: ReimbursementRow[]; canManage: boolean }) {
  const [selected, setSelected] = useState<string[]>([]);
  const { run, pending } = useActionRunner();
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const selectable = rows.filter((r) => r.status !== "PAGO");
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.includes(r.id));
  const total = rows.filter((r) => selected.includes(r.id)).reduce((a, r) => a + r.amountCents, 0);
  const apply = (status: ReimbursementStatus) => run(() => setReimbursementStatusAction(selected, status), { onSuccess: () => setSelected([]) });

  return (
    <div>
      {canManage && selected.length > 0 && (
        <div className="flex items-center gap-3 border-b border-line bg-brand-50/60 px-4 py-2 text-[13px]">
          <span className="font-medium text-ink">
            {selected.length} selecionado(s) · {formatBRL(total)}
          </span>
          <button type="button" disabled={pending} onClick={() => apply("EM_CONCILIACAO")} className={buttonClasses("secondary", "xs")}>
            {pending ? <Spinner /> : <Clock className="size-3.5" />} Enviar para conciliação
          </button>
          <button type="button" disabled={pending} onClick={() => apply("PAGO")} className={buttonClasses("primary", "xs")}>
            <Check className="size-3.5" /> Marcar como pago
          </button>
          <span className="ml-auto text-[12px] text-ink-3">Nenhum pagamento real é executado.</span>
        </div>
      )}
      <Table>
        <THead>
          {canManage && (
            <Th className="w-8">
              <input type="checkbox" aria-label="Selecionar todos" checked={allSelected} onChange={() => setSelected(allSelected ? [] : selectable.map((r) => r.id))} className="accent-brand-600" />
            </Th>
          )}
          <Th>Código</Th>
          <Th>Participante</Th>
          <Th>Estudo</Th>
          <Th>Visita</Th>
          <Th className="text-right">Valor</Th>
          <Th>Data</Th>
          <Th>Recibo</Th>
          <Th>Status</Th>
        </THead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.id} className={selected.includes(r.id) ? "bg-brand-50/40" : undefined}>
              {canManage && (
                <Td>
                  <input type="checkbox" aria-label={`Selecionar ${r.code}`} disabled={r.status === "PAGO"} checked={selected.includes(r.id)} onChange={() => toggle(r.id)} className="accent-brand-600" />
                </Td>
              )}
              <Td className="text-ink-3 tnum">{r.code}</Td>
              <Td>
                <Link href={`/participantes/${r.participantId}`} className="font-medium whitespace-nowrap text-ink hover:text-brand-700">
                  {r.participantName}
                </Link>
              </Td>
              <Td className="font-medium whitespace-nowrap text-ink-2">{r.studyCode}</Td>
              <Td className="whitespace-nowrap text-ink-2">{r.visitName ?? "—"}</Td>
              <Td className="text-right font-medium text-ink tnum">{formatBRL(r.amountCents)}</Td>
              <Td className="whitespace-nowrap text-ink-2 tnum">
                {formatDate(r.requestedAt)}
                {r.paidAt && <div className="text-[11.5px] text-ink-3">pago {formatDate(r.paidAt)}</div>}
              </Td>
              <Td>{r.receiptReceived ? <CircleCheck className="size-4 text-brand-600" aria-label="Recebido" /> : <span className="text-[12px] text-amber-700">Pendente</span>}</Td>
              <Td>
                <StatusBadge map={REIMBURSEMENT_STATUS} value={r.status} />
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
