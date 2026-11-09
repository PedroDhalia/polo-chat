import "server-only";
import type { AutomationRunStatus, Communication, Participant, Study, Task, Visit, VisitCategory } from "@prisma/client";
import { DEFAULT_AI, estimateCostUsd, isAiMode, needsAiReview } from "@/domain/assist-ai";
import { CALL_RESCHEDULE_PREFIX, confidenceLabel, DEFAULT_FOLLOW_UP, evaluatePolicy, INTENT_ACTION, INTENT_LABEL, isActionable, isWithinSendWindow } from "@/domain/assist-policy";
import { getIntegrations } from "@/integrations";
import type { AiInterpretation } from "@/integrations/ai/types";
import { callLabel, pickCallSlot } from "@/domain/call-slot";
import { firstName } from "@/lib/format";
import { addDays, atLocalTime, formatDayMonth, formatTime, localHour, startOfDay } from "@/lib/dates";
import { automationActor, type Actor } from "@/server/actor";
import { analyzeMessage, type AssistResult } from "@/server/ai/assist";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { getAssistPolicy, getAutomationSettings } from "@/server/services/assist";
import { notifyUser, recordAudit } from "@/server/services/audit";
import { createReimbursementForVisit } from "@/server/services/finance";
import { hasWhatsAppConsent, nextActiveVisit, sendTemplateMessage, setConversationStatus } from "@/server/services/messaging";
import { changeParticipantStatus, revokeWhatsAppConsent } from "@/server/services/participants";
import { closeTasks, createTask, findOpenTasks } from "@/server/services/tasks";
import { acceptProposedDate, changeVisitStatus, createVisit, declineProposedDate, findPendingProposal } from "@/server/services/visits";
import type { AutomationRuleKey } from "./rules";

// Motor de automações do MVP: Evento → Regra → Ação → Resultado.
// - Eventos de domínio são despachados pelas ações do usuário (dispatch).
// - Regras baseadas em tempo rodam no ciclo agendado (runScheduledAutomations),
//   acionado manualmente na demo; no produto real, por um agendador (cron/fila).
// - Toda execução fica registrada em AutomationRun, inclusive as ignoradas.

export type DomainEvent =
  | { type: "visit.confirmed"; visitId: string }
  | { type: "visit.completed"; visitId: string }
  | { type: "visit.missed"; visitId: string }
  | { type: "message.received"; communicationId: string }
  | { type: "form.received"; participantId: string };

async function ruleIfEnabled(key: AutomationRuleKey) {
  const rule = await db.automationRule.findUnique({ where: { key } });
  return rule?.enabled ? rule : null;
}

async function logRun(
  ruleId: string,
  status: AutomationRunStatus,
  summary: string,
  ctx: { entityType?: string; entityId?: string; studyId?: string | null; participantId?: string | null } = {},
) {
  await db.automationRun.create({
    data: { ruleId, status, summary, entityType: ctx.entityType ?? null, entityId: ctx.entityId ?? null, studyId: ctx.studyId ?? null, participantId: ctx.participantId ?? null },
  });
}

/** Prazo padrão: hoje às 18h se ainda houver expediente; senão, amanhã às 12h. */
function defaultDue(now = new Date()): Date {
  const today18 = atLocalTime(0, 18, 0, now);
  return now.getTime() < atLocalTime(0, 15, 0, now).getTime() ? today18 : atLocalTime(1, 12, 0, now);
}

