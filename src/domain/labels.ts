// Vocabulário do domínio: rótulos em português e tom visual de cada status.
// Única fonte para a UI — nenhuma tela deve definir rótulos próprios.

import type {
  ConversationStatus,
  FinancialCategory,
  FinancialStatus,
  ParticipantStatus,
  RecruitmentChannel,
  ReimbursementStatus,
  StudyStatus,
  TaskPriority,
  TaskSource,
  TaskStatus,
  TemplateApprovalStatus,
  TemplateCategory,
  UserRole,
  VisitCategory,
  VisitStatus,
} from "@prisma/client";

export type Tone = "neutral" | "brand" | "blue" | "amber" | "red" | "violet" | "green";

type LabelMap<K extends string> = Record<K, { label: string; tone: Tone }>;

export const STUDY_STATUS: LabelMap<StudyStatus> = {
  EM_ATIVACAO: { label: "Em ativação", tone: "blue" },
  RECRUTAMENTO_ATIVO: { label: "Recrutamento ativo", tone: "green" },
  RECRUTAMENTO_PAUSADO: { label: "Recrutamento pausado", tone: "amber" },
  ACOMPANHAMENTO: { label: "Em acompanhamento", tone: "violet" },
  ENCERRADO: { label: "Encerrado", tone: "neutral" },
};

export const PARTICIPANT_STATUS: LabelMap<ParticipantStatus> = {
  NOVO: { label: "Novo", tone: "blue" },
  EM_CONTATO: { label: "Em contato", tone: "amber" },
  PRE_TRIAGEM: { label: "Pré-triagem", tone: "violet" },
  AGUARDANDO_AGENDAMENTO: { label: "Aguardando agendamento", tone: "amber" },
  AGENDADO: { label: "Agendado", tone: "brand" },
  INCLUIDO: { label: "Incluído", tone: "green" },
  INELEGIVEL: { label: "Inelegível", tone: "neutral" },
  RETIRADO: { label: "Retirado", tone: "red" },
};

/** Status que representam o pipeline ativo de recrutamento. */
export const PIPELINE_STATUSES: ParticipantStatus[] = [
  "NOVO",
  "EM_CONTATO",
  "PRE_TRIAGEM",
  "AGUARDANDO_AGENDAMENTO",
  "AGENDADO",
];

export const CHANNEL: Record<RecruitmentChannel, { label: string; short: string }> = {
  BANCO_PROPRIO: { label: "Banco próprio", short: "Banco" },
  INSTAGRAM: { label: "Instagram", short: "Instagram" },
  FACEBOOK: { label: "Facebook", short: "Facebook" },
  LANDING_PAGE: { label: "Landing Page", short: "Landing" },
  INDICACAO: { label: "Indicação", short: "Indicação" },
  ASSOCIACAO: { label: "Associação/comunidade", short: "Associação" },
  MIDIA_TRADICIONAL: { label: "Mídia tradicional", short: "Mídia" },
};

export const CHANNELS = Object.keys(CHANNEL) as RecruitmentChannel[];

export const VISIT_STATUS: LabelMap<VisitStatus> = {
  AGUARDANDO_CONFIRMACAO: { label: "Aguardando confirmação", tone: "amber" },
  CONFIRMADO: { label: "Confirmado", tone: "brand" },
  REAGENDAMENTO_SOLICITADO: { label: "Reagendamento solicitado", tone: "violet" },
  REALIZADO: { label: "Realizado", tone: "green" },
  FALTOU: { label: "Faltou", tone: "red" },
  CANCELADO: { label: "Cancelado", tone: "neutral" },
};

export const VISIT_CATEGORY: Record<VisitCategory, string> = {
  TRIAGEM: "Triagem",
  INCLUSAO: "Inclusão",
  SEGUIMENTO: "Seguimento",
  ENCERRAMENTO: "Encerramento",
  NAO_PROGRAMADA: "Não programada",
};

