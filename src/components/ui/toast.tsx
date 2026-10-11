"use client";

import { CircleAlert, CircleCheck, Workflow, X } from "lucide-react";
import { createContext, useCallback, useContext, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/cn";

type ToastItem = { id: number; tone: "success" | "error"; title: string; details?: string[] };

const ToastContext = createContext<{ push: (t: Omit<ToastItem, "id">) => void } | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: Omit<ToastItem, "id">) => {
      const id = ++counter;
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.tone === "error" ? 7000 : 6000);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-5 bottom-5 z-50 flex w-[380px] flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto rounded-xl border border-line bg-surface p-3.5 shadow-[var(--shadow-pop)]" style={{ animation: "toast-in 160ms ease-out" }}>
            <div className="flex items-start gap-2.5">
              {t.tone === "success" ? <CircleCheck className="mt-px size-4 shrink-0 text-brand-600" /> : <CircleAlert className="mt-px size-4 shrink-0 text-red-600" />}
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">{t.title}</p>
                {t.details && t.details.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {t.details.map((d, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[12.5px] text-ink-2">
                        <Workflow className="mt-0.5 size-3 shrink-0 text-violet-500" />
                        {d}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button onClick={() => dismiss(t.id)} className="text-ink-3 hover:text-ink" aria-label="Fechar">
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast precisa estar dentro de <ToastProvider>");
  return ctx;
}

/** Executa uma server action em transição e exibe o resultado em um toast. */
export function useActionRunner() {
  const { push } = useToast();
  const [pending, start] = useTransition();
  const run = useCallback(
    <T,>(fn: () => Promise<ActionResult<T>>, opts?: { onSuccess?: (r: Extract<ActionResult<T>, { ok: true }>) => void; silent?: boolean }) =>
      start(async () => {
        const r = await fn();
        if (r.ok) {
          if (!opts?.silent && r.message) push({ tone: "success", title: r.message, details: r.details });
          opts?.onSuccess?.(r);
        } else {
          push({ tone: "error", title: r.error });
        }
      }),
    [push],
  );
  return { run, pending };
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent", className)} />;
}
