// Contrato INTERNO do Plátano Ops para dados vindos do Polo Trial.
//
// Importante: este contrato descreve o que o Plátano Ops precisa receber — ele NÃO descreve
// a API do Polo Trial, cujos recursos e endpoints ainda não foram confirmados. O adapter real
// fará o mapeamento entre a API oficial (quando documentada) e estes tipos.

import type { AdapterMode } from "../types";

export interface SourceStudy {
  externalId: string;
  code: string;
  enrolledCount: number;
  screeningCount: number;
}

export interface SourceParticipant {
  externalId: string;
  studyExternalId: string;
  displayName: string;
  status: string;
}

export interface SourceVisit {
  externalId: string;
  participantExternalId: string;
  name: string;
  scheduledAt: Date | null;
  /** Janela protocolar já calculada pelo Polo Trial. O Plátano Ops apenas exibe. */
  windowStart: Date | null;
  windowEnd: Date | null;
}

export interface SourceRecruitmentSnapshot {
  studyExternalId: string;
  enrolledCount: number;
  screeningCount: number;
  capturedAt: Date;
}

export interface PoloTrialAdapter {
  readonly mode: AdapterMode;
  getStudies(): Promise<SourceStudy[]>;
  getParticipants(studyExternalId: string): Promise<SourceParticipant[]>;
  getVisits(studyExternalId: string, range: { from: Date; to: Date }): Promise<SourceVisit[]>;
  /** Escrita de volta na fonte — exigirá aprovação explícita e escopo definido. */
  updateParticipant(externalId: string, patch: { status?: string; note?: string }): Promise<void>;
  getRecruitmentData(studyExternalId: string): Promise<SourceRecruitmentSnapshot>;
}
