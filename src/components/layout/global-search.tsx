"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      className="relative w-full max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        const term = q.trim();
        router.push(term ? `/participantes?q=${encodeURIComponent(term)}` : "/participantes");
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar participante por nome ou código…"
        className="h-9 w-full rounded-lg border-0 bg-subtle pr-3 pl-9 text-[13px] ring-1 ring-line ring-inset placeholder:text-ink-3 focus:bg-surface focus:ring-2 focus:ring-brand-400"
      />
    </form>
  );
}
