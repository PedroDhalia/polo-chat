// Contrato interno para envio/recebimento de mensagens.
// Implementação real prevista: WhatsApp Business Platform (modelos pré-aprovados pela Meta
// e textos aprovados pelo CEP). Neste MVP, apenas o adapter simulado existe.

import type { AdapterMode } from "../types";

export interface SendResult {
  externalId: string;
  status: "QUEUED" | "SENT" | "FAILED";
  sentAt: Date;
}

export interface InboundMessage {
  externalId: string;
  from: string;
  body: string;
  receivedAt: Date;
}

export interface WhatsAppAdapter {
  readonly mode: AdapterMode;
  /** Mensagem livre — no produto real, só dentro da janela de atendimento e com texto aprovado. */
  sendMessage(input: { to: string; body: string }): Promise<SendResult>;
  /** Envio de modelo aprovado. `renderedBody` é o texto final já com variáveis aplicadas. */
  sendTemplate(input: { to: string; templateKey: string; variables: Record<string, string>; renderedBody: string }): Promise<SendResult>;
  getMessages(input: { phone: string; since?: Date }): Promise<InboundMessage[]>;
}
