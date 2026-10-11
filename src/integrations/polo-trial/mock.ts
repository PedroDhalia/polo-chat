import "server-only";
import { db } from "@/server/db";
import type { PoloTrialAdapter, SourceStudy } from "./types";

// Adapter simulado: responde com o snapshot já armazenado localmente, como se a fonte
// confirmasse os mesmos números. Permite exercitar o fluxo de sincronização sem API real.

async function studyRefs() {
  const refs = await db.externalReference.findMany({ where: { system: "POLO_TRIAL", entityType: "Study" } });
  return new Map(refs.map((r) => [r.entityId, r.externalId]));
}

export class MockPoloTrialAdapter implements PoloTrialAdapter {
  readonly mode = "mock" as const;

  async getStudies(): Promise<SourceStudy[]> {
    const [studies, refs] = await Promise.all([db.study.findMany(), studyRefs()]);
    return studies.map((s) => ({
      externalId: refs.get(s.id) ?? `mock-${s.code}`,
      code: s.code,
      enrolledCount: s.enrolledCount,
      screeningCount: s.screeningCount,
    }));
  }

  async getParticipants() {
    return [];
  }

  async getVisits() {
    return [];
  }

  async updateParticipant() {
    // Simulado: nenhuma escrita é feita na fonte.
  }

  async getRecruitmentData(studyExternalId: string) {
    const studies = await this.getStudies();
    const s = studies.find((x) => x.externalId === studyExternalId);
    return {
      studyExternalId,
      enrolledCount: s?.enrolledCount ?? 0,
      screeningCount: s?.screeningCount ?? 0,
      capturedAt: new Date(),
    };
  }
}
