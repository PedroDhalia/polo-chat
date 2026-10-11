"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/** Menu suspenso simples: fecha ao clicar fora ou pressionar Esc. */
export function Menu({
  trigger,
  children,
  align = "left",
  side = "bottom",
  className,
  panelClassName,
}: {
  trigger: (open: boolean) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
  side?: "bottom" | "top";
  className?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className={cn("relative", className)}>
      <div onClick={() => setOpen((o) => !o)}>{trigger(open)}</div>
      {open && (
        <div
          className={cn(
            "absolute z-40 min-w-56 rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-pop)]",
            align === "right" ? "right-0" : "left-0",
            side === "top" ? "bottom-full mb-2" : "top-full mt-1.5",
            panelClassName,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onClick, children, className, disabled }: { onClick?: () => void; children: React.ReactNode; className?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink-2 hover:bg-stone-100 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50", className)}
    >
      {children}
    </button>
  );
}
