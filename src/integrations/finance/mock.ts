import type { FinanceAdapter, ReimbursementExportItem } from "./types";

export class MockFinanceAdapter implements FinanceAdapter {
  readonly mode = "mock" as const;

  async exportReimbursements(items: ReimbursementExportItem[]) {
    return { batchId: `sim-lote-${Date.now().toString(36)}`, accepted: items.length };
  }

  async getBatchStatus() {
    return "RECEBIDO" as const;
  }
}