/** Despacha um evento de domínio e retorna os resultados legíveis (para exibir ao usuário). */
export async function dispatch(event: DomainEvent): Promise<string[]> {
  const results: string[] = [];
  switch (event.type) {
    case "visit.missed": {
      const rule = await ruleIfEnabled("faltou-reagendar");
      if (!rule) break;
      const visit = await db.visit.findUniqueOrThrow({ where: { id: event.visitId }, include: { participant: true } });
      const window = visit.windowEnd ? ` Janela informada pelo Polo Trial até ${formatDayMonth(visit.windowEnd)}.` : "";
      const assigneeId = visit.participant.ownerId ?? visit.staffId;
      const task = await createTask(
        {
          title: `${visit.participant.fullName} precisa ser reagendado`,
          description: `Faltou à visita ${visit.name} em ${formatDayMonth(visit.scheduledAt)} às ${formatTime(visit.scheduledAt)}.${window}`,
          priority: "ALTA",
          dueAt: defaultDue(),
          studyId: visit.studyId,
          participantId: visit.participantId,
          visitId: visit.id,
          assigneeId,
          source: "AUTOMACAO",
          automationKey: rule.key as AutomationRuleKey,
        },
        automationActor("faltou-reagendar"),
      );
      await logRun(rule.id, "SUCESSO", `Pendência criada: ${task.title}`, { entityType: "Task", entityId: task.id, studyId: visit.studyId, participantId: visit.participantId });
      results.push("Pendência de reagendamento criada (alta prioridade)");

      // Avisa o participante com o modelo aprovado; sem consentimento, fica só a pendência (ligação).
      const ctx = { entityType: "Visit", entityId: visit.id, studyId: visit.studyId, participantId: visit.participantId };
      if (await hasWhatsAppConsent(visit.participantId)) {
        try {
          await sendTemplateMessage({ participantId: visit.participantId, templateKey: "tpl-falta-visita", visitId: visit.id, actor: automationActor("faltou-reagendar") });
          await logRun(rule.id, "SUCESSO", `“Falta na visita” enviada para ${visit.participant.fullName}`, ctx);
          results.push("Mensagem “Falta na visita” enviada");
        } catch (e) {
          const reason = e instanceof DomainError ? e.message : "erro inesperado";
          await logRun(rule.id, "FALHA", `“Falta na visita” não enviada para ${visit.participant.fullName}: ${reason}`, ctx);
          results.push(`Mensagem “Falta na visita” não enviada: ${reason}`);
        }
      } else {
        results.push("Sem consentimento de WhatsApp: nenhuma mensagem enviada, contato por telefone");
      }
      break;
    }

    case "visit.confirmed": {
      const rule = await ruleIfEnabled("confirmacao-visita");
      if (!rule) break;
      const visit = await db.visit.findUniqueOrThrow({ where: { id: event.visitId }, include: { participant: true } });
      const actor = automationActor("confirmacao-visita");
      if (await hasWhatsAppConsent(visit.participantId)) {
        await sendTemplateMessage({ participantId: visit.participantId, templateKey: "tpl-confirmacao", visitId: visit.id, actor });
        results.push("Mensagem “Confirmação de agendamento” enviada");
      }
      const open = await findOpenTasks({ visitId: visit.id });
      const closed = await closeTasks(open, actor, "Encerrada automaticamente: visita confirmada.");
      if (closed > 0) results.push(`${closed} pendência(s) da visita encerrada(s)`);
      const conv = await db.conversation.findFirst({ where: { participantId: visit.participantId, channel: "WHATSAPP" } });
      if (conv) await setConversationStatus(conv.id, "RESOLVIDA", actor);
      await logRun(rule.id, "SUCESSO", `Visita de ${visit.participant.fullName} confirmada: ${results.join("; ") || "sem ações adicionais"}`, { entityType: "Visit", entityId: visit.id, studyId: visit.studyId, participantId: visit.participantId });
      break;
    }

    case "visit.completed": {
      const rule = await ruleIfEnabled("realizada-reembolso");
      if (!rule) break;
      const r = await createReimbursementForVisit(event.visitId, automationActor("realizada-reembolso"));
      const visit = await db.visit.findUniqueOrThrow({ where: { id: event.visitId }, include: { participant: true } });
      await logRun(rule.id, "SUCESSO", `Reembolso ${r.code} gerado para ${visit.participant.fullName} (${visit.name})`, { entityType: "Reimbursement", entityId: r.id, studyId: visit.studyId, participantId: visit.participantId });
      results.push(`Reembolso ${r.code} gerado para o financeiro`);
      break;
    }

    case "message.received": {
      const msg = await db.communication.findUniqueOrThrow({ where: { id: event.communicationId }, include: { participant: { include: { study: true } } } });
      const p = msg.participant;

      // Participante respondeu: pendências de "sem resposta" perdem o motivo de existir.
      const noReply = await ruleIfEnabled("sem-resposta-24h");
      if (noReply) {
        const open = await findOpenTasks({ participantId: p.id, automationKey: "sem-resposta-24h" });
        if (open.length) {
          await closeTasks(open, automationActor("sem-resposta-24h"), "Encerrada automaticamente: participante respondeu.");
          await logRun(noReply.id, "SUCESSO", `Pendência encerrada: ${p.fullName} respondeu`, { studyId: p.studyId, participantId: p.id });
          results.push("Pendência “sem resposta” encerrada");
        }
      }

      // Possível relato clínico: nunca responder automaticamente; encaminhar à coordenação.
      if (msg.intent === "POSSIVEL_RELATO_CLINICO") results.push(...(await escalateClinical(p)));

      // Assistência: aplica sozinha (política do estudo) ou deixa na fila de revisão.
      results.push(...(await handleAssist(msg)));
      break;
    }

    case "form.received": {
      const rule = await ruleIfEnabled("formulario-entrada");
      if (!rule) break;
      const p = await db.participant.findUniqueOrThrow({ where: { id: event.participantId } });
      const task = await createTask(
        { title: `Primeiro contato com ${p.fullName}`, priority: "MEDIA", dueAt: defaultDue(), studyId: p.studyId, participantId: p.id, assigneeId: p.ownerId, source: "FORMULARIO", automationKey: "formulario-entrada" },
        automationActor("formulario-entrada"),
      );
      await logRun(rule.id, "SUCESSO", `Candidato cadastrado e pendência criada: ${task.title}`, { entityType: "Participant", entityId: p.id, studyId: p.studyId, participantId: p.id });
      results.push(`Pendência “${task.title}” criada`);
      break;
    }
  }
  return results;
}

