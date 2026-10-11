import Link from "@/components/ui/link";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Avatar, SourceTag } from "@/components/ui/misc";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { VISIT_CATEGORY, VISIT_STATUS } from "@/domain/labels";
import { RESCHEDULE_LIMIT } from "@/domain/rules";
import { addDays, formatDayMonth, formatRelativeDay, formatTime, toDateParam } from "@/lib/dates";
import { cn } from "@/lib/cn";
import type { AgendaVisit } from "@/server/queries/agenda";
import { VisitActions } from "./visit-actions";

/** Lista de visitas com ações rápidas. A janela é exibida como veio do Polo Trial. */
export function VisitTable({ visits, canManage, showDate = false, now = new Date() }: { visits: AgendaVisit[]; canManage: boolean; showDate?: boolean; now?: Date }) {
  return (
    <Table>
      <THead>
        <Th>{showDate ? "Data" : "Horário"}</Th>
        <Th>Participante</Th>
        <Th>Estudo</Th>
        <Th>Tipo de visita</Th>
        <Th>Responsável</Th>
        <Th>Status</Th>
        <Th>Janela · Polo Trial</Th>
        {canManage && <Th className="text-right">Ações</Th>}
      </THead>
      <tbody>
        {visits.map((v) => {
          const past = v.scheduledAt < now && (v.status === "CONFIRMADO" || v.status === "AGUARDANDO_CONFIRMACAO");
          return (
            <Tr key={v.id}>
              <Td className="whitespace-nowrap">
                <div className="font-semibold text-ink tnum">{showDate ? formatRelativeDay(v.scheduledAt, now) : formatTime(v.scheduledAt)}</div>
                <div className="text-[11.5px] text-ink-3 tnum">{showDate ? formatTime(v.scheduledAt) : `${v.durationMin} min`}</div>
              </Td>
              <Td>
                <Link href={`/participantes/${v.participant.id}`} className="font-medium whitespace-nowrap text-ink hover:text-brand-700">
                  {v.participant.fullName}
                </Link>
                <div className="text-[11.5px] text-ink-3 tnum">{v.participant.code}</div>
              </Td>
              <Td className="font-medium whitespace-nowrap text-ink-2">{v.study.code}</Td>
              <Td>
                <div className="whitespace-nowrap text-ink">{v.name}</div>
                <div className="text-[11.5px] text-ink-3">
                  {VISIT_CATEGORY[v.category]} · {v.room}
                </div>
              </Td>
              <Td>
                {v.staff ? (
                  <span className="flex items-center gap-2 whitespace-nowrap text-ink-2">
                    <Avatar name={v.staff.name} size="xs" /> {v.staff.name.split(" ")[0]}
                  </span>
                ) : (
                  "—"
                )}
              </Td>
              <Td>
                <div className="flex flex-col items-start gap-1">
                  <StatusBadge map={VISIT_STATUS} value={v.status} />
                  {v.rescheduleCount > 0 && (
                    <Badge tone={v.rescheduleCount >= RESCHEDULE_LIMIT - 1 ? "amber" : "neutral"}>
                      {v.rescheduleCount}/{RESCHEDULE_LIMIT} remarcações
                    </Badge>
                  )}
                  {past && <span className="text-[11px] text-ink-3">Aguardando registro</span>}
                  {v.proposedAt && (
                    <span className="text-[11px] font-medium whitespace-nowrap text-amber-700">
                      Nova data proposta: {formatDayMonth(v.proposedAt)} {formatTime(v.proposedAt)}
                    </span>
                  )}
                </div>
              </Td>
              <Td className={cn("whitespace-nowrap text-ink-2 tnum")}>
                {v.windowStart && v.windowEnd ? (
                  <SourceTag kind="polo">
                    {formatDayMonth(v.windowStart)} – {formatDayMonth(v.windowEnd)}
                  </SourceTag>
                ) : (
                  <span className="text-ink-3">—</span>
                )}
              </Td>
              {canManage && (
                <Td className="text-right">
                  <VisitActions visitId={v.id} status={v.status} defaultDate={toDateParam(addDays(now, 1))} />
                </Td>
              )}
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}
