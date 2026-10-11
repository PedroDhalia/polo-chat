import Link from "@/components/ui/link";
import { StatusBadge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/misc";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import type { VisitStatus } from "@prisma/client";
import { CHANNEL, PARTICIPANT_STATUS } from "@/domain/labels";
import { formatAgo, formatRelativeDateTime, formatRelativeDay, formatTime } from "@/lib/dates";
import { cn } from "@/lib/cn";
import type { ParticipantRow } from "@/server/queries/participants";

const SHORT_VISIT_STATUS: Record<VisitStatus, string> = {
  AGUARDANDO_CONFIRMACAO: "Aguardando",
  CONFIRMADO: "Confirmada",
  REAGENDAMENTO_SOLICITADO: "Remarcação",
  REALIZADO: "Realizada",
  FALTOU: "Faltou",
  CANCELADO: "Cancelada",
};

export function ParticipantsTable({ rows, showStudy = true, now = new Date() }: { rows: ParticipantRow[]; showStudy?: boolean; now?: Date }) {
  return (
    <Table>
      <THead>
        <Th>Nome</Th>
        {showStudy && <Th>Estudo</Th>}
        <Th>Status</Th>
        <Th>Origem</Th>
        <Th>Último contato</Th>
        <Th>Próxima ação</Th>
        <Th>Próxima visita</Th>
        <Th>Responsável</Th>
      </THead>
      <tbody>
        {rows.map((p) => {
          const visit = p.visits[0];
          const overdue = p.nextActionDueAt && p.nextActionDueAt < now;
          return (
            <Tr key={p.id}>
              <Td>
                <Link href={`/participantes/${p.id}`} className="whitespace-nowrap font-medium text-ink hover:text-brand-700">
                  {p.fullName}
                </Link>
                <div className="text-[11.5px] text-ink-3 tnum">{p.code}</div>
              </Td>
              {showStudy && <Td className="whitespace-nowrap font-medium text-ink-2">{p.study.code}</Td>}
              <Td>
                <StatusBadge map={PARTICIPANT_STATUS} value={p.status} />
              </Td>
              <Td className="whitespace-nowrap text-ink-2">{CHANNEL[p.channel].short}</Td>
              <Td className="whitespace-nowrap text-ink-2 tnum">{p.lastContactAt ? formatAgo(p.lastContactAt, now) : <span className="text-ink-3">—</span>}</Td>
              <Td className="max-w-[240px]">
                {p.nextAction ? (
                  <>
                    <div className="truncate text-ink">{p.nextAction}</div>
                    {p.nextActionDueAt && <div className={cn("text-[11.5px] tnum", overdue ? "font-medium text-red-600" : "text-ink-3")}>{overdue ? "Vencida · " : ""}{formatRelativeDateTime(p.nextActionDueAt, now)}</div>}
                  </>
                ) : (
                  <span className="text-ink-3">—</span>
                )}
              </Td>
              <Td>
                {visit ? (
                  <>
                    <div className="whitespace-nowrap text-ink-2 tnum">
                      {formatRelativeDay(visit.scheduledAt, now)} {formatTime(visit.scheduledAt)}
                    </div>
                    <div className={cn("text-[11.5px] whitespace-nowrap", visit.status === "AGUARDANDO_CONFIRMACAO" ? "text-amber-700" : "text-ink-3")}>
                      {visit.name} · {SHORT_VISIT_STATUS[visit.status]}
                    </div>
                  </>
                ) : (
                  <span className="text-ink-3">—</span>
                )}
              </Td>
              <Td>
                {p.owner ? (
                  <span className="flex items-center gap-2 whitespace-nowrap text-ink-2">
                    <Avatar name={p.owner.name} size="xs" /> {p.owner.name.split(" ")[0]}
                  </span>
                ) : (
                  "—"
                )}
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}

export function Pagination({ page, pages, total, pageSize, hrefFor }: { page: number; pages: number; total: number; pageSize: number; hrefFor: (p: number) => string }) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[12.5px] text-ink-3">
      <span className="tnum">
        {from}–{to} de {total}
      </span>
      <div className="flex gap-1">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} scroll={false} className="rounded-md px-2.5 py-1 font-medium text-ink-2 ring-1 ring-line-strong hover:bg-subtle">
            Anterior
          </Link>
        ) : null}
        {page < pages ? (
          <Link href={hrefFor(page + 1)} scroll={false} className="rounded-md px-2.5 py-1 font-medium text-ink-2 ring-1 ring-line-strong hover:bg-subtle">
            Próxima
          </Link>
        ) : null}
      </div>
    </div>
  );
}
