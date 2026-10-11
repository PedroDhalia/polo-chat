"use client";

import type { VisitStatus } from "@prisma/client";
import { CalendarClock, CalendarX, Check, CheckCheck, Ellipsis, RotateCcw } from "lucide-react";
import { useState } from "react";
import { buttonClasses } from "@/components/ui/button";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Spinner, useActionRunner } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { rescheduleVisitAction, setVisitStatusAction } from "@/server/actions/visits";

/** Ações rápidas de uma visita (confirmar, realizar, falta, remarcar). Cada ação dispara as automações correspondentes. */
export function VisitActions({ visitId, status, compact = false, defaultDate }: { visitId: string; status: VisitStatus; compact?: boolean; defaultDate?: string }) {
  const { run, pending } = useActionRunner();
  const [rescheduling, setRescheduling] = useState(false);
  const [date, setDate] = useState(defaultDate ?? "");
  const [time, setTime] = useState("09:00");
  const set = (s: VisitStatus) => run(() => setVisitStatusAction(visitId, s));
  const active = status === "AGUARDANDO_CONFIRMACAO" || status === "CONFIRMADO" || status === "REAGENDAMENTO_SOLICITADO";

  if (rescheduling) {
    return (
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => rescheduleVisitAction(visitId, date, time), { onSuccess: () => setRescheduling(false) });
        }}
      >
        <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="h-7 rounded-md border-0 px-1.5 text-[12px] ring-1 ring-line-strong ring-inset" />
        <input type="time" required value={time} step={900} onChange={(e) => setTime(e.target.value)} className="h-7 rounded-md border-0 px-1.5 text-[12px] ring-1 ring-line-strong ring-inset" />
        <button type="submit" disabled={pending} className={buttonClasses("primary", "xs")}>
          {pending ? <Spinner /> : "Salvar"}
        </button>
        <button type="button" onClick={() => setRescheduling(false)} className={buttonClasses("ghost", "xs")}>
          Cancelar
        </button>
      </form>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {status === "AGUARDANDO_CONFIRMACAO" && !compact && (
        <button type="button" disabled={pending} onClick={() => set("CONFIRMADO")} className={buttonClasses("subtle", "xs")}>
          {pending ? <Spinner /> : <Check className="size-3.5" />} Confirmar
        </button>
      )}
      {status === "FALTOU" && !compact && (
        <button type="button" onClick={() => setRescheduling(true)} className={buttonClasses("secondary", "xs")}>
          <CalendarClock className="size-3.5" /> Reagendar
        </button>
      )}
      {(active || status === "FALTOU") && (
        <Menu
          align="right"
          trigger={(open) => (
            <button type="button" aria-label="Mais ações" className={cn(buttonClasses("ghost", "xs"), "px-1.5", open && "bg-stone-100")}>
              {pending ? <Spinner /> : <Ellipsis className="size-4" />}
            </button>
          )}
        >
          {(close) => (
            <>
              {status !== "CONFIRMADO" && status !== "FALTOU" && (
                <MenuItem onClick={() => { close(); set("CONFIRMADO"); }}>
                  <Check className="size-3.5 text-brand-600" /> Confirmar presença
                </MenuItem>
              )}
              {active && (
                <MenuItem onClick={() => { close(); set("REALIZADO"); }}>
                  <CheckCheck className="size-3.5 text-emerald-600" /> Marcar como realizada
                </MenuItem>
              )}
              {active && (
                <MenuItem onClick={() => { close(); set("FALTOU"); }}>
                  <CalendarX className="size-3.5 text-red-600" /> Registrar falta
                </MenuItem>
              )}
              {status !== "REAGENDAMENTO_SOLICITADO" && status !== "FALTOU" && (
                <MenuItem onClick={() => { close(); set("REAGENDAMENTO_SOLICITADO"); }}>
                  <RotateCcw className="size-3.5 text-violet-600" /> Participante pediu remarcação
                </MenuItem>
              )}
              <MenuItem onClick={() => { close(); setRescheduling(true); }}>
                <CalendarClock className="size-3.5 text-ink-3" /> Reagendar para nova data…
              </MenuItem>
              <p className="border-t border-line px-2.5 pt-1.5 pb-1 text-[11px] leading-snug text-ink-3">As automações correspondentes são executadas após cada ação.</p>
            </>
          )}
        </Menu>
      )}
    </div>
  );
}
