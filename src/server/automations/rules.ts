// Catálogo de regras de automação do MVP.
// Cada regra segue o formato Evento → Regra → Ação, exibido na tela de Configurações.

export type AutomationKind = "scheduled" | "event";

export interface AutomationRuleDef {
  key: AutomationRuleKey;
  name: string;
  trigger: string;
  condition: string;
  action: string;
  kind: AutomationKind;
}

export type AutomationRuleKey =
  | "lembrete-24h"
  | "sem-resposta-24h"
  | "faltou-reagendar"
  | "confirmacao-visita"
  | "realizada-reembolso"
  | "formulario-entrada"
  | "mensagem-clinica"
  | "assistencia-ia";

export const AUTOMATION_RULES: AutomationRuleDef[] = [
  {
    key: "lembrete-24h",
    name: "Lembrete de visita",
    trigger: "Visita amanhã",
    condition: "24h antes, se houver consentimento para WhatsApp",
    action: "Enviar o modelo aprovado “Lembrete de visita”",
    kind: "scheduled",
  },
  {
    key: "sem-resposta-24h",
    name: "Follow-up sem resposta",
    trigger: "Participante não respondeu",
    condition: "Após o intervalo do estudo, dentro do horário de envio e sem pendência aberta",
    action: "Enviar follow-up com modelo aprovado até o limite de tentativas; esgotado, criar pendência de ligação",
    kind: "scheduled",
  },
  {
    key: "faltou-reagendar",
    name: "Falta em visita",
    trigger: "Visita marcada como “Faltou”",
    condition: "Imediatamente",
    action: "Enviar o modelo aprovado “Falta na visita” (se houver consentimento para WhatsApp) e criar pendência de reagendamento (alta prioridade)",
    kind: "event",
  },
  {
    key: "confirmacao-visita",
    name: "Visita confirmada",
    trigger: "Equipe confirma a visita",
    condition: "Após resposta do participante",
    action: "Enviar “Confirmação de agendamento” e encerrar pendências da visita",
    kind: "event",
  },
  {
    key: "realizada-reembolso",
    name: "Reembolso após visita",
    trigger: "Visita marcada como “Realizada”",
    condition: "Imediatamente",
    action: "Gerar reembolso pendente para o financeiro",
    kind: "event",
  },
  {
    key: "formulario-entrada",
    name: "Entrada por formulário",
    trigger: "Formulário de interesse recebido",
    condition: "Com aceite de contato",
    action: "Cadastrar candidato e criar pendência de primeiro contato",
    kind: "event",
  },
  {
    key: "mensagem-clinica",
    name: "Possível relato clínico",
    trigger: "Mensagem classificada como possível relato clínico",
    condition: "Imediatamente — nenhuma resposta automática",
    action: "Criar pendência de alta prioridade para a coordenação",
    kind: "event",
  },
  {
    key: "assistencia-ia",
    name: "Assistência IA (aplicação automática)",
    trigger: "Mensagem do participante classificada pela assistência",
    condition: "Estudo em modo automático para a intenção e confiança ≥ mínimo; senão, fila de revisão",
    action: "Aplicar a ação da intenção: confirmar visita, responder dúvida, registrar descadastro…",
    kind: "event",
  },
];

export const RULE_BY_KEY = Object.fromEntries(AUTOMATION_RULES.map((r) => [r.key, r])) as Record<AutomationRuleKey, AutomationRuleDef>;
