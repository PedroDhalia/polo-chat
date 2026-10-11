import "server-only";
import type { AssistIntent } from "@/domain/assist-policy";
import { buildUserContent, SYSTEM_PROMPT } from "./prompt";
import type { AiInterpretation, AiInterpretInput, AssistAiAdapter } from "./types";

// IA SIMULADA para a demonstração: nenhuma chamada externa e nenhum custo.
// Cobre o que as regras de palavras-chave não pegam — erros de digitação, gírias, horários por
// extenso, sintomas descritos de outra forma — e estima os tokens que uma chamada real gastaria
// (≈ 3,4 caracteres por token em português), para a tela de consumo.

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const tokens = (s: string) => Math.ceil(s.length / 3.4);

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

const CLINICAL = /(passando mal|passei mal|nao (estou|to|tô) bem|efeito colateral|remedio|medicamento|\bdor\b|doendo|inflam|febre|machuc|sangu|vomit|enjo|tont|alerg|reacao|coceira|vermelh|inchad|hospital|\bupa\b|pronto[- ]socorro|gravida|gestante)/;
const OPT_OUT = /(me tira|tira meu (nome|numero)|nao tenho mais interesse|desisto|desistir|nao quero (mais )?participar|para de mandar|parem de mandar|chega de mensage)/;
const RESCHEDULE = /(nao vai dar|nao da (pra|para)|nao vou conseguir|surgiu (um|uma)|tive um (problema|imprevisto)|mudar o (dia|horario)|trocar o (dia|horario)|nao consigo|vou precisar mudar|posso ir (outro|em outro|na|no)|la pelas|depois das|mais tarde|mais cedo|outro dia|outro horario)/;
const CONFIRM_SLANG = /(\bto dentro\b|\bbora\b|\bfechou\b|pode me esperar|\bvou estar\b|\bvou sim\b|\bvou la\b|\bvou ai\b|\bta confirmad|\bpode marcar\b|com certeza|\bto indo\b|\bpode contar\b|\bestarei\b)/;
const CONFIRM_WORDS = ["confirmo", "confirmado", "confirmada", "confirmar", "confirmei"];
/** Afirmativo curto: com visita esperando resposta, provável confirmação (mas sem certeza). */
const WEAK_YES = /(\bok\b|\bokay\b|\bsim\b|beleza|\bblz\b|\bcerto\b|combinado|fechado|pode deixar|\bshow\b|perfeito|ta bom|\bpode ser\b|\u{1F44D})/u;
const INTEREST = /(quero saber mais|como funciona|me interessa|tenho interesse|quero participar|quero me inscrever|pode(m)? me ligar|me liga|pode(m)? ligar)/;
const FAQ: [NonNullable<AiInterpretation["faqTopic"]>, RegExp][] = [
  ["ressarcimento", /(reembols|ressarc|transporte|uber|onibus|passagem|gasolina|lanche|almoco)/],
  ["documentos", /(documento|\brg\b|\bcpf\b|identidade|carteirinha|o que (eu )?levo|preciso levar)/],
  ["endereco", /(endereco|onde fica|como chego|estacionamento|estacionar|localizacao)/],
];
const NUMBERS: Record<string, number> = { uma: 1, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12 };
const DAYS = ["depois de amanha", "amanha", "hoje", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];

/** "lá pelas cinco da tarde" → 17:00; "meio-dia" → 12:00; "de manhã" → 10:00. */
const NUM = "(\\d{1,2}|uma|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)";
const PERIOD = "(da tarde|da noite|da manha)";
/** Grupos: 1 = hora, 2 = minutos, 3 = período do dia. */
const TIME_PATTERNS = [
  new RegExp(`\\b(?:as|das|pelas|depois das|a partir das)\\s+${NUM}(?:[:h](\\d{2}))?(?:\\s*(?:h|horas?)\\b)?(?:\\s*${PERIOD})?`), // "lá pelas cinco da tarde", "a partir das 17"
  new RegExp(`\\b${NUM}(?:[:h](\\d{2}))?\\s*(?:horas?\\s*)?${PERIOD}`), // "cinco da tarde"
  new RegExp(`\\b(\\d{1,2})(?:[:h](\\d{2})|h\\b|\\s*horas?\\b)()`), // "17h", "17:30", "15 horas"
];

