// Contrato interno para o envio de reembolsos/faturamento a um sistema financeiro.
// Nenhum sistema financeiro está definido; o adapter real dependerá da ferramenta escolhida.

import type { AdapterMode } from "../types";

export interface ReimbursementExportItem {
  code: string;
  participantCode: string;
  studyCode: string;
  amountCents: number;
}

export interface FinanceAdapter {
  readonly mode: AdapterMode;
  exportReimbursements(items: ReimbursementExportItem[]): Promise<{ batchId: string; accepted: number }>;
  getBatchStatus(batchId: string): Promise<"RECEBIDO" | "EM_PROCESSAMENTO" | "PAGO">;
}