export const CONVERSATION_STATUS: LabelMap<ConversationStatus> = {
  AGUARDANDO_RESPOSTA: { label: "Aguardando resposta", tone: "amber" },
  REQUER_ATENCAO: { label: "Requer atenção", tone: "red" },
  RESPONDIDA: { label: "Nova resposta", tone: "blue" },
  RESOLVIDA: { label: "Resolvida", tone: "neutral" },
};

export const TEMPLATE_CATEGORY: Record<TemplateCategory, string> = {
  PRIMEIRO_CONTATO: "Primeiro contato",
  SEGUNDO_CONTATO: "Segundo contato",
  LEMBRETE_VISITA: "Lembrete de visita",
  CONFIRMACAO: "Confirmação",
  REAGENDAMENTO: "Reagendamento",
  SOLICITACAO_CONTATO: "Solicitação de contato",
  DUVIDA_FREQUENTE: "Dúvida frequente",
};

export const TEMPLATE_APPROVAL: LabelMap<TemplateApprovalStatus> = {
  APROVADO: { label: "Aprovado CEP", tone: "green" },
  EM_REVISAO: { label: "Em revisão CEP", tone: "amber" },
  RASCUNHO: { label: "Rascunho", tone: "neutral" },
  REVOGADO: { label: "Revogado", tone: "red" },
};

export const TASK_PRIORITY: LabelMap<TaskPriority> = {
  ALTA: { label: "Alta", tone: "red" },
  MEDIA: { label: "Média", tone: "amber" },
  BAIXA: { label: "Baixa", tone: "neutral" },
};

export const PRIORITY_ORDER: Record<TaskPriority, number> = { ALTA: 0, MEDIA: 1, BAIXA: 2 };

export const TASK_STATUS: LabelMap<TaskStatus> = {
  ABERTA: { label: "Aberta", tone: "blue" },
  EM_ANDAMENTO: { label: "Em andamento", tone: "violet" },
  CONCLUIDA: { label: "Concluída", tone: "green" },
  CANCELADA: { label: "Cancelada", tone: "neutral" },
};

export const OPEN_TASK_STATUSES: TaskStatus[] = ["ABERTA", "EM_ANDAMENTO"];

export const TASK_SOURCE: Record<TaskSource, string> = {
  MANUAL: "Manual",
  AUTOMACAO: "Automação",
  POLO_TRIAL: "Polo Trial",
  COMUNICACAO: "Comunicação",
  FORMULARIO: "Formulário",
  FINANCEIRO: "Financeiro",
};

export const REIMBURSEMENT_STATUS: LabelMap<ReimbursementStatus> = {
  PENDENTE: { label: "Pendente", tone: "amber" },
  EM_CONCILIACAO: { label: "Em conciliação", tone: "blue" },
  PAGO: { label: "Pago", tone: "green" },
};

export const FINANCIAL_CATEGORY: Record<FinancialCategory, string> = {
  TAXA_ATIVACAO: "Taxa de ativação",
  VISITA: "Visitas",
  PROCEDIMENTO: "Procedimentos",
  OVERHEAD: "Overhead institucional",
};

export const FINANCIAL_STATUS: LabelMap<FinancialStatus> = {
  A_FATURAR: { label: "A faturar", tone: "amber" },
  FATURADO: { label: "Faturado", tone: "blue" },
  PAGO: { label: "Pago", tone: "green" },
};

export const ROLE: Record<UserRole, { label: string; description: string }> = {
  DIRETOR: { label: "Diretor", description: "Visão completa da operação e dos indicadores." },
  COORDENADOR: { label: "Coordenador", description: "Gestão dos estudos, equipe, agenda e comunicação." },
  ASSISTENTE: { label: "Assistente de pesquisa", description: "Execução do dia a dia: contatos, agenda e pendências." },
  FINANCEIRO: { label: "Financeiro", description: "Orçamento, faturamento e reembolsos." },
  QUALIDADE: { label: "Qualidade", description: "Leitura ampla, auditoria e aprovação de modelos." },
};
