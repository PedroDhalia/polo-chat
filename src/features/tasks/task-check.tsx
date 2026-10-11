"use client";

import { Check } from "lucide-react";
import { Spinner, useActionRunner } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { completeTaskAction, reopenTaskAction } from "@/server/actions/tasks";

/** Caixa de seleção para concluir/reabrir uma pendência. */
export function TaskCheck({ taskId, done, disabled }: { taskId: string; done: boolean; disabled?: boolean }) {
  const { run, pending } = useActionRunner();
  return (
    <button
      type="button"
      disabled={disabled || pending}
      title={disabled ? "Seu perfil não pode alterar pendências" : done ? "Reabrir pendência" : "Concluir pendência"}
      onClick={() => run(() => (done ? reopenTaskAction(taskId) : completeTaskAction(taskId)))}
      className={cn(
        "flex size-[18px] shrink-0 items-center justify-center rounded-[5px] ring-1 ring-inset transition-colors disabled:cursor-not-allowed",
        done ? "bg-brand-600 text-white ring-brand-600" : "bg-surface ring-line-strong hover:ring-brand-500",
      )}
    >
      {pending ? <Spinner className="size-2.5 text-ink-3" /> : done ? <Check className="size-3" strokeWidth={3} /> : null}
    </button>
  );
}
