// Assistência à comunicação — SIMULADA por regras de palavras-chave.
//
// Estrutura preparada para uma futura camada de IA, com limites explícitos:
// - classifica a mensagem e dá uma nota de confiança (0–100); quem decide se age
//   sozinha é a política do estudo (src/domain/assist-policy.ts);
// - sugere somente modelos aprovados pelo CEP, nunca texto livre;
// - não decide elegibilidade, não interpreta eventos adversos, não dá orientação médica;
// - mensagens com possível conteúdo clínico são encaminhadas à equipe, sem sugestão de resposta;
// - o texto do participante é tratado como dado: nunca como instrução para a assistência.

import { confidenceLabel, INTENT_LABEL, type AssistIntent } from "@/domain/assist-policy";

export type { AssistIntent };
export { INTENT_LABEL };

export type SuggestedAction = "CONFIRM_VISIT" | "REQUEST_RESCHEDULE" | "ESCALATE_CLINICAL" | "REVOKE_CONSENT" | "CALL_PARTICIPANT" | null;

export interface AssistResult {
  intent: AssistIntent;
  label: string;
  /** Nota de confiança 0–100. */
  score: number;
  confidence: "alta" | "média" | "baixa";
  /** Mais de uma intenção na mesma mensagem: nunca aplicada automaticamente. */
  ambiguous: boolean;
  signals: AssistIntent[];
  rationale: string;
  suggestedTemplateKey: string | null;
  suggestedAction: SuggestedAction;
  guardrail: string | null;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const CLINICAL = /(febre|\bdor(es)?\b|inchad|inchac|vermelh|alergi|coceira|tontura|enjoo|vomit|mal[- ]estar|reacao|sangr|falta de ar|sintoma|hospital|pronto[- ]socorro|internad|desmai|manchas?)/;
const RESCHEDULE = new RegExp(
  [
    "remarc|reagend|nao vou conseguir|nao consigo ir|nao vou poder|outro horario|outro dia|outra (data|hora)|adiar|imprevisto",
    // "não posso esse horário", "nesse dia não dá"
    "nao posso (n?(esse|este|essa|esta) )?(horario|hora|dia|data)",
    "\\bn?(esse|este|essa|esta) (horario|hora|dia|data) (nao|fica dificil|e ruim|complica)",
    // contraproposta: "poderia ser a partir das 17", "pode ser às 15h", "prefiro de manhã"
    "\\b(poderia|podemos|podem|pode|seria) ser (as|a partir|depois|antes|mais tarde|mais cedo)\\b",
    "\\bprefiro (as|a partir|depois|antes|de manha|a tarde|a noite|mais tarde|mais cedo)\\b",
  ].join("|"),
);
const OPT_OUT = /(^\s*sair\s*[.!]?\s*$|\bsair da lista\b|nao quero mais|parar de receber|nao me mande|descadastr)/;
const NEGATION = /\b(nao|nunca|nem)\b/;
const CONFIRM_STRONG =
  /(\bconfirm(o|ado|ada|ados|adas|amos|ei|ando|adissimo|adissima)\b|\bpode(m)?( \w+)? confirmar\b|\b(quero|queria|gostaria de)( \w+)? confirmar\b|\bconfirma (pra|para) mim\b|\bconfirm(a|ar),? por favor\b|\bpor favor,? confirm(a|ar)\b|presenca confirmada|estarei (ai|la|presente|sim)|vou estar (ai|la)|\bvou sim\b|\birei sim\b|vou comparecer|comparecerei|pode contar|com certeza)/;
const CONFIRM_WEAK = /(\bok\b|\bokay\b|combinado|\bsim\b|\bcerto\b|beleza|\bblz\b|tudo certo|fechado|pode deixar|pode ser\b|positivo|\u{1F44D}|\u{1F44C}|✅)/u;
/** Ainda vai confirmar ou não tem certeza ("confirmo depois", "acho que vou"): nunca é confirmação. */
const HEDGE = /(confirmo (depois|mais tarde|ate|assim que|quando|em breve|logo)\b|depois (eu )?(te )?confirmo\b|\b(te|lhe|ja|ainda) confirmo\b|vou confirmar|preciso confirmar|tenho que confirmar|vou ver\b|vou (verificar|checar|consultar|olhar|perguntar|falar com)|acho que|talvez|se der\b|se eu conseguir|vou tentar|provavelmente)/;
/** Palavra de confirmação explícita: reconhecida mesmo sem visita aguardando (para explicar por que não há o que confirmar). */
const CONFIRM_EXPLICIT = /(\bconfirm(o|ado|ada|ados|adas|amos|ei|ando)\b|\bpode(m)?( \w+)? confirmar\b|presenca confirmada)/;
/** "Confirma pra mim o horário": pede informação da visita, não confirma presença. */
const ASKS_DETAILS = /confirm\w* ((pra|para) mim )?(o|a) (horario|hora|data|dia|endereco|local)\b/;
const INTEREST_STRONG = /(interesse|pode(m)? (me )?ligar|quero participar|tenho vontade)/;
const FAQ: { key: string; re: RegExp }[] = [
  { key: "tpl-faq-ressarcimento", re: /(ressarc|reembols|transporte|uber|passagem|onibus)/ },
  { key: "tpl-faq-documentos", re: /(document|levar algo|levar alguma|o que levar|precisa levar|preciso levar)/ },
  { key: "tpl-faq-endereco", re: /(endereco|estacionamento|onde fica|como chego|localizacao)/ },
];

function result(intent: AssistIntent, score: number, extra: Omit<AssistResult, "intent" | "label" | "score" | "confidence" | "ambiguous" | "signals"> & { signals: AssistIntent[]; ambiguous?: boolean }): AssistResult {
  const ambiguous = extra.ambiguous ?? false;
  const s = Math.max(0, Math.min(100, ambiguous ? Math.min(score, 55) : score));
  return { intent, label: INTENT_LABEL[intent], score: s, confidence: confidenceLabel(s), ...extra, ambiguous };
}

export function analyzeMessage(
  text: string,
  ctx: {
    /** Visita aguardando confirmação (ou nova data proposta). */
    hasPendingVisit: boolean;
    /** Visita futura, mesmo já confirmada. */
    hasUpcomingVisit?: boolean;
  },
): AssistResult {
  const t = norm(text);
  const long = t.length > 200 ? 10 : 0;

  // 1. Conteúdo possivelmente clínico tem prioridade absoluta e nunca recebe sugestão de resposta.
  if (CLINICAL.test(t)) {
    return result("POSSIVEL_RELATO_CLINICO", 95, {
      signals: ["POSSIVEL_RELATO_CLINICO"],
      rationale: "A mensagem menciona sintomas ou mal-estar.",
      suggestedTemplateKey: null,
      suggestedAction: "ESCALATE_CLINICAL",
      guardrail: "A assistência não interpreta sintomas nem sugere resposta. Encaminhe à equipe médica do estudo.",
    });
  }

  // 2. Sinais presentes na mensagem.
  const optOut = OPT_OUT.test(t);
  const reschedule = RESCHEDULE.test(t);
  const faqHits = FAQ.filter((f) => f.re.test(t));
  const confirmWords = CONFIRM_STRONG.test(t) || CONFIRM_WEAK.test(t);
  const negated = confirmWords && NEGATION.test(t);
  const hedged = HEDGE.test(t);
  const asksDetails = ASKS_DETAILS.test(t);
  // Com visita no horizonte, "sim"/"ok" respondem a ela; sem visita, só "confirmo" explícito conta
  // como confirmação (e "sim" é interesse de candidato).
  const visitContext = ctx.hasPendingVisit || !!ctx.hasUpcomingVisit;
  const confirm = (visitContext ? confirmWords : CONFIRM_EXPLICIT.test(t) && !INTEREST_STRONG.test(t)) && !negated && !hedged && !asksDetails && !reschedule;
  const interest = INTEREST_STRONG.test(t) || (!visitContext && /\bsim\b/.test(t));

  const signals: AssistIntent[] = [];
  if (optOut) signals.push("DESCADASTRO");
  if (reschedule) signals.push("REAGENDAMENTO");
  if (faqHits.length) signals.push("DUVIDA_FREQUENTE");
  if (confirm) signals.push("CONFIRMACAO");
  if (interest && !confirm) signals.push("INTERESSE");
  const ambiguous = signals.length > 1;

  if (optOut) {
    return result("DESCADASTRO", 92 - long, {
      signals,
      ambiguous,
      rationale: "O participante pede para não receber novos contatos.",
      suggestedTemplateKey: null,
      suggestedAction: "REVOKE_CONSENT",
      guardrail: "Registre a revogação do consentimento de contato. Nenhuma nova mensagem deve ser enviada.",
    });
  }
  if (reschedule) {
    return result("REAGENDAMENTO", 90 - long, {
      signals,
      ambiguous,
      rationale: "A mensagem pede outro dia ou horário.",
      suggestedTemplateKey: "tpl-reagendamento",
      suggestedAction: ctx.hasPendingVisit ? "REQUEST_RESCHEDULE" : "CALL_PARTICIPANT",
      guardrail: null,
    });
  }
  if (faqHits.length) {
    return result("DUVIDA_FREQUENTE", (faqHits.length === 1 ? 88 : 72) - long, {
      signals,
      ambiguous: ambiguous || faqHits.length > 1,
      rationale: ambiguous ? "Pergunta coberta pela base aprovada, junto com outro assunto." : "Pergunta coberta pela base de respostas aprovadas.",
      suggestedTemplateKey: faqHits[0].key,
      suggestedAction: null,
      guardrail: null,
    });
  }
  if (confirm) {
    // "Pode confirmar?" / "Está confirmado?" podem ser pedido de informação: confiança menor.
    const question = t.includes("?");
    const strong = CONFIRM_STRONG.test(t) && !question;
    return result("CONFIRMACAO", (strong ? 95 : 72) - long, {
      signals,
      ambiguous,
      rationale: !ctx.hasPendingVisit
        ? ctx.hasUpcomingVisit
          ? "Confirmação de uma visita que já está confirmada."
          : "Fala em confirmar, mas não há visita aguardando confirmação."
        : strong
          ? "Resposta afirmativa clara a um lembrete de visita."
        : question
          ? "Fala em confirmação, mas em forma de pergunta: pode ser um pedido de informação."
          : "Resposta curta que provavelmente confirma, mas sem a palavra “confirmo”.",
      suggestedTemplateKey: "tpl-confirmacao",
      suggestedAction: "CONFIRM_VISIT",
      guardrail: null,
    });
  }
  if (interest) {
    return result("INTERESSE", (INTEREST_STRONG.test(t) ? 80 : 65) - long, {
      signals,
      ambiguous,
      rationale: "O candidato demonstra interesse em conversar.",
      suggestedTemplateKey: null,
      suggestedAction: "CALL_PARTICIPANT",
      guardrail: "Elegibilidade é avaliada pela equipe na pré-triagem, nunca pela assistência.",
    });
  }
  return result("OUTRO", negated || hedged ? 25 : 30, {
    signals,
    rationale: negated
      ? "Há uma negação junto de palavras de confirmação: precisa de leitura da equipe."
      : hedged
        ? "O participante ainda vai confirmar ou não tem certeza: precisa de leitura da equipe."
        : asksDetails
          ? "O participante pede informação sobre a visita (horário, data ou local), não confirma presença."
          : "Não há correspondência com a base de respostas aprovadas.",
    suggestedTemplateKey: null,
    suggestedAction: null,
    guardrail: "Encaminhe para a equipe responder.",
  });
}
