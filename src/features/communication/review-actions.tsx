"use client";

import { Check, ThumbsDown, ThumbsUp } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Spinner, useActionRunner } from "@/components/ui/toast";
import { approveLabel, isActionable } from "@/domain/assist-policy";
import { cn } from "@/lib/cn";
import { approveAssistDecisionAction, dismissAssistDecisionAction, reviewAutoDecisionAction } from "@/server/actions/assist";

export function PendingActions({ decisionId, intent, action, canSend }: { decisionId: string; intent: string; action?: string | null; canSend: boolean }) {
  const { run, pending } = useActionRunner();
  if (!canSend) return <span className="text-[12px] text-ink-3">Somente leitura</span>;
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {isActionable(intent) && (
        <button type="button" disabled={pending} onClick={() => run(() => approveAssistDecisionAction(decisionId))} className={buttonClasses(intent === "DESCADASTRO" ? "danger" : "primary", "xs")}>
          {pending ? <Spinner /> : <Check className="size-3.5" />} {approveLabel(intent, action)}
        </button>
      )}
      <button type="button" disabled={pending} onClick={() => run(() => dismissAssistDecisionAction(decisionId))} className={buttonClasses("ghost", "xs")}>
        Tratar manualmente
      </button>
    </div>
  );
}

export function VerdictActions({ decisionId, verdict, reviewer, canReview }: { decisionId: string; verdict: "CORRETA" | "INCORRETA" | null; reviewer: string | null; canReview: boolean }) {
  const { run, pending } = useActionRunner();
  if (verdict) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-[12px] font-medium whitespace-nowrap", verdict === "CORRETA" ? "text-emerald-700" : "text-red-700")}>
        {verdict === "CORRETA" ? <ThumbsUp className="size-3" /> : <ThumbsDown className="size-3" />}
        {verdict === "CORRETA" ? "Correta" : "Incorreta"}
        {reviewer && <span className="font-normal text-ink-3">· {reviewer.split(" ")[0]}</span>}
      </span>
    );
  }
  if (!canReview) return <span className="text-[12px] text-ink-3">Não revisada</span>;
  return (
    <div className="flex justify-end gap-1.5">
      <button type="button" disabled={pending} onClick={() => run(() => reviewAutoDecisionAction(decisionId, "CORRETA"))} className={buttonClasses("secondary", "xs")}>
        <ThumbsUp className="size-3" /> Correta
      </button>
      <button type="button" disabled={pending} onClick={() => run(() => reviewAutoDecisionAction(decisionId, "INCORRETA"))} className={buttonClasses("danger", "xs")}>
        <ThumbsDown className="size-3" /> Incorreta
      </button>
    </div>
  );
}
