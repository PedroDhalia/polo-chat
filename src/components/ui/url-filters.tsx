"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/cn";

function useParamSetter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("pagina");
    const qs = next.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  return { params, set, pending };
}

export function UrlSelect({ param, options, placeholder, className }: { param: string; options: { value: string; label: string }[]; placeholder: string; className?: string }) {
  const { params, set, pending } = useParamSetter();
  const value = params.get(param) ?? "";
  return (
    <select
      value={value}
      onChange={(e) => set(param, e.target.value || null)}
      className={cn(
        "h-8 rounded-lg border-0 bg-surface pr-8 pl-2.5 text-[13px] ring-1 ring-line-strong ring-inset focus:ring-2 focus:ring-brand-400",
        value ? "font-medium text-ink" : "text-ink-2",
        pending && "opacity-70",
        className,
      )}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function UrlSearch({ param = "q", placeholder, className }: { param?: string; placeholder: string; className?: string }) {
  const { params, set } = useParamSetter();
  const [value, setValue] = useState(params.get(param) ?? "");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => set(param, value.trim() || null), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-lg border-0 bg-surface pr-7 pl-8 text-[13px] ring-1 ring-line-strong ring-inset placeholder:text-ink-3 focus:ring-2 focus:ring-brand-400"
      />
      {value && (
        <button onClick={() => setValue("")} className="absolute top-1/2 right-2 -translate-y-1/2 text-ink-3 hover:text-ink" aria-label="Limpar busca">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
