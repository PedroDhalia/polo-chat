import type { TaskSource } from "@prisma/client";
import { Database, FileInput, Hand, MessagesSquare, Wallet, Workflow } from "lucide-react";
import Link from "@/components/ui/link";
import { StatusBadge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/misc";
import { TASK_PRIORITY, TASK_SOURCE } from "@/domain/labels";
import { addDays, formatAgo, formatRelativeDateTime, startOfDay } from "@/lib/dates";
import { cn } from "@/lib/cn";
import type { TaskRow } from "@/server/queries/tasks";
import { TaskCheck } from "./task-check";

const SOURCE_STYLE: Record<TaskSource, { icon: React.ReactNode; cls: string }> = {
  AUTOMACAO: { icon: <Workflow />, cls: "bg-violet-50 text-violet-700 ring-violet-200" },
  POLO_TRIAL: { icon: <Database />, cls: "bg-sky-50 text-sky-700 ring-sky-200" },
  COMUNICACAO: { icon: <MessagesSquare />, cls: "bg-brand-50 text-brand-700 ring-brand-200" },
  FORMULARIO: { icon: <FileInput />, cls: "bg-teal-50 text-teal-700 ring-teal-200" },
  FINANCEIRO: { icon: <Wallet />, cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  MANUAL: { icon: <Hand />, cls: "bg-stone-100 text-ink-2 ring-stone-200" },
};

export function SourceBadge({ source }: { source: TaskSource }) {
  const s = SOURCE_STYLE[source];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium whitespace-nowrap ring-1 ring-inset [&_svg]:size-3", s.cls)}>
      {s.icon}
      {TASK_SOURCE[source]}
    </span>
  );
}

function bucket(due: Date, now: Date): string {
  const today = startOfDay(now);
  if (due < now) return "Atrasadas";
  if (due < addDays(today, 1)) return "Hoje";
  if (due < addDays(today, 2)) return "Amanhã";
  return "Próximos dias";
}

export function TaskList({ tasks, canManage, grouped = true, now = new Date(), showStudy = true }: { tasks: TaskRow[]; canManage: boolean; grouped?: boolean; now?: Date; showStudy?: boolean }) {
  const groups = new Map<string, TaskRow[]>();
  for (const t of tasks) {
    const key = grouped && t.status !== "CONCLUIDA" ? bucket(t.dueAt, now) : "";
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return (
    <div>
      {[...groups.entries()].map(([label, items]) => (
        <section key={label || "all"}>
          {label && (
            <div className={cn("flex items-center gap-2 border-b border-line bg-subtle px-5 py-2 text-[11.5px] font-semibold tracking-wide uppercase", label === "Atrasadas" ? "text-red-700" : "text-ink-3")}>
              {label} <span className="font-medium tnum">{items.length}</span>
            </div>
          )}
          <ul>
            {items.map((t) => {
              const done = t.status === "CONCLUIDA";
              const late = !done && t.dueAt < now;
              return (
                <li key={t.id} className={cn("grid grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-3 border-b border-line px-5 py-3 last:border-0 hover:bg-subtle/60", done && "opacity-70")}>
                  <span className="pt-0.5">
                    <TaskCheck taskId={t.id} done={done} disabled={!canManage} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("text-[13.5px] font-medium text-ink", done && "line-through decoration-ink-3")}>{t.title}</span>
                      <StatusBadge map={TASK_PRIORITY} value={t.priority} />
                      <SourceBadge source={t.source} />
                    </div>
                    {t.description && <p className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-2">{t.description}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-3">
                      {t.participant && (
                        <Link href={`/participantes/${t.participant.id}`} className="font-medium text-ink-2 hover:text-brand-700">
                          {t.participant.fullName}
                        </Link>
                      )}
                      {showStudy && t.study && <span>{t.study.code}</span>}
                      <span>· criada {formatAgo(t.createdAt, now)}</span>
                      {done && t.completedAt && <span>· concluída {formatAgo(t.completedAt, now)}{t.completedBy ? ` por ${t.completedBy.name}` : " automaticamente"}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 pt-0.5">
                    <div className="text-right">
                      <div className={cn("text-[12.5px] whitespace-nowrap tnum", late ? "font-semibold text-red-600" : "text-ink-2")}>{formatRelativeDateTime(t.dueAt, now)}</div>
                      <div className="text-[11px] text-ink-3">{late ? "atrasada" : "prazo"}</div>
                    </div>
                    {t.assignee ? (
                      <span className="flex w-28 items-center gap-1.5 text-[12.5px] text-ink-2">
                        <Avatar name={t.assignee.name} size="xs" />
                        <span className="truncate">{t.assignee.name.replace(/^Dra?\.\s/, "").split(" ")[0]}</span>
                      </span>
                    ) : (
                      <span className="w-28 text-[12.5px] text-ink-3">Sem responsável</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
