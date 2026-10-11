import type { ParticipantStatus, RecruitmentChannel } from "@prisma/client";
import { Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState, Page, PageHeader, RestrictedAccess } from "@/components/ui/misc";
import { FilterChips, hrefWith } from "@/components/ui/nav";
import { UrlSearch, UrlSelect } from "@/components/ui/url-filters";
import { CHANNEL, PARTICIPANT_STATUS, ROLE } from "@/domain/labels";
import { Pagination, ParticipantsTable } from "@/features/participants/participants-table";
import { can, getCurrentUser } from "@/server/auth/session";
import { listParticipants, ownerOptions, PAGE_SIZE } from "@/server/queries/participants";
import { studyOptions } from "@/server/queries/studies";

export const metadata = { title: "Participantes" };

type SP = Promise<Record<string, string | undefined>>;

export default async function ParticipantsPage({ searchParams }: { searchParams: SP }) {
  const user = await getCurrentUser();
  if (!can(user, "participants.view")) return <RestrictedAccess area="Participantes" role={ROLE[user.role].label} />;
  const sp = await searchParams;
  const status = sp.status && sp.status in PARTICIPANT_STATUS ? (sp.status as ParticipantStatus) : undefined;
  const channel = sp.origem && sp.origem in CHANNEL ? (sp.origem as RecruitmentChannel) : undefined;
  const page = Number(sp.pagina) || 1;
  const [data, studies, owners] = await Promise.all([
    listParticipants(user, { q: sp.q, studyId: sp.estudo, status, channel, ownerId: sp.responsavel, acao: sp.acao, page }),
    studyOptions(user),
    ownerOptions(user),
  ]);
  const current = { ...sp, pagina: undefined };

  return (
    <Page>
      <PageHeader
        title="Participantes"
        description="Ficha operacional de cada participante: em que etapa está, o último contato e o que precisa ser feito. Dados clínicos permanecem no Polo Trial."
      />
      <FilterChips
        className="mb-3"
        items={[
          { label: "Todos", href: hrefWith("/participantes", current, { acao: null, status: null }), active: !sp.acao && !sp.status },
          { label: "Contato hoje", href: hrefWith("/participantes", current, { acao: "hoje", status: null }), active: sp.acao === "hoje" },
          { label: "Aguardando agendamento", href: hrefWith("/participantes", current, { status: "AGUARDANDO_AGENDAMENTO", acao: null }), active: sp.status === "AGUARDANDO_AGENDAMENTO" },
          { label: "Agendados", href: hrefWith("/participantes", current, { status: "AGENDADO", acao: null }), active: sp.status === "AGENDADO" },
          { label: "Incluídos", href: hrefWith("/participantes", current, { status: "INCLUIDO", acao: null }), active: sp.status === "INCLUIDO" },
        ]}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <UrlSearch placeholder="Nome ou código (PLT-…)" className="w-72" />
        <UrlSelect param="estudo" placeholder="Todos os estudos" options={studies} />
        <UrlSelect param="status" placeholder="Todos os status" options={Object.entries(PARTICIPANT_STATUS).map(([value, s]) => ({ value, label: s.label }))} />
        <UrlSelect param="origem" placeholder="Todas as origens" options={Object.entries(CHANNEL).map(([value, c]) => ({ value, label: c.label }))} />
        <UrlSelect param="responsavel" placeholder="Todos os responsáveis" options={owners} />
      </div>
      <Card className="overflow-hidden">
        {data.rows.length === 0 ? (
          <EmptyState icon={<Users className="size-5" />} title="Nenhum participante encontrado" description="Ajuste a busca ou os filtros." />
        ) : (
          <>
            <ParticipantsTable rows={data.rows} />
            <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={PAGE_SIZE} hrefFor={(p) => hrefWith("/participantes", current, { pagina: String(p) })} />
          </>
        )}
      </Card>
      <p className="mt-3 text-[12px] text-ink-3">Todos os nomes e telefones são fictícios. Telefones ficam ocultos na listagem e só são exibidos na ficha, com registro em auditoria.</p>
    </Page>
  );
}
