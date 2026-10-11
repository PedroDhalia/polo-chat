// Controle de acesso baseado em função (RBAC).
// Regras puras: usadas no servidor (autorização) e na UI (exibição da matriz).

import type { UserRole } from "@prisma/client";

export const PERMISSIONS = {
  "studies.view": "Ver estudos",
  "studies.manage": "Gerenciar estudos",
  "participants.view": "Ver participantes",
  "participants.edit": "Editar participantes",
  "participants.contact": "Ver dados de contato",
  "communication.view": "Ver comunicação",
  "communication.send": "Enviar mensagens",
  "agenda.view": "Ver agenda",
  "agenda.manage": "Gerenciar agenda",
  "tasks.view": "Ver pendências",
  "tasks.manage": "Gerenciar pendências",
  "finance.view": "Ver financeiro",
  "finance.manage": "Gerenciar financeiro",
  "reports.view": "Ver relatórios",
  "templates.manage": "Gerenciar modelos",
  "automations.manage": "Gerenciar automações",
  "settings.manage": "Gerenciar configurações",
  "audit.view": "Ver auditoria",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
  { label: "Estudos e participantes", permissions: ["studies.view", "studies.manage", "participants.view", "participants.edit", "participants.contact"] },
  { label: "Operação", permissions: ["communication.view", "communication.send", "agenda.view", "agenda.manage", "tasks.view", "tasks.manage"] },
  { label: "Financeiro e relatórios", permissions: ["finance.view", "finance.manage", "reports.view"] },
  { label: "Administração", permissions: ["templates.manage", "automations.manage", "settings.manage", "audit.view"] },
];

const ALL = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  DIRETOR: ALL.filter((p) => p !== "finance.manage"),
  COORDENADOR: ALL.filter((p) => p !== "finance.manage" && p !== "audit.view"),
  ASSISTENTE: [
    "studies.view",
    "participants.view",
    "participants.edit",
    "participants.contact",
    "communication.view",
    "communication.send",
    "agenda.view",
    "agenda.manage",
    "tasks.view",
    "tasks.manage",
    "reports.view",
  ],
  // Financeiro vê participantes apenas pelo nome — sem dados de contato.
  FINANCEIRO: ["studies.view", "participants.view", "finance.view", "finance.manage", "reports.view", "tasks.view"],
  // Qualidade: leitura ampla + auditoria + gestão dos modelos aprovados.
  QUALIDADE: [
    "studies.view",
    "participants.view",
    "communication.view",
    "agenda.view",
    "tasks.view",
    "finance.view",
    "reports.view",
    "templates.manage",
    "audit.view",
  ],
};

export function roleCan(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Funções com acesso a todos os estudos; as demais veem apenas estudos em que são membros. */
export const CROSS_STUDY_ROLES: UserRole[] = ["DIRETOR", "FINANCEIRO", "QUALIDADE"];
