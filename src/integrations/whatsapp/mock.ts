import type { SendResult, WhatsAppAdapter } from "./types";

// Adapter simulado: nenhuma mensagem sai do sistema. Gera apenas um ID fictício.
function fakeId(): string {
  return `sim-wa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class MockWhatsAppAdapter implements WhatsAppAdapter {
  readonly mode = "mock" as const;

  async sendMessage(): Promise<SendResult> {
    return { externalId: fakeId(), status: "SENT", sentAt: new Date() };
  }

  async sendTemplate(): Promise<SendResult> {
    return { externalId: fakeId(), status: "SENT", sentAt: new Date() };
  }

  async getMessages() {
    return [];
  }
}
