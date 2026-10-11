import "server-only";
import { DEFAULT_AI_MODEL } from "@/domain/assist-ai";
import { LiveAssistAiAdapter } from "./ai/live";
import { MockAssistAiAdapter } from "./ai/mock";
import type { AssistAiAdapter } from "./ai/types";
import { MockFinanceAdapter } from "./finance/mock";
import type { FinanceAdapter } from "./finance/types";
import { MockFormsAdapter } from "./forms/mock";
import type { FormsAdapter } from "./forms/types";
import { MockPoloTrialAdapter } from "./polo-trial/mock";
import type { PoloTrialAdapter } from "./polo-trial/types";
import { IntegrationNotAvailableError, type IntegrationInfo } from "./types";
import { MockWhatsAppAdapter } from "./whatsapp/mock";
import type { WhatsAppAdapter } from "./whatsapp/types";

export interface Integrations {
  poloTrial: PoloTrialAdapter;
  whatsapp: WhatsAppAdapter;
  forms: FormsAdapter;
  finance: FinanceAdapter;
  /** Segunda opinião da IA: simulada (padrão) ou real (ASSIST_AI_MODE=live). */
  ai: AssistAiAdapter;
}

/** Modo da IA: "mock" (simulada, sem custo) ou "live" (API da Anthropic). */
export const AI_MODE = process.env.ASSIST_AI_MODE === "live" ? "live" : "mock";
export const AI_MODEL = process.env.ASSIST_AI_MODEL || DEFAULT_AI_MODEL;

let instance: Integrations | null = null;

/** Ponto único de acesso a sistemas externos. */
export function getIntegrations(): Integrations {
  if (instance) return instance;
  const mode = process.env.INTEGRATIONS_MODE ?? "mock";
  if (mode !== "mock") throw new IntegrationNotAvailableError(mode);
  instance = {
    poloTrial: new MockPoloTrialAdapter(),
    whatsapp: new MockWhatsAppAdapter(),
    forms: new MockFormsAdapter(),
    finance: new MockFinanceAdapter(),
    ai: AI_MODE === "live" ? new LiveAssistAiAdapter(AI_MODEL) : new MockAssistAiAdapter(AI_MODEL),
  };
  return instance;
}

export const INTEGRATION_CATALOG: IntegrationInfo[] = [
  {
    system: "POLO_TRIAL",
    name: "Polo Trial",
    purpose: "Fonte de dados clínicos e protocolares: estudos, participantes, visitas e janelas.",
    mode: "mock",
    prerequisites: [
      "Documentação oficial da API (recursos, autenticação, limites)",
      "Definição de quais dados podem ser lidos e escritos",
      "Acordo sobre frequência de sincronização",
    ],
  },
  {
    system: "WHATSAPP",
    name: "WhatsApp Business Platform",
    purpose: "Envio de lembretes e mensagens com modelos aprovados; recebimento de respostas.",
    mode: "mock",
    prerequisites: [
      "Conta WhatsApp Business verificada",
      "Modelos aprovados pelo CEP e pela Meta",
      "Política de consentimento e retenção de conversas",
    ],
  },
  {
    system: "FORMS",
    name: "Formulários e landing pages",
    purpose: "Entrada automática de interessados, sem recadastro manual.",
    mode: "mock",
    prerequisites: ["Definição dos formulários de origem", "Campos mínimos e aceite de contato padronizados"],
  },
  {
    system: "AI",
    name: `Assistência IA (Claude · ${AI_MODEL})`,
    purpose: "Segunda opinião nas mensagens que as regras não resolveram: só rotula a intenção; a ação segue a política do estudo.",
    mode: AI_MODE,
    prerequisites: [
      "Chave da API da Anthropic (ASSIST_AI_MODE=live)",
      "Base de teste com respostas reais anonimizadas para medir o acerto",
      "Avaliação de LGPD e contrato com o provedor (dados de saúde)",
    ],
  },
  {
    system: "FINANCE",
    name: "Sistema financeiro",
    purpose: "Envio de reembolsos e acompanhamento de pagamentos.",
    mode: "mock",
    prerequisites: ["Escolha do sistema financeiro", "Fluxo de aprovação de pagamentos"],
  },
];
