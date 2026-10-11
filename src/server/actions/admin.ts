"use server";

import type { ReimbursementStatus } from "@prisma/client";
import { cookies } from "next/headers";
import { getIntegrations } from "@/integrations";
import { userActor } from "@/server/actor";
import { canAccessStudy, getCurrentUser, requirePermission, SESSION_COOKIE } from "@/server/auth/session";
import { runScheduledAutomations } from "@/server/automations/engine";
import { db } from "@/server/db";
import { seedDatabase } from "@/server/demo/seed";
import { DomainError } from "@/server/errors";
import { recordAudit } from "@/server/services/audit";
import { setReimbursementStatus } from "@/server/services/finance";
import { act } from "./result";

/** Troca o perfil ativo (somente no modo demonstração). */
export async function switchDemoUserAction(userId: string) {
  return act(async () => {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) throw new DomainError("Usuário não encontrado.");
    const store = await cookies();
    store.set(SESSION_COOKIE, user.id, { httpOnly: true, sameSite: "lax", path: "/" });
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await recordAudit({ actor: { type: "SYSTEM" }, action: "user.login", entityType: "User", entityId: user.id, summary: `${user.name} entrou (troca de perfil na demonstração)` });
    return { message: `Você está vendo o sistema como ${user.name}` };
  });
}

export async function runAutomationCycleAction() {
  return act(async () => {
    await requirePermission("tasks.view");
    const r = await runScheduledAutomations();
    const message =
      r.reminders + r.followUps + r.tasksCreated === 0
        ? "Ciclo executado — nada pendente no momento"
        : `Ciclo executado: ${r.reminders} lembrete(s), ${r.followUps} follow-up(s) e ${r.tasksCreated} pendência(s)`;
    return { message, details: r.details };
  });
}

export async function toggleAutomationRuleAction(ruleId: string, enabled: boolean) {
  return act(async () => {
    const user = await requirePermission("automations.manage");
    const rule = await db.automationRule.update({ where: { id: ruleId }, data: { enabled } });
    await recordAudit({ actor: userActor(user), action: enabled ? "automation.enabled" : "automation.disabled", entityType: "AutomationRule", entityId: rule.id, summary: `Automação “${rule.name}” ${enabled ? "ativada" : "desativada"}` });
    return { message: `Automação “${rule.name}” ${enabled ? "ativada" : "desativada"}` };
  });
}

/** Sincronização simulada com o Polo Trial: atualiza apenas o carimbo de sincronização. */
export async function syncPoloTrialAction() {
  return act(async () => {
    const user = await requirePermission("studies.view");
    const sourceStudies = await getIntegrations().poloTrial.getStudies();
    const now = new Date();
    for (const s of sourceStudies) {
      await db.study.update({ where: { code: s.code }, data: { enrolledCount: s.enrolledCount, screeningCount: s.screeningCount, sourceSyncedAt: now } });
    }
    await db.externalReference.updateMany({ where: { system: "POLO_TRIAL" }, data: { lastSyncedAt: now } });
    await recordAudit({ actor: userActor(user), action: "integration.sync", entityType: "Study", summary: `Sincronização com o Polo Trial (simulada): ${sourceStudies.length} estudos`, metadata: { system: "POLO_TRIAL", mode: "mock" } });
    return { message: "Sincronização simulada concluída", details: [`${sourceStudies.length} estudos conferidos com a fonte (adapter simulado)`] };
  });
}

export async function setReimbursementStatusAction(ids: string[], status: ReimbursementStatus) {
  return act(async () => {
    const user = await requirePermission("finance.manage");
    const items = await db.reimbursement.findMany({ where: { id: { in: ids } }, select: { id: true, studyId: true } });
    const allowed = items.filter((r) => canAccessStudy(user, r.studyId)).map((r) => r.id);
    const n = await setReimbursementStatus(allowed, status, userActor(user));
    if (status === "EM_CONCILIACAO") {
      await getIntegrations().finance.exportReimbursements([]); // ponto de integração futura (simulado)
    }
    return { message: `${n} reembolso(s) atualizado(s)` };
  });
}

export async function markNotificationsReadAction() {
  const user = await getCurrentUser();
  await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
}

/** Restaura os dados de demonstração (apaga tudo e recria o seed). */
export async function resetDemoDataAction() {
  return act(async () => {
    const user = await requirePermission("settings.manage");
    await seedDatabase(db);
    const store = await cookies();
    const same = await db.user.findUnique({ where: { email: user.email } });
    if (same) store.set(SESSION_COOKIE, same.id, { httpOnly: true, sameSite: "lax", path: "/" });
    return { message: "Dados de demonstração restaurados" };
  });
}
