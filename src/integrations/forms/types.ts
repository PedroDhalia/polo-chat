// Contrato interno para entrada de interessados (Google Forms, landing pages, etc.).
// O objetivo é eliminar o recadastro manual: toda submissão é normalizada em um "lead".

import type { RecruitmentChannel } from "@prisma/client";
import type { AdapterMode } from "../types";

export interface RawSubmission {
  externalId: string;
  formName: string;
  submittedAt: Date;
  answers: Record<string, string>;
}

export interface NormalizedLead {
  externalId: string;
  fullName: string;
  phone: string;
  email: string | null;
  studyCode: string;
  channel: RecruitmentChannel;
  contactConsent: boolean;
  submittedAt: Date;
}

export interface FormsAdapter {
  readonly mode: AdapterMode;
  fetchNewSubmissions(): Promise<RawSubmission[]>;
  normalize(submission: RawSubmission): NormalizedLead;
}
