import type { ReimbursementStatus } from "@prisma/client";
import { Page, PageHeader, RestrictedAccess } from "@/components/ui/misc";
import { UrlSelect } from "@/components/ui/url-filters";
import { REIMBURSEMENT_STATUS, ROLE } from "@/domain/labels";
import { FinanceView } from "@/features/finance/finance-view";
import { can, getCurrentUser } from "@/server/auth/session";
import { studyOptions } from "@/server/queries/studies";

export const metadata = { title: "Financeiro" };

type SP = Promise<Record<string, string | undefined>>;

export default async function FinancePage({ searchParams }: { searchParams: SP }) {
  const user = await getCurrentUser();
  if (!can(user, "finance.view")) return <RestrictedAccess area="Financeiro" role={ROLE[user.role].label} />;
  const sp = await searchParams;
  const status = sp.status && sp.status in REIMBURSEMENT_STATUS ? (sp.status as ReimbursementStatus) : undefined;
  const studies = await studyOptions(user);

  return (
    <Page>
      <PageHeader
        title="Financeiro"
        description="Visão simplificada: orçamento × executado por estudo, visitas pagas e reembolsos a participantes. Sem integração financeira real — valores fictícios."
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <UrlSelect param="estudo" placeholder="Todos os estudos" options={studies} />
        <UrlSelect param="status" placeholder="Todos os reembolsos" options={Object.entries(REIMBURSEMENT_STATUS).map(([value, s]) => ({ value, label: s.label }))} />
      </div>
      <FinanceView user={user} studyId={sp.estudo} status={status} />
    </Page>
  );
}
