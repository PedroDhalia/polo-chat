// Tipos compartilhados da camada de integrações.
//
// Regra de arquitetura: nenhuma parte do sistema fala diretamente com um sistema externo.
// Telas, serviços e automações usam apenas os adapters expostos por `getIntegrations()`.

export type AdapterMode = "mock" | "live";

export interface IntegrationInfo {
  system: "POLO_TRIAL" | "WHATSAPP" | "FORMS" | "FINANCE" | "AI";
  name: string;
  purpose: string;
  mode: AdapterMode;
  /** O que o adapter real precisará antes de ser implementado. */
  prerequisites: string[];
}

export class IntegrationNotAvailableError extends Error {
  constructor(system: string) {
    super(`Integração "${system}" não disponível neste MVP — apenas o adapter simulado está implementado.`);
    this.name = "IntegrationNotAvailableError";
  }
}