/** Ciclo agendado (lembretes 24h e follow-up de quem não respondeu). */
export async function runScheduledAutomations(now = new Date()) {
  const details: string[] = [];
  let reminders = 0;
  let followUps = 0;
  let tasksCreated = 0;
  let skipped = 0;
  let outsideWindow = 0;

  // 1) Lembrete 24h antes das visitas de amanhã.
  const reminderRule = await ruleIfEnabled("lembrete-24h");
  const windows = new Map((await db.studyAutomationSettings.findMany()).map((x) => [x.studyId, x]));
  if (reminderRule) {
    const tomorrow = addDays(startOfDay(now), 1);
    const due = await db.visit.findMany({
      where: { scheduledAt: { gte: tomorrow, lt: addDays(tomorrow, 1) }, status: { in: ["AGUARDANDO_CONFIRMACAO", "CONFIRMADO"] }, reminderSentAt: null },
      include: { participant: true },
      orderBy: { scheduledAt: "asc" },
    });
    for (const v of due) {
      const ctx = { entityType: "Visit", entityId: v.id, studyId: v.studyId, participantId: v.participantId };
      if (await hasWhatsAppConsent(v.participantId)) {
        const w = windows.get(v.studyId) ?? DEFAULT_FOLLOW_UP;
        if (!isWithinSendWindow(localHour(now), w.sendWindowStart, w.sendWindowEnd)) {
          outsideWindow++;
          continue;
        }
        try {
          await sendTemplateMessage({ participantId: v.participantId, templateKey: "tpl-lembrete-visita", visitId: v.id, actor: automationActor("lembrete-24h") });
          await logRun(reminderRule.id, "SUCESSO", `Lembrete de visita enviado para ${v.participant.fullName} (visita ${formatDayMonth(v.scheduledAt)} às ${formatTime(v.scheduledAt)})`, ctx);
          details.push(`Lembrete enviado para ${v.participant.fullName} (${formatTime(v.scheduledAt)})`);
          reminders++;
        } catch (e) {
          await logRun(reminderRule.id, "FALHA", `Falha ao enviar lembrete para ${v.participant.fullName}: ${e instanceof DomainError ? e.message : "erro inesperado"}`, ctx);
        }
      } else {
        await db.visit.update({ where: { id: v.id }, data: { reminderSentAt: now } });
        await createTask(
          { title: `Confirmar visita de ${v.participant.fullName} por telefone`, description: "Participante sem consentimento para WhatsApp.", priority: "MEDIA", dueAt: defaultDue(now), studyId: v.studyId, participantId: v.participantId, visitId: v.id, assigneeId: v.participant.ownerId, source: "AUTOMACAO", automationKey: "lembrete-24h" },
          automationActor("lembrete-24h"),
        );
        await logRun(reminderRule.id, "IGNORADA", `Lembrete não enviado a ${v.participant.fullName}: sem consentimento para WhatsApp. Pendência de contato telefônico criada.`, ctx);
        details.push(`${v.participant.fullName}: sem consentimento para WhatsApp — pendência de ligação criada`);
        skipped++;
        tasksCreated++;
      }
    }
  }

  // 2) Follow-up de quem não respondeu: mensagem automática até o limite do estudo;
  //    esgotadas as tentativas (ou com visita em menos de 24h), pendência de ligação.
  const noReplyRule = await ruleIfEnabled("sem-resposta-24h");
  if (noReplyRule) {
    const settings = new Map((await db.studyAutomationSettings.findMany()).map((x) => [x.studyId, x]));
    const minInterval = Math.min(24, ...[...settings.values()].map((x) => x.followUpIntervalHours));
    const waiting = await db.conversation.findMany({
      where: { status: "AGUARDANDO_RESPOSTA", lastMessageAt: { lte: new Date(now.getTime() - minInterval * 3_600_000) } },
      include: { participant: true, messages: { where: { direction: { not: "INTERNAL_NOTE" } }, orderBy: { sentAt: "desc" }, take: 1, include: { template: true } } },
      orderBy: { lastMessageAt: "asc" },
    });
    for (const c of waiting) {
      const cfg = settings.get(c.studyId) ?? DEFAULT_FOLLOW_UP;
      if (c.lastMessageAt.getTime() > now.getTime() - cfg.followUpIntervalHours * 3_600_000) continue;
      const last = c.messages[0];
      if (!last || last.direction !== "OUTBOUND") continue;
      // A equipe já está cuidando deste participante.
      const open = await db.task.count({ where: { participantId: c.participantId, status: { in: ["ABERTA", "EM_ANDAMENTO"] } } });
      if (open > 0) continue;

      const name = c.participant.fullName;
      const ctx = { entityType: "Conversation", entityId: c.id, studyId: c.studyId, participantId: c.participantId };
      const visit = await nextActiveVisit(c.participantId);
      const urgentVisit = !!visit && visit.status === "AGUARDANDO_CONFIRMACAO" && visit.scheduledAt.getTime() <= now.getTime() + 24 * 3_600_000;
      const consent = await hasWhatsAppConsent(c.participantId);
      const canMessage = cfg.followUpEnabled && c.followUpAttempts < cfg.followUpMaxAttempts && !urgentVisit && consent;

      if (canMessage) {
        if (!isWithinSendWindow(localHour(now), cfg.sendWindowStart, cfg.sendWindowEnd)) {
          outsideWindow++;
          continue;
        }
        const templateKey = c.participant.status === "NOVO" || c.participant.status === "EM_CONTATO" ? "tpl-segundo-contato" : "tpl-solicitacao-contato";
        const attempt = c.followUpAttempts + 1;
        try {
          await sendTemplateMessage({ participantId: c.participantId, templateKey, actor: automationActor("sem-resposta-24h") });
          await db.conversation.update({ where: { id: c.id }, data: { followUpAttempts: attempt, lastFollowUpAt: now } });
          await logRun(noReplyRule.id, "SUCESSO", `Follow-up ${attempt}/${cfg.followUpMaxAttempts} enviado para ${name}`, ctx);
          details.push(`Follow-up ${attempt}/${cfg.followUpMaxAttempts} enviado para ${name}`);
          followUps++;
        } catch (e) {
          await logRun(noReplyRule.id, "FALHA", `Falha no follow-up para ${name}: ${e instanceof DomainError ? e.message : "erro inesperado"}`, ctx);
        }
        continue;
      }

      const why = urgentVisit
        ? "visita em menos de 24h ainda sem confirmação"
        : !consent
          ? "sem consentimento para WhatsApp"
          : !cfg.followUpEnabled || cfg.followUpMaxAttempts === 0
            ? "follow-up automático desligado neste estudo"
            : `${c.followUpAttempts} follow-up(s) automático(s) sem resposta`;
      const what = last.template ? `ao ${last.template.name.toLowerCase()}` : "à última mensagem";
      const task = await createTask(
        {
          title: urgentVisit && visit ? `Confirmar visita de ${name} por telefone` : `${name} não respondeu ${what}`,
          description: `Sem resposta: ${why}. Sugestão: tentar contato telefônico com ${firstName(name)}.`,
          priority: urgentVisit ? "ALTA" : "MEDIA",
          dueAt: defaultDue(now),
          studyId: c.studyId,
          participantId: c.participantId,
          visitId: urgentVisit && visit ? visit.id : null,
          assigneeId: c.participant.ownerId,
          source: "AUTOMACAO",
          automationKey: "sem-resposta-24h",
        },
        automationActor("sem-resposta-24h"),
      );
      await logRun(noReplyRule.id, "SUCESSO", `Pendência criada: ${task.title} (${why})`, ctx);
      details.push(`Pendência criada: ${task.title}`);
      tasksCreated++;
    }

  }

  if (outsideWindow > 0) details.push(`${outsideWindow} envio(s) aguardando o horário de envio do estudo (lembretes e follow-ups só saem dentro da janela)`);

  await recordAudit({
    actor: { type: "SYSTEM" },
    action: "automation.cycle",
    entityType: "AutomationRule",
    summary: `Ciclo de automações: ${reminders} lembrete(s), ${followUps} follow-up(s), ${tasksCreated} pendência(s) criada(s)`,
    metadata: { reminders, followUps, tasksCreated, skipped, outsideWindow },
  });
  return { reminders, followUps, tasksCreated, skipped, outsideWindow, details };
}

