import "server-only";
import { revalidatePath } from "next/cache";
import { ForbiddenError } from "@/server/auth/session";
import { DomainError } from "@/server/errors";

import type { ActionResult } from "@/lib/action-result";

export type { ActionResult };

/** Executa uma ação de servidor com tratamento uniforme de erros e revalidação da interface. */
export async function act<T = undefined>(fn: () => Promise<{ message?: string; details?: string[]; data?: T } | void>): Promise<ActionResult<T>> {
  try {
    const out = (await fn()) ?? {};
    revalidatePath("/", "layout");
    return { ok: true, ...out };
  } catch (e) {
    if (e instanceof DomainError || e instanceof ForbiddenError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Não foi possível concluir a operação." };
  }
}
