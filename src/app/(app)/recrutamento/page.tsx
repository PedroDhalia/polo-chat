import type { ParticipantStatus, RecruitmentChannel } from "@prisma/client";
import { FileInput } from "lucide-react";
import { ActionButton } from "@/components/ui/action-button";
import { Page, PageHeader, RestrictedAccess } from "@/components/ui/misc";
import { UrlSelect } from "@/components/ui/url-filters";
import { CHANNEL, PARTICIPANT_STATUS, PIPELINE_STATUSES, ROLE } from "@/domain/labels";
import { RecruitmentView } from "@/features/recruitment/recruitment-view";
import { simulateFormSubmissionAction } from "@/server/actions/participants";
import { can, getCurrentUser } from "@/server/auth/session";
import { parsePeriod, PERIOD_OPTIONS } from "@/server/queries/recruitment";
import { studyOptions } from "@/server/queries/studies";

export const metadata = { title: "Recrutamento" };

type SP = Promise<Record<string, string | undefined>>;

export default async function RecruitmentPage({ searchParams }: { searchParams: SP }) {
  const user = await getCurrentUser();
  if (!can(user, "participants.view")) return <RestrictedAccess area="Recrutamento" role={ROLE[user.role].label} />;
  const sp = await searchParams;
  const studies = await studyOptions(user);
  const channel = sp.canal && sp.canal in CHANNEL ? (sp.canal as RecruitmentChannel) : undefined;
  const status = sp.status && PIPELINE_STATUSES.includes(sp.status as ParticipantStatus) ? (sp.status as ParticipantStatus) : undefined;
  const weeks = parsePeriod(sp.periodo);
  const periodLabel = PERIOD_OPTIONS.find((p) => p.value === (sp.periodo ?? "12"))?.label ?? "Últimas 12 semanas";

  return (
    <Page>
      <PageHeader
        title="Recrutamento"
        description="Do banco de voluntários à inclusão: onde os candidatos estão, quais canais funcionam e quem precisa de contato."
        actions={
          can(user, "participants.edit") && (
            <ActionButton action={simulateFormSubmissionAction} icon={<FileInput className="size-4" />} variant="secondary" size="md">
              Simular formulário recebido
            </ActionButton>
          )
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <UrlSelect param="periodo" placeholder="Últimas 12 semanas" options={PERIOD_OPTIONS.filter((p) => p.value !== "12")} />
        <UrlSelect param="estudo" placeholder="Todos os estudos" options={studies} />
        <UrlSelect param="canal" placeholder="Todos os canais" options={Object.entries(CHANNEL).map(([value, c]) => ({ value, label: c.label }))} />
        <UrlSelect param="status" placeholder="Todos os status do pipeline" options={PIPELINE_STATUSES.map((s) => ({ value: s, label: PARTICIPANT_STATUS[s].label }))} />
      </div>
      <RecruitmentView user={user} studyId={sp.estudo} channel={channel} weeks={weeks} status={status} periodLabel={periodLabel} />
    </Page>
  );
}