// ─── Assistência IA ─────────────────────────────────────────────────────────

const AI = automationActor("assistencia-ia");

/** Possível relato clínico: pendência de alta prioridade para a coordenação (nunca resposta automática). */
async function escalateClinical(p: Participant): Promise<string[]> {
  const conv = await db.conversation.findFirst({ where: { participantId: p.id, channel: "WHATSAPP" } });
  if (conv && conv.status !== "REQUER_ATENCAO") await db.conversation.update({ where: { id: conv.id }, data: { status: "REQUER_ATENCAO" } });
  const rule = await ruleIfEnabled("mensagem-clinica");
  if (!rule) return [];
  const task = await createTask(
    {
      title: `Encaminhar relato de ${p.fullName} à equipe médica`,
      description: "Mensagem via WhatsApp menciona sintomas. Avaliação e registro cabem à equipe médica do estudo, fora do Polo Chat.",
      priority: "ALTA",
      dueAt: new Date(Date.now() + 60 * 60_000),
      studyId: p.studyId,
      participantId: p.id,
      assigneeId: (await db.study.findUniqueOrThrow({ where: { id: p.studyId } })).ownerId,
      source: "COMUNICACAO",
      automationKey: "mensagem-clinica",
    },
    automationActor("mensagem-clinica"),
  );
  await logRun(rule.id, "SUCESSO", `Pendência criada: ${task.title}`, { entityType: "Task", entityId: task.id, studyId: p.studyId, participantId: p.id });
  return ["Possível relato clínico: pendência de alta prioridade criada para a coordenação"];
}

const CANDIDATE_STATUSES = ["NOVO", "EM_CONTATO", "PRE_TRIAGEM", "AGUARDANDO_AGENDAMENTO"];
const FAQ_TEMPLATE: Record<NonNullable<AiInterpretation["faqTopic"]>, string> = {
  ressarcimento: "tpl-faq-ressarcimento",
  documentos: "tpl-faq-documentos",
  endereco: "tpl-faq-endereco",
};

/** Converte o rótulo da IA no mesmo formato da análise por regras (a política não distingue a origem). */
function fromInterpretation(r: AiInterpretation, hasPendingVisit: boolean): AssistResult {
  const score = r.ambiguous ? Math.min(r.confidence, 55) : r.confidence;
  const template =
    r.intent === "DUVIDA_FREQUENTE" && r.faqTopic ? FAQ_TEMPLATE[r.faqTopic] : r.intent === "CONFIRMACAO" ? "tpl-confirmacao" : r.intent === "REAGENDAMENTO" ? "tpl-reagendamento" : null;
  const actions: Partial<Record<string, AssistResult["suggestedAction"]>> = {
    CONFIRMACAO: "CONFIRM_VISIT",
    REAGENDAMENTO: hasPendingVisit ? "REQUEST_RESCHEDULE" : "CALL_PARTICIPANT",
    POSSIVEL_RELATO_CLINICO: "ESCALATE_CLINICAL",
    DESCADASTRO: "REVOKE_CONSENT",
    INTERESSE: "CALL_PARTICIPANT",
  };
  return {
    intent: r.intent,
    label: INTENT_LABEL[r.intent],
    score,
    confidence: confidenceLabel(score),
    ambiguous: r.ambiguous,
    signals: [r.intent],
    rationale: `IA: ${r.rationale}`,
    suggestedTemplateKey: template,
    suggestedAction: actions[r.intent] ?? null,
    guardrail: r.intent === "POSSIVEL_RELATO_CLINICO" ? "A assistência não interpreta sintomas nem sugere resposta. Encaminhe à equipe médica do estudo." : null,
  };
}

/**
 * Segunda opinião da IA. Envia só o necessário (mensagem, conversa recente e contexto, com o nome
 * trocado por [nome]) e registra o consumo — inclusive quando falha, para a tela de consumo.
 */
