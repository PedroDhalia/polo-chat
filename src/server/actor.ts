import type { ActorType } from "@prisma/client";
import type { SessionUser } from "@/server/auth/session";
import { RULE_BY_KEY, type AutomationRuleKey } from "@/server/automations/rules";

/** Quem executa uma operação: pessoa, automação, sistema ou integração. */
export type Actor =
  | { type: "USER"; user: SessionUser }
  | { type: "AUTOMATION"; ruleKey: AutomationRuleKey }
  | { type: "SYSTEM" }
  | { type: "INTEGRATION"; system: string };

export const userActor = (user: SessionUser): Actor => ({ type: "USER", user });
export const automationActor = (ruleKey: AutomationRuleKey): Actor => ({ type: "AUTOMATION", ruleKey });

export function actorFields(actor: Actor): { actorType: ActorType; actorId: string | null; actorLabel: string } {
  switch (actor.type) {
    case "USER":
      return { actorType: "USER", actorId: actor.user.id, actorLabel: actor.user.name };
    case "AUTOMATION":
      return { actorType: "AUTOMATION", actorId: null, actorLabel: `Automação · ${RULE_BY_KEY[actor.ruleKey].name}` };
    case "INTEGRATION":
      return { actorType: "INTEGRATION", actorId: null, actorLabel: `Integração ${actor.system} (simulada)` };
    default:
      return { actorType: "SYSTEM", actorId: null, actorLabel: "Sistema" };
  }
}

export function actorSource(actor: Actor): string | null {
  return actor.type === "AUTOMATION" ? `Automação · ${RULE_BY_KEY[actor.ruleKey].name}` : null;
}