function extractTime(t: string): string | null {
  const pad = (h: number, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  if (/meio[- ]dia/.test(t)) return "12:00";
  for (const re of TIME_PATTERNS) {
    const m = t.match(re);
    if (!m) continue;
    let h = Number(m[1]) || NUMBERS[m[1]] || 0;
    if (!h || h > 23) continue;
    if ((m[3] === "da tarde" || m[3] === "da noite") && h < 12) h += 12;
    else if (!m[3] && h <= 6) h += 12; // "às 3" = 15h: ninguém pede ligação de madrugada
    return pad(h, Number(m[2] || 0));
  }
  if (/(fim|final) da tarde/.test(t)) return "17:00";
  if (/\bmanha\b|\bcedo\b/.test(t)) return "10:00";
  if (/\btarde\b/.test(t) && !/mais tarde/.test(t)) return "15:00";
  if (/\bnoite\b/.test(t)) return "18:00";
  return null;
}

export class MockAssistAiAdapter implements AssistAiAdapter {
  readonly mode = "mock" as const;
  private lastCallAt = 0;

  constructor(readonly model: string) {}

  async interpret(input: AiInterpretInput) {
    const started = Date.now();
    const result = this.classify(input);
    // Estimativa do que a chamada real gastaria (instruções em cache por 5 min).
    const system = tokens(SYSTEM_PROMPT);
    const warm = Date.now() - this.lastCallAt < 5 * 60_000;
    this.lastCallAt = Date.now();
    return {
      result,
      usage: {
        model: this.model,
        inputTokens: tokens(buildUserContent(input)),
        outputTokens: 70 + tokens(result.rationale) + 160, // JSON + justificativa + raciocínio curto (esforço baixo)
        cacheReadTokens: warm ? system : 0,
        cacheWriteTokens: warm ? 0 : system,
        latencyMs: Date.now() - started,
      },
    };
  }

  private classify(input: AiInterpretInput): AiInterpretation {
    const t = norm(input.message);
    const c = input.context;
    const out = (intent: AssistIntent, confidence: number, rationale: string, extra: Partial<AiInterpretation> = {}): AiInterpretation => ({
      intent,
      confidence,
      ambiguous: false,
      faqTopic: null,
      preferredDay: null,
      preferredTime: null,
      rationale,
      ...extra,
    });

    if (CLINICAL.test(t)) return out("POSSIVEL_RELATO_CLINICO", 94, "Menciona mal-estar ou assunto de saúde: deve ir para a equipe médica.");
    if (OPT_OUT.test(t)) return out("DESCADASTRO", 92, "Pede para sair ou desiste de participar.");

    const day = DAYS.find((d) => new RegExp(`\\b${d}\\b`).test(t)) ?? null;
    const time = extractTime(t);
    const faq = FAQ.filter(([, re]) => re.test(t)).map(([k]) => k);
    const words = t.split(/[^a-z]+/).filter(Boolean);
    const typo = words.some((w) => w.length >= 6 && CONFIRM_WORDS.some((cw) => distance(w, cw) <= 2));
    const confirmish = CONFIRM_SLANG.test(t) || typo;
    const visitContext = c.hasPendingVisit || c.hasConfirmedVisit || c.hasDateProposal;

    if (RESCHEDULE.test(t) || (c.hasScheduledCall && time && !confirmish)) {
      const target = c.hasScheduledCall && !visitContext ? "a ligação" : "a visita";
      return out("REAGENDAMENTO", time ? 91 : 88, `Pede outro horário para ${target}${time ? ` (${time})` : ""}.`, { preferredDay: day, preferredTime: time });
    }
    if (confirmish && faq.length) {
      return out("CONFIRMACAO", 60, "Confirma, mas também faz uma pergunta: precisa da equipe.", { ambiguous: true });
    }
    if (faq.length === 1) return out("DUVIDA_FREQUENTE", 90, `Pergunta sobre ${faq[0]}.`, { faqTopic: faq[0] });
    if (confirmish) {
      return visitContext
        ? out("CONFIRMACAO", typo ? 91 : 92, typo ? "Confirmação com erro de digitação, em resposta à visita." : "Confirmação informal da visita.")
        : out("OUTRO", 55, "Parece confirmar algo, mas não há visita aguardando resposta.");
    }
    if (WEAK_YES.test(t) && visitContext) return out("CONFIRMACAO", 78, "Resposta curta afirmativa a um pedido de confirmação: provável confirmação.");
    if (INTEREST.test(t) && c.stage === "candidato") {
      return out("INTERESSE", 90, "Candidato demonstra interesse em participar.", { preferredDay: day, preferredTime: time });
    }
    return out("OUTRO", 50, "Não há uma intenção clara: precisa da equipe.");
  }
}