async function consultAi(msg: InboundMessage, visit: Visit | null, hasPendingVisit: boolean) {
  const p = msg.participant;
  const adapter = getIntegrations().ai;
  const name = firstName(p.fullName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const scrub = (text: string) => text.replace(new RegExp(name, "gi"), "[nome]");
  const recent = await db.communication.findMany({
    where: { participantId: p.id, direction: { not: "INTERNAL_NOTE" }, sentAt: { lt: msg.sentAt } },
    orderBy: { sentAt: "desc" },
    take: 6,
  });
  const input = {
    message: scrub(msg.body),
    history: recent.reverse().map((m) => ({ from: m.direction === "INBOUND" ? ("participante" as const) : ("centro" as const), text: scrub(m.body).slice(0, 300) })),
    context: {
      stage: CANDIDATE_STATUSES.includes(p.status) ? ("candidato" as const) : ("participante" as const),
      hasPendingVisit,
      hasConfirmedVisit: visit?.status === "CONFIRMADO",
      hasDateProposal: !!visit?.proposedAt,
      hasScheduledCall: !!(await findScheduledCall(p.id)),
    },
  };
  const base = { studyId: p.studyId, studyCode: p.study.code, participantId: p.id, communicationId: msg.id, mode: adapter.mode };
  try {
    const { result, usage } = await adapter.interpret(input);
    const row = await db.aiUsage.create({
      data: {
        ...base,
        model: usage.model,
        status: "OK",
        intent: result.intent,
        confidence: result.confidence,
        rationale: result.rationale,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        costUsd: estimateCostUsd(usage.model, usage),
        latencyMs: usage.latencyMs,
      },
    });
    return { result, usageId: row.id, label: adapter.mode === "mock" ? "IA (simulada)" : "IA" };
  } catch (e) {
    await db.aiUsage.create({ data: { ...base, model: adapter.model, status: "ERRO", outcome: "ERRO", error: (e instanceof Error ? e.message : String(e)).slice(0, 300) } });
    return null;
  }
}

/** Há algo concreto a fazer para a intenção? (ex.: uma visita aguardando confirmação). */
async function checkApplicable(a: AssistResult, participantId: string, visit: Visit | null): Promise<{ ok: boolean; reason?: string }> {
  switch (a.intent) {
    case "CONFIRMACAO":
      // Já confirmada: a automação só reenvia a confirmação com a data.
      if (visit?.proposedAt || visit?.status === "AGUARDANDO_CONFIRMACAO" || visit?.status === "CONFIRMADO") return { ok: true };
      if (visit?.status === "REAGENDAMENTO_SOLICITADO") return { ok: false, reason: "Visita com remarcação solicitada: proponha uma nova data" };
      return { ok: false, reason: "Nenhuma visita futura para confirmar (a visita pode já ter passado)" };
    case "REAGENDAMENTO":
      return visit || (await findScheduledCall(participantId)) ? { ok: true } : { ok: false, reason: "Nenhuma visita ou ligação agendada para remarcar" };
    case "DUVIDA_FREQUENTE": {
      if (!a.suggestedTemplateKey) return { ok: false, reason: "Sem resposta aprovada para a dúvida" };
      const tpl = await db.messageTemplate.findUnique({ where: { key: a.suggestedTemplateKey } });
      if (tpl?.approvalStatus !== "APROVADO") return { ok: false, reason: "A resposta para a dúvida não está aprovada pelo CEP" };
      return (await hasWhatsAppConsent(participantId)) ? { ok: true } : { ok: false, reason: "Sem consentimento para responder por WhatsApp" };
    }
    default:
      return { ok: true };
  }
}

type InboundMessage = Communication & { participant: Participant & { study: Study } };

async function handleAssist(msg: InboundMessage): Promise<string[]> {
  const p = msg.participant;
  // Nova data proposta tem prioridade: o "confirmo" responde a ela.
  const visit = (await findPendingProposal(p.id)) ?? (await nextActiveVisit(p.id));
  const hasPendingVisit = (!!visit && visit.status !== "CONFIRMADO") || !!visit?.proposedAt;
  let a = analyzeMessage(msg.body, { hasPendingVisit, hasUpcomingVisit: !!visit });
  const rule = await db.automationRule.findUnique({ where: { key: "assistencia-ia" } });
  let policy = isActionable(a.intent) ? await getAssistPolicy(p.studyId, a.intent) : null;
  const lines: string[] = [];

  // Segunda opinião da IA: só para o que as regras não resolveram (custo só no resíduo).
  const settings = await getAutomationSettings(p.studyId);
  const aiMode = "aiMode" in settings && isAiMode(settings.aiMode) ? settings.aiMode : DEFAULT_AI.aiMode;
  const aiMin = "aiMinConfidence" in settings ? settings.aiMinConfidence : DEFAULT_AI.aiMinConfidence;
  let ai: { source: "IA"; rulesIntent: string; rulesConfidence: number; timeHint: string | null; usageId: string } | null = null;
  if (rule?.enabled && aiMode !== "DESLIGADA" && needsAiReview(a, policy?.minConfidence ?? null)) {
    const consulted = await consultAi(msg, visit, hasPendingVisit);
    if (consulted && consulted.result.intent === "OUTRO" && a.intent !== "OUTRO") {
      // A IA não acrescentou nada: fica valendo a leitura das regras.
      await db.aiUsage.update({ where: { id: consulted.usageId }, data: { outcome: "SEM_GANHO" } });
      lines.push(`${consulted.label} não identificou outra intenção: mantida a leitura das regras`);
    } else if (consulted) {
      const r = consulted.result;
      ai = { source: "IA", rulesIntent: a.intent, rulesConfidence: a.score, timeHint: r.preferredTime ? `${r.preferredDay ?? ""} as ${r.preferredTime}`.trim() : null, usageId: consulted.usageId };
      a = fromInterpretation(r, hasPendingVisit);
      policy = isActionable(a.intent) ? await getAssistPolicy(p.studyId, a.intent) : null;
      await db.communication.update({ where: { id: msg.id }, data: { intent: a.intent } });
      lines.push(`${consulted.label} interpretou: ${INTENT_LABEL[a.intent]} (confiança ${a.score})`);
      if (a.intent === "POSSIVEL_RELATO_CLINICO") lines.push(...(await escalateClinical(p)));
    } else {
      lines.push("IA indisponível: mensagem na fila para a equipe");
    }
  }

  const applicable = await checkApplicable(a, p.id, visit);
  let ev = evaluatePolicy(a, policy, { ruleEnabled: !!rule?.enabled, applicable: applicable.ok, notApplicableReason: applicable.reason });
  let action = isActionable(a.intent) ? INTENT_ACTION[a.intent] : null;
  // Leitura da IA: além da política da intenção, vale o modo e a confiança mínima da IA no estudo.
  if (ai && ev.outcome === "AUTOMATICA") {
    if (aiMode !== "AUTOMATICO") ev = { outcome: "PENDENTE", reason: "IA em modo sugestão neste estudo" };
    else if (a.score < aiMin) ev = { outcome: "PENDENTE", reason: `IA: confiança ${a.score} abaixo do mínimo da IA (${aiMin})` };
    else ev = { ...ev, reason: `IA: ${ev.reason}` };
  } else if (ai) {
    ev = { ...ev, reason: `IA: ${ev.reason}` };
  }

  // Candidato pediu outro horário para a ligação: a equipe aprova o novo horário antes de ele ser avisado.
  if (a.intent === "REAGENDAMENTO") {
    const call = await callRescheduleContext(p.id, visit);
    const slot = call && pickCallSlot(ai?.timeHint ?? msg.body, new Date(), { defaultDay: call.dueAt });
    if (call && slot?.preference && slot.at.getTime() !== call.dueAt.getTime()) {
      action = `${CALL_RESCHEDULE_PREFIX}${formatDayMonth(slot.at)} às ${formatTime(slot.at)} (pedido: ${slot.preference}) e avisar o candidato`;
      if (ev.outcome === "AUTOMATICA") ev = { outcome: "PENDENTE", reason: "Novo horário de ligação: a equipe aprova antes de avisar o candidato" };
    }
  }

  const decision = await db.assistDecision.upsert({
    where: { communicationId: msg.id },
    update: {},
    create: {
      communicationId: msg.id,
      participantId: p.id,
      studyId: p.studyId,
      intent: a.intent,
      confidence: a.score,
      ambiguous: a.ambiguous,
      outcome: ev.outcome,
      reason: ev.reason,
      action,
      suggestedTemplateKey: a.suggestedTemplateKey,
      ...(ai ? { source: ai.source, rulesIntent: ai.rulesIntent, rulesConfidence: ai.rulesConfidence, timeHint: ai.timeHint } : {}),
    },
  });
  if (ai) {
    const outcome = ev.outcome === "AUTOMATICA" ? "AUTOMATICA" : ev.outcome === "ENCAMINHADA" ? "ENCAMINHADA" : "EQUIPE";
    await db.aiUsage.update({ where: { id: ai.usageId }, data: { decisionId: decision.id, outcome } });
  }

  if (ev.outcome === "AUTOMATICA") {
    const applied = await applyAssistDecision(decision.id, AI);
    if (rule) {
      await logRun(rule.id, "SUCESSO", `${INTENT_LABEL[a.intent]} de ${p.fullName} aplicada automaticamente (confiança ${a.score}${ai ? ", leitura da IA" : ""}): ${applied.join("; ")}`, {
        entityType: "AssistDecision",
        entityId: decision.id,
        studyId: p.studyId,
        participantId: p.id,
      });
    }
    return [...lines, `IA aplicou sozinha — ${ev.reason}`, ...applied];
  }
  if (ev.outcome === "PENDENTE") return [...lines, `Assistência: ${INTENT_LABEL[a.intent]} · na fila de revisão (${ev.reason})`];
  return lines;
}

/**
 * Aplica a ação da intenção de uma decisão da assistência.
 * Usada pela automação (modo automático) e pela equipe ao aprovar uma sugestão da fila.
 */
/** Marca das pendências de ligação de pré-triagem agendadas pela assistência (Interesse). */
const CALL_TASK_MARK = "(pré-triagem)";

async function findScheduledCall(participantId: string) {
  return db.task.findFirst({ where: { participantId, status: { in: ["ABERTA", "EM_ANDAMENTO"] }, title: { endsWith: CALL_TASK_MARK } }, orderBy: { dueAt: "asc" } });
}

/** O pedido de outro horário é sobre a ligação agendada? Sim se não há visita, ou se a última mensagem do centro tratou da ligação. */
async function callRescheduleContext(participantId: string, visit: Visit | null): Promise<Task | null> {
  const call = await findScheduledCall(participantId);
  if (!call || !visit) return call;
  const lastOut = await db.communication.findFirst({ where: { participantId, direction: "OUTBOUND" }, orderBy: { sentAt: "desc" }, include: { template: { select: { key: true } } } });
  return lastOut?.template?.key === "tpl-ligacao-agendada" || lastOut?.template?.key === "tpl-solicitacao-contato" ? call : null;
}

/**
 * Remarca a ligação para o horário que o candidato pediu ("a partir das 17" → mesmo dia, 17h) e avisa.
 * Sem horário sugerido, pergunta qual é o melhor ("Solicitação de contato").
 */
async function rescheduleCall(call: Task, communicationId: string, p: Participant, actor: Actor, at?: Date, hint?: string | null): Promise<string[]> {
  const message = await db.communication.findUnique({ where: { id: communicationId } });
  if (at && at.getTime() < Date.now()) throw new DomainError("O novo horário da ligação precisa estar no futuro.");
  // A equipe pode aprovar um horário diferente do pedido.
  const slot = at ? { at, preference: "horário definido pela equipe" } : pickCallSlot(hint ?? message?.body ?? "", new Date(), { defaultDay: call.dueAt });
  const consent = await hasWhatsAppConsent(p.id);
  if (!slot.preference || slot.at.getTime() === call.dueAt.getTime()) {
    if (consent) await sendTemplateMessage({ participantId: p.id, templateKey: "tpl-solicitacao-contato", actor });
    return [`Ligação: ${p.fullName} não pode no horário e não sugeriu outro${consent ? " — “Solicitação de contato” enviada perguntando o melhor horário" : ""}`];
  }
  const when = callLabel(slot.at);
  await db.task.update({
    where: { id: call.id },
    data: { dueAt: slot.at, description: `${call.description ?? ""}\nRemarcada a pedido do candidato (${slot.preference}): ${when}.`.trim() },
  });
  await recordAudit({
    actor,
    action: "task.rescheduled",
    entityType: "Task",
    entityId: call.id,
    studyId: call.studyId,
    summary: `Ligação com ${p.fullName} remarcada para ${formatDayMonth(slot.at)} às ${formatTime(slot.at)}`,
    metadata: { from: call.dueAt.toISOString(), to: slot.at.toISOString(), preference: slot.preference },
  });
  const lines = [`Ligação remarcada para ${when} (pedido do candidato: ${slot.preference})`];
  if (consent) {
    // Aprovado o horário, o aviso sai pela automação.
    await sendTemplateMessage({ participantId: p.id, templateKey: "tpl-ligacao-agendada", extraVars: { ligacao: when }, actor: AI });
    lines.push("Participante avisado automaticamente: “Ligação agendada” com o novo horário");
  } else {
    const conv = await db.conversation.findFirst({ where: { participantId: p.id, channel: "WHATSAPP" } });
    if (conv) await setConversationStatus(conv.id, "RESOLVIDA", actor);
  }
  return lines;
}

/**
 * A equipe agenda uma visita combinada com o participante (ex.: na ligação de pré-triagem):
 * encerra a ligação pendente, atualiza o status do candidato, confirma e avisa (se já combinado)
 * e deixa a pendência de registrar a visita no Polo Trial.
 */
export async function scheduleVisitFromTeam(
  input: { participantId: string; name: string; category: VisitCategory; when: Date; confirmed: boolean },
  actor: Actor,
): Promise<string[]> {
  const { visit, participant } = await createVisit({ ...input, actor });
  const lines = [`Visita ${visit.name} agendada para ${formatDayMonth(visit.scheduledAt)} às ${formatTime(visit.scheduledAt)}`];
  if (input.category === "TRIAGEM" && ["NOVO", "EM_CONTATO", "PRE_TRIAGEM", "AGUARDANDO_AGENDAMENTO"].includes(participant.status)) {
    await changeParticipantStatus(participant.id, "AGENDADO", actor);
    lines.push("Status do participante: Agendado");
  }
  const calls = await db.task.findMany({ where: { participantId: participant.id, status: { in: ["ABERTA", "EM_ANDAMENTO"] }, title: { endsWith: CALL_TASK_MARK } } });
  if ((await closeTasks(calls, actor, "Ligação realizada: visita agendada.")) > 0) lines.push("Ligação de pré-triagem concluída");
  if (input.confirmed) {
    await changeVisitStatus(visit.id, "CONFIRMADO", actor);
    lines.push(...(await dispatch({ type: "visit.confirmed", visitId: visit.id })));
  } else {
    lines.push("Visita aguardando confirmação: use “Pedir confirmação” ou aguarde o lembrete da véspera");
  }
  await createTask(
    {
      title: `Registrar no Polo Trial a visita ${visit.name} (${participant.fullName})`,
      description: `Agendada para ${formatDayMonth(visit.scheduledAt)} às ${formatTime(visit.scheduledAt)}. Com a integração, este registro passará a ser automático.`,
      priority: "MEDIA",
      dueAt: defaultDue(),
      studyId: visit.studyId,
      participantId: participant.id,
      assigneeId: participant.ownerId,
      source: "COMUNICACAO",
    },
    actor,
  );
  lines.push("Pendência: registrar a visita no Polo Trial");
  return lines;
}

/**
 * O participante (ou a equipe, por telefone) aceitou a nova data: a visita muda na agenda e fica
 * confirmada, a confirmação é enviada e fica a pendência de registrar a nova data no Polo Trial
 * (o Polo Chat não escreve no Polo Trial).
 */
export async function confirmProposedDate(visitId: string, actor: Actor): Promise<string[]> {
  const { visit, participant, from } = await acceptProposedDate(visitId, actor);
  const lines = [`Visita ${visit.name} remarcada de ${formatDayMonth(from)} ${formatTime(from)} para ${formatDayMonth(visit.scheduledAt)} às ${formatTime(visit.scheduledAt)} e confirmada`];
  lines.push(...(await dispatch({ type: "visit.confirmed", visitId })));
  await createTask(
    {
      title: `Registrar no Polo Trial a nova data de ${visit.name} (${participant.fullName})`,
      description: `Remarcada de ${formatDayMonth(from)} ${formatTime(from)} para ${formatDayMonth(visit.scheduledAt)} às ${formatTime(visit.scheduledAt)}, confirmada pelo participante. Com a integração, este registro passará a ser automático.`,
      priority: "MEDIA",
      dueAt: defaultDue(),
      studyId: visit.studyId,
      participantId: visit.participantId,
      assigneeId: participant.ownerId,
      source: "COMUNICACAO",
    },
    actor,
  );
  lines.push("Pendência: registrar a nova data no Polo Trial");
  return lines;
}

export async function applyAssistDecision(decisionId: string, actor: Actor, opts: { callAt?: Date } = {}): Promise<string[]> {
  const d = await db.assistDecision.findUnique({ where: { id: decisionId }, include: { participant: true } });
  if (!d) throw new DomainError("Sugestão não encontrada.");
  if (!isActionable(d.intent)) throw new DomainError("Esta mensagem não tem ação automática: responda pela conversa.");
  if (actor.type === "USER" && d.outcome !== "PENDENTE") throw new DomainError("Esta sugestão já foi tratada.");
  const p = d.participant;
  const lines: string[] = [];

  switch (d.intent) {
    case "CONFIRMACAO": {
      const proposal = await findPendingProposal(p.id);
      if (proposal) {
        lines.push(...(await confirmProposedDate(proposal.id, actor)));
        break;
      }
      const visit = await db.visit.findFirst({
        where: { participantId: p.id, status: "AGUARDANDO_CONFIRMACAO", scheduledAt: { gte: new Date(Date.now() - 12 * 3_600_000) } },
        orderBy: { scheduledAt: "asc" },
      });
      if (!visit) {
        // Visita já confirmada (ex.: "Confirmo" em resposta ao lembrete da véspera): reenvia a confirmação.
        const confirmed = await nextActiveVisit(p.id);
        if (confirmed?.status !== "CONFIRMADO") throw new DomainError("Não há visita aguardando confirmação para este participante.");
        if (await hasWhatsAppConsent(p.id)) {
          await sendTemplateMessage({ participantId: p.id, templateKey: "tpl-confirmacao", visitId: confirmed.id, actor });
          lines.push(`Visita ${confirmed.name} já estava confirmada: confirmação reenviada (${formatDayMonth(confirmed.scheduledAt)} às ${formatTime(confirmed.scheduledAt)})`);
        } else {
          const conv = await db.conversation.findFirst({ where: { participantId: p.id, channel: "WHATSAPP" } });
          if (conv) await setConversationStatus(conv.id, "RESOLVIDA", actor);
          lines.push(`Visita ${confirmed.name} já estava confirmada: nada a fazer`);
        }
        break;
      }
      await changeVisitStatus(visit.id, "CONFIRMADO", actor);
      lines.push(`Visita ${visit.name} (${formatDayMonth(visit.scheduledAt)} às ${formatTime(visit.scheduledAt)}) confirmada`);
      lines.push(...(await dispatch({ type: "visit.confirmed", visitId: visit.id })));
      break;
    }
    case "DUVIDA_FREQUENTE": {
      if (!d.suggestedTemplateKey) throw new DomainError("Sem resposta aprovada para esta dúvida.");
      const { template } = await sendTemplateMessage({ participantId: p.id, templateKey: d.suggestedTemplateKey, actor });
      lines.push(`Resposta aprovada “${template.name}” enviada`);
      break;
    }
    case "REAGENDAMENTO": {
      // Pedido de outro horário para a ligação de pré-triagem agendada.
      const call = await callRescheduleContext(p.id, (await findPendingProposal(p.id)) ?? (await nextActiveVisit(p.id)));
      if (call) {
        lines.push(...(await rescheduleCall(call, d.communicationId, p, actor, opts.callAt, d.timeHint)));
        break;
      }
      // Não pode na data proposta: a proposta cai e a equipe propõe outra.
      const proposal = await findPendingProposal(p.id);
      if (proposal) {
        await declineProposedDate(proposal.id, actor);
        lines.push("Data proposta recusada: a equipe vai propor outra");
      }
      const visit = proposal ?? (await nextActiveVisit(p.id));
      if (visit) {
        if (visit.status === "AGUARDANDO_CONFIRMACAO" || visit.status === "CONFIRMADO") await changeVisitStatus(visit.id, "REAGENDAMENTO_SOLICITADO", actor);
        if ((await findOpenTasks({ visitId: visit.id })).length === 0) {
          await createTask(
            {
              title: `Reagendar visita ${visit.name} de ${p.fullName}`,
              priority: "MEDIA",
              dueAt: defaultDue(),
              studyId: p.studyId,
              participantId: p.id,
              visitId: visit.id,
              assigneeId: p.ownerId,
              source: "COMUNICACAO",
              automationKey: actor.type === "AUTOMATION" ? "assistencia-ia" : null,
            },
            actor,
          );
          lines.push("Pendência de reagendamento criada");
        }
      }
      if (await hasWhatsAppConsent(p.id)) {
        await sendTemplateMessage({ participantId: p.id, templateKey: "tpl-reagendamento", actor });
        lines.push("Resposta “Reagendamento” enviada");
      }
      break;
    }
    case "DESCADASTRO": {
      await revokeWhatsAppConsent(p.id, actor);
      const conv = await db.conversation.findFirst({ where: { participantId: p.id, channel: "WHATSAPP" } });
      if (conv) await setConversationStatus(conv.id, "RESOLVIDA", actor);
      await notifyUser(p.ownerId, {
        type: "MESSAGE",
        title: `${p.fullName} pediu para não receber mensagens`,
        body: "Consentimento de WhatsApp revogado. Novos envios estão bloqueados.",
        href: `/participantes/${p.id}`,
      });
      lines.push("Consentimento de WhatsApp revogado e responsável avisado");
      break;
    }
    case "INTERESSE": {
      // Horário pedido na mensagem ("amanhã de manhã", "depois das 14h") ou o próximo livre.
      const message = await db.communication.findUnique({ where: { id: d.communicationId } });
      const slot = pickCallSlot(d.timeHint ?? message?.body ?? "");
      const when = callLabel(slot.at);
      await createTask(
        {
          title: `Ligar para ${p.fullName} ${CALL_TASK_MARK}`,
          description: `Ligação combinada pelo WhatsApp: ${when}${slot.preference ? ` (pedido do candidato: ${slot.preference})` : " (próximo horário livre)"}. A elegibilidade é avaliada pela equipe.`,
          priority: "MEDIA",
          dueAt: slot.at,
          studyId: p.studyId,
          participantId: p.id,
          assigneeId: p.ownerId,
          source: "COMUNICACAO",
          automationKey: actor.type === "AUTOMATION" ? "assistencia-ia" : null,
        },
        actor,
      );
      lines.push(`Ligação agendada ${when} (pendência para o responsável)`);
      if (await hasWhatsAppConsent(p.id)) {
        await sendTemplateMessage({ participantId: p.id, templateKey: "tpl-ligacao-agendada", extraVars: { ligacao: when }, actor });
        lines.push("Participante avisado: “Ligação agendada”");
      }
      const conv = await db.conversation.findFirst({ where: { participantId: p.id, channel: "WHATSAPP" } });
      if (conv) await setConversationStatus(conv.id, "RESOLVIDA", actor);
      break;
    }
  }

  await db.assistDecision.update({
    where: { id: d.id },
    data: actor.type === "USER" ? { outcome: "APROVADA", reviewedById: actor.user.id, reviewedAt: new Date(), action: lines.join("; ") } : { action: lines.join("; ") },
  });
  return lines;
}
