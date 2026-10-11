// Verificação dos fluxos principais (serviços + automações) em um banco SQLite isolado.
// Uso: npm run verify   — não altera o banco da demonstração (prisma/dev.db).

import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

const DB_URL = "file:./verify.db";
process.env.DATABASE_URL = DB_URL;

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "  ✔" : "  ✘"} ${label}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures++;
}

async function expectError(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, "nenhum erro lançado");
  } catch (e) {
    check(label, e instanceof Error && e.name === "DomainError", (e as Error).message);
  }
}

async function main() {
  // Banco descartável criado do zero a cada execução (nunca o banco da demonstração).
  const root = path.resolve(__dirname, "..");
  for (const f of ["verify.db", "verify.db-journal"]) rmSync(path.join(root, "prisma", f), { force: true });
  execSync("npx prisma db push --skip-generate", { cwd: root, env: { ...process.env, DATABASE_URL: DB_URL }, stdio: "ignore" });

  const { db } = await import("@/server/db");
  const { seedDatabase } = await import("@/server/demo/seed");
  const { applyAssistDecision, confirmProposedDate, dispatch, runScheduledAutomations, scheduleVisitFromTeam } = await import("@/server/automations/engine");
  const { proposeVisitDate } = await import("@/server/services/visits");
  const { visitDateLabel } = await import("@/domain/templates");
  const { hasWhatsAppConsent, nextActiveVisit, receiveSimulatedMessage, sendFreeTextMessage, sendTemplateMessage } = await import("@/server/services/messaging");
  const { FREE_TEXT_MAX } = await import("@/domain/templates");
  const { changeVisitStatus } = await import("@/server/services/visits");
  const { ingestLead } = await import("@/server/services/participants");
  const { analyzeMessage } = await import("@/server/ai/assist");
  const { atLocalTime, formatTime } = await import("@/lib/dates");
  const { callLabel, pickCallSlot } = await import("@/domain/call-slot");
  const { getIntegrations } = await import("@/integrations");

  await seedDatabase(db);
  check(
    "padrão da demo: interpretação por IA em modo automático, confiança mínima 80, em todos os estudos",
    (await db.studyAutomationSettings.count({ where: { OR: [{ aiMode: { not: "AUTOMATICO" } }, { aiMinConfidence: { not: 80 } }] } })) === 0,
  );
  // As seções 1–13 testam as regras sozinhas; a segunda opinião da IA tem a seção própria (14).
  await db.studyAutomationSettings.updateMany({ data: { aiMode: "DESLIGADA" } });
  const { getAiUsageReport } = await import("@/server/queries/ai-usage");
  const camila = await db.user.findUniqueOrThrow({ where: { email: "camila.rocha@platano.demo" } });
  const actor = { type: "USER" as const, user: { id: camila.id, name: camila.name, email: camila.email, role: camila.role, jobTitle: camila.jobTitle, studyIds: null } };
  const byName = (fullName: string) => db.participant.findFirstOrThrow({ where: { fullName } });
  /** Simula a mensagem do participante e roda as automações, como faz a tela. */
  const reply = async (participantId: string, body: string) => {
    const r = await receiveSimulatedMessage({ participantId, body, simulatedBy: actor });
    const details = await dispatch({ type: "message.received", communicationId: r.communicationId });
    const decision = await db.assistDecision.findUnique({ where: { communicationId: r.communicationId } });
    return { ...r, details, decision };
  };
  const awaitingVisit = (participantId: string) => db.visit.findFirst({ where: { participantId, status: "AGUARDANDO_CONFIRMACAO" }, orderBy: { scheduledAt: "asc" } });

  console.log("\n1. Classificador: confiança, negação e ambiguidade");
  const strong = analyzeMessage("Confirmo, estarei aí!", { hasPendingVisit: true });
  const weak = analyzeMessage("ok", { hasPendingVisit: true });
  const negated = analyzeMessage("Não confirmo", { hasPendingVisit: true });
  const mixed = analyzeMessage("Confirmo. O transporte é reembolsado?", { hasPendingVisit: true });
  const clinicalMixed = analyzeMessage("Confirmo, mas estou com febre", { hasPendingVisit: true });
  check("“Confirmo, estarei aí!” = confirmação com confiança alta (≥ 85)", strong.intent === "CONFIRMACAO" && strong.score >= 85, strong);
  check("“ok” = confirmação com confiança menor (< 85)", weak.intent === "CONFIRMACAO" && weak.score < 85, weak);
  check("“Não confirmo” não vira confirmação", negated.intent !== "CONFIRMACAO", negated.intent);
  check("confirmação + dúvida na mesma mensagem = ambígua", mixed.ambiguous && mixed.score <= 55, mixed);
  check("sintoma junto de confirmação = relato clínico (prioridade)", clinicalMixed.intent === "POSSIVEL_RELATO_CLINICO", clinicalMixed.intent);
  const confirmations = ["Pode confirmar!", "OK, pode me confirmar por favor", "Confirma pra mim, por favor", "Confirmei", "Quero confirmar minha presença", "Vou comparecer", "Irei sim"];
  const notYet = ["Confirmo depois", "Te confirmo mais tarde", "Já confirmo", "Vou verificar e confirmo", "Acho que vou sim", "Confirma pra mim o horário"];
  const asStrong = confirmations.map((t) => [t, analyzeMessage(t, { hasPendingVisit: true })] as const).filter(([, r]) => r.intent !== "CONFIRMACAO" || r.score < 85);
  const asConfirm = notYet.map((t) => [t, analyzeMessage(t, { hasPendingVisit: true })] as const).filter(([, r]) => r.intent === "CONFIRMACAO");
  check(`outras formas de confirmar (${confirmations.join(", ")}) = confiança alta`, asStrong.length === 0, asStrong);
  check(`quem ainda vai confirmar (${notYet.join(", ")}) não vira confirmação`, asConfirm.length === 0, asConfirm);
  const noVisit = analyzeMessage("Confirmo", { hasPendingVisit: false });
  const simConfirmed = analyzeMessage("Sim", { hasPendingVisit: false, hasUpcomingVisit: true });
  const simCandidate = analyzeMessage("Sim", { hasPendingVisit: false });
  check("“Confirmo” sem visita aguardando = confirmação (não “Não classificada”)", noVisit.intent === "CONFIRMACAO", noVisit.intent);
  check("“Sim” de quem tem visita já confirmada = confirmação; de candidato sem visita = interesse", simConfirmed.intent === "CONFIRMACAO" && simCandidate.intent === "INTERESSE", [simConfirmed.intent, simCandidate.intent]);
  const asked = analyzeMessage("Pode confirmar?", { hasPendingVisit: true });
  check("“Pode confirmar?” (pergunta) = confiança menor (< 85)", asked.score < 85, asked);

  console.log("\n1b. Horário da ligação de pré-triagem (quarta 10:00)");
  const wed = atLocalTime(0, 10, 0, new Date(Date.UTC(2026, 9, 7, 15))); // quarta-feira, 07/10
  const slot = (text: string, now = wed) => {
    const s = pickCallSlot(text, now);
    return `${s.at.getUTCDate()}/${s.at.getUTCMonth() + 1} ${formatTime(s.at)}`;
  };
  const expected: [string, string, Date?][] = [
    ["Pode me ligar amanhã de manhã", "8/10 10:00"],
    ["Tenho interesse, pode ligar depois das 14h", "7/10 14:30"],
    ["Melhor horário é à tarde", "7/10 15:00"],
    ["Pode ligar na sexta às 9h", "9/10 09:00"],
    ["Tenho interesse sim!", "7/10 12:00"],
    ["Pode ligar às 8h", "8/10 09:00"],
    ["Tenho interesse sim!", "12/10 10:00", atLocalTime(2, 17, 30, wed)], // sexta 17:30 → segunda
  ];
  const wrong = expected.map(([t, want, now]) => [t, want, slot(t, now)]).filter(([, want, got]) => want !== got);
  check("preferência do candidato vira horário de ligação (dia útil, 9h–18h)", wrong.length === 0, wrong);
  const thuCall = atLocalTime(1, 14, 30, wed);
  const moved = [slot2("Não posso esse horário, poderia ser a partir das 17?"), slot2("Pode ser às 15h?"), slot2("Prefiro de manhã")];
  function slot2(text: string) {
    const s = pickCallSlot(text, wed, { defaultDay: thuCall });
    return `${s.at.getUTCDate()}/${s.at.getUTCMonth() + 1} ${formatTime(s.at)}`;
  }
  check("remarcar ligação de quinta 14:30: “a partir das 17” → quinta 17:00; “às 15h” → 15:00; “de manhã” → 10:00", moved.join(" | ") === "8/10 17:00 | 8/10 15:00 | 8/10 10:00", moved);
  const callAsk = analyzeMessage("Não posso esse horário, poderia ser a partir das 17?", { hasPendingVisit: false });
  const laterReply = analyzeMessage("Te respondo mais tarde", { hasPendingVisit: false });
  const tomorrowOk = analyzeMessage("Pode ser amanhã sim", { hasPendingVisit: true });
  check("“não posso esse horário, a partir das 17?” = remarcação; “te respondo mais tarde” não; “pode ser amanhã sim” (visita) = confirmação", callAsk.intent === "REAGENDAMENTO" && callAsk.score >= 85 && laterReply.intent !== "REAGENDAMENTO" && tomorrowOk.intent === "CONFIRMACAO", [callAsk.intent, laterReply.intent, tomorrowOk.intent]);

  console.log("\nPadrão da demo: as 5 intenções configuráveis em modo automático em todos os estudos");
  check("nenhum estudo em “Só sugerir”", (await db.assistPolicy.count({ where: { mode: "SUGERIR" } })) === 0);

  console.log("\n2. VAC-2026 configurado para só sugerir: Maria confirma → fila de revisão → equipe aprova");
  const vacStudy = await db.study.findUniqueOrThrow({ where: { code: "VAC-2026" } });
  await db.assistPolicy.update({ where: { studyId_intent: { studyId: vacStudy.id, intent: "CONFIRMACAO" } }, data: { mode: "SUGERIR" } });
  const maria = await byName("Maria Santos");
  const mariaVisit = (await awaitingVisit(maria.id))!;
  const r2 = await reply(maria.id, "Confirmo, estarei aí!");
  check("decisão fica na fila (modo sugestão)", r2.decision?.outcome === "PENDENTE" && r2.decision.reason.includes("sugestão"), r2.decision);
  check("visita continua aguardando confirmação", (await db.visit.findUniqueOrThrow({ where: { id: mariaVisit.id } })).status === "AGUARDANDO_CONFIRMACAO");
  await applyAssistDecision(r2.decision!.id, actor);
  const v2 = await db.visit.findUniqueOrThrow({ where: { id: mariaVisit.id } });
  const conv2 = await db.conversation.findFirstOrThrow({ where: { participantId: maria.id } });
  const last2 = await db.communication.findFirstOrThrow({ where: { conversationId: conv2.id }, orderBy: { sentAt: "desc" }, include: { template: true } });
  check("após aprovar: visita Confirmada", v2.status === "CONFIRMADO", v2.status);
  check("confirmação enviada pela automação e conversa resolvida", last2.template?.key === "tpl-confirmacao" && conv2.status === "RESOLVIDA", [last2.template?.key, conv2.status]);
  check("decisão registrada como aprovada por quem aprovou", (await db.assistDecision.findUniqueOrThrow({ where: { id: r2.decision!.id } })).outcome === "APROVADA");

  console.log("\n3. AUTO-2026 (piloto automático): Eduardo confirma e a IA aplica sozinha");
  const eduardo = await byName("Eduardo Ramos");
  const edVisit = (await awaitingVisit(eduardo.id))!;
  const r3 = await reply(eduardo.id, "Confirmo!");
  const v3 = await db.visit.findUniqueOrThrow({ where: { id: edVisit.id } });
  const conv3 = await db.conversation.findFirstOrThrow({ where: { participantId: eduardo.id } });
  check("decisão automática (confiança ≥ mínimo)", r3.decision?.outcome === "AUTOMATICA", r3.decision);
  check("visita Confirmada sem ação humana", v3.status === "CONFIRMADO", v3.status);
  check("conversa resolvida e confirmação enviada", conv3.status === "RESOLVIDA");
  check("execução registrada na regra “Assistência IA”", (await db.automationRun.count({ where: { participantId: eduardo.id, rule: { key: "assistencia-ia" }, createdAt: { gte: new Date(Date.now() - 60_000) } } })) === 1);

  console.log("\n4. AUTO-2026: confiança baixa, ambiguidade e relato clínico ficam com a equipe");
  const autoStudy = await db.study.findUniqueOrThrow({ where: { code: "AUTO-2026" } });
  const pendingAuto = await db.visit.findFirstOrThrow({
    where: { studyId: autoStudy.id, status: "AGUARDANDO_CONFIRMACAO", participantId: { not: eduardo.id }, participant: { consents: { some: { purpose: "CONTATO_WHATSAPP", granted: true } } } },
    include: { participant: true },
  });
  const r4a = await reply(pendingAuto.participantId, "ok");
  check("“ok” → fila (confiança abaixo do mínimo)", r4a.decision?.outcome === "PENDENTE" && r4a.decision.reason.includes("abaixo do mínimo"), r4a.decision?.reason);
  const r4b = await reply(pendingAuto.participantId, "Confirmo. O transporte é reembolsado?");
  check("confirmação + dúvida → fila (mais de uma intenção)", r4b.decision?.outcome === "PENDENTE" && r4b.decision.reason.includes("Mais de uma"), r4b.decision?.reason);
  const r4c = await reply(pendingAuto.participantId, "Confirmo, mas estou com febre desde ontem");
  check("relato clínico → encaminhada, nunca automática", r4c.decision?.outcome === "ENCAMINHADA", r4c.decision?.outcome);
  check("visita continua aguardando confirmação", (await db.visit.findUniqueOrThrow({ where: { id: pendingAuto.id } })).status === "AGUARDANDO_CONFIRMACAO");
  check("pendência alta criada para a coordenação", (await db.task.count({ where: { participantId: pendingAuto.participantId, automationKey: "mensagem-clinica", priority: "ALTA" } })) === 1);

  console.log("\n5. Política alterada: AUTO-2026 volta a só sugerir confirmações");
  await db.assistPolicy.update({ where: { studyId_intent: { studyId: autoStudy.id, intent: "CONFIRMACAO" } }, data: { mode: "SUGERIR" } });
  const otherAuto = await db.visit.findFirst({
    where: { studyId: autoStudy.id, status: "AGUARDANDO_CONFIRMACAO", participantId: { notIn: [eduardo.id, pendingAuto.participantId] }, participant: { consents: { some: { purpose: "CONTATO_WHATSAPP", granted: true } } } },
  });
  if (otherAuto) {
    const r5 = await reply(otherAuto.participantId, "Confirmo!");
    check("mesma mensagem agora vai para a fila", r5.decision?.outcome === "PENDENTE" && r5.decision.reason.includes("sugestão"), r5.decision?.reason);
  } else check("há outro participante do AUTO-2026 aguardando confirmação para o teste", false);
  await db.assistPolicy.update({ where: { studyId_intent: { studyId: autoStudy.id, intent: "CONFIRMACAO" } }, data: { mode: "AUTOMATICO" } });

  console.log("\n6. AUTO-2026: pedido de descadastro aplicado sozinho bloqueia novos envios");
  const rodrigo = await byName("Rodrigo Teixeira");
  const r6 = await reply(rodrigo.id, "Não quero mais receber mensagens.");
  check("descadastro aplicado automaticamente", r6.decision?.outcome === "AUTOMATICA", r6.decision);
  await expectError("novo envio para quem se descadastrou é bloqueado", () => sendTemplateMessage({ participantId: rodrigo.id, templateKey: "tpl-primeiro-contato", actor }));

  console.log("\n7. Equipe agindo direto na conversa tira a sugestão da fila");
  const queued = await db.assistDecision.findFirstOrThrow({ where: { outcome: "PENDENTE", intent: "INTERESSE" }, include: { participant: true } });
  await sendTemplateMessage({ participantId: queued.participantId, templateKey: "tpl-solicitacao-contato", actor });
  check("sugestão marcada como tratada pela equipe", (await db.assistDecision.findUniqueOrThrow({ where: { id: queued.id } })).outcome === "TRATADA");

  console.log("\n8. Renata responde → pendência “sem resposta” encerrada e follow-ups zerados");
  const renata = await byName("Renata Fonseca");
  await reply(renata.id, "Oi! Desculpa a demora, tenho interesse sim.");
  check("pendência encerrada automaticamente", (await db.task.count({ where: { participantId: renata.id, automationKey: "sem-resposta-24h", status: "ABERTA" } })) === 0);
  check("contador de follow-ups volta a zero", (await db.conversation.findFirstOrThrow({ where: { participantId: renata.id } })).followUpAttempts === 0);
  const callTask = await db.task.findFirst({ where: { participantId: renata.id, title: { contains: "pré-triagem" }, status: "ABERTA" }, orderBy: { createdAt: "desc" } });
  const callMsg = await db.communication.findFirstOrThrow({ where: { participantId: renata.id, direction: "OUTBOUND" }, orderBy: { sentAt: "desc" }, include: { template: true } });
  check(
    "interesse → ligação agendada: pendência no horário e aviso “Ligação agendada” com o mesmo horário",
    !!callTask && callMsg.template?.key === "tpl-ligacao-agendada" && callMsg.body.includes(callLabel(callTask.dueAt)),
    [callTask?.dueAt, callMsg.template?.key, callMsg.body],
  );
  await expectError("“Ligação agendada” não pode ser enviado à mão (sem horário combinado)", () => sendTemplateMessage({ participantId: renata.id, templateKey: "tpl-ligacao-agendada", actor }));
  // Horário fixo da ligação (amanhã 14:30): o teste não depende da hora em que roda.
  await db.task.update({ where: { id: callTask!.id }, data: { dueAt: atLocalTime(1, 14, 30) } });
  const callDay = atLocalTime(1, 14, 30);
  const lastOutId = async () => (await db.communication.findFirstOrThrow({ where: { participantId: renata.id, direction: "OUTBOUND" }, orderBy: { sentAt: "desc" } })).id;
  const beforeAsk = await lastOutId();
  const re = await reply(renata.id, "Não posso esse horário, poderia ser a partir das 17?");
  check(
    "pede outro horário → sugestão “Remarcar a ligação para … 17:00” na fila; nada enviado e ligação mantida até a equipe aprovar",
    re.decision?.outcome === "PENDENTE" && !!re.decision.action?.startsWith("Remarcar a ligação para") && re.decision.action.includes("17:00") && (await lastOutId()) === beforeAsk && (await db.task.findUniqueOrThrow({ where: { id: callTask!.id } })).dueAt.getTime() === callDay.getTime(),
    [re.decision?.outcome, re.decision?.action],
  );
  await applyAssistDecision(re.decision!.id, actor);
  const movedTask = await db.task.findUniqueOrThrow({ where: { id: callTask!.id } });
  const movedMsg = await db.communication.findFirstOrThrow({ where: { participantId: renata.id, direction: "OUTBOUND" }, orderBy: { sentAt: "desc" }, include: { template: true } });
  check(
    "equipe aprova → ligação às 17:00 e “Ligação agendada” enviada pela automação",
    formatTime(movedTask.dueAt) === "17:00" && movedTask.dueAt >= callDay && movedMsg.template?.key === "tpl-ligacao-agendada" && movedMsg.body.includes("17:00") && movedMsg.automated,
    [movedTask.dueAt, movedMsg.body, movedMsg.automated],
  );
  const re2 = await reply(renata.id, "Pode ser às 15h?");
  const teamAt = atLocalTime(2, 11, 0);
  await applyAssistDecision(re2.decision!.id, actor, { callAt: teamAt });
  const teamMsg = await db.communication.findFirstOrThrow({ where: { participantId: renata.id, direction: "OUTBOUND" }, orderBy: { sentAt: "desc" } });
  check(
    "equipe aprova outro horário (11:00) → ligação e aviso com o horário da equipe",
    re2.decision?.outcome === "PENDENTE" && (await db.task.findUniqueOrThrow({ where: { id: callTask!.id } })).dueAt.getTime() === teamAt.getTime() && teamMsg.body.includes("11:00"),
    [re2.decision?.outcome, teamMsg.body],
  );
  check("continua uma única pendência de ligação", (await db.task.count({ where: { participantId: renata.id, title: { endsWith: "(pré-triagem)" }, status: "ABERTA" } })) === 1);
  await reply(renata.id, "Esse horário não dá pra mim");
  const askMsg = await db.communication.findFirstOrThrow({ where: { participantId: renata.id, direction: "OUTBOUND" }, orderBy: { sentAt: "desc" }, include: { template: true } });
  check(
    "não pode e não sugere horário → pergunta o melhor horário (“Solicitação de contato”), ligação mantida",
    askMsg.template?.key === "tpl-solicitacao-contato" && (await db.task.findUniqueOrThrow({ where: { id: callTask!.id } })).dueAt.getTime() === teamAt.getTime(),
    askMsg.template?.key,
  );

  console.log("\n9. Agenda: falta → aviso + pendência; realizada → reembolso");
  const carlos = await byName("Carlos Oliveira");
  const carlosVisit = await db.visit.findFirstOrThrow({ where: { participantId: carlos.id, status: "CONFIRMADO" } });
  await changeVisitStatus(carlosVisit.id, "FALTOU", actor);
  await dispatch({ type: "visit.missed", visitId: carlosVisit.id });
  check("falta gera pendência de reagendamento (alta)", (await db.task.findFirst({ where: { visitId: carlosVisit.id, automationKey: "faltou-reagendar" } }))?.priority === "ALTA");
  const carlosConv = await db.conversation.findFirstOrThrow({ where: { participantId: carlos.id } });
  const carlosLast = await db.communication.findFirstOrThrow({ where: { conversationId: carlosConv.id }, orderBy: { sentAt: "desc" }, include: { template: true } });
  check(
    "falta envia “Falta na visita” (modelo aprovado, automação) e a conversa aguarda resposta",
    carlosLast.template?.key === "tpl-falta-visita" && carlosLast.automationKey === "faltou-reagendar" && carlosConv.status === "AGUARDANDO_RESPOSTA",
    [carlosLast.template?.key, carlosLast.automationKey, carlosConv.status],
  );
  const patricia = await byName("Patrícia Gomes");
  const pv = await db.visit.findFirstOrThrow({ where: { participantId: patricia.id, status: "CONFIRMADO" } });
  await changeVisitStatus(pv.id, "REALIZADO", actor);
  await dispatch({ type: "visit.completed", visitId: pv.id });
  check("visita realizada gera reembolso pendente", (await db.reimbursement.findFirst({ where: { visitId: pv.id } }))?.status === "PENDENTE");

  console.log("\n9b. Remarcação: equipe propõe nova data → participante responde → agenda muda só na confirmação");
  const roberto = await byName("Roberto Almeida");
  const rv = await db.visit.findFirstOrThrow({ where: { participantId: roberto.id, status: "REAGENDAMENTO_SOLICITADO" } });
  const originalAt = rv.scheduledAt;
  const propose = async (visitId: string, participantId: string, when: Date) => {
    await proposeVisitDate(visitId, when, actor);
    await sendTemplateMessage({ participantId, templateKey: "tpl-proposta-data", extraVars: { nova_data: visitDateLabel(when), nova_hora: formatTime(when) }, actor });
  };
  await expectError("proposta fora da janela do Polo Trial é bloqueada", () => proposeVisitDate(rv.id, new Date((rv.windowEnd as Date).getTime() + 2 * 86_400_000), actor));
  await expectError("“Proposta de nova data” não pode ser enviada à mão", () => sendTemplateMessage({ participantId: roberto.id, templateKey: "tpl-proposta-data", actor }));
  const first = atLocalTime(2, 14, 0);
  await propose(rv.id, roberto.id, first);
  const rConv = await db.conversation.findFirstOrThrow({ where: { participantId: roberto.id } });
  const proposalMsg = await db.communication.findFirstOrThrow({ where: { conversationId: rConv.id }, orderBy: { sentAt: "desc" }, include: { template: true } });
  const afterProposal = await db.visit.findUniqueOrThrow({ where: { id: rv.id } });
  check(
    "proposta enviada com a nova data; agenda ainda na data antiga; conversa aguarda resposta",
    proposalMsg.template?.key === "tpl-proposta-data" && proposalMsg.body.includes("14:00") && afterProposal.scheduledAt.getTime() === originalAt.getTime() && afterProposal.proposedAt?.getTime() === first.getTime() && rConv.status === "AGUARDANDO_RESPOSTA",
    [proposalMsg.body, afterProposal.scheduledAt, afterProposal.proposedAt, rConv.status],
  );
  const declined = await reply(roberto.id, "Nesse dia não consigo ir, pode ser outro dia?");
  const afterDecline = await db.visit.findUniqueOrThrow({ where: { id: rv.id } });
  check("“não consigo, outro dia?” → proposta cai, visita segue com remarcação solicitada", declined.decision?.intent === "REAGENDAMENTO" && afterDecline.proposedAt === null && afterDecline.status === "REAGENDAMENTO_SOLICITADO" && afterDecline.scheduledAt.getTime() === originalAt.getTime(), [declined.decision?.intent, declined.decision?.outcome, afterDecline]);
  const second = atLocalTime(3, 10, 30);
  await propose(rv.id, roberto.id, second);
  const accepted = await reply(roberto.id, "Confirmo!");
  const afterAccept = await db.visit.findUniqueOrThrow({ where: { id: rv.id } });
  const confirmMsg = await db.communication.findFirstOrThrow({ where: { conversationId: rConv.id }, orderBy: { sentAt: "desc" }, include: { template: true } });
  check(
    "“Confirmo!” → visita muda para a nova data, confirmada, sem proposta pendente",
    accepted.decision?.outcome === "AUTOMATICA" && afterAccept.scheduledAt.getTime() === second.getTime() && afterAccept.status === "CONFIRMADO" && afterAccept.proposedAt === null && afterAccept.rescheduleCount === rv.rescheduleCount + 1,
    [accepted.decision?.outcome, afterAccept],
  );
  check("confirmação enviada com a nova data", confirmMsg.template?.key === "tpl-confirmacao" && confirmMsg.body.includes("10:30"), confirmMsg.body);
  check("pendência de reagendamento encerrada", (await db.task.count({ where: { visitId: rv.id, status: { in: ["ABERTA", "EM_ANDAMENTO"] } } })) === 0);
  check("pendência para registrar a nova data no Polo Trial", (await db.task.count({ where: { participantId: roberto.id, title: { contains: "Registrar no Polo Trial" }, status: "ABERTA" } })) === 1);
  // Falta: proposta + confirmação por telefone (equipe confirma na tela).
  const joao = await byName("João Silva");
  const jv = await db.visit.findFirstOrThrow({ where: { participantId: joao.id, status: "FALTOU" } });
  const jWhen = atLocalTime(1, 9, 0);
  await propose(jv.id, joao.id, jWhen);
  await confirmProposedDate(jv.id, actor);
  const jAfter = await db.visit.findUniqueOrThrow({ where: { id: jv.id } });
  check("falta → nova data confirmada pela equipe (telefone) → visita confirmada no novo dia", jAfter.status === "CONFIRMADO" && jAfter.scheduledAt.getTime() === jWhen.getTime() && jAfter.proposedAt === null, jAfter);

  console.log("\n9c. Pedido de confirmação antecipado não cancela o lembrete da véspera");
  const early = await db.visit.findFirstOrThrow({ where: { status: "AGUARDANDO_CONFIRMACAO", scheduledAt: { gte: atLocalTime(3, 0) }, reminderSentAt: null, participant: { consents: { some: { purpose: "CONTATO_WHATSAPP", granted: true, revokedAt: null } } } } });
  const earlyMsg = await sendTemplateMessage({ participantId: early.participantId, templateKey: "tpl-lembrete-visita", visitId: early.id, actor });
  check(
    "lembrete enviado à mão dias antes: sai com a data da visita e a véspera continua pendente",
    earlyMsg.message.body.includes(formatTime(early.scheduledAt)) && (await db.visit.findUniqueOrThrow({ where: { id: early.id } })).reminderSentAt === null,
    earlyMsg.message.body,
  );

  console.log("\n9d. “Confirmo” de visita já confirmada e de quem não tem visita");
  const vacStudyId = (await db.study.findUniqueOrThrow({ where: { code: "VAC-2026" } })).id;
  const withWa = { consents: { some: { purpose: "CONTATO_WHATSAPP" as const, granted: true, revokedAt: null } } };
  const confirmedVisit = await db.visit.findFirstOrThrow({
    where: { status: "CONFIRMADO", scheduledAt: { gte: atLocalTime(1, 0) }, studyId: { not: vacStudyId }, participant: withWa },
    orderBy: { scheduledAt: "asc" },
  });
  const again2 = await reply(confirmedVisit.participantId, "Confirmo!");
  const againMsg = await db.communication.findFirstOrThrow({ where: { participantId: confirmedVisit.participantId, direction: "OUTBOUND" }, orderBy: { sentAt: "desc" }, include: { template: true } });
  const againConv = await db.conversation.findFirstOrThrow({ where: { participantId: confirmedVisit.participantId } });
  check(
    "já confirmada → aplicada sozinha: confirmação reenviada com a data, sem fila",
    again2.decision?.outcome === "AUTOMATICA" && againMsg.template?.key === "tpl-confirmacao" && againMsg.body.includes(formatTime(confirmedVisit.scheduledAt)) && againConv.status === "RESOLVIDA",
    [again2.decision?.outcome, againMsg.template?.key, againConv.status],
  );
  const noVisitP = await db.participant.findFirstOrThrow({
    where: { ...withWa, studyId: { not: vacStudyId }, visits: { none: { status: { in: ["AGUARDANDO_CONFIRMACAO", "CONFIRMADO", "REAGENDAMENTO_SOLICITADO"] } } }, conversations: { some: {} } },
  });
  const orphan = await reply(noVisitP.id, "Confirmo");
  check(
    "sem visita futura → “Confirmação de presença” na fila, com o motivo",
    orphan.decision?.intent === "CONFIRMACAO" && orphan.decision.outcome === "PENDENTE" && orphan.decision.reason.includes("Nenhuma visita futura"),
    [orphan.decision?.intent, orphan.decision?.outcome, orphan.decision?.reason],
  );

  console.log("\n9e. Depois da ligação: equipe agenda a visita de triagem");
  const cand = await db.participant.findFirstOrThrow({
    where: { status: "EM_CONTATO", studyId: { not: vacStudyId }, visits: { none: {} }, tasks: { none: { status: { in: ["ABERTA", "EM_ANDAMENTO"] } } }, conversations: { some: {} }, ...withWa },
    orderBy: { fullName: "asc" },
  });
  await reply(cand.id, "Tenho interesse");
  check("interesse → ligação de pré-triagem agendada", (await db.task.count({ where: { participantId: cand.id, title: { endsWith: "(pré-triagem)" }, status: "ABERTA" } })) === 1);
  const triagemAt = atLocalTime(3, 9, 30);
  const sched = await scheduleVisitFromTeam({ participantId: cand.id, name: "Triagem", category: "TRIAGEM", when: triagemAt, confirmed: true }, actor);
  const cVisit = await db.visit.findFirstOrThrow({ where: { participantId: cand.id } });
  const cMsg = await db.communication.findFirstOrThrow({ where: { participantId: cand.id, direction: "OUTBOUND" }, orderBy: { sentAt: "desc" }, include: { template: true } });
  check(
    "visita agendada e confirmada; “Confirmação de agendamento” enviada com a data",
    cVisit.status === "CONFIRMADO" && cVisit.scheduledAt.getTime() === triagemAt.getTime() && cMsg.template?.key === "tpl-confirmacao" && cMsg.body.includes("09:30") && cMsg.automated,
    [cVisit.status, cMsg.body, sched],
  );
  check("candidato passa a “Agendado”", (await db.participant.findUniqueOrThrow({ where: { id: cand.id } })).status === "AGENDADO");
  check("ligação de pré-triagem encerrada", (await db.task.count({ where: { participantId: cand.id, title: { endsWith: "(pré-triagem)" }, status: "ABERTA" } })) === 0);
  check("pendência para registrar a visita no Polo Trial", (await db.task.count({ where: { participantId: cand.id, title: { contains: "Registrar no Polo Trial a visita" }, status: "ABERTA" } })) === 1);
  await expectError("não cria segunda visita se já existe uma ativa", () => scheduleVisitFromTeam({ participantId: cand.id, name: "Triagem", category: "TRIAGEM", when: atLocalTime(4, 9, 0), confirmed: true }, actor));

  console.log("\n10. Follow-up automático: horário de envio, tentativas e esgotamento");
  const wellington = await byName("Wellington Barbosa");
  const night = await runScheduledAutomations(atLocalTime(0, 22, 30));
  check("às 22h30 nada sai: lembretes e follow-ups aguardam a janela (07h–21h)", night.followUps === 0 && night.reminders === 0 && night.outsideWindow >= 2, night);
  const morning = await runScheduledAutomations(atLocalTime(0, 10, 0));
  const wConv = await db.conversation.findFirstOrThrow({ where: { participantId: wellington.id } });
  const wLast = await db.communication.findFirstOrThrow({ where: { conversationId: wConv.id }, orderBy: { sentAt: "desc" }, include: { template: true } });
  check("às 10h: follow-up 1/1 enviado para Wellington com modelo aprovado", morning.details.some((d) => d.includes("Follow-up 1/1 enviado para Wellington Barbosa")) && wLast.automationKey === "sem-resposta-24h" && wLast.template?.key === "tpl-segundo-contato", morning.details);
  check("às 10h: lembrete da visita de amanhã enviado", morning.reminders >= 1, morning);
  check("contador de tentativas = 1", wConv.followUpAttempts === 1, wConv.followUpAttempts);
  const again = await runScheduledAutomations(atLocalTime(0, 10, 5));
  check("rodar de novo não duplica nada", again.followUps === 0 && again.reminders === 0 && !again.details.some((d) => d.includes("Wellington")), again);
  const later = await runScheduledAutomations(atLocalTime(2, 10, 0));
  check("sem resposta após a tentativa: vira pendência de ligação", later.details.some((d) => d.includes("Wellington Barbosa não respondeu ao segundo contato")), later.details);
  const wTask = await db.task.findFirst({ where: { participantId: wellington.id, automationKey: "sem-resposta-24h", status: "ABERTA" } });
  check("pendência aberta para o responsável", !!wTask && wTask.assigneeId === wellington.ownerId);
  const marcos = await byName("Marcos Vieira");
  await expectError("participante sem consentimento de WhatsApp não recebe envio", () => sendTemplateMessage({ participantId: marcos.id, templateKey: "tpl-solicitacao-contato", actor }));
  const draft = await db.messageTemplate.findFirstOrThrow({ where: { approvalStatus: { not: "APROVADO" } } });
  await expectError("modelo não aprovado pelo CEP é bloqueado", () => sendTemplateMessage({ participantId: maria.id, templateId: draft.id, actor }));

  console.log("\n11. Texto livre escrito pela equipe");
  await expectError("texto livre sem consentimento de WhatsApp é bloqueado", () => sendFreeTextMessage({ participantId: marcos.id, body: "Olá, tudo bem?", expectsReply: true, actor }));
  await expectError("texto vazio é bloqueado", () => sendFreeTextMessage({ participantId: maria.id, body: "   ", expectsReply: true, actor }));
  await expectError(`texto acima de ${FREE_TEXT_MAX} caracteres é bloqueado`, () => sendFreeTextMessage({ participantId: maria.id, body: "a".repeat(FREE_TEXT_MAX + 1), expectsReply: true, actor }));
  const free = await sendFreeTextMessage({ participantId: maria.id, body: "  Maria, pode trazer o cartão do SUS na visita?  ", expectsReply: false, actor });
  const freeConv = await db.conversation.findFirstOrThrow({ where: { participantId: maria.id } });
  check(
    "mensagem gravada como texto livre da equipe (sem modelo, não automática)",
    free.message.body === "Maria, pode trazer o cartão do SUS na visita?" && free.message.templateId === null && !free.message.automated && free.message.sentById === camila.id,
    free.message,
  );
  check("Maria escreveu há pouco: janela de 24h aberta", free.windowOpen);
  check("sem “aguardar resposta”: conversa resolvida", freeConv.status === "RESOLVIDA", freeConv.status);
  const freeAudit = await db.auditLog.findFirst({ where: { action: "message.free_text_sent", entityId: maria.id }, orderBy: { createdAt: "desc" } });
  check("auditoria guarda o texto enviado", !!freeAudit && JSON.stringify(freeAudit.metadata).includes("cartão do SUS"), freeAudit?.metadata);
  check("linha do tempo registra “Mensagem livre enviada”", (await db.timelineEvent.count({ where: { participantId: maria.id, title: "Mensagem livre enviada" } })) === 1);
  // Alguém sem mensagem recente, sem visita ativa e sem pendência: o follow-up automático pode agir.
  const quiet = [];
  for (const p of await db.participant.findMany({ where: { tasks: { none: { status: { in: ["ABERTA", "EM_ANDAMENTO"] } } } }, orderBy: { fullName: "asc" } })) {
    const lastIn = await db.communication.findFirst({ where: { participantId: p.id, direction: "INBOUND" }, orderBy: { sentAt: "desc" } });
    if (lastIn && lastIn.sentAt.getTime() > Date.now() - 24 * 3_600_000) continue;
    if (!(await hasWhatsAppConsent(p.id)) || (await nextActiveVisit(p.id))) continue;
    const cfg = await db.studyAutomationSettings.findUnique({ where: { studyId: p.studyId } });
    if (cfg && (!cfg.followUpEnabled || cfg.followUpMaxAttempts === 0)) continue;
    quiet.push(p);
  }
  const target = quiet[0];
  if (target) {
    const ask = await sendFreeTextMessage({ participantId: target.id, body: "Oi! Você ainda tem interesse em participar do estudo?", expectsReply: true, actor });
    const askConv = await db.conversation.findFirstOrThrow({ where: { participantId: target.id } });
    check(`${target.fullName} sem mensagem nas últimas 24h: janela fechada (aviso)`, !ask.windowOpen);
    check("com “aguardar resposta”: conversa aguarda resposta", askConv.status === "AGUARDANDO_RESPOSTA", askConv.status);
    await runScheduledAutomations(atLocalTime(3, 10, 0));
    const fu = await db.communication.findFirstOrThrow({ where: { conversationId: askConv.id }, orderBy: { sentAt: "desc" }, include: { template: true } });
    check("sem resposta: follow-up automático sai com modelo aprovado (nunca repete o texto livre)", fu.automationKey === "sem-resposta-24h" && fu.template?.approvalStatus === "APROVADO", [fu.automationKey, fu.template?.key]);
  } else check("há participante sem visita ativa nem pendência para testar o follow-up", false);

  console.log("\n12. Formulário recebido → cadastro automático + pendência");
  const forms = getIntegrations().forms;
  const [submission] = await forms.fetchNewSubmissions();
  const lead = await ingestLead(forms.normalize(submission), { type: "INTEGRATION", system: "Formulários" });
  await dispatch({ type: "form.received", participantId: lead.id });
  check("participante criado como Novo, com pendência de primeiro contato", lead.status === "NOVO" && (await db.task.count({ where: { participantId: lead.id, automationKey: "formulario-entrada" } })) === 1);

  console.log("\n14. Segunda opinião da IA (simulada) só no que as regras não resolvem");
  const aiStudy = await db.study.findUniqueOrThrow({ where: { code: "AUTO-2026" } });
  await db.studyAutomationSettings.updateMany({ where: { studyId: aiStudy.id }, data: { aiMode: "AUTOMATICO", aiMinConfidence: 90 } });
  const pendingAi = await db.visit.findMany({
    where: { studyId: aiStudy.id, status: "AGUARDANDO_CONFIRMACAO", scheduledAt: { gte: new Date() }, participant: withWa },
    orderBy: { scheduledAt: "asc" },
    take: 3,
  });
  const aiCount = () => db.aiUsage.count();

  const before1 = await aiCount();
  const typoReply = await reply(pendingAi[0].participantId, "comfirmo");
  const typoVisit = await db.visit.findUniqueOrThrow({ where: { id: pendingAi[0].id } });
  const typoUsage = await db.aiUsage.findFirst({ where: { communicationId: typoReply.communicationId } });
  check(
    "“comfirmo” (regras: não classificada) → IA lê confirmação e aplica sozinha",
    typoReply.assist.intent === "OUTRO" && typoReply.decision?.source === "IA" && typoReply.decision.rulesIntent === "OUTRO" && typoReply.decision.outcome === "AUTOMATICA" && typoVisit.status === "CONFIRMADO",
    [typoReply.decision?.source, typoReply.decision?.intent, typoReply.decision?.outcome, typoVisit.status],
  );
  check(
    "consumo registrado: tokens, custo estimado, estudo e resultado",
    (await aiCount()) === before1 + 1 && !!typoUsage && typoUsage.status === "OK" && typoUsage.inputTokens > 0 && typoUsage.outputTokens > 0 && typoUsage.costUsd > 0 && typoUsage.studyCode === "AUTO-2026" && typoUsage.outcome === "AUTOMATICA",
    typoUsage,
  );

  const before2 = await aiCount();
  await reply(pendingAi[1].participantId, "Confirmo, estarei aí!");
  check("mensagem que as regras resolvem não chama a IA (sem custo)", (await aiCount()) === before2);

  const sick = await reply(pendingAi[2].participantId, "Tô passando mal desde ontem");
  check(
    "“passando mal” (fora das palavras-chave) → IA encaminha à equipe médica, sem resposta",
    sick.decision?.outcome === "ENCAMINHADA" && (await db.task.count({ where: { participantId: pendingAi[2].participantId, automationKey: "mensagem-clinica", status: "ABERTA" } })) >= 1,
    [sick.decision?.intent, sick.decision?.outcome],
  );

  const late = await reply(renata.id, "lá pelas cinco da tarde pode ser?");
  check(
    "ligação: “lá pelas cinco da tarde” → IA entende 17:00 e a sugestão vai para a equipe aprovar",
    late.decision?.source === "IA" && late.decision.outcome === "PENDENTE" && !!late.decision.action?.includes("17:00") && late.decision.timeHint === "as 17:00",
    [late.decision?.intent, late.decision?.outcome, late.decision?.action, late.decision?.timeHint],
  );
  await applyAssistDecision(late.decision!.id, actor);
  check("aprovada → ligação às 17:00", formatTime((await db.task.findUniqueOrThrow({ where: { id: callTask!.id } })).dueAt) === "17:00");

  await db.studyAutomationSettings.updateMany({ where: { studyId: aiStudy.id }, data: { aiMode: "SUGERIR" } });
  const nextPending = await db.visit.findFirst({
    where: { studyId: aiStudy.id, status: "AGUARDANDO_CONFIRMACAO", scheduledAt: { gte: new Date() }, participant: withWa },
    orderBy: { scheduledAt: "asc" },
  });
  if (nextPending) {
    const slang = await reply(nextPending.participantId, "tô dentro!");
    check("IA em “Só sugerir”: lê a gíria como confirmação, mas deixa na fila", slang.decision?.intent === "CONFIRMACAO" && slang.decision.outcome === "PENDENTE" && slang.decision.reason.includes("modo sugestão"), slang.decision?.reason);
  } else check("há outra visita aguardando confirmação no AUTO-2026 para o teste", false);

  await db.studyAutomationSettings.updateMany({ where: { studyId: aiStudy.id }, data: { aiMode: "DESLIGADA" } });
  const before3 = await aiCount();
  await reply(renata.id, "hmm, deixa eu ver");
  check("IA desligada no estudo → nenhuma chamada", (await aiCount()) === before3);

  const usage = await getAiUsageReport(actor.user, 30);
  check(
    "relatório de consumo: mensagens, tokens, custo e resultados",
    usage.totals.calls === (await aiCount()) && usage.totals.cost > 0 && usage.outcomes.AUTOMATICA >= 1 && usage.outcomes.ENCAMINHADA >= 1 && usage.outcomes.EQUIPE >= 1,
    [usage.totals, usage.outcomes],
  );

  console.log("\n13. Rastreabilidade");
  check("ações registradas na auditoria", (await db.auditLog.count({ where: { createdAt: { gte: new Date(Date.now() - 5 * 60_000) } } })) >= 15);

  console.log("\n15. Restaurar a demo mantém o consumo da IA");
  const keptCount = await db.aiUsage.count();
  const keptCost = (await getAiUsageReport(actor.user, 30)).totals.cost;
  await seedDatabase(db);
  const afterReset = await getAiUsageReport(actor.user, 30);
  check(
    "após restaurar: mesmas análises e mesmo custo, com estudo e resultado preservados",
    keptCount > 0 &&
      (await db.aiUsage.count()) === keptCount &&
      Math.abs(afterReset.totals.cost - keptCost) < 1e-9 &&
      afterReset.byStudy.some((st) => st.code === "AUTO-2026") &&
      afterReset.outcomes.AUTOMATICA >= 1 &&
      afterReset.recent.every((r) => r.participantName === null),
    [keptCount, afterReset.totals, afterReset.outcomes],
  );

  await db.$disconnect();
  console.log(failures === 0 ? "\nTodos os fluxos verificados com sucesso.\n" : `\n${failures} verificação(ões) falharam.\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
