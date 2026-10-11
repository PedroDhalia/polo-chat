import type { RecruitmentChannel } from "@prisma/client";
import type { FormsAdapter, NormalizedLead, RawSubmission } from "./types";

// Gera submissões fictícias para demonstrar a entrada automática de interessados.
const FIRST = ["Aline", "Bruno", "Cíntia", "Davi", "Elaine", "Fábio", "Gisele", "Heitor", "Ingrid", "Jonas"];
const LAST = ["Prado", "Meireles", "Quintana", "Sales", "Toledo", "Valente", "Bastos", "Coelho"];
const SOURCES: { form: string; study: string; channel: RecruitmentChannel }[] = [
  { form: "Landing Page — VAC-2026", study: "VAC-2026", channel: "LANDING_PAGE" },
  { form: "Formulário Instagram — AUTO-2026", study: "AUTO-2026", channel: "INSTAGRAM" },
  { form: "Formulário de interesse — DERM-2026", study: "DERM-2026", channel: "FACEBOOK" },
];

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

export class MockFormsAdapter implements FormsAdapter {
  readonly mode = "mock" as const;

  async fetchNewSubmissions(): Promise<RawSubmission[]> {
    const src = pick(SOURCES);
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const suffix = String(Math.floor(Math.random() * 9000) + 1000);
    return [
      {
        externalId: `sim-form-${Date.now().toString(36)}`,
        formName: src.form,
        submittedAt: new Date(),
        answers: {
          nome: name,
          telefone: `(11) 95555-${suffix}`,
          email: `${name.split(" ")[0].toLowerCase()}.${suffix}@exemplo.com`,
          estudo: src.study,
          canal: src.channel,
          aceite_contato: "sim",
        },
      },
    ];
  }

  normalize(s: RawSubmission): NormalizedLead {
    return {
      externalId: s.externalId,
      fullName: s.answers.nome,
      phone: s.answers.telefone,
      email: s.answers.email || null,
      studyCode: s.answers.estudo,
      channel: s.answers.canal as RecruitmentChannel,
      contactConsent: s.answers.aceite_contato === "sim",
      submittedAt: s.submittedAt,
    };
  }
}
