"use client";

import { TriangleAlert } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-line bg-surface p-8 text-center">
      <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-red-50 text-red-600">
        <TriangleAlert className="size-5" />
      </div>
      <h1 className="text-base font-semibold">Algo deu errado</h1>
      <p className="mt-1.5 text-[13px] text-ink-2">
        {error.message.includes("npm run setup") ? error.message : "Não foi possível carregar esta página. Tente novamente; se persistir, verifique se o banco de demonstração foi criado (npm run setup)."}
      </p>
      <button type="button" onClick={reset} className={buttonClasses("secondary", "sm", "mt-4")}>
        Tentar novamente
      </button>
    </div>
  );
}
