// Dados de demonstração — TODOS FICTÍCIOS.
//
// - Determinístico: mesma semente → mesmos registros e IDs (URLs da demo são estáveis).
// - Datas relativas ao momento da execução: a demo funciona em qualquer dia.
// - Cenários roteirizados (Larissa Mendonça, Paulo Resende, Aline Furtado...) sustentam o fluxo
//   de demonstração, espalhados pelos dias úteis; o restante é gerado de forma coerente com eles.
// - Nomes são combinações aleatórias; telefones usam o prefixo fictício 95555.

import type {
  ConversationStatus,
  MessageDirection,
  MessageStatus,
  ParticipantStatus,
  Prisma,
  PrismaClient,
  RecruitmentChannel,
  TaskPriority,
  TaskSource,
  TaskStatus,
  TimelineEventType,
  VisitCategory,
  VisitStatus,
} from "@prisma/client";
import { DEFAULT_AI } from "@/domain/assist-ai";
import { DEFAULT_FOLLOW_UP, DEFAULT_POLICY, evaluatePolicy, INTENT_LABEL, isActionable, type ActionableIntent } from "@/domain/assist-policy";
import { callLabel } from "@/domain/call-slot";
import { buildTemplateVars, renderTemplate, visitDateLabel } from "@/domain/templates";
import { addDays, atLocalTime, formatDayMonth, formatTime, startOfDay, startOfMonth, startOfWeek, weekdayIndex } from "@/lib/dates";
import { analyzeMessage } from "@/server/ai/assist";
import { AUTOMATION_RULES, type AutomationRuleKey } from "@/server/automations/rules";

// ─── PRNG determinístico ──────────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distribute(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  const rest = total - out.reduce((a, b) => a + b, 0);
  raw
    .map((r, i) => ({ frac: r - out[i], i }))
    .sort((x, y) => y.frac - x.frac)
    .slice(0, rest)
    .forEach(({ i }) => out[i]++);
  return out;
}

// ─── Catálogos ────────────────────────────────────────────────────────────

const STAGES = [
  { key: "BASE", name: "Base de voluntários", description: "Candidatos disponíveis para abordagem" },
  { key: "CONTATADOS", name: "Contatados", description: "Receberam o primeiro contato" },
  { key: "RESPONDERAM", name: "Responderam", description: "Retornaram o contato" },
  { key: "PRE_TRIAGEM", name: "Pré-triagem", description: "Passaram pela pré-triagem operacional" },
  { key: "ELEGIVEIS", name: "Elegíveis", description: "Aptos a agendar triagem (avaliação da equipe)" },
  { key: "AGENDADOS", name: "Agendados", description: "Visita de triagem agendada" },
  { key: "INCLUIDOS", name: "Incluídos", description: "Incluídos no estudo (registro no Polo Trial)" },
] as const;
type StageKey = (typeof STAGES)[number]["key"];

const CHANNELS: RecruitmentChannel[] = ["BANCO_PROPRIO", "INSTAGRAM", "FACEBOOK", "LANDING_PAGE", "INDICACAO", "ASSOCIACAO", "MIDIA_TRADICIONAL"];

/** Conversão entre etapas consecutivas, por canal (base→contatados … agendados→incluídos). */
const RATES: Record<RecruitmentChannel, number[]> = {
  BANCO_PROPRIO: [0.86, 0.56, 0.7, 0.55, 0.86, 0.8],
  INSTAGRAM: [0.95, 0.4, 0.6, 0.4, 0.8, 0.74],
  FACEBOOK: [0.95, 0.37, 0.62, 0.42, 0.8, 0.75],
  LANDING_PAGE: [0.98, 0.6, 0.74, 0.46, 0.85, 0.78],
  INDICACAO: [0.98, 0.76, 0.84, 0.6, 0.9, 0.85],
  ASSOCIACAO: [0.9, 0.66, 0.8, 0.55, 0.88, 0.82],
  MIDIA_TRADICIONAL: [0.95, 0.45, 0.6, 0.35, 0.8, 0.7],
};

const STAGE_FOR_STATUS: Record<ParticipantStatus, StageKey> = {
  NOVO: "BASE",
  EM_CONTATO: "CONTATADOS",
  PRE_TRIAGEM: "PRE_TRIAGEM",
  AGUARDANDO_AGENDAMENTO: "ELEGIVEIS",
  AGENDADO: "AGENDADOS",
  INCLUIDO: "INCLUIDOS",
  INELEGIVEL: "PRE_TRIAGEM",
  RETIRADO: "INCLUIDOS",
};

const FIRST_F = ["Ana", "Adriana", "Amanda", "Bianca", "Bruna", "Carla", "Célia", "Daniela", "Elisa", "Fabiana", "Gabriela", "Isabela", "Jéssica", "Joana", "Karina", "Larissa", "Lívia", "Mariana", "Michele", "Natália", "Priscila", "Raquel", "Regina", "Rita", "Rosana", "Sabrina", "Tânia", "Viviane", "Yasmin", "Aparecida"];
const FIRST_M = ["André", "Alexandre", "Arthur", "Caio", "Daniel", "Felipe", "Fernando", "Gabriel", "Guilherme", "Hugo", "Igor", "Jorge", "Leandro", "Leonardo", "Luiz", "Marcelo", "Márcio", "Mateus", "Nelson", "Paulo", "Rafael", "Renan", "Samuel", "Sérgio", "Thiago", "Vinícius", "Vitor", "Wagner", "Edson", "Raimundo"];
const LAST = ["Andrade", "Azevedo", "Batista", "Brito", "Campos", "Carvalho", "Correia", "Cunha", "Dias", "Fernandes", "Freire", "Garcia", "Guimarães", "Lacerda", "Leite", "Macedo", "Machado", "Marques", "Medeiros", "Melo", "Miranda", "Monteiro", "Moreira", "Nascimento", "Neves", "Pacheco", "Pinheiro", "Queiroz", "Rezende", "Sampaio", "Siqueira", "Tavares", "Vasconcelos", "Xavier", "Moura", "Paiva"];

type StudyKey = "VAC" | "AUTO" | "DERM" | "CARDIO";

const VISIT_PLAN: Record<StudyKey, string[]> = {
  VAC: ["Triagem", "V1 · Dia 1 (vacinação)", "V2 · Dia 8", "V3 · Dia 29", "V4 · Dia 57", "V5 · Dia 85", "V6 · Dia 180"],
  AUTO: ["Triagem", "Basal · Semana 0", "Semana 2", "Semana 4", "Semana 8", "Semana 12", "Semana 24"],
  DERM: ["Triagem", "Basal · Dia 1", "Semana 2", "Semana 4", "Semana 8"],
  CARDIO: ["Semana 36", "Semana 40", "Semana 44", "Semana 48", "Semana 52", "Encerramento · Semana 56"],
};

const REIMBURSEMENT_CENTS: Record<StudyKey, number> = { VAC: 8_000, AUTO: 12_000, DERM: 8_000, CARDIO: 10_000 };

function visitCategory(name: string): VisitCategory {
  if (name.startsWith("Triagem")) return "TRIAGEM";
  if (name.startsWith("Basal") || name.startsWith("V1 ")) return "INCLUSAO";
  if (name.startsWith("Encerramento")) return "ENCERRAMENTO";
  return "SEGUIMENTO";
}

const DURATION: Record<VisitCategory, number> = { TRIAGEM: 120, INCLUSAO: 180, SEGUIMENTO: 60, ENCERRAMENTO: 90, NAO_PROGRAMADA: 60 };

function visitRoom(study: StudyKey, name: string): string {
  if (name.startsWith("Triagem")) return "Sala de triagem";
  if (name.startsWith("V1 ")) return "Sala de vacinação";
  return { VAC: "Consultório 2", AUTO: "Consultório 1", DERM: "Consultório 3", CARDIO: "Consultório 1" }[study];
}

// ─── Construção dos dados ─────────────────────────────────────────────────

