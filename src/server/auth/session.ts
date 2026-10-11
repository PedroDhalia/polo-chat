import "server-only";
import type { UserRole } from "@prisma/client";
import { cookies } from "next/headers";
import { cache } from "react";
import { CROSS_STUDY_ROLES, roleCan, type Permission } from "@/domain/permissions";
import { db } from "@/server/db";

// Sessão de DEMONSTRAÇÃO: o perfil ativo é escolhido na interface, sem senha.
// No produto real, substituir por autenticação (SSO/senha + MFA) mantendo a mesma interface.

export const SESSION_COOKIE = "platano_demo_user";
const DEFAULT_EMAIL = "camila.rocha@platano.demo";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  jobTitle: string;
  /** Estudos acessíveis; `null` = todos (funções transversais). */
  studyIds: string[] | null;
}

export class ForbiddenError extends Error {
  constructor(permission: string) {
    super(`Seu perfil não tem a permissão necessária (${permission}).`);
    this.name = "ForbiddenError";
  }
}

export const getCurrentUser = cache(async (): Promise<SessionUser> => {
  const store = await cookies();
  const id = store.get(SESSION_COOKIE)?.value;
  const include = { memberships: { select: { studyId: true } } } as const;
  const user =
    (id ? await db.user.findUnique({ where: { id }, include }) : null) ??
    (await db.user.findUnique({ where: { email: DEFAULT_EMAIL }, include })) ??
    (await db.user.findFirst({ include }));
  if (!user) throw new Error("Nenhum usuário encontrado. Rode `npm run setup` para carregar os dados de demonstração.");
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    jobTitle: user.jobTitle,
    studyIds: CROSS_STUDY_ROLES.includes(user.role) ? null : user.memberships.map((m) => m.studyId),
  };
});

export function can(user: SessionUser, permission: Permission): boolean {
  return roleCan(user.role, permission);
}

export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!can(user, permission)) throw new ForbiddenError(permission);
  return user;
}

/** Filtro Prisma que restringe consultas aos estudos acessíveis ao usuário. */
export function studyScope(user: SessionUser): { studyId?: { in: string[] } } {
  return user.studyIds ? { studyId: { in: user.studyIds } } : {};
}

export function canAccessStudy(user: SessionUser, studyId: string | null | undefined): boolean {
  if (!studyId) return true;
  return user.studyIds === null || user.studyIds.includes(studyId);
}
