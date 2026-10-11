"use client";

import type { ActionResult } from "@/lib/action-result";
import { buttonClasses } from "./button";
import { Spinner, useActionRunner } from "./toast";

/**
 * Botão que executa uma server action (passe uma action "bindada" a partir de server components:
 * `action={confirmVisit.bind(null, id)}`).
 */
export function ActionButton({
  action,
  children,
  icon,
  variant = "secondary",
  size = "sm",
  confirm,
  className,
  title,
}: {
  action: () => Promise<ActionResult<unknown>>;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "subtle";
  size?: "xs" | "sm" | "md";
  confirm?: string;
  className?: string;
  title?: string;
}) {
  const { run, pending } = useActionRunner();
  return (
    <button
      type="button"
      title={title}
      disabled={pending}
      className={buttonClasses(variant, size, className)}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        run(action);
      }}
    >
      {pending ? <Spinner /> : icon}
      {children}
    </button>
  );
}