export function buildDemoData(now: Date) {
  const rand = mulberry32(20261008);
  const idRand = mulberry32(4242);
  const ALPHA = "0123456789abcdefghijklmnopqrstuvwxyz";
  const newId = () => "c" + Array.from({ length: 24 }, () => ALPHA[Math.floor(idRand() * 36)]).join("");
  const int = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const chance = (p: number) => rand() < p;

  const today = startOfDay(now);
  const at = (d: number, h: number, m = 0) => atLocalTime(d, h, m, now);
  /** Evento "já ocorrido hoje": nunca no futuro em relação a `now`. */
  const past = (d: number, h: number, m = 0) => {
    const t = at(d, h, m);
    const limit = now.getTime() - 2 * 60_000;
    // Preserva a ordem relativa dos eventos "futuros" comprimindo-os nos minutos anteriores a `now`.
    return t.getTime() > limit ? new Date(limit - (24 * 60 - (h * 60 + m)) * 1000) : t;
  };
  const isWeekend = (offset: number) => weekdayIndex(addDays(today, offset)) >= 5;
  /** Deslocamento em dias (a partir de hoje) do dia de `d`. */
  const dayOffsetOf = (d: Date) => Math.floor((d.getTime() - today.getTime()) / 86_400_000);
  /** Ajusta um deslocamento de dias para cair em dia útil. */
  const workday = (offset: number) => {
    let o = offset;
    const dir = offset >= 0 ? 1 : -1;
    while (isWeekend(o)) o += dir;
    return o;
  };
  /** n-ésimo dia útil a partir de hoje: 0 = hoje (no fim de semana, a segunda seguinte), 1 = próximo dia útil, -1 = dia útil anterior. */
  const bd = (n: number) => {
    let o = 0;
    if (n >= 0) {
      while (isWeekend(o)) o++;
      for (let i = 0; i < n; i++) do o++; while (isWeekend(o));
    } else {
      for (let i = 0; i < -n; i++) do o--; while (isWeekend(o));
    }
    return o;
  };
  const SLOTS: [number, number][] = [[8, 0], [8, 30], [9, 0], [9, 30], [10, 0], [10, 30], [11, 0], [13, 30], [14, 0], [14, 30], [15, 0], [15, 30], [16, 0]];

  // ── Usuários ──
  const U = {
    helena: { id: newId(), name: "Dra. Helena Duarte", email: "helena.duarte@platano.demo", role: "DIRETOR", jobTitle: "Diretora médica", lastLoginAt: past(0, 7, 40) },
    camila: { id: newId(), name: "Camila Rocha", email: "camila.rocha@platano.demo", role: "COORDENADOR", jobTitle: "Coordenadora de estudos", lastLoginAt: past(0, 7, 55) },
    marina: { id: newId(), name: "Marina Couto", email: "marina.couto@platano.demo", role: "COORDENADOR", jobTitle: "Coordenadora de estudos", lastLoginAt: at(-1, 17, 10) },
    beatriz: { id: newId(), name: "Beatriz Nunes", email: "beatriz.nunes@platano.demo", role: "ASSISTENTE", jobTitle: "Assistente de pesquisa", lastLoginAt: past(0, 7, 30) },
    lucas: { id: newId(), name: "Lucas Pereira", email: "lucas.pereira@platano.demo", role: "ASSISTENTE", jobTitle: "Assistente de pesquisa", lastLoginAt: past(0, 7, 35) },
    fernanda: { id: newId(), name: "Fernanda Alves", email: "fernanda.alves@platano.demo", role: "FINANCEIRO", jobTitle: "Analista financeira", lastLoginAt: at(-1, 16, 0) },
    ricardo: { id: newId(), name: "Ricardo Teles", email: "ricardo.teles@platano.demo", role: "QUALIDADE", jobTitle: "Analista de qualidade", lastLoginAt: at(-2, 14, 20) },
  } satisfies Record<string, Prisma.UserCreateManyInput>;
  type UserKey = keyof typeof U;
  const users: Prisma.UserCreateManyInput[] = Object.values(U);

  // ── Estudos ──
  const ST = {
    VAC: {
      id: newId(), code: "VAC-2026", name: "Vacina candidata em adultos", sponsor: "Instituto Butantan",
      title: "Estudo fase III, randomizado e duplo-cego, de imunogenicidade e segurança de vacina candidata em adultos saudáveis",
      indication: "Imunização de adultos saudáveis", studyType: "Vacina", phase: "Fase III", status: "RECRUTAMENTO_ATIVO",
      targetEnrollment: 500, enrolledCount: 368, screeningCount: 42, sourceSyncedAt: past(0, 6, 0),
      startDate: at(-220, 0), recruitmentEndDate: at(50, 0), expectedEndDate: at(420, 0), budgetCents: 18_000_000, ownerId: U.camila.id,
    },
    AUTO: {
      id: newId(), code: "AUTO-2026", name: "Imunobiológico em artrite reumatoide", sponsor: "Solenne Pharma",
      title: "Estudo fase II, randomizado e controlado por placebo, de imunobiológico em artrite reumatoide moderada a grave",
      indication: "Artrite reumatoide", studyType: "Autoimune", phase: "Fase II", status: "RECRUTAMENTO_ATIVO",
      targetEnrollment: 250, enrolledCount: 94, screeningCount: 21, sourceSyncedAt: past(0, 6, 0),
      startDate: at(-160, 0), recruitmentEndDate: at(260, 0), expectedEndDate: at(540, 0), budgetCents: 42_000_000, ownerId: U.marina.id,
    },
    DERM: {
      id: newId(), code: "DERM-2026", name: "Terapia tópica em dermatite atópica", sponsor: "Caravela Bio",
      title: "Estudo fase II de terapia tópica em dermatite atópica moderada em adultos",
      indication: "Dermatite atópica", studyType: "Dermatologia", phase: "Fase II", status: "RECRUTAMENTO_ATIVO",
      targetEnrollment: 80, enrolledCount: 19, screeningCount: 9, sourceSyncedAt: past(0, 6, 0),
      startDate: at(-45, 0), recruitmentEndDate: at(135, 0), expectedEndDate: at(330, 0), budgetCents: 9_600_000, ownerId: U.marina.id,
    },
    CARDIO: {
      id: newId(), code: "CARDIO-2025", name: "Anti-hipertensivo em hipertensão resistente", sponsor: "Altamira Biotech",
      title: "Estudo fase III de anti-hipertensivo em hipertensão arterial resistente",
      indication: "Hipertensão resistente", studyType: "Cardiovascular", phase: "Fase III", status: "ACOMPANHAMENTO",
      targetEnrollment: 120, enrolledCount: 120, screeningCount: 0, sourceSyncedAt: past(0, 6, 0),
      startDate: at(-560, 0), recruitmentEndDate: at(-200, 0), expectedEndDate: at(180, 0), budgetCents: 31_000_000, ownerId: U.camila.id,
    },
  } satisfies Record<StudyKey, Prisma.StudyCreateManyInput>;
  const studies: Prisma.StudyCreateManyInput[] = Object.values(ST);

  const studyMembers: Prisma.StudyMemberCreateManyInput[] = [];
  const member = (s: StudyKey, u: UserKey, studyRole: string) => studyMembers.push({ id: newId(), studyId: ST[s].id, userId: U[u].id, studyRole });
  member("VAC", "camila", "Coordenação"); member("VAC", "helena", "Investigadora principal"); member("VAC", "beatriz", "Assistente"); member("VAC", "lucas", "Assistente");
  member("AUTO", "marina", "Coordenação"); member("AUTO", "camila", "Coordenação adjunta"); member("AUTO", "helena", "Investigadora principal"); member("AUTO", "beatriz", "Assistente");
  member("DERM", "marina", "Coordenação"); member("DERM", "camila", "Coordenação adjunta"); member("DERM", "helena", "Investigadora principal"); member("DERM", "lucas", "Assistente");
  member("CARDIO", "camila", "Coordenação"); member("CARDIO", "helena", "Investigadora principal"); member("CARDIO", "lucas", "Assistente");

  const externalRefs: Prisma.ExternalReferenceCreateManyInput[] = [];
  const extRef = (entityType: string, entityId: string, externalId: string) =>
    externalRefs.push({ id: newId(), system: "POLO_TRIAL", entityType, entityId, externalId, lastSyncedAt: past(0, 6, 0) });
  (Object.keys(ST) as StudyKey[]).forEach((k, i) => extRef("Study", ST[k].id, `PT-EST-${1040 + i * 7}`));

  // ── Etapas e métricas do funil ──
  const stageIds = Object.fromEntries(STAGES.map((s) => [s.key, newId()])) as Record<StageKey, string>;
  const stages: Prisma.RecruitmentStageCreateManyInput[] = STAGES.map((s, i) => ({ id: stageIds[s.key], key: s.key, name: s.name, description: s.description, order: i + 1 }));

  const SHARES: Record<StudyKey, number[]> = {
    // ordem: BANCO, INSTAGRAM, FACEBOOK, LANDING, INDICACAO, ASSOCIACAO, MIDIA
    VAC: [0.3, 0.18, 0.12, 0.16, 0.12, 0.04, 0.08],
    AUTO: [0.22, 0.1, 0.14, 0.12, 0.14, 0.22, 0.06],
    DERM: [0.2, 0.3, 0.2, 0.15, 0.1, 0.03, 0.02],
    CARDIO: [0.35, 0, 0.1, 0.05, 0.25, 0.1, 0.15],
  };
  const ELIGIBILITY_FACTOR: Record<StudyKey, number> = { VAC: 1, AUTO: 0.8, DERM: 0.9, CARDIO: 0.85 };

  const recruitmentMetrics: Prisma.RecruitmentMetricCreateManyInput[] = [];
  for (const key of Object.keys(ST) as StudyKey[]) {
    const s = ST[key];
    const end = s.recruitmentEndDate < now ? s.recruitmentEndDate : now;
    const weeks: Date[] = [];
    for (let w = startOfWeek(s.startDate); w <= end; w = addDays(w, 7)) weeks.push(w);
    const weights = weeks.map((_, i) => Math.min(1, (i + 1) / 5) * (0.75 + rand() * 0.5));
    if (end === now) weights[weights.length - 1] *= (weekdayIndex(now) + 1) / 7;
    const perWeek = distribute(s.enrolledCount, weights);
    weeks.forEach((weekStart, wi) => {
      const perChannel = distribute(perWeek[wi], SHARES[key]);
      CHANNELS.forEach((channel, ci) => {
        const share = SHARES[key][ci];
        if (share === 0) return;
        const counts = new Array<number>(7).fill(0);
        counts[6] = perChannel[ci];
        let f = Math.max(perWeek[wi] * share, perChannel[ci], 0.35 * share * 4);
        for (let k = 5; k >= 0; k--) {
          const r = RATES[channel][k] * (k === 3 ? ELIGIBILITY_FACTOR[key] : 1) * (0.9 + rand() * 0.2);
          f = f / r;
          counts[k] = Math.max(counts[k + 1], Math.round(f));
        }
        counts.forEach((count, k) => {
          if (count > 0) recruitmentMetrics.push({ id: newId(), studyId: s.id, stageId: stageIds[STAGES[k].key], channel, weekStart, count });
        });
      });
    });
  }

  // ── Assistência IA e follow-up por estudo ──
  // Política atual: todas as intenções configuráveis em modo automático, em todos os estudos.
  // O histórico da demo foi vivido com o piloto inicial (só AUTO-2026, e só confirmação, dúvida e
  // descadastro); minutos antes de "agora" o modo automático foi ampliado. Interesse fica em 80,
  // a nota máxima que o classificador dá para interesse.
  const PILOT: StudyKey = "AUTO";
  const PILOT_POLICY_HISTORY: Partial<Record<ActionableIntent, number>> = { CONFIRMACAO: 85, DUVIDA_FREQUENTE: 85, DESCADASTRO: 90 };
  const AUTO_POLICY: Record<ActionableIntent, number> = { CONFIRMACAO: 85, DUVIDA_FREQUENTE: 85, REAGENDAMENTO: 85, DESCADASTRO: 90, INTERESSE: 80 };
  const autoExpandedAt = new Date(now.getTime() - 60_000);
  const policyFor = (_study: StudyKey, intent: ActionableIntent) => ({ mode: "AUTOMATICO" as const, minConfidence: AUTO_POLICY[intent] });
  const historyPolicyFor = (study: StudyKey, intent: ActionableIntent) =>
    study === PILOT && PILOT_POLICY_HISTORY[intent] !== undefined ? { mode: "AUTOMATICO" as const, minConfidence: PILOT_POLICY_HISTORY[intent] as number } : DEFAULT_POLICY;
  const expandedIntents = (study: StudyKey) => (Object.keys(AUTO_POLICY) as ActionableIntent[]).filter((i) => historyPolicyFor(study, i).mode !== "AUTOMATICO");
  const automationSettings: Prisma.StudyAutomationSettingsCreateManyInput[] = (Object.keys(ST) as StudyKey[]).map((k) => ({ id: newId(), studyId: ST[k].id, ...DEFAULT_FOLLOW_UP, ...DEFAULT_AI }));
  const assistPolicies: Prisma.AssistPolicyCreateManyInput[] = (Object.keys(ST) as StudyKey[]).flatMap((k) =>
    (["CONFIRMACAO", "DUVIDA_FREQUENTE", "REAGENDAMENTO", "DESCADASTRO", "INTERESSE"] as ActionableIntent[]).map((intent) => ({
      id: newId(),
      studyId: ST[k].id,
      intent,
      ...policyFor(k, intent),
      ...(expandedIntents(k).includes(intent) ? { updatedById: U.helena.id, updatedAt: autoExpandedAt } : {}),
    })),
  );
  /** A assistência teria aplicado esta resposta sozinha? (mesma regra do motor, com a política da época) */
  const autoApplies = (study: StudyKey, body: string, hasPendingVisit: boolean) => {
    const a = analyzeMessage(body, { hasPendingVisit });
    const ev = evaluatePolicy(a, isActionable(a.intent) ? historyPolicyFor(study, a.intent) : null, { ruleEnabled: true, applicable: true });
    return { a, auto: ev.outcome === "AUTOMATICA", reason: ev.reason };
  };

  // ── Modelos de mensagem ──
  type TplKey =
    | "tpl-primeiro-contato" | "tpl-segundo-contato" | "tpl-lembrete-visita" | "tpl-confirmacao" | "tpl-reagendamento" | "tpl-falta-visita" | "tpl-ligacao-agendada" | "tpl-proposta-data"
    | "tpl-solicitacao-contato" | "tpl-faq-ressarcimento" | "tpl-faq-documentos" | "tpl-faq-endereco"
    | "tpl-vac-convite" | "tpl-derm-instagram" | "tpl-auto-associacao";
  const TPL: Record<TplKey, Prisma.MessageTemplateCreateManyInput> = {
    "tpl-primeiro-contato": { id: newId(), key: "tpl-primeiro-contato", name: "Primeiro contato", category: "PRIMEIRO_CONTATO", approvalStatus: "APROVADO", version: 2, cepReference: "Parecer fictício nº 6.104.221", approvedAt: at(-240, 10),
      body: "Olá, {{nome}}! Aqui é a equipe do Centro de Pesquisa Plátano. Recebemos seu interesse em participar de pesquisas clínicas e gostaríamos de conversar sobre o estudo {{estudo}}. Podemos te ligar? Responda SIM e informe o melhor horário." },
    "tpl-segundo-contato": { id: newId(), key: "tpl-segundo-contato", name: "Segundo contato", category: "SEGUNDO_CONTATO", approvalStatus: "APROVADO", version: 1, cepReference: "Parecer fictício nº 6.104.221", approvedAt: at(-240, 10),
      body: "Olá, {{nome}}. Tentamos falar com você sobre o estudo {{estudo}}. Se ainda tiver interesse, é só responder esta mensagem. Se preferir não receber novos contatos, responda SAIR." },
    "tpl-lembrete-visita": { id: newId(), key: "tpl-lembrete-visita", name: "Lembrete de visita", category: "LEMBRETE_VISITA", approvalStatus: "APROVADO", version: 3, cepReference: "Parecer fictício nº 6.233.870", approvedAt: at(-120, 15),
      body: "Olá, {{nome}}! Tudo bem? Gostaríamos de confirmar sua visita {{data}} às {{hora}} no Centro de Pesquisa Plátano. Responda CONFIRMO para confirmar ou REMARCAR se precisar de outro horário." },
    "tpl-confirmacao": { id: newId(), key: "tpl-confirmacao", name: "Confirmação de agendamento", category: "CONFIRMACAO", approvalStatus: "APROVADO", version: 2, cepReference: "Parecer fictício nº 6.233.870", approvedAt: at(-120, 15),
      body: "Obrigado, {{nome}}! Sua visita está confirmada para {{data}} às {{hora}}. Lembre-se de trazer um documento com foto. Até lá!" },
    "tpl-reagendamento": { id: newId(), key: "tpl-reagendamento", name: "Reagendamento", category: "REAGENDAMENTO", approvalStatus: "APROVADO", version: 1, cepReference: "Parecer fictício nº 6.233.870", approvedAt: at(-120, 15),
      body: "Olá, {{nome}}. Recebemos seu pedido de remarcação. Nossa equipe vai entrar em contato em breve com novas opções de horário." },
    "tpl-ligacao-agendada": { id: newId(), key: "tpl-ligacao-agendada", name: "Ligação agendada", category: "CONFIRMACAO", approvalStatus: "APROVADO", version: 1, cepReference: "Parecer fictício nº 6.104.221", approvedAt: at(-240, 10),
      body: "Combinado, {{nome}}! Nossa equipe vai te ligar {{ligacao}} para conversar sobre o estudo {{estudo}}. Se esse horário não for bom, é só responder com outro." },
    "tpl-proposta-data": { id: newId(), key: "tpl-proposta-data", name: "Proposta de nova data", category: "REAGENDAMENTO", approvalStatus: "APROVADO", version: 1, cepReference: "Parecer fictício nº 6.233.870", approvedAt: at(-120, 15),
      body: "Olá, {{nome}}! Podemos remarcar sua visita para {{nova_data}} às {{nova_hora}}? Responda CONFIRMO para confirmar ou nos diga outro dia e horário que fique melhor." },
    "tpl-falta-visita": { id: newId(), key: "tpl-falta-visita", name: "Falta na visita", category: "REAGENDAMENTO", approvalStatus: "APROVADO", version: 1, cepReference: "Parecer fictício nº 6.233.870", approvedAt: at(-120, 15),
      body: "Olá, {{nome}}. Sentimos sua falta na visita {{data}} às {{hora}} no Centro de Pesquisa Plátano. Vamos combinar um novo horário? Responda esta mensagem e nossa equipe entra em contato." },
    "tpl-solicitacao-contato": { id: newId(), key: "tpl-solicitacao-contato", name: "Solicitação de contato", category: "SOLICITACAO_CONTATO", approvalStatus: "APROVADO", version: 1, cepReference: "Parecer fictício nº 6.104.221", approvedAt: at(-240, 10),
      body: "Olá, {{nome}}. A equipe do estudo {{estudo}} precisa falar com você. Qual o melhor horário para ligarmos?" },
    "tpl-faq-ressarcimento": { id: newId(), key: "tpl-faq-ressarcimento", name: "Dúvida: ressarcimento", category: "DUVIDA_FREQUENTE", approvalStatus: "APROVADO", version: 1, cepReference: "Parecer fictício nº 6.233.870", approvedAt: at(-120, 15),
      body: "Olá, {{nome}}! Sim: as despesas de transporte e alimentação nos dias de visita são ressarcidas, conforme descrito no Termo de Consentimento. Basta guardar os comprovantes." },
    "tpl-faq-documentos": { id: newId(), key: "tpl-faq-documentos", name: "Dúvida: documentos", category: "DUVIDA_FREQUENTE", approvalStatus: "APROVADO", version: 1, cepReference: "Parecer fictício nº 6.233.870", approvedAt: at(-120, 15),
      body: "Olá, {{nome}}! Para a visita, traga um documento oficial com foto. Qualquer dúvida, estamos à disposição por aqui." },
    "tpl-faq-endereco": { id: newId(), key: "tpl-faq-endereco", name: "Dúvida: endereço e estacionamento", category: "DUVIDA_FREQUENTE", approvalStatus: "APROVADO", version: 1, cepReference: "Parecer fictício nº 6.233.870", approvedAt: at(-120, 15),
      body: "Olá, {{nome}}! O Centro de Pesquisa Plátano fica na Av. das Palmeiras, 1000 — 3º andar. Há estacionamento conveniado no prédio e o valor é ressarcido nos dias de visita." },
    "tpl-vac-convite": { id: newId(), key: "tpl-vac-convite", name: "Convite VAC-2026 (banco de voluntários)", category: "PRIMEIRO_CONTATO", studyId: ST.VAC.id, approvalStatus: "APROVADO", version: 1, cepReference: "Parecer fictício nº 6.301.552", approvedAt: at(-200, 11),
      body: "Olá, {{nome}}! Você faz parte do banco de voluntários do Centro de Pesquisa Plátano. Estamos convidando adultos para o estudo {{estudo}}, sobre uma vacina em pesquisa. Quer saber mais? Responda SIM." },
    "tpl-derm-instagram": { id: newId(), key: "tpl-derm-instagram", name: "Convite DERM-2026 (Instagram)", category: "PRIMEIRO_CONTATO", studyId: ST.DERM.id, approvalStatus: "EM_REVISAO", version: 1, cepReference: "Submetido — aguardando parecer",
      body: "Olá, {{nome}}! Vimos que você se interessou pelo estudo {{estudo}} sobre dermatite atópica. Podemos te ligar para explicar como funciona?" },
    "tpl-auto-associacao": { id: newId(), key: "tpl-auto-associacao", name: "Convite AUTO-2026 (associação de pacientes)", category: "PRIMEIRO_CONTATO", studyId: ST.AUTO.id, approvalStatus: "RASCUNHO", version: 1,
      body: "Olá, {{nome}}! A associação de pacientes indicou seu contato para o estudo {{estudo}}. Podemos conversar?" },
  };
  const templates = Object.values(TPL);

  // ── Coleções ──
  const participants: P[] = [];
  const recruitments: Prisma.RecruitmentCreateManyInput[] = [];
  const consents: Prisma.ConsentRecordCreateManyInput[] = [];
  const visits: Prisma.VisitCreateManyInput[] = [];
  const conversations: C[] = [];
  const inbound: { id: string; c: C; body: string; at: Date; hasPendingVisit: boolean }[] = [];
  const communications: Prisma.CommunicationCreateManyInput[] = [];
  const tasks: Prisma.TaskCreateManyInput[] = [];
  const reimbursements: Prisma.ReimbursementCreateManyInput[] = [];
  const timeline: Prisma.TimelineEventCreateManyInput[] = [];
  const automationRuns: Prisma.AutomationRunCreateManyInput[] = [];
  const auditLogs: Prisma.AuditLogCreateManyInput[] = [];
  const notifications: Prisma.NotificationCreateManyInput[] = [];

  const ruleIds = Object.fromEntries(AUTOMATION_RULES.map((r) => [r.key, newId()])) as Record<AutomationRuleKey, string>;
  const automationRules: Prisma.AutomationRuleCreateManyInput[] = AUTOMATION_RULES.map((r) => ({
    id: ruleIds[r.key], key: r.key, name: r.name, trigger: r.trigger, condition: r.condition, action: r.action, enabled: true, createdAt: at(-90, 10),
  }));

  type P = Prisma.ParticipantCreateManyInput & { id: string; studyKey: StudyKey; ownerKey: UserKey; whatsapp: boolean };
  type Actor = UserKey | "automation" | "system" | "integration";
  const actorFields = (a: Actor) =>
    a === "automation" ? { actorType: "AUTOMATION" as const, actorId: null }
    : a === "system" ? { actorType: "SYSTEM" as const, actorId: null }
    : a === "integration" ? { actorType: "INTEGRATION" as const, actorId: null }
    : { actorType: "USER" as const, actorId: U[a].id };

  let seq = 0;
  const usedNames = new Set<string>(Object.values(U).map((u) => u.name));

  function addParticipant(spec: {
    name: string; study: StudyKey; status: ParticipantStatus; channel: RecruitmentChannel; owner: UserKey; createdAt: Date;
    lastContactAt?: Date | null; nextAction?: string | null; nextActionDueAt?: Date | null; whatsapp?: boolean; campaign?: string;
  }): P {
    seq++;
    usedNames.add(spec.name);
    const p: P = {
      id: newId(), code: `PLT-${String(seq).padStart(4, "0")}`, fullName: spec.name,
      phone: `(11) 95555-${String(1000 + seq * 7).padStart(4, "0")}`, email: null,
      studyId: ST[spec.study].id, status: spec.status, channel: spec.channel, ownerId: U[spec.owner].id,
      lastContactAt: spec.lastContactAt ?? null, nextAction: spec.nextAction ?? null, nextActionDueAt: spec.nextActionDueAt ?? null,
      createdAt: spec.createdAt, studyKey: spec.study, ownerKey: spec.owner, whatsapp: spec.whatsapp ?? true,
    };
    participants.push(p);
    const outcome = spec.status === "INCLUIDO" ? "INCLUIDO" : spec.status === "INELEGIVEL" ? "NAO_ELEGIVEL" : spec.status === "RETIRADO" ? "DESISTENCIA" : "EM_ANDAMENTO";
    recruitments.push({
      id: newId(), participantId: p.id, studyId: p.studyId, stageId: stageIds[STAGE_FOR_STATUS[spec.status]],
      campaign: spec.campaign ?? campaignFor(spec.study, spec.channel), outcome, enteredAt: spec.createdAt, stageUpdatedAt: spec.lastContactAt ?? spec.createdAt,
    });
    const consentSource = { BANCO_PROPRIO: "Banco de voluntários (aceite registrado)", INSTAGRAM: "Formulário — Instagram", FACEBOOK: "Formulário — Facebook", LANDING_PAGE: "Formulário — Landing Page", INDICACAO: "Contato telefônico (aceite verbal registrado)", ASSOCIACAO: "Lista da associação (aceite registrado)", MIDIA_TRADICIONAL: "Contato telefônico (aceite verbal registrado)" }[spec.channel];
    consents.push({ id: newId(), participantId: p.id, purpose: "CONTATO_TELEFONE", granted: true, source: consentSource, recordedAt: spec.createdAt, retentionUntil: addDays(spec.createdAt, 365 * 5) });
    consents.push({ id: newId(), participantId: p.id, purpose: "CONTATO_WHATSAPP", granted: p.whatsapp, source: consentSource, recordedAt: spec.createdAt, retentionUntil: addDays(spec.createdAt, 365 * 5) });
    return p;
  }

  function campaignFor(study: StudyKey, channel: RecruitmentChannel): string {
    const code = ST[study].code;
    return {
      BANCO_PROPRIO: "Banco de voluntários Plátano", INSTAGRAM: `Anúncio Instagram — ${code}`, FACEBOOK: `Anúncio Facebook — ${code}`,
      LANDING_PAGE: `Landing page ${code}`, INDICACAO: "Indicação de participante", ASSOCIACAO: study === "AUTO" ? "Associação de pacientes (parceria)" : "Associação comunitária",
      MIDIA_TRADICIONAL: "Rádio local e jornal de bairro",
    }[channel];
  }

  function tl(p: P, type: TimelineEventType, title: string, occurredAt: Date, o: { description?: string; source?: string; actor?: Actor } = {}) {
    timeline.push({ id: newId(), participantId: p.id, studyId: p.studyId, type, title, description: o.description ?? null, source: o.source ?? null, occurredAt, ...actorFields(o.actor ?? "system") });
  }

  type V = Prisma.VisitCreateManyInput & { id: string; scheduledAt: Date };
  function addVisit(p: P, v: {
    name: string; at: Date; status: VisitStatus; staff?: UserKey; rescheduleCount?: number; reminderSentAt?: Date | null;
    confirmedAt?: Date | null; completedAt?: Date | null; window?: [Date, Date] | null;
  }): V {
    const category = visitCategory(v.name);
    const window = v.window === undefined ? (category === "SEGUIMENTO" || category === "ENCERRAMENTO" ? [addDays(v.at, -3), addDays(v.at, 4)] : null) : v.window;
    const visit: V = {
      id: newId(), participantId: p.id, studyId: p.studyId, name: v.name, category, scheduledAt: v.at, durationMin: DURATION[category],
      status: v.status, staffId: U[v.staff ?? p.ownerKey].id, room: visitRoom(p.studyKey, v.name),
      windowStart: window?.[0] ?? null, windowEnd: window?.[1] ?? null, rescheduleCount: v.rescheduleCount ?? 0,
      reminderSentAt: v.reminderSentAt ?? null, confirmedAt: v.confirmedAt ?? null,
      completedAt: v.completedAt ?? (v.status === "REALIZADO" ? new Date(v.at.getTime() + DURATION[category] * 60_000) : null),
      createdAt: addDays(v.at, -14),
    };
    visits.push(visit);
    if (window) extRef("Visit", visit.id, `PT-VIS-${String(70000 + visits.length * 13)}`);
    return visit;
  }

  type C = Prisma.ConversationCreateManyInput & { id: string; p: P; count: number };
  function conversation(p: P, status: ConversationStatus, unreadCount = 0): C {
    const c: C = { id: newId(), participantId: p.id, studyId: p.studyId, channel: "WHATSAPP", status, assignedToId: U[p.ownerKey].id, unreadCount, lastMessageAt: p.createdAt as Date, createdAt: p.createdAt, p, count: 0 };
    conversations.push(c);
    return c;
  }

  function msg(c: C, m: { dir: MessageDirection; at: Date; tpl?: TplKey; body?: string; by?: UserKey; auto?: AutomationRuleKey; visitAt?: Date; status?: MessageStatus; hasPendingVisit?: boolean; vars?: Record<string, string> }) {
    const p = c.p;
    const body = m.tpl
      ? renderTemplate(TPL[m.tpl].body, { ...buildTemplateVars({ participantName: p.fullName, studyCode: ST[p.studyKey].code, visitAt: m.visitAt, now: m.at }), ...m.vars })
      : (m.body ?? "");
    const status: MessageStatus = m.status ?? (m.dir === "INBOUND" ? "RECEIVED" : m.dir === "INTERNAL_NOTE" ? "SENT" : now.getTime() - m.at.getTime() > 6 * 3_600_000 ? "READ" : "DELIVERED");
    communications.push({
      id: newId(), conversationId: c.id, participantId: p.id, studyId: p.studyId, channel: "WHATSAPP", direction: m.dir, body,
      templateId: m.tpl ? TPL[m.tpl].id : null, status, automated: !!m.auto, automationKey: m.auto ?? null,
      intent: m.dir === "INBOUND" ? analyzeMessage(body, { hasPendingVisit: m.hasPendingVisit ?? true }).intent : null,
      sentById: m.by ? U[m.by].id : null, externalId: m.dir === "INTERNAL_NOTE" ? null : `sim-wa-${(communications.length + 1).toString(36)}`, sentAt: m.at,
    });
    if (m.dir === "INBOUND") inbound.push({ id: communications.at(-1)!.id as string, c, body, at: m.at, hasPendingVisit: m.hasPendingVisit ?? true });
    if (m.at > (c.lastMessageAt as Date)) c.lastMessageAt = m.at;
    c.count++;
    if (m.auto) {
      const label = m.tpl ? TPL[m.tpl].name : "Mensagem";
      run(m.auto, "SUCESSO", `${label} enviado para ${p.fullName}${m.visitAt ? ` (visita ${formatDayMonth(m.visitAt)} às ${formatTime(m.visitAt)})` : ""}`, m.at, p, "Communication");
    }
  }

  function addTask(t: {
    title: string; description?: string; priority: TaskPriority; status?: TaskStatus; dueAt: Date; study?: StudyKey; p?: P; visit?: V;
    assignee: UserKey; createdBy?: UserKey; source: TaskSource; auto?: AutomationRuleKey; createdAt: Date; completedAt?: Date; completedBy?: UserKey;
  }) {
    const status: TaskStatus = t.status ?? (t.completedAt ? "CONCLUIDA" : "ABERTA");
    const task: Prisma.TaskCreateManyInput = {
      id: newId(), title: t.title, description: t.description ?? null, priority: t.priority, status, dueAt: t.dueAt,
      studyId: t.p ? t.p.studyId : t.study ? ST[t.study].id : null, participantId: t.p?.id ?? null, visitId: t.visit?.id ?? null,
      assigneeId: U[t.assignee].id, createdById: t.createdBy ? U[t.createdBy].id : null, source: t.source, automationKey: t.auto ?? null,
      completedAt: t.completedAt ?? null, completedById: t.completedBy ? U[t.completedBy].id : null, createdAt: t.createdAt, updatedAt: t.completedAt ?? t.createdAt,
    };
    tasks.push(task);
    if (t.auto) run(t.auto, "SUCESSO", `Pendência criada: ${t.title}`, t.createdAt, t.p, "Task", task.id, t.study);
    return task;
  }

  function run(rule: AutomationRuleKey, status: "SUCESSO" | "IGNORADA" | "FALHA", summary: string, createdAt: Date, p?: P, entityType?: string, entityId?: string, study?: StudyKey) {
    automationRuns.push({
      id: newId(), ruleId: ruleIds[rule], status, summary, entityType: entityType ?? null, entityId: entityId ?? null,
      studyId: p ? p.studyId : study ? ST[study].id : null, participantId: p?.id ?? null, createdAt,
    });
  }

  let rbSeq = 0;
  function addReimbursement(p: P, v: V) {
    const ageDays = (now.getTime() - v.scheduledAt.getTime()) / 86_400_000;
    const status = ageDays > 20 ? "PAGO" : ageDays > 10 ? "EM_CONCILIACAO" : "PENDENTE";
    rbSeq++;
    const r: Prisma.ReimbursementCreateManyInput = {
      id: newId(), code: `RB-${String(rbSeq).padStart(4, "0")}`, participantId: p.id, studyId: p.studyId, visitId: v.id,
      amountCents: REIMBURSEMENT_CENTS[p.studyKey] + (v.category === "INCLUSAO" ? 4_000 : 0), description: "Transporte e alimentação",
      status, receiptReceived: status !== "PENDENTE" || chance(0.6), requestedAt: v.completedAt as Date,
      paidAt: status === "PAGO" ? addDays(v.scheduledAt, int(8, 12)) : null,
    };
    reimbursements.push(r);
    run("realizada-reembolso", "SUCESSO", `Reembolso ${r.code} gerado para ${p.fullName} (${v.name})`, v.completedAt as Date, p, "Reimbursement", r.id);
  }

  function audit(a: { actor: Actor; action: string; entityType: string; entityId?: string; study?: StudyKey; summary: string; at: Date; metadata?: Prisma.InputJsonValue }) {
    const actor = actorFields(a.actor);
    const label = a.actor === "automation" ? "Automação" : a.actor === "system" ? "Sistema" : a.actor === "integration" ? "Integração Polo Trial (simulada)" : U[a.actor].name;
    auditLogs.push({ id: newId(), ...actor, actorLabel: label, action: a.action, entityType: a.entityType, entityId: a.entityId ?? null, studyId: a.study ? ST[a.study].id : null, summary: a.summary, metadata: a.metadata, createdAt: a.at });
  }

  function notify(u: UserKey, type: Prisma.NotificationCreateManyInput["type"], title: string, createdAt: Date, o: { body?: string; href?: string; read?: boolean } = {}) {
    notifications.push({ id: newId(), userId: U[u].id, type, title, body: o.body ?? null, href: o.href ?? null, readAt: o.read ? addDays(createdAt, 0.02) : null, createdAt });
  }

  /** Thread padrão de lembrete: lembrete automático → "Confirmo" → confirmação enviada após a equipe confirmar. */
  function reminderThread(c: C, visitAt: Date, reminderAt: Date, reply: string, replyAfterMin: number, confirmer: UserKey) {
    msg(c, { dir: "OUTBOUND", at: reminderAt, tpl: "tpl-lembrete-visita", auto: "lembrete-24h", visitAt });
    const replyAt = new Date(reminderAt.getTime() + replyAfterMin * 60_000);
    msg(c, { dir: "INBOUND", at: replyAt, body: reply });
    const humanDelay = int(4, 15);
    const { a, auto } = autoApplies(c.p.studyKey, reply, true);
    const confirmAt = new Date(replyAt.getTime() + (auto ? 1 : humanDelay) * 60_000);
    msg(c, { dir: "OUTBOUND", at: confirmAt, tpl: "tpl-confirmacao", auto: "confirmacao-visita", visitAt });
    tl(c.p, "MESSAGE_SENT", "Lembrete de visita enviado", reminderAt, { source: "Automação · Lembrete 24h", actor: "automation" });
    tl(c.p, "MESSAGE_RECEIVED", "Participante respondeu", replyAt, { description: `“${reply}”`, source: "WhatsApp" });
    if (auto) tl(c.p, "VISIT_CONFIRMED", "Visita confirmada automaticamente", confirmAt, { description: `Assistência IA · confiança ${a.score}`, source: "Assistência IA", actor: "automation" });
    else tl(c.p, "VISIT_CONFIRMED", "Visita confirmada", confirmAt, { actor: confirmer, source: "WhatsApp" });
    return confirmAt;
  }

  // ════════════════════════════════════════════════════════════════════
  // Cenários roteirizados — espalhados pelos dias úteis
  // ════════════════════════════════════════════════════════════════════
  //
  // Datas em dias úteis: bd(0) = hoje (no fim de semana, a segunda seguinte), bd(1) = próximo dia
  // útil, bd(-1) = dia útil anterior. Nenhuma visita roteirizada cai em sábado ou domingo.
  //
  //   bd(0)  08:00 Marcelo · 08:30 Bruna · 09:30 Isabela · 10:00 Rogério · 11:00 Letícia · 14:00 Mário · 15:30 Priscila
  //   bd(1)  08:30 Nelson · 09:00 Larissa · 10:00 ligação de Felipe · 10:30 Thiago · 11:00 Márcia · 14:00 Vera · 15:30 Gabriel
  //   bd(2)  09:00 Sérgio (remarcação pedida) · 10:00 Elaine
  //   bd(3)  10:00 Rosana · 11:00 Gisele (3ª remarcação) · 14:00 Natália
  //   bd(4)  10:00 Jéssica (nova data proposta) · 15:00 Osvaldo
  //   bd(5)  10:00 Bianca
  //   Passado: Paulo (faltou), Caio (remarcação pedida, janela no fim)

  /** Lembrete da véspera (dia útil anterior, 07:00) para uma visita já passada. */
  const reminderBefore = (visitAt: Date) => at(workday(dayOffsetOf(visitAt) - 1), 7);

  // Larissa Mendonça — triagem no próximo dia útil, lembrete enviado hoje, aguardando confirmação.
  const larissa = addParticipant({ name: "Larissa Mendonça", study: "VAC", status: "AGENDADO", channel: "LANDING_PAGE", owner: "beatriz", createdAt: at(bd(-6), 9, 12), lastContactAt: past(0, 7, 0), nextAction: "Confirmar a triagem", nextActionDueAt: at(bd(0), 18) });
  const larissaVisit = addVisit(larissa, { name: "Triagem", at: at(bd(1), 9), status: "AGUARDANDO_CONFIRMACAO", reminderSentAt: past(0, 7, 0) });
  {
    tl(larissa, "FORM_RECEIVED", "Formulário recebido", at(bd(-6), 9, 12), { description: "Cadastro automático a partir da Landing Page — sem digitação manual.", source: "Landing Page", actor: "integration" });
    tl(larissa, "PRESCREENING_STARTED", "Pré-triagem iniciada", at(bd(-6), 10, 30), { actor: "beatriz" });
    tl(larissa, "MESSAGE_SENT", "Contato enviado", at(bd(-6), 10, 45), { description: "Modelo aprovado: Primeiro contato", source: "WhatsApp", actor: "beatriz" });
    tl(larissa, "MESSAGE_RECEIVED", "Participante respondeu", at(bd(-5), 8, 20), { description: "“Oi! Tenho interesse sim. Pode me ligar depois das 10h?”", source: "WhatsApp" });
    tl(larissa, "CALL_LOGGED", "Ligação de pré-triagem realizada", at(bd(-5), 10, 40), { description: "12 min — critérios operacionais conferidos pela equipe.", source: "Telefone", actor: "beatriz" });
    tl(larissa, "VISIT_SCHEDULED", "Visita agendada", at(bd(-5), 11, 10), { description: `Triagem em ${formatDayMonth(larissaVisit.scheduledAt)} às 09:00`, actor: "beatriz" });
    tl(larissa, "MESSAGE_SENT", "Lembrete de visita enviado", past(0, 7, 0), { description: "Aguardando confirmação do participante.", source: "Automação · Lembrete 24h", actor: "automation" });
    const c = conversation(larissa, "AGUARDANDO_RESPOSTA");
    msg(c, { dir: "OUTBOUND", at: at(bd(-6), 10, 45), tpl: "tpl-primeiro-contato", by: "beatriz" });
    msg(c, { dir: "INBOUND", at: at(bd(-5), 8, 20), body: "Oi! Tenho interesse sim. Pode me ligar depois das 10h?", hasPendingVisit: false });
    msg(c, { dir: "OUTBOUND", at: at(bd(-5), 11, 12), tpl: "tpl-confirmacao", by: "beatriz", visitAt: larissaVisit.scheduledAt });
    msg(c, { dir: "OUTBOUND", at: past(0, 7, 0), tpl: "tpl-lembrete-visita", auto: "lembrete-24h", visitAt: larissaVisit.scheduledAt, status: "DELIVERED" });
    addTask({ title: "Primeiro contato com Larissa Mendonça", priority: "MEDIA", dueAt: at(bd(-6), 18), p: larissa, assignee: "beatriz", source: "FORMULARIO", auto: "formulario-entrada", createdAt: at(bd(-6), 9, 12), completedAt: at(bd(-6), 10, 45), completedBy: "beatriz" });
    addTask({ title: "Agendar triagem de Larissa Mendonça", priority: "MEDIA", dueAt: at(bd(-5), 18), p: larissa, assignee: "beatriz", createdBy: "beatriz", source: "MANUAL", createdAt: at(bd(-5), 10, 45), completedAt: at(bd(-5), 11, 10), completedBy: "beatriz" });
  }

  // Paulo Resende — faltou no dia útil anterior; automação avisou e criou a pendência de reagendamento.
  const paulo = addParticipant({ name: "Paulo Resende", study: "VAC", status: "INCLUIDO", channel: "BANCO_PROPRIO", owner: "beatriz", createdAt: at(-60, 10), lastContactAt: at(bd(-1), 15, 30), nextAction: "Reagendar V3 · Dia 29 dentro da janela", nextActionDueAt: at(bd(0), 12) });
  {
    const v1 = addVisit(paulo, { name: "V1 · Dia 1 (vacinação)", at: at(workday(-29), 8), status: "REALIZADO" });
    const v2 = addVisit(paulo, { name: "V2 · Dia 8", at: at(workday(-22), 8, 30), status: "REALIZADO" });
    const v3 = addVisit(paulo, { name: "V3 · Dia 29", at: at(bd(-1), 8), status: "FALTOU", reminderSentAt: at(bd(-2), 7), confirmedAt: at(bd(-2), 7, 40), window: [at(bd(-3), 0), at(bd(3), 0)] });
    addReimbursement(paulo, v1); addReimbursement(paulo, v2);
    tl(paulo, "STATUS_CHANGED", "Incluído no estudo", v1.scheduledAt, { source: "Polo Trial", actor: "integration" });
    tl(paulo, "VISIT_COMPLETED", "V1 · Dia 1 (vacinação) realizada", v1.completedAt as Date, { actor: "beatriz" });
    tl(paulo, "VISIT_COMPLETED", "V2 · Dia 8 realizada", v2.completedAt as Date, { actor: "beatriz" });
    const c = conversation(paulo, "AGUARDANDO_RESPOSTA");
    reminderThread(c, v3.scheduledAt, at(bd(-2), 7), "Confirmo!", 32, "beatriz");
    tl(paulo, "VISIT_MISSED", "Faltou à visita V3 · Dia 29", at(bd(-1), 8, 40), { description: "Status registrado pela equipe às 08:40.", actor: "beatriz" });
    tl(paulo, "TASK_CREATED", "Pendência de reagendamento criada", at(bd(-1), 8, 40), { source: "Automação · Falta em visita", actor: "automation" });
    msg(c, { dir: "OUTBOUND", at: at(bd(-1), 8, 41), tpl: "tpl-falta-visita", auto: "faltou-reagendar", visitAt: v3.scheduledAt, status: "DELIVERED" });
    tl(paulo, "MESSAGE_SENT", "Falta na visita enviada", at(bd(-1), 8, 41), { description: "Modelo aprovado pelo CEP — envio simulado.", source: "Automação · Falta em visita", actor: "automation" });
    msg(c, { dir: "INTERNAL_NOTE", at: at(bd(-1), 15, 30), body: "Liguei às 15h30 — caixa postal. Tentar novamente cedo.", by: "beatriz" });
    tl(paulo, "CALL_LOGGED", "Ligação sem sucesso", at(bd(-1), 15, 30), { description: "Caixa postal.", source: "Telefone", actor: "beatriz" });
    addTask({ title: "Paulo Resende precisa ser reagendado", description: `Faltou à visita V3 · Dia 29 em ${formatDayMonth(v3.scheduledAt)}. Janela informada pelo Polo Trial até ${formatDayMonth(v3.windowEnd as Date)}.`, priority: "ALTA", dueAt: at(bd(0), 12), p: paulo, visit: v3, assignee: "beatriz", source: "AUTOMACAO", auto: "faltou-reagendar", createdAt: at(bd(-1), 8, 40) });
    audit({ actor: "beatriz", action: "visit.status_changed", entityType: "Visit", entityId: v3.id, study: "VAC", summary: "Visita V3 · Dia 29 de Paulo Resende marcada como “Faltou”", at: at(bd(-1), 8, 40), metadata: { from: "CONFIRMADO", to: "FALTOU" } });
    notify("beatriz", "TASK", "Nova pendência: Paulo Resende precisa ser reagendado", at(bd(-1), 8, 40), { href: "/pendencias", read: true });
  }

  // Marcelo Azevedo — visita hoje 08:00; contato pelo WhatsApp ainda não registrado no Polo Trial.
  const marcelo = addParticipant({ name: "Marcelo Azevedo", study: "VAC", status: "INCLUIDO", channel: "INDICACAO", owner: "lucas", createdAt: at(-90, 14), lastContactAt: at(bd(-1), 16, 10), nextAction: "Registrar contato no Polo Trial", nextActionDueAt: at(bd(0), 18) });
  {
    const prev = addVisit(marcelo, { name: "V3 · Dia 29", at: at(workday(-28), 9), status: "REALIZADO" });
    addReimbursement(marcelo, prev);
    const v = addVisit(marcelo, { name: "V4 · Dia 57", at: at(bd(0), 8), status: "CONFIRMADO", reminderSentAt: at(bd(-1), 7), confirmedAt: at(bd(-1), 8, 5) });
    tl(marcelo, "STATUS_CHANGED", "Incluído no estudo", at(-56, 9), { source: "Polo Trial", actor: "integration" });
    const c = conversation(marcelo, "RESOLVIDA");
    reminderThread(c, v.scheduledAt, at(bd(-1), 7), "Confirmo, obrigado!", 50, "lucas");
    msg(c, { dir: "INBOUND", at: at(bd(-1), 15, 58), body: "Tem estacionamento aí no prédio?", hasPendingVisit: false });
    msg(c, { dir: "OUTBOUND", at: at(bd(-1), 16, 10), tpl: "tpl-faq-endereco", by: "lucas" });
    tl(marcelo, "MESSAGE_SENT", "Dúvida respondida com modelo aprovado", at(bd(-1), 16, 10), { description: "Endereço e estacionamento", source: "WhatsApp", actor: "lucas" });
    addTask({ title: "Registrar contato realizado com Marcelo Azevedo no Polo Trial", description: "Conversa do dia útil anterior (confirmação e dúvida sobre estacionamento) ainda não registrada no Polo Trial. Com a integração, este registro passará a ser automático.", priority: "BAIXA", dueAt: at(bd(0), 18), p: marcelo, assignee: "lucas", source: "COMUNICACAO", createdAt: at(bd(-1), 16, 12) });
  }

  // Aline Furtado — sem resposta ao 2º contato; automação criou pendência de ligação.
  const aline = addParticipant({ name: "Aline Furtado", study: "AUTO", status: "EM_CONTATO", channel: "ASSOCIACAO", owner: "beatriz", createdAt: at(bd(-4), 11), lastContactAt: at(bd(-2), 9), nextAction: "Tentar contato por telefone", nextActionDueAt: at(bd(0), 17) });
  {
    tl(aline, "FORM_RECEIVED", "Indicação recebida da associação de pacientes", at(bd(-4), 11), { source: "Associação", actor: "integration" });
    const c = conversation(aline, "AGUARDANDO_RESPOSTA");
    msg(c, { dir: "OUTBOUND", at: at(bd(-3), 9), tpl: "tpl-primeiro-contato", by: "beatriz", status: "READ" });
    tl(aline, "MESSAGE_SENT", "Primeiro contato enviado", at(bd(-3), 9), { source: "WhatsApp", actor: "beatriz" });
    msg(c, { dir: "OUTBOUND", at: at(bd(-2), 9), tpl: "tpl-segundo-contato", auto: "sem-resposta-24h", status: "DELIVERED" });
    c.followUpAttempts = 1;
    c.lastFollowUpAt = at(bd(-2), 9);
    tl(aline, "MESSAGE_SENT", "Segundo contato enviado (follow-up automático 1/1)", at(bd(-2), 9), { source: "Automação · Follow-up sem resposta", actor: "automation" });
    tl(aline, "TASK_CREATED", "Pendência criada: sem resposta após 24h", at(bd(-1), 9), { source: "Automação · Participante sem resposta", actor: "automation" });
    addTask({ title: "Primeiro contato com Aline Furtado", priority: "MEDIA", dueAt: at(bd(-3), 18), p: aline, assignee: "beatriz", createdBy: "marina", source: "MANUAL", createdAt: at(bd(-4), 11, 30), completedAt: at(bd(-3), 9), completedBy: "beatriz" });
    addTask({ title: "Aline Furtado não respondeu ao segundo contato", description: "Sem resposta: 1 follow-up automático sem resposta. Sugestão: tentar contato telefônico com Aline.", priority: "MEDIA", dueAt: at(bd(0), 17), p: aline, assignee: "beatriz", source: "AUTOMACAO", auto: "sem-resposta-24h", createdAt: at(bd(-1), 9) });
    notify("beatriz", "AUTOMATION", "Aline Furtado não respondeu ao segundo contato", at(bd(-1), 9), { href: "/pendencias" });
  }

  // Thiago Moreira — próximo dia útil, aguardando confirmação, 2ª remarcação (perto do limite).
  const thiago = addParticipant({ name: "Thiago Moreira", study: "AUTO", status: "INCLUIDO", channel: "FACEBOOK", owner: "beatriz", createdAt: at(-120, 10), lastContactAt: past(0, 7, 0), nextAction: "Confirmar a Semana 8 (2ª remarcação)", nextActionDueAt: at(bd(0), 18) });
  {
    const prev = addVisit(thiago, { name: "Semana 4", at: at(workday(-30), 10), status: "REALIZADO" });
    addReimbursement(thiago, prev);
    const v = addVisit(thiago, { name: "Semana 8", at: at(bd(1), 10, 30), status: "AGUARDANDO_CONFIRMACAO", rescheduleCount: 2, reminderSentAt: past(0, 7, 0), window: [at(bd(-1), 0), at(bd(3), 0)] });
    tl(thiago, "STATUS_CHANGED", "Incluído no estudo", at(-85, 9), { source: "Polo Trial", actor: "integration" });
    const c = conversation(thiago, "AGUARDANDO_RESPOSTA");
    msg(c, { dir: "INBOUND", at: at(bd(-9), 18, 40), body: "Vou ter que remarcar de novo, desculpa. Surgiu uma viagem a trabalho." });
    msg(c, { dir: "OUTBOUND", at: at(bd(-8), 9, 5), tpl: "tpl-reagendamento", by: "beatriz" });
    msg(c, { dir: "OUTBOUND", at: at(bd(-8), 11, 30), tpl: "tpl-confirmacao", by: "beatriz", visitAt: v.scheduledAt });
    msg(c, { dir: "OUTBOUND", at: past(0, 7, 0), tpl: "tpl-lembrete-visita", auto: "lembrete-24h", visitAt: v.scheduledAt, status: "DELIVERED" });
    tl(thiago, "VISIT_RESCHEDULE_REQUESTED", "Pediu remarcação da Semana 8 (2ª vez)", at(bd(-9), 18, 40), { source: "WhatsApp" });
    tl(thiago, "VISIT_SCHEDULED", "Visita reagendada", at(bd(-8), 11, 30), { description: `Semana 8 em ${formatDayMonth(v.scheduledAt)} às 10:30`, actor: "beatriz" });
    tl(thiago, "MESSAGE_SENT", "Lembrete de visita enviado", past(0, 7, 0), { source: "Automação · Lembrete 24h", actor: "automation" });
    addTask({ title: "Thiago Moreira está na 2ª remarcação — reforçar confirmação", description: "Limite operacional: 3 remarcações por visita. Confirmar presença por telefone se não houver resposta ao lembrete.", priority: "MEDIA", dueAt: at(bd(1), 9), p: thiago, visit: v, assignee: "beatriz", createdBy: "marina", source: "MANUAL", createdAt: at(bd(-8), 11, 40) });
  }

  // Vera Campos — V4 no próximo dia útil às 14:00, aguardando confirmação.
  const vera = addParticipant({ name: "Vera Campos", study: "VAC", status: "INCLUIDO", channel: "MIDIA_TRADICIONAL", owner: "beatriz", createdAt: at(-100, 15), lastContactAt: past(0, 7, 0), nextAction: "Aguardar confirmação da V4", nextActionDueAt: at(bd(1), 9) });
  {
    const prev = addVisit(vera, { name: "V3 · Dia 29", at: at(workday(-27), 14), status: "REALIZADO" });
    addReimbursement(vera, prev);
    const v = addVisit(vera, { name: "V4 · Dia 57", at: at(bd(1), 14), status: "AGUARDANDO_CONFIRMACAO", reminderSentAt: past(0, 7, 0) });
    tl(vera, "STATUS_CHANGED", "Incluído no estudo", at(-55, 9), { source: "Polo Trial", actor: "integration" });
    const c = conversation(vera, "AGUARDANDO_RESPOSTA");
    reminderThread(c, prev.scheduledAt, reminderBefore(prev.scheduledAt), "Confirmo sim. Obrigada!", 25, "beatriz");
    msg(c, { dir: "OUTBOUND", at: past(0, 7, 0), tpl: "tpl-lembrete-visita", auto: "lembrete-24h", visitAt: v.scheduledAt, status: "DELIVERED" });
    tl(vera, "MESSAGE_SENT", "Lembrete de visita enviado", past(0, 7, 0), { source: "Automação · Lembrete 24h", actor: "automation" });
  }

  // Bianca Siqueira — mensagem com possível relato clínico: nenhuma resposta automática.
  const bianca = addParticipant({ name: "Bianca Siqueira", study: "VAC", status: "INCLUIDO", channel: "INSTAGRAM", owner: "lucas", createdAt: at(-25, 10), lastContactAt: past(0, 8, 40), nextAction: "Equipe médica avaliar mensagem recebida", nextActionDueAt: at(bd(0), 10) });
  {
    const tri = addVisit(bianca, { name: "Triagem", at: at(workday(-12), 9), status: "REALIZADO" });
    const v1 = addVisit(bianca, { name: "V1 · Dia 1 (vacinação)", at: at(bd(-1), 10), status: "REALIZADO", reminderSentAt: at(bd(-2), 7), confirmedAt: at(bd(-2), 7, 30) });
    addVisit(bianca, { name: "V2 · Dia 8", at: at(bd(5), 10), status: "CONFIRMADO" });
    addReimbursement(bianca, tri); addReimbursement(bianca, v1);
    tl(bianca, "VISIT_COMPLETED", "Triagem realizada", tri.completedAt as Date, { actor: "lucas" });
    tl(bianca, "STATUS_CHANGED", "Incluído no estudo", v1.scheduledAt, { source: "Polo Trial", actor: "integration" });
    tl(bianca, "VISIT_COMPLETED", "V1 · Dia 1 (vacinação) realizada", v1.completedAt as Date, { actor: "lucas" });
    const c = conversation(bianca, "REQUER_ATENCAO", 1);
    reminderThread(c, v1.scheduledAt, at(bd(-2), 7), "Confirmo!", 15, "lucas");
    msg(c, { dir: "INBOUND", at: past(0, 8, 40), body: "Bom dia! Desde a vacina estou com o braço inchado e um pouco de febre. Isso é normal?" });
    tl(bianca, "MESSAGE_RECEIVED", "Mensagem com possível relato clínico", past(0, 8, 40), { description: "Classificada pela assistência como possível relato clínico. Encaminhada à coordenação — nenhuma resposta automática.", source: "WhatsApp" });
    addTask({ title: "Encaminhar relato de Bianca Siqueira à equipe médica", description: "Mensagem via WhatsApp menciona sintomas após a vacinação. Avaliação e registro cabem à equipe médica do estudo, fora do Polo Chat.", priority: "ALTA", dueAt: at(bd(0), 10), p: bianca, assignee: "camila", source: "COMUNICACAO", auto: "mensagem-clinica", createdAt: past(0, 8, 41) });
    notify("camila", "MESSAGE", "Possível relato clínico — Bianca Siqueira (VAC-2026)", past(0, 8, 41), { body: "Mensagem encaminhada para avaliação da equipe médica.", href: "/comunicacao" });
  }

  // Sérgio Albuquerque — pediu remarcação hoje pelo WhatsApp ("semana que vem"), mas a janela acaba antes.
  const sergio = addParticipant({ name: "Sérgio Albuquerque", study: "AUTO", status: "INCLUIDO", channel: "BANCO_PROPRIO", owner: "beatriz", createdAt: at(-140, 9), lastContactAt: past(0, 9, 25), nextAction: "Propor nova data para a Semana 12", nextActionDueAt: at(bd(1), 12) });
  {
    const prev = addVisit(sergio, { name: "Semana 8", at: at(workday(-26), 9), status: "REALIZADO" });
    addReimbursement(sergio, prev);
    const v = addVisit(sergio, { name: "Semana 12", at: at(bd(2), 9), status: "REAGENDAMENTO_SOLICITADO", window: [at(bd(-1), 0), at(bd(4), 0)] });
    tl(sergio, "STATUS_CHANGED", "Incluído no estudo", at(-110, 9), { source: "Polo Trial", actor: "integration" });
    const c = conversation(sergio, "RESOLVIDA");
    msg(c, { dir: "INBOUND", at: past(0, 9, 10), body: "Oi, bom dia. Vou precisar remarcar a visita, surgiu um compromisso no trabalho. Pode ser na semana que vem?" });
    msg(c, { dir: "OUTBOUND", at: past(0, 9, 25), tpl: "tpl-reagendamento", by: "beatriz" });
    tl(sergio, "VISIT_RESCHEDULE_REQUESTED", "Pediu remarcação da Semana 12", past(0, 9, 10), { source: "WhatsApp" });
    addTask({ title: "Reagendar visita Semana 12 de Sérgio Albuquerque", description: `Pedido recebido via WhatsApp. Janela informada pelo Polo Trial: ${formatDayMonth(v.windowStart as Date)} a ${formatDayMonth(v.windowEnd as Date)}.`, priority: "MEDIA", dueAt: at(bd(1), 12), p: sergio, visit: v, assignee: "beatriz", createdBy: "beatriz", source: "COMUNICACAO", createdAt: past(0, 9, 12) });
    notify("beatriz", "MESSAGE", "Sérgio Albuquerque pediu remarcação", past(0, 9, 10), { href: "/comunicacao" });
  }

  // Agenda de hoje (demais).
  const bruna = addParticipant({ name: "Bruna Valente", study: "VAC", status: "AGENDADO", channel: "INSTAGRAM", owner: "lucas", createdAt: at(bd(-7), 19), lastContactAt: at(bd(-1), 7, 46), nextAction: "Visita de triagem hoje", nextActionDueAt: null });
  {
    const v = addVisit(bruna, { name: "Triagem", at: at(bd(0), 8, 30), status: "CONFIRMADO", reminderSentAt: at(bd(-1), 7), confirmedAt: at(bd(-1), 7, 46) });
    tl(bruna, "FORM_RECEIVED", "Formulário recebido", at(bd(-7), 19), { source: "Instagram", actor: "integration" });
    const c = conversation(bruna, "RESOLVIDA");
    msg(c, { dir: "OUTBOUND", at: at(bd(-6), 9, 30), tpl: "tpl-primeiro-contato", by: "lucas" });
    msg(c, { dir: "INBOUND", at: at(bd(-6), 12, 5), body: "Sim, podem ligar à tarde.", hasPendingVisit: false });
    tl(bruna, "CALL_LOGGED", "Pré-triagem por telefone", at(bd(-6), 15), { actor: "lucas", source: "Telefone" });
    tl(bruna, "VISIT_SCHEDULED", "Visita agendada", at(bd(-5), 10), { description: `Triagem em ${formatDayMonth(v.scheduledAt)} às 08:30`, actor: "lucas" });
    msg(c, { dir: "OUTBOUND", at: at(bd(-5), 10, 2), tpl: "tpl-confirmacao", by: "lucas", visitAt: v.scheduledAt });
    msg(c, { dir: "OUTBOUND", at: at(bd(-1), 7), tpl: "tpl-lembrete-visita", auto: "lembrete-24h", visitAt: v.scheduledAt });
    msg(c, { dir: "INBOUND", at: at(bd(-1), 7, 20), body: "Confirmo. Preciso levar algum documento?" });
    msg(c, { dir: "OUTBOUND", at: at(bd(-1), 7, 45), tpl: "tpl-faq-documentos", by: "lucas" });
    msg(c, { dir: "OUTBOUND", at: at(bd(-1), 7, 46), tpl: "tpl-confirmacao", auto: "confirmacao-visita", visitAt: v.scheduledAt });
    tl(bruna, "VISIT_CONFIRMED", "Visita confirmada", at(bd(-1), 7, 46), { actor: "lucas", source: "WhatsApp" });
    addTask({ title: "Registrar no Polo Trial o contato com Bruna Valente", priority: "BAIXA", dueAt: at(bd(-1), 18), p: bruna, assignee: "lucas", source: "COMUNICACAO", createdAt: at(bd(-1), 7, 50), completedAt: at(bd(-1), 17), completedBy: "lucas" });
  }

  const isabela = addParticipant({ name: "Isabela Quintana", study: "AUTO", status: "INCLUIDO", channel: "ASSOCIACAO", owner: "beatriz", createdAt: at(-150, 10), lastContactAt: at(bd(-1), 8, 30), nextAction: "Visita Semana 24 hoje", nextActionDueAt: null });
  {
    const prev = addVisit(isabela, { name: "Semana 12", at: at(workday(-24), 9, 30), status: "REALIZADO" });
    addReimbursement(isabela, prev);
    const v = addVisit(isabela, { name: "Semana 24", at: at(bd(0), 9, 30), status: "CONFIRMADO", reminderSentAt: at(bd(-1), 7), confirmedAt: at(bd(-1), 8, 31) });
    tl(isabela, "STATUS_CHANGED", "Incluído no estudo", at(-128, 9), { source: "Polo Trial", actor: "integration" });
    const c = conversation(isabela, "RESOLVIDA");
    msg(c, { dir: "OUTBOUND", at: at(bd(-1), 7), tpl: "tpl-lembrete-visita", auto: "lembrete-24h", visitAt: v.scheduledAt });
    msg(c, { dir: "INBOUND", at: at(bd(-1), 8, 2), body: "Confirmo. O transporte é reembolsado?" });
    msg(c, { dir: "OUTBOUND", at: at(bd(-1), 8, 30), tpl: "tpl-faq-ressarcimento", by: "beatriz" });
    msg(c, { dir: "OUTBOUND", at: at(bd(-1), 8, 31), tpl: "tpl-confirmacao", auto: "confirmacao-visita", visitAt: v.scheduledAt });
    tl(isabela, "VISIT_CONFIRMED", "Visita confirmada", at(bd(-1), 8, 31), { actor: "beatriz", source: "WhatsApp" });
    addTask({ title: "Responder dúvida de Isabela Quintana sobre ressarcimento", priority: "BAIXA", dueAt: at(bd(-1), 12), p: isabela, assignee: "beatriz", source: "COMUNICACAO", createdAt: at(bd(-1), 8, 3), completedAt: at(bd(-1), 8, 30), completedBy: "beatriz" });
  }

  const rogerio = addParticipant({ name: "Rogério Pacheco", study: "VAC", status: "INCLUIDO", channel: "BANCO_PROPRIO", owner: "lucas", createdAt: at(-30, 10), lastContactAt: at(bd(-1), 7, 20), nextAction: "Visita V2 hoje", nextActionDueAt: null });
  {
    const v1 = addVisit(rogerio, { name: "V1 · Dia 1 (vacinação)", at: at(workday(-7), 10), status: "REALIZADO" });
    addReimbursement(rogerio, v1);
    const v = addVisit(rogerio, { name: "V2 · Dia 8", at: at(bd(0), 10), status: "CONFIRMADO", reminderSentAt: at(bd(-1), 7), confirmedAt: at(bd(-1), 7, 20), window: [at(bd(-1), 0), at(bd(1), 0)] });
    tl(rogerio, "STATUS_CHANGED", "Incluído no estudo", v1.scheduledAt, { source: "Polo Trial", actor: "integration" });
    reminderThread(conversation(rogerio, "RESOLVIDA"), v.scheduledAt, at(bd(-1), 7), "CONFIRMO", 5, "lucas");
  }

  const leticia = addParticipant({ name: "Letícia Brandão", study: "DERM", status: "AGENDADO", channel: "INSTAGRAM", owner: "lucas", createdAt: at(bd(-5), 20), lastContactAt: at(bd(-1), 12, 50), nextAction: "Visita de triagem hoje", nextActionDueAt: null });
  {
    const v = addVisit(leticia, { name: "Triagem", at: at(bd(0), 11), status: "CONFIRMADO", reminderSentAt: at(bd(-1), 7), confirmedAt: at(bd(-1), 12, 50) });
    tl(leticia, "FORM_RECEIVED", "Formulário recebido", at(bd(-5), 20), { source: "Instagram", actor: "integration" });
    const c = conversation(leticia, "RESOLVIDA");
    msg(c, { dir: "OUTBOUND", at: at(bd(-4), 9), tpl: "tpl-primeiro-contato", by: "lucas" });
    msg(c, { dir: "INBOUND", at: at(bd(-4), 9, 40), body: "Tenho interesse, podem me ligar.", hasPendingVisit: false });
    tl(leticia, "CALL_LOGGED", "Pré-triagem por telefone", at(bd(-4), 14), { actor: "lucas", source: "Telefone" });
    reminderThread(c, v.scheduledAt, at(bd(-1), 7), "Confirmado, estarei aí.", 340, "lucas");
  }

  const mario = addParticipant({ name: "Mário Bastos", study: "CARDIO", status: "INCLUIDO", channel: "INDICACAO", owner: "lucas", createdAt: at(-420, 10), lastContactAt: at(bd(-1), 10, 15), nextAction: "Visita Semana 48 hoje", nextActionDueAt: null, whatsapp: false });
  {
    const prev = addVisit(mario, { name: "Semana 44", at: at(workday(-28), 14), status: "REALIZADO" });
    addReimbursement(mario, prev);
    addVisit(mario, { name: "Semana 48", at: at(bd(0), 14), status: "CONFIRMADO", confirmedAt: at(bd(-1), 10, 15) });
    tl(mario, "STATUS_CHANGED", "Incluído no estudo", at(-380, 9), { source: "Polo Trial", actor: "integration" });
    run("lembrete-24h", "IGNORADA", "Lembrete não enviado a Mário Bastos: sem consentimento para WhatsApp. Pendência de contato telefônico criada.", at(bd(-1), 7), mario, "Visit");
    addTask({ title: "Confirmar visita de Mário Bastos por telefone", description: "Participante sem consentimento para WhatsApp.", priority: "MEDIA", dueAt: at(bd(-1), 12), p: mario, assignee: "lucas", source: "AUTOMACAO", auto: "lembrete-24h", createdAt: at(bd(-1), 7), completedAt: at(bd(-1), 10, 15), completedBy: "lucas" });
    tl(mario, "CALL_LOGGED", "Presença confirmada por telefone", at(bd(-1), 10, 15), { actor: "lucas", source: "Telefone" });
  }

  const priscila = addParticipant({ name: "Priscila Antunes", study: "AUTO", status: "AGENDADO", channel: "LANDING_PAGE", owner: "beatriz", createdAt: at(bd(-8), 13), lastContactAt: at(bd(-1), 9, 10), nextAction: "Visita de triagem hoje", nextActionDueAt: null });
  {
    const v = addVisit(priscila, { name: "Triagem", at: at(bd(0), 15, 30), status: "CONFIRMADO", reminderSentAt: at(bd(-1), 7), confirmedAt: at(bd(-1), 9, 10) });
    tl(priscila, "FORM_RECEIVED", "Formulário recebido", at(bd(-8), 13), { source: "Landing Page", actor: "integration" });
    const c = conversation(priscila, "RESOLVIDA");
    msg(c, { dir: "OUTBOUND", at: at(bd(-7), 10), tpl: "tpl-primeiro-contato", by: "beatriz" });
    msg(c, { dir: "INBOUND", at: at(bd(-7), 11, 15), body: "Oi! Quero participar sim.", hasPendingVisit: false });
    reminderThread(c, v.scheduledAt, at(bd(-1), 7), "Confirmo 👍", 125, "beatriz");
  }

  // Próximo dia útil (demais).
  const nelson = addParticipant({ name: "Nelson Matos", study: "CARDIO", status: "INCLUIDO", channel: "BANCO_PROPRIO", owner: "lucas", createdAt: at(-470, 10), lastContactAt: past(0, 7, 20), nextAction: "Visita Semana 52 no próximo dia útil", nextActionDueAt: null });
  {
    const prev = addVisit(nelson, { name: "Semana 48", at: at(workday(-28), 8, 30), status: "REALIZADO" });
    addReimbursement(nelson, prev);
    const v = addVisit(nelson, { name: "Semana 52", at: at(bd(1), 8, 30), status: "CONFIRMADO", reminderSentAt: past(0, 7, 0), confirmedAt: past(0, 7, 20) });
    tl(nelson, "STATUS_CHANGED", "Incluído no estudo", at(-440, 9), { source: "Polo Trial", actor: "integration" });
    reminderThread(conversation(nelson, "RESOLVIDA"), v.scheduledAt, past(0, 7, 0), "Confirmo!", 12, "lucas");
  }

  const marcia = addParticipant({ name: "Márcia Guedes", study: "VAC", status: "INCLUIDO", channel: "FACEBOOK", owner: "lucas", createdAt: at(-50, 16), lastContactAt: past(0, 7, 40), nextAction: "Visita V3 no próximo dia útil", nextActionDueAt: null });
  {
    const v1 = addVisit(marcia, { name: "V1 · Dia 1 (vacinação)", at: at(workday(-27), 11), status: "REALIZADO" });
    addReimbursement(marcia, v1);
    const v = addVisit(marcia, { name: "V3 · Dia 29", at: at(bd(1), 11), status: "CONFIRMADO", reminderSentAt: past(0, 7, 0), confirmedAt: past(0, 7, 40) });
    tl(marcia, "STATUS_CHANGED", "Incluído no estudo", v1.scheduledAt, { source: "Polo Trial", actor: "integration" });
    reminderThread(conversation(marcia, "RESOLVIDA"), v.scheduledAt, past(0, 7, 0), "Ok, confirmado. Estarei aí às 11h.", 25, "lucas");
  }

  // Gabriel Torres — triagem agendada hoje, depois do ciclo das 07:00: o lembrete sai no ciclo da véspera.
  const gabriel = addParticipant({ name: "Gabriel Torres", study: "DERM", status: "AGENDADO", channel: "FACEBOOK", owner: "lucas", createdAt: at(bd(-3), 18), lastContactAt: past(0, 10, 5), nextAction: "Triagem no próximo dia útil", nextActionDueAt: null });
  {
    const v = addVisit(gabriel, { name: "Triagem", at: at(bd(1), 15, 30), status: "CONFIRMADO", confirmedAt: past(0, 10, 5) });
    tl(gabriel, "FORM_RECEIVED", "Formulário recebido", at(bd(-3), 18), { source: "Facebook", actor: "integration" });
    const c = conversation(gabriel, "RESOLVIDA");
    msg(c, { dir: "OUTBOUND", at: at(bd(-2), 9, 20), tpl: "tpl-primeiro-contato", by: "lucas" });
    msg(c, { dir: "INBOUND", at: at(bd(-2), 10, 2), body: "Tenho interesse sim! Pode ligar depois do almoço.", hasPendingVisit: false });
    tl(gabriel, "CALL_LOGGED", "Pré-triagem por telefone", at(bd(-1), 14), { actor: "lucas", source: "Telefone" });
    addTask({ title: "Pré-triagem por telefone: Gabriel Torres", priority: "MEDIA", dueAt: at(bd(-1), 18), p: gabriel, assignee: "lucas", createdBy: "lucas", source: "MANUAL", createdAt: at(bd(-2), 10, 5), completedAt: at(bd(-1), 14, 20), completedBy: "lucas" });
    tl(gabriel, "VISIT_SCHEDULED", "Visita agendada", past(0, 10, 5), { description: `Triagem em ${formatDayMonth(v.scheduledAt)} às 15:30`, actor: "lucas" });
    msg(c, { dir: "OUTBOUND", at: past(0, 10, 5), tpl: "tpl-confirmacao", by: "lucas", visitAt: v.scheduledAt });
  }

  // Felipe Rangel — candidato pediu ligação: a pré-triagem por telefone está marcada para o próximo dia útil às 10h.
  const felipe = addParticipant({ name: "Felipe Rangel", study: "AUTO", status: "EM_CONTATO", channel: "FACEBOOK", owner: "beatriz", createdAt: at(bd(-2), 19), lastContactAt: past(0, 8, 11), nextAction: "Ligação de pré-triagem", nextActionDueAt: at(bd(1), 10) });
  {
    const callAt = at(bd(1), 10);
    const callDay = bd(1) === 1 ? "amanhã" : "na segunda";
    tl(felipe, "FORM_RECEIVED", "Formulário recebido", at(bd(-2), 19), { source: "Facebook", actor: "integration" });
    const c = conversation(felipe, "RESOLVIDA");
    msg(c, { dir: "OUTBOUND", at: at(bd(-1), 9, 30), tpl: "tpl-primeiro-contato", by: "beatriz" });
    tl(felipe, "MESSAGE_SENT", "Primeiro contato enviado", at(bd(-1), 9, 30), { source: "WhatsApp", actor: "beatriz" });
    msg(c, { dir: "INBOUND", at: past(0, 8, 10), body: `Oi! Tenho interesse sim. Podem me ligar ${callDay} às 10h?`, hasPendingVisit: false });
    tl(felipe, "MESSAGE_RECEIVED", "Participante respondeu", past(0, 8, 10), { description: `“Tenho interesse sim. Podem me ligar ${callDay} às 10h?”`, source: "WhatsApp" });
    msg(c, { dir: "OUTBOUND", at: past(0, 8, 11), tpl: "tpl-ligacao-agendada", by: "beatriz", vars: { ligacao: callLabel(callAt, past(0, 8, 11)) } });
    addTask({ title: `Ligar para Felipe Rangel (pré-triagem)`, description: `Ligação combinada pelo WhatsApp: ${callLabel(callAt, now)} (pedido do candidato). A elegibilidade é avaliada pela equipe.`, priority: "MEDIA", dueAt: callAt, p: felipe, assignee: "beatriz", createdBy: "beatriz", source: "COMUNICACAO", createdAt: past(0, 8, 11) });
  }

  // Elaine Fontes — Semana 4 daqui a dois dias úteis, ainda sem lembrete: confirmação antecipada ou remarcação.
  const elaine = addParticipant({ name: "Elaine Fontes", study: "AUTO", status: "INCLUIDO", channel: "ASSOCIACAO", owner: "beatriz", createdAt: at(-45, 10), lastContactAt: at(workday(-10), 9) });
  {
    const prev = addVisit(elaine, { name: "Semana 2", at: at(workday(-10), 9), status: "REALIZADO" });
    const v = addVisit(elaine, { name: "Semana 4", at: at(bd(2), 10), status: "AGUARDANDO_CONFIRMACAO" });
    elaine.nextAction = `Próxima visita: Semana 4 em ${formatDayMonth(v.scheduledAt)}`;
    addReimbursement(elaine, prev);
    tl(elaine, "STATUS_CHANGED", "Incluído no estudo", at(-28, 9), { source: "Polo Trial", actor: "integration" });
    tl(elaine, "VISIT_COMPLETED", "Semana 2 realizada", prev.completedAt as Date, { actor: "beatriz" });
    reminderThread(conversation(elaine, "RESOLVIDA"), prev.scheduledAt, reminderBefore(prev.scheduledAt), "Confirmo, obrigada!", 35, "beatriz");
  }

  // Gisele Prates — V3 na 3ª remarcação (limite operacional): mais um pedido deve chamar a coordenação.
  const gisele = addParticipant({ name: "Gisele Prates", study: "VAC", status: "INCLUIDO", channel: "INSTAGRAM", owner: "beatriz", createdAt: at(-50, 16), lastContactAt: at(bd(-2), 11, 30), nextAction: "Confirmar a V3 (3ª remarcação)", nextActionDueAt: at(bd(2), 12) });
  {
    const v1 = addVisit(gisele, { name: "V1 · Dia 1 (vacinação)", at: at(workday(-30), 11), status: "REALIZADO" });
    const v2 = addVisit(gisele, { name: "V2 · Dia 8", at: at(workday(-24), 11), status: "REALIZADO" });
    const v = addVisit(gisele, { name: "V3 · Dia 29", at: at(bd(3), 11), status: "AGUARDANDO_CONFIRMACAO", rescheduleCount: 3, window: [at(bd(-2), 0), at(bd(5), 0)] });
    addReimbursement(gisele, v1); addReimbursement(gisele, v2);
    tl(gisele, "STATUS_CHANGED", "Incluído no estudo", v1.scheduledAt, { source: "Polo Trial", actor: "integration" });
    const c = conversation(gisele, "RESOLVIDA");
    msg(c, { dir: "INBOUND", at: at(bd(-2), 10, 50), body: "Desculpa, vou ter que remarcar de novo. Mudaram minha escala no trabalho." });
    msg(c, { dir: "OUTBOUND", at: at(bd(-2), 11, 30), tpl: "tpl-confirmacao", by: "beatriz", visitAt: v.scheduledAt });
    tl(gisele, "VISIT_RESCHEDULE_REQUESTED", "Pediu remarcação da V3 (3ª vez)", at(bd(-2), 10, 50), { source: "WhatsApp" });
    tl(gisele, "VISIT_SCHEDULED", "Visita reagendada", at(bd(-2), 11, 30), { description: `V3 · Dia 29 em ${formatDayMonth(v.scheduledAt)} às 11:00 — 3ª remarcação`, actor: "beatriz" });
  }

  // Jéssica Amaral — pediu remarcação da V4; a equipe propôs nova data no dia útil anterior e aguarda a resposta.
  const jessica = addParticipant({ name: "Jéssica Amaral", study: "VAC", status: "INCLUIDO", channel: "BANCO_PROPRIO", owner: "lucas", createdAt: at(-80, 10), lastContactAt: at(bd(-1), 16), nextAction: "Aguardar resposta à nova data proposta", nextActionDueAt: at(bd(1), 12) });
  {
    const prev = addVisit(jessica, { name: "V3 · Dia 29", at: at(workday(-28), 9), status: "REALIZADO" });
    addReimbursement(jessica, prev);
    const v = addVisit(jessica, { name: "V4 · Dia 57", at: at(bd(1), 9), status: "REAGENDAMENTO_SOLICITADO", window: [at(bd(-2), 0), at(bd(5), 0)] });
    const proposedAt = at(bd(4), 10);
    v.proposedAt = proposedAt;
    tl(jessica, "STATUS_CHANGED", "Incluído no estudo", at(-56, 9), { source: "Polo Trial", actor: "integration" });
    const c = conversation(jessica, "AGUARDANDO_RESPOSTA");
    msg(c, { dir: "INBOUND", at: at(bd(-1), 10, 5), body: "Oi! Não vou conseguir ir na visita, vou viajar a trabalho. Pode ser outro dia?" });
    msg(c, { dir: "OUTBOUND", at: at(bd(-1), 10, 20), tpl: "tpl-reagendamento", by: "lucas" });
    msg(c, { dir: "OUTBOUND", at: at(bd(-1), 16), tpl: "tpl-proposta-data", by: "lucas", vars: { nova_data: visitDateLabel(proposedAt, at(bd(-1), 16)), nova_hora: formatTime(proposedAt) } });
    tl(jessica, "VISIT_RESCHEDULE_REQUESTED", "Pediu remarcação da V4 · Dia 57", at(bd(-1), 10, 5), { source: "WhatsApp" });
    tl(jessica, "VISIT_RESCHEDULE_REQUESTED", "Nova data proposta", at(bd(-1), 16), { description: `V4 · Dia 57 em ${formatDayMonth(proposedAt)} às ${formatTime(proposedAt)} — aguardando resposta do participante`, actor: "lucas" });
    addTask({ title: "Reagendar visita V4 · Dia 57 de Jéssica Amaral", priority: "MEDIA", dueAt: at(bd(1), 12), p: jessica, visit: v, assignee: "lucas", createdBy: "lucas", source: "COMUNICACAO", createdAt: at(bd(-1), 10, 6) });
  }

  // Caio Medeiros — pediu remarcação por telefone; o Polo Trial sinaliza janela perto do fim.
  const caio = addParticipant({ name: "Caio Medeiros", study: "VAC", status: "INCLUIDO", channel: "BANCO_PROPRIO", owner: "lucas", createdAt: at(-120, 10), lastContactAt: at(bd(-2), 16), nextAction: "Reagendar V5 antes do fim da janela", nextActionDueAt: at(bd(1), 18) });
  {
    const prev = addVisit(caio, { name: "V4 · Dia 57", at: at(workday(-29), 9), status: "REALIZADO" });
    addReimbursement(caio, prev);
    const v = addVisit(caio, { name: "V5 · Dia 85", at: at(bd(-1), 9), status: "REAGENDAMENTO_SOLICITADO", window: [at(bd(-4), 0), at(bd(2), 0)] });
    tl(caio, "STATUS_CHANGED", "Incluído no estudo", at(-85, 9), { source: "Polo Trial", actor: "integration" });
    tl(caio, "CALL_LOGGED", "Pediu para remarcar a V5", at(bd(-2), 16), { description: "Compromisso familiar no dia agendado.", actor: "lucas", source: "Telefone" });
    tl(caio, "VISIT_RESCHEDULE_REQUESTED", "Remarcação solicitada", at(bd(-2), 16, 5), { actor: "lucas" });
    addTask({ title: "Janela de visita próxima do limite — Caio Medeiros", description: `A janela da V5 · Dia 85 encerra em ${formatDayMonth(v.windowEnd as Date)} (informação do Polo Trial). O Polo Chat não calcula janelas — apenas exibe o dado da fonte.`, priority: "ALTA", dueAt: at(bd(1), 18), p: caio, visit: v, assignee: "camila", source: "POLO_TRIAL", createdAt: past(0, 6, 0) });
    notify("camila", "VISIT", "Janela de visita próxima do limite — Caio Medeiros", past(0, 6, 0), { body: `V5 · Dia 85 — janela até ${formatDayMonth(v.windowEnd as Date)}`, href: "/pendencias" });
  }

  // Natália Prado — Semana 8 daqui a três dias úteis, aguardando confirmação.
  const natalia = addParticipant({ name: "Natália Prado", study: "AUTO", status: "INCLUIDO", channel: "INDICACAO", owner: "beatriz", createdAt: at(-75, 10), lastContactAt: at(workday(-20), 14) });
  {
    const v = addVisit(natalia, { name: "Semana 4", at: at(workday(-20), 14), status: "REALIZADO" });
    const next = addVisit(natalia, { name: "Semana 8", at: at(bd(3), 14), status: "AGUARDANDO_CONFIRMACAO" });
    natalia.nextAction = `Próxima visita: Semana 8 em ${formatDayMonth(next.scheduledAt)}`;
    addReimbursement(natalia, v);
    tl(natalia, "STATUS_CHANGED", "Incluído no estudo", at(-48, 9), { source: "Polo Trial", actor: "integration" });
    tl(natalia, "VISIT_COMPLETED", "Semana 4 realizada", v.completedAt as Date, { actor: "beatriz" });
    reminderThread(conversation(natalia, "RESOLVIDA"), v.scheduledAt, reminderBefore(v.scheduledAt), "Confirmo, até amanhã.", 60, "beatriz");
  }

  // Osvaldo Cardim — Semana 48 daqui a quatro dias úteis, aguardando confirmação.
  const osvaldo = addParticipant({ name: "Osvaldo Cardim", study: "CARDIO", status: "INCLUIDO", channel: "ASSOCIACAO", owner: "lucas", createdAt: at(-400, 10), lastContactAt: at(workday(-20), 15) });
  {
    const v = addVisit(osvaldo, { name: "Semana 44", at: at(workday(-20), 15), status: "REALIZADO" });
    const next = addVisit(osvaldo, { name: "Semana 48", at: at(bd(4), 15), status: "AGUARDANDO_CONFIRMACAO" });
    osvaldo.nextAction = `Próxima visita: Semana 48 em ${formatDayMonth(next.scheduledAt)}`;
    addReimbursement(osvaldo, v);
    tl(osvaldo, "STATUS_CHANGED", "Incluído no estudo", at(-360, 9), { source: "Polo Trial", actor: "integration" });
    tl(osvaldo, "VISIT_COMPLETED", "Semana 44 realizada", v.completedAt as Date, { actor: "lucas" });
    reminderThread(conversation(osvaldo, "RESOLVIDA"), v.scheduledAt, reminderBefore(v.scheduledAt), "Confirmo!", 50, "lucas");
  }

  // Rosana Freire — faltou há quatro dias úteis, já reagendada (pendência concluída).
  const rosana = addParticipant({ name: "Rosana Freire", study: "VAC", status: "INCLUIDO", channel: "LANDING_PAGE", owner: "beatriz", createdAt: at(-70, 10), lastContactAt: at(bd(-3), 11) });
  {
    const prev = addVisit(rosana, { name: "V2 · Dia 8", at: at(workday(-25), 10), status: "REALIZADO" });
    addReimbursement(rosana, prev);
    const v = addVisit(rosana, { name: "V3 · Dia 29", at: at(bd(3), 10), status: "CONFIRMADO", rescheduleCount: 1, confirmedAt: at(bd(-3), 11), window: [at(bd(-5), 0), at(bd(4), 0)] });
    rosana.nextAction = `Visita V3 em ${formatDayMonth(v.scheduledAt)} (reagendada)`;
    tl(rosana, "STATUS_CHANGED", "Incluído no estudo", at(-32, 9), { source: "Polo Trial", actor: "integration" });
    tl(rosana, "VISIT_MISSED", "Faltou à visita V3 · Dia 29", at(bd(-4), 10, 30), { actor: "beatriz" });
    tl(rosana, "TASK_CREATED", "Pendência de reagendamento criada", at(bd(-4), 10, 30), { source: "Automação · Falta em visita", actor: "automation" });
    tl(rosana, "CALL_LOGGED", "Contato realizado — imprevisto familiar", at(bd(-3), 10, 50), { actor: "beatriz", source: "Telefone" });
    tl(rosana, "VISIT_SCHEDULED", "Visita reagendada", at(bd(-3), 11), { description: `V3 · Dia 29 em ${formatDayMonth(v.scheduledAt)} às 10:00`, actor: "beatriz" });
    const c = conversation(rosana, "RESOLVIDA");
    msg(c, { dir: "OUTBOUND", at: at(bd(-4), 10, 31), tpl: "tpl-falta-visita", auto: "faltou-reagendar", visitAt: at(bd(-4), 10), status: "READ" });
    tl(rosana, "MESSAGE_SENT", "Falta na visita enviada", at(bd(-4), 10, 31), { description: "Modelo aprovado pelo CEP — envio simulado.", source: "Automação · Falta em visita", actor: "automation" });
    msg(c, { dir: "OUTBOUND", at: at(bd(-3), 11, 2), tpl: "tpl-confirmacao", by: "beatriz", visitAt: v.scheduledAt });
    msg(c, { dir: "INBOUND", at: at(bd(-3), 11, 30), body: "Obrigada! Desculpem pela falta.", hasPendingVisit: false });
    addTask({ title: "Rosana Freire precisa ser reagendada", priority: "ALTA", dueAt: at(bd(-3), 12), p: rosana, visit: v, assignee: "beatriz", source: "AUTOMACAO", auto: "faltou-reagendar", createdAt: at(bd(-4), 10, 30), completedAt: at(bd(-3), 11), completedBy: "beatriz" });
  }

  // Wagner Cordeiro — sem resposta ao convite há mais de 24h e sem pendência: o próximo ciclo manda o 2º contato.
  const wagner = addParticipant({ name: "Wagner Cordeiro", study: "VAC", status: "EM_CONTATO", channel: "BANCO_PROPRIO", owner: "lucas", createdAt: at(bd(-5), 10), lastContactAt: at(bd(-2), 14), nextAction: "Segundo contato se não houver resposta", nextActionDueAt: at(bd(1), 10) });
  {
    tl(wagner, "STATUS_CHANGED", "Selecionado do banco de voluntários", at(bd(-5), 10), { source: "Banco próprio", actor: "lucas" });
    const c = conversation(wagner, "AGUARDANDO_RESPOSTA");
    msg(c, { dir: "OUTBOUND", at: at(bd(-2), 14), tpl: "tpl-vac-convite", by: "lucas", status: "DELIVERED" });
    tl(wagner, "MESSAGE_SENT", "Convite enviado", at(bd(-2), 14), { description: "Modelo aprovado: Convite VAC-2026", source: "WhatsApp", actor: "lucas" });
  }

  // Novos interessados vindos de formulários (entrada automática).
  const newLead = (name: string, study: StudyKey, channel: RecruitmentChannel, owner: UserKey, createdAt: Date, dueAt: Date, form: string) => {
    const p = addParticipant({ name, study, status: "NOVO", channel, owner, createdAt, nextAction: "Fazer primeiro contato", nextActionDueAt: dueAt });
    tl(p, "FORM_RECEIVED", "Formulário recebido", createdAt, { description: `${form} — cadastro automático, sem recadastro manual.`, source: "Formulário", actor: "integration" });
    tl(p, "TASK_CREATED", "Pendência de primeiro contato criada", createdAt, { source: "Automação · Entrada por formulário", actor: "automation" });
    addTask({ title: `Primeiro contato com ${name}`, priority: "MEDIA", dueAt, p, assignee: owner, source: "FORMULARIO", auto: "formulario-entrada", createdAt });
    conversation(p, "RESOLVIDA"); // vazia, pronta para o primeiro contato em Comunicação
    return p;
  };
  newLead("Tânia Ribas", "VAC", "LANDING_PAGE", "lucas", past(0, 8, 12), at(bd(0), 18), "Landing Page VAC-2026");
  newLead("Rafael Coutinho", "AUTO", "INSTAGRAM", "beatriz", past(0, 7, 40), at(bd(0), 18), "Formulário Instagram AUTO-2026");
  newLead("Sofia Lemes", "DERM", "FACEBOOK", "lucas", at(bd(-1), 21, 5), at(bd(1), 12), "Formulário de interesse DERM-2026");

  // ════════════════════════════════════════════════════════════════════
  // Participantes gerados (coerentes com os estudos)
  // ════════════════════════════════════════════════════════════════════

  const GENERIC: Record<StudyKey, Partial<Record<ParticipantStatus, number>>> = {
    VAC: { NOVO: 4, EM_CONTATO: 6, PRE_TRIAGEM: 5, AGUARDANDO_AGENDAMENTO: 4, AGENDADO: 3, INCLUIDO: 12, INELEGIVEL: 4, RETIRADO: 2 },
    AUTO: { NOVO: 3, EM_CONTATO: 5, PRE_TRIAGEM: 4, AGUARDANDO_AGENDAMENTO: 3, AGENDADO: 2, INCLUIDO: 9, INELEGIVEL: 4, RETIRADO: 1 },
    DERM: { NOVO: 3, EM_CONTATO: 4, PRE_TRIAGEM: 4, AGUARDANDO_AGENDAMENTO: 2, AGENDADO: 1, INCLUIDO: 4, INELEGIVEL: 1 },
    CARDIO: { INCLUIDO: 11, RETIRADO: 2 },
  };
  const OWNERS: Record<StudyKey, UserKey[]> = { VAC: ["beatriz", "lucas"], AUTO: ["beatriz"], DERM: ["lucas"], CARDIO: ["lucas"] };
  const INCLUSION_RANGE: Record<StudyKey, [number, number]> = { VAC: [35, 200], AUTO: [30, 140], DERM: [12, 40], CARDIO: [220, 540] };

  const genName = () => {
    for (;;) {
      const first = chance(0.55) ? pick(FIRST_F) : pick(FIRST_M);
      const name = chance(0.3) ? `${first} ${pick(LAST)} ${pick(LAST)}` : `${first} ${pick(LAST)}`;
      if (!usedNames.has(name)) return name;
    }
  };
  const pickChannel = (study: StudyKey): RecruitmentChannel => {
    const r = rand();
    let acc = 0;
    for (let i = 0; i < CHANNELS.length; i++) {
      acc += SHARES[study][i];
      if (r <= acc) return CHANNELS[i];
    }
    return "BANCO_PROPRIO";
  };
  const slot = (d: number) => {
    const [h, m] = pick(SLOTS);
    return at(d, h, m);
  };
  const CHANNEL_SOURCE: Record<RecruitmentChannel, string> = { BANCO_PROPRIO: "Banco próprio", INSTAGRAM: "Instagram", FACEBOOK: "Facebook", LANDING_PAGE: "Landing Page", INDICACAO: "Indicação", ASSOCIACAO: "Associação", MIDIA_TRADICIONAL: "Mídia tradicional" };
  const REPLIES_INTEREST = ["Tenho interesse sim!", "Sim, podem me ligar à tarde.", "Oi! Quero saber mais, pode ligar.", "Sim, tenho interesse. Melhor horário é de manhã."];
  const REPLIES_CONFIRM = ["Confirmo!", "Confirmo, obrigado.", "Ok, confirmado.", "CONFIRMO", "Confirmo sim 👍", "Estarei aí, confirmo."];

  let ownerToggle = 0;
  for (const study of Object.keys(GENERIC) as StudyKey[]) {
    for (const [status, count] of Object.entries(GENERIC[study]) as [ParticipantStatus, number][]) {
      for (let i = 0; i < count; i++) {
        const owners = OWNERS[study];
        const owner = owners[ownerToggle++ % owners.length];
        const channel = pickChannel(study);
        const src = CHANNEL_SOURCE[channel];
        const fromForm = channel === "INSTAGRAM" || channel === "FACEBOOK" || channel === "LANDING_PAGE";
        const entry = (p: P, when: Date) =>
          fromForm
            ? tl(p, "FORM_RECEIVED", "Formulário recebido", when, { source: src, actor: "integration", description: "Cadastro automático a partir do formulário." })
            : tl(p, "STATUS_CHANGED", channel === "BANCO_PROPRIO" ? "Selecionado do banco de voluntários" : `Cadastro via ${src.toLowerCase()}`, when, { source: src, actor: owner });

        if (status === "NOVO") {
          const created = at(-1, int(9, 22), pick([0, 15, 30, 45]));
          const p = addParticipant({ name: genName(), study, status, channel, owner, createdAt: created, nextAction: "Fazer primeiro contato", nextActionDueAt: at(workday(1), 18) });
          entry(p, created);
        } else if (status === "EM_CONTATO") {
          const d = -int(2, 8);
          const created = at(d, int(9, 17));
          const firstAt = at(d + 1, int(9, 11), pick([0, 20, 40]));
          const replied = chance(0.5);
          const p = addParticipant({ name: genName(), study, status, channel, owner, createdAt: created, lastContactAt: firstAt, nextAction: replied ? "Ligar para pré-triagem" : "Aguardar resposta ao segundo contato", nextActionDueAt: at(workday(1), 12) });
          entry(p, created);
          const c = conversation(p, replied ? "RESPONDIDA" : "AGUARDANDO_RESPOSTA", replied ? 1 : 0);
          msg(c, { dir: "OUTBOUND", at: firstAt, tpl: "tpl-primeiro-contato", by: owner });
          tl(p, "MESSAGE_SENT", "Primeiro contato enviado", firstAt, { source: "WhatsApp", actor: owner });
          if (replied) {
            const r = new Date(firstAt.getTime() + int(30, 600) * 60_000);
            const replyAt = r > now ? past(0, 8, 0) : r;
            const body = pick(REPLIES_INTEREST);
            msg(c, { dir: "INBOUND", at: replyAt, body, hasPendingVisit: false });
            tl(p, "MESSAGE_RECEIVED", "Participante respondeu", replyAt, { description: `“${body}”`, source: "WhatsApp" });
            p.lastContactAt = replyAt;
          } else {
            const secondAt = past(0, int(8, 9), pick([0, 15, 30, 45]));
            msg(c, { dir: "OUTBOUND", at: secondAt, tpl: "tpl-segundo-contato", by: owner, status: "DELIVERED" });
            tl(p, "MESSAGE_SENT", "Segundo contato enviado", secondAt, { source: "WhatsApp", actor: owner });
            p.lastContactAt = secondAt;
          }
        } else if (status === "PRE_TRIAGEM" || status === "AGUARDANDO_AGENDAMENTO" || status === "INELEGIVEL") {
          const d = status === "INELEGIVEL" ? -int(10, 40) : -int(4, 15);
          const created = at(d, int(9, 18));
          const firstAt = at(d + 1, 9, 30);
          const replyAt = at(d + 1, int(10, 16), 10);
          const callAt = at(d + 2, int(9, 16), 30);
          const p = addParticipant({ name: genName(), study, status, channel, owner, createdAt: created, lastContactAt: callAt });
          entry(p, created);
          const c = conversation(p, "RESOLVIDA");
          msg(c, { dir: "OUTBOUND", at: firstAt, tpl: "tpl-primeiro-contato", by: owner });
          const body = pick(REPLIES_INTEREST);
          msg(c, { dir: "INBOUND", at: replyAt, body, hasPendingVisit: false });
          tl(p, "MESSAGE_SENT", "Primeiro contato enviado", firstAt, { source: "WhatsApp", actor: owner });
          tl(p, "MESSAGE_RECEIVED", "Participante respondeu", replyAt, { description: `“${body}”`, source: "WhatsApp" });
          tl(p, "PRESCREENING_STARTED", "Pré-triagem iniciada por telefone", callAt, { actor: owner, source: "Telefone" });
          if (status === "PRE_TRIAGEM") {
            p.nextAction = "Concluir pré-triagem";
            p.nextActionDueAt = at(workday(int(1, 3)), 17);
          } else if (status === "AGUARDANDO_AGENDAMENTO") {
            tl(p, "PRESCREENING_COMPLETED", "Pré-triagem concluída", addDays(callAt, 1), { description: "Encaminhado para agendamento da triagem.", actor: owner });
            p.nextAction = "Agendar visita de triagem";
            p.nextActionDueAt = at(workday(int(1, 2)), 17);
          } else {
            tl(p, "PRESCREENING_COMPLETED", "Pré-triagem concluída — não segue no processo", addDays(callAt, 1), { description: "Não atende aos critérios operacionais da pré-triagem (avaliação da equipe).", actor: owner });
          }
        } else if (status === "AGENDADO") {
          const d = -int(5, 12);
          const created = at(d, int(9, 18));
          const vAt = slot(bd(int(2, 8))); // sorteio entre dias úteis: nada se acumula na segunda
          const scheduledAt = at(d + 3, 11);
          const confirmed = chance(0.5);
          const p = addParticipant({ name: genName(), study, status, channel, owner, createdAt: created, lastContactAt: scheduledAt, nextAction: `Triagem em ${formatDayMonth(vAt)}` });
          entry(p, created);
          addVisit(p, { name: "Triagem", at: vAt, status: confirmed ? "CONFIRMADO" : "AGUARDANDO_CONFIRMACAO", confirmedAt: confirmed ? scheduledAt : null });
          const c = conversation(p, "RESOLVIDA");
          msg(c, { dir: "OUTBOUND", at: at(d + 1, 9, 30), tpl: "tpl-primeiro-contato", by: owner });
          msg(c, { dir: "INBOUND", at: at(d + 1, 12, 5), body: pick(REPLIES_INTEREST), hasPendingVisit: false });
          msg(c, { dir: "OUTBOUND", at: scheduledAt, tpl: "tpl-confirmacao", by: owner, visitAt: vAt });
          tl(p, "PRESCREENING_COMPLETED", "Pré-triagem concluída", at(d + 2, 15), { actor: owner, source: "Telefone" });
          tl(p, "VISIT_SCHEDULED", "Visita agendada", scheduledAt, { description: `Triagem em ${formatDayMonth(vAt)} às ${formatTime(vAt)}`, actor: owner });
        } else if (status === "INCLUIDO" || status === "RETIRADO") {
          const [minD, maxD] = INCLUSION_RANGE[study];
          const incl = -int(minD, maxD);
          const created = at(incl - int(15, 30), 10);
          const whatsapp = !(study === "CARDIO" && chance(0.2));
          const p = addParticipant({ name: genName(), study, status, channel, owner, createdAt: created, whatsapp });
          entry(p, created);
          tl(p, "STATUS_CHANGED", "Incluído no estudo", at(incl, 9), { source: "Polo Trial", actor: "integration" });
          extRef("Participant", p.id as string, `PT-PAR-${String(20000 + seq * 11)}`);
          if (status === "RETIRADO") {
            const wd = at(Math.round(incl / 2), 11);
            tl(p, "STATUS_CHANGED", "Retirado do estudo", wd, { description: "Registro sincronizado do Polo Trial.", source: "Polo Trial", actor: "integration" });
            p.lastContactAt = wd;
            continue;
          }
          const followups = VISIT_PLAN[study].filter((n) => !n.startsWith("Triagem"));
          const idx = int(1, followups.length - 1);
          let last: Date | null = null;
          if (chance(0.65)) {
            const pv = addVisit(p, { name: followups[idx - 1], at: slot(bd(-int(2, 32))), status: "REALIZADO" });
            pv.reminderSentAt = addDays(pv.scheduledAt, -1);
            addReimbursement(p, pv);
            tl(p, "VISIT_COMPLETED", `${pv.name} realizada`, pv.completedAt as Date, { actor: owner });
            last = pv.scheduledAt;
            if (whatsapp && chance(0.6)) {
              const reminderAt = at(dayOffsetOf(pv.scheduledAt) - 1, 7);
              const c = conversation(p, "RESOLVIDA");
              const confirmAt = reminderThread(c, pv.scheduledAt, reminderAt, pick(REPLIES_CONFIRM), int(5, 120), owner);
              pv.confirmedAt = confirmAt;
            }
          }
          if (chance(0.7)) {
            const nv = addVisit(p, { name: followups[idx], at: slot(bd(int(2, 15))), status: chance(0.55) ? "CONFIRMADO" : "AGUARDANDO_CONFIRMACAO" });
            p.nextAction = `Próxima visita: ${nv.name} em ${formatDayMonth(nv.scheduledAt)}`;
          } else {
            p.nextAction = "Aguardar agendamento da próxima visita (Polo Trial)";
          }
          p.lastContactAt = last ?? at(incl, 9);
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Pendências operacionais gerais, financeiro, auditoria
  // ════════════════════════════════════════════════════════════════════

  addTask({ title: "Enviar recibos de ressarcimento de setembro ao patrocinador", description: "Consolidar recibos digitalizados de VAC-2026 e enviar ao patrocinador. Hoje feito manualmente a partir de planilhas.", priority: "MEDIA", dueAt: at(-2, 17), study: "VAC", assignee: "fernanda", createdBy: "fernanda", source: "FINANCEIRO", createdAt: at(-9, 10) });
  addTask({ title: "Conciliar reembolsos pendentes de AUTO-2026", priority: "MEDIA", dueAt: at(workday(2), 17), study: "AUTO", assignee: "fernanda", createdBy: "fernanda", source: "FINANCEIRO", createdAt: at(-1, 15) });
  addTask({ title: "Atualizar status de pré-triagem no Polo Trial (4 candidatos)", description: "Registros feitos no WhatsApp e no telefone ainda não lançados no Polo Trial.", priority: "BAIXA", dueAt: at(-1, 18), study: "DERM", assignee: "lucas", createdBy: "marina", source: "MANUAL", createdAt: at(-3, 9) });
  addTask({ title: "Revisar modelo “Convite DERM-2026 (Instagram)” após parecer do CEP", priority: "BAIXA", dueAt: at(workday(5), 17), study: "DERM", assignee: "ricardo", createdBy: "marina", source: "MANUAL", createdAt: at(-6, 14) });
  addTask({ title: "Conferir recibos de transporte da semana anterior", priority: "MEDIA", dueAt: at(-4, 17), study: "VAC", assignee: "fernanda", createdBy: "fernanda", source: "FINANCEIRO", createdAt: at(-7, 9), completedAt: at(-4, 16), completedBy: "fernanda" });
  addTask({ title: "Montar relatório semanal de recrutamento para o patrocinador", description: "Consolidado manualmente a partir do Polo Trial, planilhas e WhatsApp.", priority: "MEDIA", dueAt: at(-4, 12), study: "VAC", assignee: "camila", createdBy: "camila", source: "MANUAL", createdAt: at(-6, 9), completedAt: at(-4, 11, 30), completedBy: "camila" });
  addTask({ title: "Revisar lembretes automáticos de VAC-2026 com o modelo v3", priority: "BAIXA", dueAt: at(-7, 17), study: "VAC", assignee: "ricardo", createdBy: "camila", source: "MANUAL", createdAt: at(-10, 9), completedAt: at(-7, 15), completedBy: "ricardo" });

  // Lançamentos financeiros mensais (visitas + overhead + taxa de ativação).
  const FIN: Record<StudyKey, { activation: number; unit: number; visits: number }> = {
    VAC: { activation: 1_200_000, unit: 12_000, visits: 625 },
    AUTO: { activation: 1_500_000, unit: 26_000, visits: 400 },
    DERM: { activation: 800_000, unit: 18_000, visits: 40 },
    CARDIO: { activation: 1_000_000, unit: 20_000, visits: 1000 },
  };
  const financialRecords: Prisma.FinancialRecordCreateManyInput[] = [];
  const thisMonth = startOfMonth(now);
  for (const key of Object.keys(ST) as StudyKey[]) {
    const s = ST[key];
    const months: Date[] = [];
    for (let m = startOfMonth(s.startDate); m <= thisMonth; m = startOfMonth(addDays(m, 32))) months.push(m);
    const qty = distribute(FIN[key].visits, months.map((_, i) => Math.min(1, (i + 1) / 3) * (i === months.length - 1 ? 0.35 : 1) * (0.85 + rand() * 0.3)));
    financialRecords.push({ id: newId(), studyId: s.id, category: "TAXA_ATIVACAO", description: "Taxa de ativação do centro", competence: months[0], quantity: 1, unitAmountCents: FIN[key].activation, amountCents: FIN[key].activation, status: "PAGO" });
    months.forEach((m, i) => {
      if (qty[i] === 0) return;
      const status = i === months.length - 1 ? "A_FATURAR" : i === months.length - 2 ? "FATURADO" : "PAGO";
      const amount = qty[i] * FIN[key].unit;
      financialRecords.push({ id: newId(), studyId: s.id, category: "VISITA", description: "Visitas realizadas", competence: m, quantity: qty[i], unitAmountCents: FIN[key].unit, amountCents: amount, status });
      financialRecords.push({ id: newId(), studyId: s.id, category: "OVERHEAD", description: "Overhead institucional (10%)", competence: m, quantity: 1, unitAmountCents: amount / 10, amountCents: amount / 10, status });
    });
  }

  // Auditoria e notificações gerais.
  audit({ actor: "integration", action: "integration.sync", entityType: "Study", summary: "Sincronização com o Polo Trial (simulada): 4 estudos e 1 alerta de janela recebidos", at: past(0, 6, 0), metadata: { system: "POLO_TRIAL", mode: "mock" } });
  audit({ actor: "automation", action: "automation.cycle", entityType: "AutomationRule", summary: "Ciclo de automações: lembretes das visitas do próximo dia útil enviados", at: past(0, 7, 0) });
  audit({ actor: "camila", action: "user.login", entityType: "User", entityId: U.camila.id, summary: "Acesso ao sistema", at: past(0, 7, 55) });
  audit({ actor: "beatriz", action: "user.login", entityType: "User", entityId: U.beatriz.id, summary: "Acesso ao sistema", at: past(0, 7, 30) });
  audit({ actor: "lucas", action: "participant.contact_viewed", entityType: "Participant", entityId: gabriel.id as string, study: "DERM", summary: "Telefone de Gabriel Torres exibido", at: past(0, 10, 0) });
  audit({ actor: "lucas", action: "visit.scheduled", entityType: "Participant", entityId: gabriel.id as string, study: "DERM", summary: `Triagem de Gabriel Torres agendada para ${formatDayMonth(at(bd(1), 15, 30))} às 15:30`, at: past(0, 10, 5) });
  audit({ actor: "beatriz", action: "message.sent", entityType: "Participant", entityId: sergio.id as string, study: "AUTO", summary: "Modelo “Reagendamento” enviado a Sérgio Albuquerque", at: past(0, 9, 25) });
  audit({ actor: "beatriz", action: "task.completed", entityType: "Task", study: "AUTO", summary: "Pendência concluída: Responder dúvida de Isabela Quintana sobre ressarcimento", at: at(bd(-1), 8, 30) });
  audit({ actor: "lucas", action: "visit.confirmed", entityType: "Participant", entityId: bruna.id as string, study: "VAC", summary: "Visita de Bruna Valente confirmada", at: at(bd(-1), 7, 46) });
  audit({ actor: "fernanda", action: "reimbursement.status_changed", entityType: "Reimbursement", study: "VAC", summary: "3 reembolsos enviados para conciliação", at: at(-2, 16, 20) });
  audit({ actor: "ricardo", action: "template.approval_registered", entityType: "MessageTemplate", entityId: TPL["tpl-lembrete-visita"].id as string, summary: "Aprovação do CEP registrada para “Lembrete de visita” (v3)", at: at(-120, 15) });
  audit({ actor: "ricardo", action: "template.submitted", entityType: "MessageTemplate", entityId: TPL["tpl-derm-instagram"].id as string, study: "DERM", summary: "Modelo “Convite DERM-2026 (Instagram)” submetido ao CEP", at: at(-6, 14) });
  audit({ actor: "marina", action: "user.role_changed", entityType: "User", entityId: U.lucas.id, summary: "Lucas Pereira adicionado à equipe de DERM-2026", at: at(-44, 10) });
  audit({ actor: "helena", action: "report.viewed", entityType: "Report", summary: "Relatório de recrutamento consultado", at: at(-1, 17, 40) });
  for (const k of Object.keys(ST) as StudyKey[]) {
    for (const intent of expandedIntents(k)) {
      const min = AUTO_POLICY[intent];
      audit({
        actor: "helena",
        action: "assist.policy_changed",
        entityType: "AssistPolicy",
        study: k,
        summary: `${ST[k].code} · ${INTENT_LABEL[intent]}: automático, confiança mínima ${min}`,
        at: autoExpandedAt,
        metadata: { before: DEFAULT_POLICY, after: { mode: "AUTOMATICO", minConfidence: min } },
      });
    }
  }

  notify("camila", "SYSTEM", "VAC-2026 está abaixo do ritmo esperado de recrutamento", past(0, 6, 5), { href: "/estudos", read: true });
  notify("camila", "AUTOMATION", "Ciclo das 07:00: lembretes de visita enviados", past(0, 7, 0), { href: "/configuracoes?secao=automacoes", read: true });
  notify("beatriz", "MESSAGE", "Thiago Moreira e Vera Campos ainda não confirmaram a visita do próximo dia útil", past(0, 9, 0), { href: "/agenda" });
  notify("lucas", "TASK", "Nova pendência: Primeiro contato com Tânia Ribas", past(0, 8, 12), { href: "/pendencias" });
  notify("fernanda", "TASK", "Recibos de setembro ao patrocinador estão atrasados", past(0, 8, 0), { href: "/pendencias" });
  notify("marina", "SYSTEM", "DERM-2026 dentro do ritmo esperado", past(0, 6, 5), { read: true });

  // Decisões da assistência para cada mensagem recebida: fila de revisão e histórico do piloto.
  const assistDecisions: Prisma.AssistDecisionCreateManyInput[] = [];
  let reviewToggle = 0;
  for (const m of inbound) {
    const p = m.c.p;
    const { a, auto, reason } = autoApplies(p.studyKey, m.body, m.hasPendingVisit);
    const next = communications
      .filter((x) => x.conversationId === m.c.id && x.direction === "OUTBOUND" && (x.sentAt as Date) > m.at)
      .sort((x, y) => (x.sentAt as Date).getTime() - (y.sentAt as Date).getTime())[0];
    const base = { id: newId(), communicationId: m.id, participantId: p.id, studyId: p.studyId, intent: a.intent, confidence: a.score, ambiguous: a.ambiguous, suggestedTemplateKey: a.suggestedTemplateKey, createdAt: m.at };
    if (a.intent === "POSSIVEL_RELATO_CLINICO") {
      assistDecisions.push({ ...base, outcome: "ENCAMINHADA", reason: "Possível relato clínico: sempre encaminhado à equipe médica", action: null });
    } else if (!next && m.c.status !== "RESOLVIDA") {
      assistDecisions.push({ ...base, outcome: "PENDENTE", reason: auto ? "Aguardando revisão" : reason, action: null });
    } else if (!next) {
      // Tratada fora do WhatsApp (ex.: ligação de pré-triagem) e conversa encerrada.
      assistDecisions.push({ ...base, outcome: "TRATADA", reason, action: null, reviewedById: U[p.ownerKey].id, reviewedAt: new Date(m.at.getTime() + 2 * 3_600_000) });
    } else if (auto && isActionable(a.intent)) {
      const action = a.intent === "CONFIRMACAO" ? "Visita confirmada; “Confirmação de agendamento” enviada" : a.intent === "DUVIDA_FREQUENTE" ? "Resposta aprovada enviada" : "Ação aplicada";
      const reviewed = reviewToggle++ % 3 !== 2; // cerca de 2/3 revisadas
      const reviewer: UserKey = reviewToggle % 2 === 0 ? "ricardo" : "marina";
      assistDecisions.push({
        ...base,
        outcome: "AUTOMATICA",
        reason,
        action,
        verdict: reviewed ? "CORRETA" : null,
        reviewedById: reviewed ? U[reviewer].id : null,
        reviewedAt: reviewed ? addDays(m.at, 1) : null,
      });
      run("assistencia-ia", "SUCESSO", `${INTENT_LABEL[a.intent]} de ${p.fullName} aplicada automaticamente (confiança ${a.score}): ${action}`, new Date(m.at.getTime() + 60_000), p, "AssistDecision", base.id);
    } else {
      assistDecisions.push({
        ...base,
        outcome: isActionable(a.intent) && !a.ambiguous ? "APROVADA" : "TRATADA",
        reason,
        action: null,
        reviewedById: U[p.ownerKey].id,
        reviewedAt: next.sentAt as Date,
      });
    }
  }

  // Remove campos auxiliares antes da gravação.
  const cleanParticipants = participants.map(({ studyKey: _s, ownerKey: _o, whatsapp: _w, ...rest }) => rest);
  const cleanConversations = conversations.map(({ p: _p, count: _c, ...rest }) => rest);

  return {
    users, studies, studyMembers, stages, recruitmentMetrics, templates, automationRules, externalRefs,
    participants: cleanParticipants, recruitments, consents, visits, conversations: cleanConversations, communications,
    tasks, reimbursements, financialRecords, timeline, automationRuns, auditLogs, notifications,
    automationSettings, assistPolicies, assistDecisions,
  };
}

// ─── Gravação ─────────────────────────────────────────────────────────────

type Tx = Prisma.TransactionClient;

async function clearDatabase(tx: Tx) {
  // Ordem respeita as chaves estrangeiras.
  await tx.notification.deleteMany();
  // O consumo da IA (aiUsage) é mantido de propósito: mostra o gasto acumulado de todos os testes.
  await tx.assistDecision.deleteMany();
  await tx.assistPolicy.deleteMany();
  await tx.studyAutomationSettings.deleteMany();
  await tx.auditLog.deleteMany();
  await tx.automationRun.deleteMany();
  await tx.automationRule.deleteMany();
  await tx.timelineEvent.deleteMany();
  await tx.communication.deleteMany();
  await tx.conversation.deleteMany();
  await tx.task.deleteMany();
  await tx.reimbursement.deleteMany();
  await tx.visit.deleteMany();
  await tx.consentRecord.deleteMany();
  await tx.recruitment.deleteMany();
  await tx.recruitmentMetric.deleteMany();
  await tx.recruitmentStage.deleteMany();
  await tx.financialRecord.deleteMany();
  await tx.messageTemplate.deleteMany();
  await tx.externalReference.deleteMany();
  await tx.participant.deleteMany();
  await tx.studyMember.deleteMany();
  await tx.study.deleteMany();
  await tx.user.deleteMany();
}

export async function seedDatabase(db: PrismaClient, now: Date = new Date()) {
  const d = buildDemoData(now);
  await db.$transaction(
    async (tx) => {
      await clearDatabase(tx);
      await tx.user.createMany({ data: d.users });
      await tx.study.createMany({ data: d.studies });
      await tx.studyMember.createMany({ data: d.studyMembers });
      await tx.recruitmentStage.createMany({ data: d.stages });
      await tx.recruitmentMetric.createMany({ data: d.recruitmentMetrics });
      await tx.messageTemplate.createMany({ data: d.templates });
      await tx.automationRule.createMany({ data: d.automationRules });
      await tx.externalReference.createMany({ data: d.externalRefs });
      await tx.participant.createMany({ data: d.participants });
      await tx.recruitment.createMany({ data: d.recruitments });
      await tx.consentRecord.createMany({ data: d.consents });
      await tx.visit.createMany({ data: d.visits });
      await tx.conversation.createMany({ data: d.conversations });
      await tx.communication.createMany({ data: d.communications });
      await tx.studyAutomationSettings.createMany({ data: d.automationSettings });
      await tx.assistPolicy.createMany({ data: d.assistPolicies });
      await tx.assistDecision.createMany({ data: d.assistDecisions });
      await tx.task.createMany({ data: d.tasks });
      await tx.reimbursement.createMany({ data: d.reimbursements });
      await tx.financialRecord.createMany({ data: d.financialRecords });
      await tx.timelineEvent.createMany({ data: d.timeline });
      await tx.automationRun.createMany({ data: d.automationRuns });
      await tx.auditLog.createMany({ data: d.auditLogs });
      await tx.notification.createMany({ data: d.notifications });
    },
    { timeout: 60_000 },
  );
  return {
    usuarios: d.users.length,
    estudos: d.studies.length,
    participantes: d.participants.length,
    visitas: d.visits.length,
    conversas: d.conversations.length,
    mensagens: d.communications.length,
    pendencias: d.tasks.length,
    reembolsos: d.reimbursements.length,
    registrosRecrutamento: d.recruitments.length,
    metricasFunil: d.recruitmentMetrics.length,
  };
}
