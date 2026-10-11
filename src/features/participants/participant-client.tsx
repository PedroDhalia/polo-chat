"use client";

import type { ParticipantStatus } from "@prisma/client";
import { ChevronDown, Eye, Phone, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { buttonClasses } from "@/components/ui/button";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Spinner, useActionRunner } from "@/components/ui/toast";
import { PARTICIPANT_STATUS } from "@/domain/labels";
import { cn } from "@/lib/cn";
import { changeParticipantStatusAction, logContactAction, revealPhoneAction } from "@/server/actions/participants";

/** Telefone mascarado por padrão; exibir o número completo é uma ação auditada. */
export function RevealPhone({ participantId, masked, allowed }: { participantId: string; masked: string; allowed: boolean }) {
  const { run, pending } = useActionRunner();
  const [phone, setPhone] = useState<string | null>(null);
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="font-medium text-ink tnum">{phone ?? masked}</span>
        {!phone && allowed && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => revealPhoneAction(participantId), { silent: true, onSuccess: (r) => setPhone(r.data ?? null) })}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:underline"
          >
            {pending ? <Spinner className="size-3" /> : <Eye className="size-3" />} Mostrar
          </button>
        )}
      </div>
      {phone && (
        <p className="mt-0.5 flex items-center gap-1 text-[11.5px] text-ink-3">
          <ShieldCheck className="size-3" /> Exibição registrada na auditoria
        </p>
      )}
      {!allowed && <p className="mt-0.5 text-[11.5px] text-ink-3">Seu perfil não tem acesso a dados de contato.</p>}
    </div>
  );
}

export function StatusMenu({ participantId, status, disabled }: { participantId: string; status: ParticipantStatus; disabled?: boolean }) {
  const { run, pending } = useActionRunner();
  return (
    <Menu
      align="right"
      trigger={() => (
        <button type="button" disabled={disabled} className={buttonClasses("secondary", "sm")}>
          {pending ? <Spinner /> : null} Alterar status <ChevronDown className="size-3.5" />
        </button>
      )}
    >
      {(close) =>
        (Object.keys(PARTICIPANT_STATUS) as ParticipantStatus[]).map((s) => (
          <MenuItem
            key={s}
            disabled={s === status}
            onClick={() => {
              close();
              run(() => changeParticipantStatusAction(participantId, s));
            }}
          >
            <span className={cn("size-1.5 rounded-full", s === status ? "bg-brand-500" : "bg-stone-300")} />
            {PARTICIPANT_STATUS[s].label}
          </MenuItem>
        ))
      }
    </Menu>
  );
}

export function LogContactButton({ participantId, disabled }: { participantId: string; disabled?: boolean }) {
  const { run, pending } = useActionRunner();
  const [note, setNote] = useState("");
  return (
    <Menu
      align="right"
      panelClassName="w-80 p-3"
      trigger={() => (
        <button type="button" disabled={disabled} className={buttonClasses("secondary", "sm")}>
          <Phone className="size-3.5" /> Registrar contato
        </button>
      )}
    >
      {(close) => (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => logContactAction(participantId, note), {
              onSuccess: () => {
                setNote("");
                close();
              },
            });
          }}
        >
          <label className="mb-1.5 block text-[12.5px] font-medium text-ink">Contato telefônico</label>
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Ex.: Confirmou presença; pediu para ligar após 17h."
            className="w-full resize-none rounded-lg border-0 p-2 text-[13px] ring-1 ring-line-strong ring-inset placeholder:text-ink-3 focus:ring-2 focus:ring-brand-400"
          />
          <p className="mt-1 text-[11.5px] text-ink-3">Registre apenas informações operacionais — dados clínicos pertencem ao prontuário/Polo Trial.</p>
          <div className="mt-2 flex justify-end">
            <button type="submit" disabled={pending} className={buttonClasses("primary", "xs")}>
              {pending ? <Spinner /> : null} Registrar
            </button>
          </div>
        </form>
      )}
    </Menu>
  );
}
