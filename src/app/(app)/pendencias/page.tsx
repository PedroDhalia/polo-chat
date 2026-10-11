import { CircleCheck, ClipboardList } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState, Page, PageHeader, RestrictedAccess } from "@/components/ui/misc";
import { FilterChips, hrefWith } from "@/components/ui/nav";
import { StatTile } from "@/components/ui/stat-tile";
import { UrlSearch, UrlSelect } from "@/components/ui/url-filters";
import { ROLE } from "@/domain/labels";
import { NewTaskButton } from "@/features/tasks/new-task-button";
import { TaskList } from "@/features/tasks/task-list";
import { addDays, toDateParam } from "@/lib/dates";
import { can, getCurrentUser } from "@/server/auth/session";
import { listTasks, taskFormOptions, taskSummary, type TaskFilter } from "@/server/queries/tasks";
import { studyOptions } from "@/server/queries/studies";

export const metadata = { title: "Pendências" };

type SP = Promise<Record<string, string | undefined>>;
const FILTERS: TaskFilter[] = ["todas", "minhas", "atrasadas", "hoje", "alta"];

export default async function TasksPage({ searchParams }: { searchParams: SP }) {
  const user = await getCurrentUser();
  if (!can(user, "tasks.view")) return <RestrictedAccess area="Pendências" role={ROLE[user.role].label} />;
  const sp = await searchParams;
  const filter = FILTERS.includes(sp.filtro as TaskFilter) ? (sp.filtro as TaskFilter) : "todas";
  const done = sp.situacao === "concluidas";
  const now = new Date();
  const canManage = can(user, "tasks.manage");
  const [tasks, summary, studies, formOptions] = await Promise.all([
    listTasks(user, { filter, studyId: sp.estudo, done, q: sp.q }, now),
    taskSummary(user, now),
    studyOptions(user),
    canManage ? taskFormOptions(user) : null,
  ]);
  const current = { filtro: sp.filtro, estudo: sp.estudo, situacao: sp.situacao, q: sp.q };
  const chip = (f: TaskFilter) => hrefWith("/pendencias", current, { filtro: f === "todas" ? null : f });

  return (
    <Page>
      <PageHeader
        title="Pendências"
        description="O que a equipe precisa fazer agora. Pendências nascem de automações, do Polo Trial, da comunicação, de formulários ou da própria equipe."
        actions={formOptions && <NewTaskButton options={formOptions} defaultAssignee={user.id} defaultDate={toDateParam(addDays(now, 1))} />}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Atrasadas" value={summary.overdue} sub="Prazo vencido" subTone={summary.overdue > 0 ? "red" : undefined} href={chip("atrasadas")} />
        <StatTile label="Vencem hoje" value={summary.dueToday} sub="Até o fim do dia" subTone={summary.dueToday > 0 ? "amber" : undefined} href={chip("hoje")} />
        <StatTile label="Alta prioridade" value={summary.high} sub="Abertas" href={chip("alta")} />
        <StatTile label="Abertas" value={summary.open} sub={`${summary.done7d} concluídas nos últimos 7 dias`} href={chip("todas")} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterChips
          items={[
            { label: "Todas", href: chip("todas"), active: filter === "todas", count: summary.open },
            { label: "Minhas pendências", href: chip("minhas"), active: filter === "minhas", count: summary.mine },
            { label: "Atrasadas", href: chip("atrasadas"), active: filter === "atrasadas", count: summary.overdue, tone: "alert" },
            { label: "Hoje", href: chip("hoje"), active: filter === "hoje", count: summary.dueToday },
            { label: "Alta prioridade", href: chip("alta"), active: filter === "alta", count: summary.high, tone: "alert" },
          ]}
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <UrlSearch placeholder="Buscar pendência ou participante" className="w-64" />
          <UrlSelect param="estudo" placeholder="Todos os estudos" options={studies} />
          <UrlSelect param="situacao" placeholder="Abertas" options={[{ value: "concluidas", label: "Concluídas" }]} />
        </div>
      </div>

      <Card className="overflow-hidden">
        {tasks.length === 0 ? (
          <EmptyState icon={done ? <ClipboardList className="size-5" /> : <CircleCheck className="size-5" />} title={done ? "Nenhuma pendência concluída" : "Nada pendente aqui"} description="Ajuste os filtros para ver outras pendências." />
        ) : (
          <TaskList tasks={tasks} canManage={canManage} grouped={!done} now={now} />
        )}
      </Card>
    </Page>
  );
}
