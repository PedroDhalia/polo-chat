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
  const { atLocalTime, diffInDays, formatTime, toDateParam } = await import("@/lib/dates");
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

  console.log("\n2. VAC-2026 configurado para só sugerir: Larissa confirma → fila de revisão → equipe aprova");
  const vacStudy = await db.study.findUniqueOrThrow({ where: { code: "VAC-2026" } });
  await db.assistPolicy.update({ where: { studyId_intent: { studyId: vacStudy.id, intent: "CONFIRMACAO" } }, data: { mode: "SUGERIR" } });
  const larissa = await byName("Larissa Mendonça");
  const larissaVisit = (await awaitingVisit(larissa.id))!;
  const r2 = await reply(larissa.id, "Confirmo, estarei aí!");
  check("decisão fica na fila (modo sugestão)", r2.decision?.outcome === "PENDENTE" && r2.decision.reason.includes("sugestão"), r2.decision);
  check("visita continua aguardando confirmação", (await db.visit.findUniqueOrThrow({ where: { id: larissaVisit.id } })).status === "AGUARDANDO_CONFIRMACAO");
  await applyAssistDecision(r2.decision!.id, actor);
  const v2 = await db.visit.findUniqueOrThrow({ where: { id: larissaVisit.id } });
  const conv2 = await db.conversation.findFirstOrThrow({ where: { participantId: larissa.id } });
  const last2 = await db.communication.findFirstOrThrow({ where: { conversationId: conv2.id }, orderBy: { sentAt: "desc" }, include: { template: true } });
  check("após aprovar: visita Confirmada", v2.status === "CONFIRMADO", v2.status);
  check("confirmação enviada pela automação e conversa resolvida", last2.template?.key === "tpl-confirmacao" && conv2.status === "RESOLVIDA", [last2.template?.key, conv2.status]);
  check("decisão registrada como aprovada por quem aprovou", (await db.assistDecision.findUniqueOrThrow({ where: { id: r2.decision!.id } })).outcome === "APROVADA");

  console.log("\n3. AUTO-2026 (piloto automático): Thiago confirma e a IA aplica sozinha");
  const thiago = await byName("Thiago Moreira");
  const edVisit = (await awaitingVisit(thiago.id))!;
  const r3 = await reply(thiago.id, "Confirmo!");
  const v3 = await db.visit.findUniqueOrThrow({ where: { id: edVisit.id } });
  const conv3 = await db.conversation.findFirstOrThrow({ where: { participantId: thiago.id } });
  check("decisão automática (confiança ≥ mínimo)", r3.decision?.outcome === "AUTOMATICA", r3.decision);
  check("visita Confirmada sem ação humana", v3.status === "CONFIRMADO", v3.status);
  check("conversa resolvida e confirmação enviada", conv3.status === "RESOLVIDA");
  check("execução registrada na regra “Assistência IA”", (await db.automationRun.count({ where: { participantId: thiago.id, rule: { key: "assistencia-ia" }, createdAt: { gte: new Date(Date.now() - 60_000) } } })) === 1);

  console.log("\n4. AUTO-2026: confiança baixa, ambiguidade e relato clínico ficam com a equipe");
  const autoStudy = await db.study.findUniqueOrThrow({ where: { code: "AUTO-2026" } });
  const pendingAuto = await db.visit.findFirstOrThrow({
    where: { studyId: autoStudy.id, status: "AGUARDANDO_CONFIRMACAO", participantId: { not: thiago.id }, participant: { consents: { some: { purpose: "CONTATO_WHATSAPP", granted: true } } } },
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
    where: { studyId: autoStudy.id, status: "AGUARDANDO_CONFIRMACAO", participantId: { notIn: [thiago.id, pendingAuto.participantId] }, participant: { consents: { some: { purpose: "CONTATO_WHATSAPP", granted: true } } } },
  });
  if (otherAuto) {
    const r5 = await reply(otherAuto.participantId, "Confirmo!");
    check("mesma mensagem agora vai para a fila", r5.decision?.outcome === "PENDENTE" && r5.decision.reason.includes("sugestão"), r5.decision?.reason);
  } else check("há outro participante do AUTO-2026 aguardando confirmação para o teste", false);
  await db.assistPolicy.update({ where: { studyId_intent: { studyId: autoStudy.id, intent: "CONFIRMACAO" } }, data: { mode: "AUTOMATICO" } });

  console.log("\n6. AUTO-2026: pedido de descadastro aplicado sozinho bloqueia novos envios");
  const rafael = await byName("Rafael Coutinho");
  const r6 = await reply(rafael.id, "Não quero mais receber mensagens.");
  check("descadastro aplicado automaticamente", r6.decision?.outcome === "AUTOMATICA", r6.decision);
  await expectError("novo envio para quem se descadastrou é bloqueado", () => sendTemplateMessage({ participantId: rafael.id, templateKey: "tpl-primeiro-contato", actor }));

  console.log("\n7. Equipe agindo direto na conversa tira a sugestão da fila");
  const queued = await db.assistDecision.findFirstOrThrow({ where: { outcome: "PENDENTE", intent: "INTERESSE" }, include: { participant: true } });
  await sendTemplateMessage({ participantId: queued.participantId, templateKey: "tpl-solicitacao-contato", actor });
  check("sugestão marcada como tratada pela equipe", (await db.assistDecision.findUniqueOrThrow({ where: { id: queued.id } })).outcome === "TRATADA");

  console.log("\n8. Aline responde → pendência “sem resposta” encerrada e follow-ups zerados");
  const aline = await byName("Aline Furtado");
  await reply(aline.id, "Oi! Desculpa a demora, tenho interesse sim.");
  check("pendência encerrada automaticamente", (await db.task.count({ where: { participantId: aline.id, automationKey: "sem-resposta-24h", status: "ABERTA" } })) === 0);
  check("contador de follow-ups volta a zero", (await db.conversation.findFirstOrThrow({ where: { participantId: aline.id } })).followUpAttempts === 0);
  const callTask = await db.task.findFirst({ where: { participantId: aline.id, title: { contains: "pré-triagem" }, status: "ABERTA" }, orderBy: { createdAt: "desc" } });
  const callMsg = await db.communication.findFirstOrThrow({ where: { participantId: aline.id, direction: "OUTBOUND" }, orderBy: { sentAt: "desc" }, include: { template: true } });
  check(
    "interesse → ligação agendada: pendência no horário e aviso “Ligação agendada” com o mesmo horário",
    !!callTask && callMsg.template?.key === "tpl-ligacao-agendada" && callMsg.body.includes(callLabel(callTask.dueAt)),
    [callTask?.dueAt, callMsg.template?.key, callMsg.body],
  );
  await expectError("“Ligação agendada” não pode ser enviado à mão (sem horário combinado)", () => sendTemplateMessage({ participantId: aline.id, templateKey: "tpl-ligacao-agendada", actor }));
  // Horário fixo da ligação (amanhã 14:30): o teste não depende da hora em que roda.
  await db.task.update({ where: { id: callTask!.id }, data: { dueAt: atLocalTime(1, 14, 30) } });
  const callDay = atLocalTime(1, 14, 30);
  const lastOutId = async () => (await db.communication.findFirstOrThrow({ where: { participantId: aline.id, direction: "OUTBOUND" }, orderBy: { sentAt: "desc" } })).id;
  const beforeAsk = await lastOutId();
  const re = await reply(aline.id, "Não posso esse horário, poderia ser a partir das 17?");
  check(
    "pede outro horário → sugestão “Remarcar a ligação para … 17:00” na fila; nada enviado e ligação mantida até a equipe aprovar",
    re.decision?.outcome === "PENDENTE" && !!re.decision.action?.startsWith("Remarcar a ligação para") && re.decision.action.includes("17:00") && (await lastOutId()) === beforeAsk && (await db.task.findUniqueOrThrow({ where: { id: callTask!.id } })).dueAt.getTime() === callDay.getTime(),
    [re.decision?.outcome, re.decision?.action],
  );
  await applyAssistDecision(re.decision!.id, actor);
  const movedTask = await db.task.findUniqueOrThrow({ where: { id: callTask!.id } });
  const movedMsg = await db.communication.findFirstOrThrow({ where: { participantId: aline.id, direction: "OUTBOUND" }, orderBy: { sentAt: "desc" }, include: { template: true } });
  check(
    "equipe aprova → ligação às 17:00 e “Ligação agendada” enviada pela automação",
    formatTime(movedTask.dueAt) === "17:00" && movedTask.dueAt >= callDay && movedMsg.template?.key === "tpl-ligacao-agendada" && movedMsg.body.includes("17:00") && movedMsg.automated,
    [movedTask.dueAt, movedMsg.body, movedMsg.automated],
  );
  const re2 = await reply(aline.id, "Pode ser às 15h?");
  const teamAt = atLocalTime(2, 11, 0);
  await applyAssistDecision(re2.decision!.id, actor, { callAt: teamAt });
  const teamMsg = await db.communication.findFirstOrThrow({ where: { participantId: aline.id, direction: "OUTBOUND" }, orderBy: { sentAt: "desc" } });
  check(
    "equipe aprova outro horário (11:00) → ligação e aviso com o horário da equipe",
    re2.decision?.outcome === "PENDENTE" && (await db.task.findUniqueOrThrow({ where: { id: callTask!.id } })).dueAt.getTime() === teamAt.getTime() && teamMsg.body.includes("11:00"),
    [re2.decision?.outcome, teamMsg.body],
  );
  check("continua uma única pendência de ligação", (await db.task.count({ where: { participantId: aline.id, title: { endsWith: "(pré-triagem)" }, status: "ABERTA" } })) === 1);
  await reply(aline.id, "Esse horário não dá pra mim");
  const askMsg = await db.communication.findFirstOrThrow({ where: { participantId: aline.id, direction: "OUTBOUND" }, orderBy: { sentAt: "desc" }, include: { template: true } });
  check(
    "não pode e não sugere horário → pergunta o melhor horário (“Solicitação de contato”), ligação mantida",
    askMsg.template?.key === "tpl-solicitacao-contato" && (await db.task.findUniqueOrThrow({ where: { id: callTask!.id } })).dueAt.getTime() === teamAt.getTime(),
    askMsg.template?.key,
  );

  console.log("\n9. Agenda: falta → aviso + pendência; realizada → reembolso");
  const marcelo = await byName("Marcelo Azevedo");
  const marceloVisit = await db.visit.findFirstOrThrow({ where: { participantId: marcelo.id, status: "CONFIRMADO" } });
  await changeVisitStatus(marceloVisit.id, "FALTOU", actor);
  await dispatch({ type: "visit.missed", visitId: marceloVisit.id });
  check("falta gera pendência de reagendamento (alta)", (await db.task.findFirst({ where: { visitId: marceloVisit.id, automationKey: "faltou-reagendar" } }))?.priority === "ALTA");
  const marceloConv = await db.conversation.findFirstOrThrow({ where: { participantId: marcelo.id } });
  const marceloLast = await db.communication.findFirstOrThrow({ where: { conversationId: marceloConv.id }, orderBy: { sentAt: "desc" }, include: { template: true } });
  check(
    "falta envia “Falta na visita” (modelo aprovado, automação) e a conversa aguarda resposta",
    marceloLast.template?.key === "tpl-falta-visita" && marceloLast.automationKey === "faltou-reagendar" && marceloConv.status === "AGUARDANDO_RESPOSTA",
    [marceloLast.template?.key, marceloLast.automationKey, marceloConv.status],
  );
  const bruna = await byName("Bruna Valente");
  const pv = await db.visit.findFirstOrThrow({ where: { participantId: bruna.id, status: "CONFIRMADO" } });
  await changeVisitStatus(pv.id, "REALIZADO", actor);
  await dispatch({ type: "visit.completed", visitId: pv.id });
  check("visita realizada gera reembolso pendente", (await db.reimbursement.findFirst({ where: { visitId: pv.id } }))?.status === "PENDENTE");

  console.log("\n9b. Remarcação: equipe propõe nova data → participante responde → agenda muda só na confirmação");
  const sergio = await byName("Sérgio Albuquerque");
  const rv = await db.visit.findFirstOrThrow({ where: { participantId: sergio.id, status: "REAGENDAMENTO_SOLICITADO" } });
  const originalAt = rv.scheduledAt;
  const propose = async (visitId: string, participantId: string, when: Date) => {
    await proposeVisitDate(visitId, when, actor);
    await sendTemplateMessage({ participantId, templateKey: "tpl-proposta-data", extraVars: { nova_data: visitDateLabel(when), nova_hora: formatTime(when) }, actor });
  };
  await expectError("proposta fora da janela do Polo Trial é bloqueada", () => proposeVisitDate(rv.id, new Date((rv.windowEnd as Date).getTime() + 2 * 86_400_000), actor));
  // A janela vale por dia, com o último dia incluído: "até 20/10" aceita o dia 20 inteiro.
  const lastDay = diffInDays(rv.windowEnd as Date, atLocalTime(0, 0, 0));
  await proposeVisitDate(rv.id, atLocalTime(lastDay, 15, 0), actor);
  check("proposta no último dia da janela, à tarde, é aceita", (await db.visit.findUniqueOrThrow({ where: { id: rv.id } })).proposedAt?.getTime() === atLocalTime(lastDay, 15, 0).getTime());
  await expectError("proposta no dia seguinte ao último dia da janela é bloqueada", () => proposeVisitDate(rv.id, atLocalTime(lastDay + 1, 9, 0), actor));
  const { isWithinWindow } = await import("@/domain/visit-window");
  const timedWindow = { windowStart: atLocalTime(-2, 14, 0), windowEnd: atLocalTime(5, 14, 0) };
  check(
    "a hora gravada nas pontas da janela não conta: primeiro e último dia valem inteiros",
    isWithinWindow(atLocalTime(-2, 8, 0), timedWindow) && isWithinWindow(atLocalTime(5, 17, 0), timedWindow) && !isWithinWindow(atLocalTime(6, 8, 0), timedWindow) && !isWithinWindow(atLocalTime(-3, 17, 0), timedWindow),
  );
  await expectError("“Proposta de nova data” não pode ser enviada à mão", () => sendTemplateMessage({ participantId: sergio.id, templateKey: "tpl-proposta-data", actor }));
  const first = atLocalTime(2, 14, 0);
  await propose(rv.id, sergio.id, first);
  const rConv = await db.conversation.findFirstOrThrow({ where: { participantId: sergio.id } });
  const proposalMsg = await db.communication.findFirstOrThrow({ where: { conversationId: rConv.id }, orderBy: { sentAt: "desc" }, include: { template: true } });
  const afterProposal = await db.visit.findUniqueOrThrow({ where: { id: rv.id } });
  check(
    "proposta enviada com a nova data; agenda ainda na data antiga; conversa aguarda resposta",
    proposalMsg.template?.key === "tpl-proposta-data" && proposalMsg.body.includes("14:00") && afterProposal.scheduledAt.getTime() === originalAt.getTime() && afterProposal.proposedAt?.getTime() === first.getTime() && rConv.status === "AGUARDANDO_RESPOSTA",
    [proposalMsg.body, afterProposal.scheduledAt, afterProposal.proposedAt, rConv.status],
  );
  const declined = await reply(sergio.id, "Nesse dia não consigo ir, pode ser outro dia?");
  const afterDecline = await db.visit.findUniqueOrThrow({ where: { id: rv.id } });
  check("“não consigo, outro dia?” → proposta cai, visita segue com remarcação solicitada", declined.decision?.intent === "REAGENDAMENTO" && afterDecline.proposedAt === null && afterDecline.status === "REAGENDAMENTO_SOLICITADO" && afterDecline.scheduledAt.getTime() === originalAt.getTime(), [declined.decision?.intent, declined.decision?.outcome, afterDecline]);
  const second = atLocalTime(3, 10, 30);
  await propose(rv.id, sergio.id, second);
  const accepted = await reply(sergio.id, "Confirmo!");
  const afterAccept = await db.visit.findUniqueOrThrow({ where: { id: rv.id } });
  const confirmMsg = await db.communication.findFirstOrThrow({ where: { conversationId: rConv.id }, orderBy: { sentAt: "desc" }, include: { template: true } });
  check(
    "“Confirmo!” → visita muda para a nova data, confirmada, sem proposta pendente",
    accepted.decision?.outcome === "AUTOMATICA" && afterAccept.scheduledAt.getTime() === second.getTime() && afterAccept.status === "CONFIRMADO" && afterAccept.proposedAt === null && afterAccept.rescheduleCount === rv.rescheduleCount + 1,
    [accepted.decision?.outcome, afterAccept],
  );
  check("confirmação enviada com a nova data", confirmMsg.template?.key === "tpl-confirmacao" && confirmMsg.body.includes("10:30"), confirmMsg.body);
  check("pendência de reagendamento encerrada", (await db.task.count({ where: { visitId: rv.id, status: { in: ["ABERTA", "EM_ANDAMENTO"] } } })) === 0);
  check("pendência para registrar a nova data no Polo Trial", (await db.task.count({ where: { participantId: sergio.id, title: { contains: "Registrar no Polo Trial" }, status: "ABERTA" } })) === 1);
  // Falta: proposta + confirmação por telefone (equipe confirma na tela).
  const paulo = await byName("Paulo Resende");
  const jv = await db.visit.findFirstOrThrow({ where: { participantId: paulo.id, status: "FALTOU" } });
  // Resposta à mensagem de falta pedindo nova data: tratada sozinha, como a remarcação, sem duplicar a pendência da falta.
  const openTasks = (visitId: string) => db.task.count({ where: { visitId, status: { in: ["ABERTA", "EM_ANDAMENTO"] } } });
  const jOpenBefore = await openTasks(jv.id);
  const jAsk = await reply(paulo.id, "Oi, desculpa por ontem, tive um imprevisto com meu filho. Consigo ir na sexta de manhã?");
  const jConv = await db.conversation.findFirstOrThrow({ where: { participantId: paulo.id } });
  const jReply = await db.communication.findFirstOrThrow({ where: { conversationId: jConv.id, direction: "OUTBOUND" }, orderBy: { sentAt: "desc" }, include: { template: true } });
  const jAfterAsk = await db.visit.findUniqueOrThrow({ where: { id: jv.id } });
  check(
    "falta → participante pede nova data → aplicada sozinha: “Reagendamento” enviado, visita segue como falta, sem pendência duplicada",
    jAsk.decision?.intent === "REAGENDAMENTO" && jAsk.decision?.outcome === "AUTOMATICA" && jReply.template?.key === "tpl-reagendamento" && jAfterAsk.status === "FALTOU" && jOpenBefore === 1 && (await openTasks(jv.id)) === 1,
    [jAsk.decision?.outcome, jAsk.decision?.reason, jReply.template?.key, jAfterAsk.status, jOpenBefore],
  );
  const caio = await byName("Caio Medeiros");
  const hv = await db.visit.findFirstOrThrow({ where: { participantId: caio.id, status: "REAGENDAMENTO_SOLICITADO" } });
  const hAsk = await reply(caio.id, "Preciso remarcar a visita, pode ser outro dia?");
  check(
    "remarcação já pedida e data original passada (janela aberta): novo pedido reconhecido e respondido sozinho",
    hv.scheduledAt < new Date() && hAsk.decision?.outcome === "AUTOMATICA" && (await db.visit.findUniqueOrThrow({ where: { id: hv.id } })).status === "REAGENDAMENTO_SOLICITADO",
    [hAsk.decision?.outcome, hAsk.decision?.reason],
  );
  const jWhen = atLocalTime(1, 9, 0);
  await propose(jv.id, paulo.id, jWhen);
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
    where: {
      ...withWa,
      studyId: { not: vacStudyId },
      visits: { none: { status: { in: ["AGUARDANDO_CONFIRMACAO", "CONFIRMADO", "REAGENDAMENTO_SOLICITADO"] } } },
      tasks: { none: { status: { in: ["ABERTA", "EM_ANDAMENTO"] }, title: { endsWith: "(pré-triagem)" } } }, // sem ligação agendada
      conversations: { some: {} },
    },
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

  console.log("\n9f. Participante pede dia e hora exatos: horário livre → equipe só confirma; ocupado → fluxo normal");
  const { checkVisitSlot, readRequestedVisitTime } = await import("@/domain/visit-slot");
  const { checkRequestedVisitSlot } = await import("@/server/services/visits");
  const { VISIT_SLOT_PREFIX } = await import("@/domain/assist-policy");
  const sentWed = new Date("2026-10-14T18:08:00Z"); // quarta-feira, 15:08 em Brasília
  const askedAt = (text: string, sentAt = sentWed) => readRequestedVisitTime(text, sentAt)?.at.toISOString() ?? null;
  const readings = [
    askedAt("Consigo ir na sexta feira as 10 da manhã?"),
    askedAt("Pode ser dia 20 às 14h30?"),
    askedAt("16/10 às 9h fica bom"),
    askedAt("amanhã às 3 da tarde"),
  ];
  check(
    "lê dia e hora exatos: “sexta feira as 10 da manhã”, “dia 20 às 14h30”, “16/10 às 9h”, “amanhã às 3 da tarde”",
    readings.join() === ["2026-10-16T13:00:00.000Z", "2026-10-20T17:30:00.000Z", "2026-10-16T12:00:00.000Z", "2026-10-15T18:00:00.000Z"].join(),
    readings,
  );
  check(
    "sem dia ou sem hora exata não vira pedido de horário (“sexta de manhã”, “às 10h”, “amanhã depois das 14h”)",
    ["Consigo na sexta de manhã", "Pode ser às 10h?", "amanhã depois das 14h"].every((t) => askedAt(t) === null),
  );
  const skipNegated = [
    askedAt("Não vou conseguir às 10h30. Pode ser amanhã às 9h?"),
    askedAt("Não vou conseguir amanhã, pode ser sexta às 10h?"),
    askedAt("Boa tarde! Amanhã não dá, só na sexta às 10h"),
  ];
  check(
    "o horário que NÃO serve é ignorado: “não consigo às 10h30, pode ser amanhã às 9h?” = amanhã 9h",
    skipNegated.join() === ["2026-10-15T12:00:00.000Z", "2026-10-16T13:00:00.000Z", "2026-10-16T13:00:00.000Z"].join(),
    skipNegated,
  );
  check(
    "duas opções ou frase sem pontuação com negação não viram sugestão (a equipe decide)",
    ["Pode ser sexta às 9h ou às 10h?", "Não consigo amanhã pode ser sexta às 10h"].every((t) => askedAt(t) === null),
  );
  check("“sexta às 10h” escrito numa sexta depois das 10h = a sexta seguinte", askedAt("sexta às 10h", new Date("2026-10-16T15:00:00Z")) === "2026-10-23T13:00:00.000Z");
  const slotCtx = {
    now: sentWed,
    window: { windowStart: null, windowEnd: new Date("2026-10-19T03:00:00Z") }, // janela até 19/10
    ownerId: "u1",
    ownerName: "Lucas Pereira",
    dayVisits: [{ start: new Date("2026-10-16T13:00:00Z"), durationMin: 60, staffId: "u1", name: "V2", participantName: "Fulano" }],
  };
  const slotOk = (iso: string) => checkVisitSlot(new Date(iso), slotCtx).ok;
  check(
    "agenda: conflito com o responsável, fim de semana, fora do horário de visitas e fora da janela são recusados; horário vago passa",
    !slotOk("2026-10-16T13:30:00Z") && !slotOk("2026-10-17T13:00:00Z") && !slotOk("2026-10-16T22:00:00Z") && !slotOk("2026-10-20T13:00:00Z") && slotOk("2026-10-16T15:00:00Z") && slotOk("2026-10-19T13:00:00Z"),
  );
  const activeVisit = (participantId: string) => db.visit.findFirstOrThrow({ where: { participantId, status: { in: ["AGUARDANDO_CONFIRMACAO", "CONFIRMADO"] } } });
  /** Primeiro dia útil, de 2 a 5 dias à frente, com todos os horários livres para a visita. */
  const freeDay = async (visit: Awaited<ReturnType<typeof activeVisit>>, hours: number[]) => {
    for (let d = 2; d <= 5; d++) if ((await Promise.all(hours.map((h) => checkRequestedVisitSlot(visit, atLocalTime(d, h, 0))))).every((r) => r.ok)) return d;
    return null;
  };
  const dayOfMonth = (offset: number) => Number(toDateParam(atLocalTime(offset, 12, 0)).slice(8));
  const outbound = (participantId: string) => db.communication.findMany({ where: { participantId, direction: "OUTBOUND" }, orderBy: { sentAt: "desc" }, include: { template: true } });

  const marcia = await byName("Márcia Guedes");
  const cv = await activeVisit(marcia.id);
  const cDay = (await freeDay(cv, [10])) ?? 2;
  const cSentBefore = (await outbound(marcia.id)).length;
  const cAsk = await reply(marcia.id, `Não vou conseguir ir amanhã. Pode ser dia ${dayOfMonth(cDay)} às 10h?`);
  const cHeld = await db.visit.findUniqueOrThrow({ where: { id: cv.id } });
  check(
    "horário pedido livre → sugestão “Confirmar novo horário” na fila; visita e conversa ainda sem mudança",
    !!cAsk.decision?.action?.startsWith(VISIT_SLOT_PREFIX) && cAsk.decision?.outcome === "PENDENTE" && cHeld.scheduledAt.getTime() === cv.scheduledAt.getTime() && (await outbound(marcia.id)).length === cSentBefore,
    [cAsk.decision?.outcome, cAsk.decision?.action, cAsk.decision?.reason],
  );
  await applyAssistDecision(cAsk.decision!.id, actor);
  const cAfter = await db.visit.findUniqueOrThrow({ where: { id: cv.id } });
  const [cLast] = await outbound(marcia.id);
  check(
    "equipe confirma → visita no horário pedido, já confirmada, “Confirmação de agendamento” enviada e pendência do Polo Trial criada",
    cAfter.scheduledAt.getTime() === atLocalTime(cDay, 10, 0).getTime() && cAfter.status === "CONFIRMADO" && cAfter.proposedAt === null && cLast.template?.key === "tpl-confirmacao" && cLast.body.includes("10:00") && (await db.task.count({ where: { participantId: marcia.id, title: { contains: "Registrar no Polo Trial" } } })) === 1,
    [cAfter.scheduledAt, cAfter.status, cLast.template?.key],
  );

  const gabriel = await byName("Gabriel Torres");
  const gv = await activeVisit(gabriel.id);
  const gAsk = await reply(gabriel.id, `Preciso remarcar a triagem. Pode ser dia ${dayOfMonth(cDay)} às 10h?`);
  const gTask = await db.task.findFirst({ where: { visitId: gv.id, status: "ABERTA" } });
  check(
    "horário pedido ocupado (Lucas já atende a Márcia) → fluxo normal, com o motivo na conversa e na pendência",
    gAsk.decision?.outcome === "AUTOMATICA" && (await db.visit.findUniqueOrThrow({ where: { id: gv.id } })).status === "REAGENDAMENTO_SOLICITADO" && !!gAsk.decision?.action?.includes("indisponível") && !!gTask?.description?.includes("Márcia Guedes"),
    [gAsk.decision?.outcome, gAsk.decision?.action, gTask?.description],
  );

  const nelson = await byName("Nelson Matos");
  const fv = await activeVisit(nelson.id);
  const fDay = (await freeDay(fv, [14, 15])) ?? 2;
  const fAsk = await reply(nelson.id, `Não vou conseguir ir amanhã. Pode ser dia ${dayOfMonth(fDay)} às 14h?`);
  const otherAt = atLocalTime(fDay, 15, 0);
  await applyAssistDecision(fAsk.decision!.id, actor, { callAt: otherAt });
  const fAfter = await db.visit.findUniqueOrThrow({ where: { id: fv.id } });
  const [fLast] = await outbound(nelson.id);
  check(
    "equipe escolhe outro horário → vira proposta: a visita só muda quando o participante confirmar",
    !!fAsk.decision?.action?.startsWith(VISIT_SLOT_PREFIX) && fAfter.proposedAt?.getTime() === otherAt.getTime() && fAfter.scheduledAt.getTime() === fv.scheduledAt.getTime() && fAfter.status === "REAGENDAMENTO_SOLICITADO" && fLast.template?.key === "tpl-proposta-data",
    [fAsk.decision?.action, fAfter.proposedAt, fAfter.status, fLast.template?.key],
  );

  console.log("\n10. Follow-up automático: horário de envio, tentativas e esgotamento");
  const wagner = await byName("Wagner Cordeiro");
  const night = await runScheduledAutomations(atLocalTime(0, 22, 30));
  check("às 22h30 nada sai: lembretes e follow-ups aguardam a janela (07h–21h)", night.followUps === 0 && night.reminders === 0 && night.outsideWindow >= 2, night);
  const morning = await runScheduledAutomations(atLocalTime(0, 10, 0));
  const wConv = await db.conversation.findFirstOrThrow({ where: { participantId: wagner.id } });
  const wLast = await db.communication.findFirstOrThrow({ where: { conversationId: wConv.id }, orderBy: { sentAt: "desc" }, include: { template: true } });
  check("às 10h: follow-up 1/1 enviado para Wagner com modelo aprovado", morning.details.some((d) => d.includes("Follow-up 1/1 enviado para Wagner Cordeiro")) && wLast.automationKey === "sem-resposta-24h" && wLast.template?.key === "tpl-segundo-contato", morning.details);
  check("às 10h: lembrete da visita de amanhã enviado", morning.reminders >= 1, morning);
  check("contador de tentativas = 1", wConv.followUpAttempts === 1, wConv.followUpAttempts);
  const again = await runScheduledAutomations(atLocalTime(0, 10, 5));
  check("rodar de novo não duplica nada", again.followUps === 0 && again.reminders === 0 && !again.details.some((d) => d.includes("Wagner")), again);
  const later = await runScheduledAutomations(atLocalTime(2, 10, 0));
  check("sem resposta após a tentativa: vira pendência de ligação", later.details.some((d) => d.includes("Wagner Cordeiro não respondeu ao segundo contato")), later.details);
  const wTask = await db.task.findFirst({ where: { participantId: wagner.id, automationKey: "sem-resposta-24h", status: "ABERTA" } });
  check("pendência aberta para o responsável", !!wTask && wTask.assigneeId === wagner.ownerId);
  const mario = await byName("Mário Bastos");
  await expectError("participante sem consentimento de WhatsApp não recebe envio", () => sendTemplateMessage({ participantId: mario.id, templateKey: "tpl-solicitacao-contato", actor }));
  const draft = await db.messageTemplate.findFirstOrThrow({ where: { approvalStatus: { not: "APROVADO" } } });
  await expectError("modelo não aprovado pelo CEP é bloqueado", () => sendTemplateMessage({ participantId: larissa.id, templateId: draft.id, actor }));

  console.log("\n11. Texto livre escrito pela equipe");
  await expectError("texto livre sem consentimento de WhatsApp é bloqueado", () => sendFreeTextMessage({ participantId: mario.id, body: "Olá, tudo bem?", expectsReply: true, actor }));
  await expectError("texto vazio é bloqueado", () => sendFreeTextMessage({ participantId: larissa.id, body: "   ", expectsReply: true, actor }));
  await expectError(`texto acima de ${FREE_TEXT_MAX} caracteres é bloqueado`, () => sendFreeTextMessage({ participantId: larissa.id, body: "a".repeat(FREE_TEXT_MAX + 1), expectsReply: true, actor }));
  const free = await sendFreeTextMessage({ participantId: larissa.id, body: "  Larissa, pode trazer o cartão do SUS na visita?  ", expectsReply: false, actor });
  const freeConv = await db.conversation.findFirstOrThrow({ where: { participantId: larissa.id } });
  check(
    "mensagem gravada como texto livre da equipe (sem modelo, não automática)",
    free.message.body === "Larissa, pode trazer o cartão do SUS na visita?" && free.message.templateId === null && !free.message.automated && free.message.sentById === camila.id,
    free.message,
  );
  check("Larissa escreveu há pouco: janela de 24h aberta", free.windowOpen);
  check("sem “aguardar resposta”: conversa resolvida", freeConv.status === "RESOLVIDA", freeConv.status);
  const freeAudit = await db.auditLog.findFirst({ where: { action: "message.free_text_sent", entityId: larissa.id }, orderBy: { createdAt: "desc" } });
  check("auditoria guarda o texto enviado", !!freeAudit && JSON.stringify(freeAudit.metadata).includes("cartão do SUS"), freeAudit?.metadata);
  check("linha do tempo registra “Mensagem livre enviada”", (await db.timelineEvent.count({ where: { participantId: larissa.id, title: "Mensagem livre enviada" } })) === 1);
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
  const leadConvs = await db.conversation.findMany({ where: { participantId: lead.id }, include: { _count: { select: { messages: true } } } });
  const { listConversations } = await import("@/server/queries/communication");
  const inboxForLead = await listConversations(actor.user, { q: lead.fullName });
  check(
    "com consentimento, a conversa já existe vazia e aparece em Comunicação para o primeiro contato",
    leadConvs.length === 1 && leadConvs[0].channel === "WHATSAPP" && leadConvs[0]._count.messages === 0 && inboxForLead.items.some((c) => c.participantId === lead.id),
    [leadConvs.length, inboxForLead.items.length],
  );
  const { openConversation } = await import("@/server/services/messaging");
  const noConv = await db.participant.findFirstOrThrow({ where: { conversations: { none: {} } } });
  const opened = await openConversation(noConv.id);
  const reopened = await openConversation(noConv.id);
  check("“Iniciar conversa” cria a conversa uma única vez (abrir de novo não duplica)", opened.id === reopened.id && (await db.conversation.count({ where: { participantId: noConv.id } })) === 1);
  const firstContact = await sendTemplateMessage({ participantId: lead.id, templateKey: "tpl-primeiro-contato", actor });
  check(
    "primeiro contato enviado pela conversa criada no cadastro (sem criar outra)",
    firstContact.template.key === "tpl-primeiro-contato" && (await db.conversation.count({ where: { participantId: lead.id } })) === 1 && (await db.conversation.findFirstOrThrow({ where: { participantId: lead.id } })).status === "AGUARDANDO_RESPOSTA",
  );

  console.log("\n14. Segunda opinião da IA (simulada) só no que as regras não resolvem");
  const aiStudy = await db.study.findUniqueOrThrow({ where: { code: "AUTO-2026" } });
  await db.studyAutomationSettings.updateMany({ where: { studyId: aiStudy.id }, data: { aiMode: "AUTOMATICO", aiMinConfidence: 80 } });
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

  // Duas dúvidas com resposta aprovada: sem IA, a equipe confirma e as duas respostas saem.
  const { faqTemplateKeys } = await import("@/server/ai/assist");
  const { approveLabel, FAQ_MULTI_PREFIX } = await import("@/domain/assist-policy");
  check(
    "regras acham as duas dúvidas na ordem da pergunta: “Onde fica e preciso levar RG?” = endereço, documentos",
    faqTemplateKeys("Onde fica e preciso levar RG?").join() === "tpl-faq-endereco,tpl-faq-documentos",
    faqTemplateKeys("Onde fica e preciso levar RG?"),
  );
  const isabela = await byName("Isabela Quintana");
  const beforeFaq = await aiCount();
  const twoFaqs = await reply(isabela.id, "Onde fica e preciso levar RG?");
  check(
    "duas dúvidas → sugestão “Enviar as 2 respostas”, sem consultar a IA e sem enviar nada ainda",
    twoFaqs.decision?.outcome === "PENDENTE" && !!twoFaqs.decision.action?.startsWith(FAQ_MULTI_PREFIX) && approveLabel("DUVIDA_FREQUENTE", twoFaqs.decision.action) === "Enviar as 2 respostas" && (await aiCount()) === beforeFaq,
    [twoFaqs.decision?.outcome, twoFaqs.decision?.action, twoFaqs.decision?.source],
  );
  const faqLines = await applyAssistDecision(twoFaqs.decision!.id, actor);
  const faqSent = await db.communication.findMany({ where: { participantId: isabela.id, direction: "OUTBOUND", sentAt: { gte: new Date(Date.now() - 60_000) } }, orderBy: { sentAt: "asc" } });
  const combined = faqSent[0]?.body ?? "";
  check(
    "equipe aprova → uma mensagem só: saudação uma vez, respostas ligadas por “e”, modelos usados registrados",
    faqSent.length === 1 &&
      combined.startsWith("Olá, Isabela! O Centro de Pesquisa") &&
      combined.includes("nos dias de visita, e para a visita, traga um documento oficial com foto.") &&
      (combined.match(/Olá/g) ?? []).length === 1 &&
      faqSent[0].combinedTemplates === "“Dúvida: endereço e estacionamento” v1 + “Dúvida: documentos” v1" &&
      faqLines.length === 1,
    [faqSent.length, combined, faqSent[0]?.combinedTemplates, faqLines],
  );
  const { combineAnswers } = await import("@/domain/templates");
  check(
    "a resposta que fecha a conversa (“Qualquer dúvida…”) vai por último, qualquer que seja a ordem da pergunta",
    combineAnswers(["Olá, Ana! Para a visita, traga um documento oficial com foto. Qualquer dúvida, estamos à disposição por aqui.", "Olá, Ana! O Centro fica na Av. das Palmeiras, 1000."]) ===
      "Olá, Ana! O Centro fica na Av. das Palmeiras, 1000, e para a visita, traga um documento oficial com foto. Qualquer dúvida, estamos à disposição por aqui.",
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

  const late = await reply(aline.id, "lá pelas cinco da tarde pode ser?");
  check(
    "ligação: “lá pelas cinco da tarde” → IA entende 17:00 e a sugestão vai para a equipe aprovar",
    late.decision?.source === "IA" && late.decision.outcome === "PENDENTE" && !!late.decision.action?.includes("17:00") && late.decision.timeHint === "as 17:00",
    [late.decision?.intent, late.decision?.outcome, late.decision?.action, late.decision?.timeHint],
  );
  await applyAssistDecision(late.decision!.id, actor);
  check("aprovada → ligação às 17:00", formatTime((await db.task.findUniqueOrThrow({ where: { id: callTask!.id } })).dueAt) === "17:00");
  const lastOutBefore = (await db.communication.findFirstOrThrow({ where: { participantId: aline.id, direction: "OUTBOUND" }, orderBy: { sentAt: "desc" } })).id;
  const ack = await reply(aline.id, "Combinado, obrigado!");
  const ackConv = await db.conversation.findFirstOrThrow({ where: { participantId: aline.id } });
  const lastOutAfter = (await db.communication.findFirstOrThrow({ where: { participantId: aline.id, direction: "OUTBOUND" }, orderBy: { sentAt: "desc" } })).id;
  check(
    "“Combinado” com ligação agendada (sem visita) → confirmação do horário da ligação, registrada sem mensagem e sem mexer na pendência",
    ack.decision?.intent === "CONFIRMACAO" && ack.decision.outcome === "AUTOMATICA" && !!ack.decision.action?.startsWith("Candidato confirmou o horário da ligação") &&
      lastOutAfter === lastOutBefore && ackConv.status === "RESOLVIDA" &&
      (await db.task.findUniqueOrThrow({ where: { id: callTask!.id } })).status === "ABERTA",
    [ack.decision?.intent, ack.decision?.outcome, ack.decision?.action, ackConv.status],
  );

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
  await reply(aline.id, "hmm, deixa eu ver");
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
