import { SearchX } from "lucide-react";
import Link from "@/components/ui/link";
import { Page } from "@/components/ui/misc";

export default function NotFound() {
  return (
    <Page>
      <div className="mx-auto mt-16 max-w-md rounded-xl border border-line bg-surface p-8 text-center">
        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-stone-100 text-ink-3">
          <SearchX className="size-5" />
        </div>
        <h1 className="text-base font-semibold">Registro não encontrado</h1>
        <p className="mt-1.5 text-[13px] text-ink-2">O item não existe ou pertence a um estudo ao qual seu perfil não tem acesso.</p>
        <Link href="/" className="mt-4 inline-block text-[13px] font-medium text-brand-700 hover:underline">
          Voltar ao Dashboard
        </Link>
      </div>
    </Page>
  );
}
