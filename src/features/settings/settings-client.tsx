"use client";

import { RotateCcw } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Spinner, useActionRunner } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { resetDemoDataAction, toggleAutomationRuleAction } from "@/server/actions/admin";

export function AutomationToggle({ ruleId, enabled, disabled }: { ruleId: string; enabled: boolean; disabled?: boolean }) {
  const { run, pending } = useActionRunner();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled || pending}
      title={disabled ? "Seu perfil não pode alterar automações" : enabled ? "Desativar" : "Ativar"}
      onClick={() => run(() => toggleAutomationRuleAction(ruleId, !enabled))}
      className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60", enabled ? "bg-brand-600" : "bg-stone-300")}
    >
      <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", enabled ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

export function ResetDemoButton() {
  const { run, pending } = useActionRunner();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (window.confirm("Restaurar os dados de demonstração? Todas as alterações feitas na demo serão descartadas.")) run(() => resetDemoDataAction());
      }}
      className={buttonClasses("danger", "md")}
    >
      {pending ? <Spinner /> : <RotateCcw className="size-4" />} Restaurar dados de demonstração
    </button>
  );
}
