import { Download } from "lucide-react";
import { Page, PageHeader, RestrictedAccess } from "@/components/ui/misc";
import { UrlSelect } from "@/components/ui/url-filters";
import { buttonClasses } from "@/components/ui/button";
import { ROLE } from "@/domain/labels";
import { ReportsView } from "@/features/reports/reports-view";
import { can, getCurrentUser } from "@/server/auth/session";
import { parsePeriod, PERIOD_OPTIONS } from "@/server/queries/recruitment";
import { studyOptions } from "@/server/queries/studies";

export const metadata = { title: "Relatórios" };

type SP = Promise<Record<string, string | undefined>>;

export default async function ReportsPage({ searchParams }: { searchParams: SP }) {
  const user = await getCurrentUser();
  if (!can(user, "reports.view")) return <RestrictedAccess area="Relatórios" role={ROLE[user.role].label} />;
  const sp = await searchParams;
  const studies = await studyOptions(user);
  const weeks = parsePeriod(sp.periodo);
  const periodLabel = PERIOD_OPTIONS.find((p) => p.value === (sp.periodo ?? "12"))?.label ?? "Últimas 12 semanas";
  const exportHref = `/relatorios/exportar${sp.estudo ? `?estudo=${sp.estudo}` : ""}`;

  return (
    <Page>
      <PageHeader
        title="Relatórios"
        description="Indicadores operacionais consolidados automaticamente — o que hoje é montado à mão a partir de planilhas, WhatsApp e Polo Trial."
        actions={
          <a href={exportHref} className={buttonClasses("secondary", "md")}>
            <Download className="size-4" /> Exportar CSV
          </a>
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <UrlSelect param="periodo" placeholder="Últimas 12 semanas" options={PERIOD_OPTIONS.filter((p) => p.value !== "12")} />
        <UrlSelect param="estudo" placeholder="Todos os estudos" options={studies} />
      </div>
      <ReportsView user={user} studyId={sp.estudo} weeks={weeks} periodLabel={periodLabel} />
    </Page>
  );
}
