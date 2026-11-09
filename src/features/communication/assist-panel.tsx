"use client";

import type { AssistOutcome } from "@prisma/client";
import { Check, CircleCheck, ShieldAlert, Sparkles, ThumbsDown, ThumbsUp, Zap } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Spinner, useActionRunner } from "@/components/ui/toast";
import { useState } from "react";
import { approveLabel, INTENT_ACTION, INTENT_LABEL, isActionable, isCallAction, isNewTimeSuggestion, isVisitSlot, type AssistIntent } from "@/domain/assist-policy";
import Link from "@/components/ui/link";
import { cn } from "@/lib/cn";
import type { AssistResult } from "@/server/ai/assist";
import { approveAssistDecisionAction, dismissAssistDecisionAction, reviewAutoDecisionAction } from "@/server/actions/assist";

export interface PanelDecision {
  id: string;
  outcome: AssistOutcome;
  intent: string;
  confidence: number;
  ambiguous: boolean;
  reason: string;
  action: string | null;
  verdict: "CORRETA" | "INCORRETA" | null;
  reviewedByName: string | null;
  /** "REGRAS" ou "IA". */
  source: string;
  rulesIntent: string | null;
  rulesConfidence: number | null;
  /** Consumo da IA nesta mensagem (quando foi consultada). */
  ai: { mode: string; model: string; status: string; rationale: string | null; tokens: number; costUsd: number } | null;
}

/** Barra de confiança com a marca do mínimo exigido pelo estudo. */
export function ConfidenceMeter({ score, min }: { score: number; min: number | null }) {
  const ok = min === null || score >= min;
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-24 rounded-full bg-violet-100">
        <div className={cn("h-full rounded-full", ok ? "bg-violet-500" : "bg-amber-500")} style={{ width: `${score}%` }} />
        {min !== null && <div title={`Mínimo do estudo: ${min}`} className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-ink/60" style={{ left: `calc(${min}% - 1px)` }} />}
      </div>
      <span className="text-[11.5px] text-ink-2 tnum">
        {score}
        {min !== null && <span className="text-ink-3"> · mín. {min}</span>}
      </span>
    </div>
  );
}

export function AssistPanel({
  assist,
  decision,
  policyMin,
  canSend,
  canReview,
  onUseTemplate,
  suggestedTemplateName,
}: {
  assist: AssistResult | null;
  decision: PanelDecision | null;
  policyMin: number | null;
  canSend: boolean;
  canReview: boolean;
  onUseTemplate?: () => void;
  suggestedTemplateName?: string;
}) {
  const { run, pending } = useActionRunner();
  const [otherTime, setOtherTime] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const intent = (decision?.intent ?? assist?.intent) as AssistIntent | undefined;
  const score = decision?.confidence ?? assist?.score ?? null;

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-violet-900">
          <Sparkles className="size-4 text-violet-500" /> Assistência IA
        </span>
        <span className="rounded bg-violet-100 px-1.5 py-px text-[10.5px] font-medium text-violet-700">Simulação</span>
      </div>

      {!intent ? (
        <p className="mt-2 text-[12.5px] text-ink-2">Nenhuma mensagem do participante aguardando análise.</p>
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <div className="text-[11.5px] text-ink-3">Intenção identificada</div>
            <div className="text-[13.5px] font-semibold text-ink">{INTENT_LABEL[intent]}</div>
            {score !== null && (
              <div className="mt-1">
                <ConfidenceMeter score={score} min={isActionable(intent) ? policyMin : null} />
              </div>
            )}
            {decision?.source === "IA" ? (
              <>
                {decision.ai?.rationale && <p className="mt-1 text-[12px] text-ink-2">{decision.ai.rationale}</p>}
                <p className="mt-1 inline-flex items-center gap-1 rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-800">
                  <Sparkles className="size-3" /> Lida pela IA{decision.ai?.mode === "mock" ? " (simulada)" : ""}
                  {decision.rulesIntent && (
                    <span className="font-normal text-violet-700">
                      · regras: {INTENT_LABEL[decision.rulesIntent as AssistIntent] ?? decision.rulesIntent} ({decision.rulesConfidence})
                    </span>
                  )}
                </p>
              </>
            ) : (
              assist && <p className="mt-1 text-[12px] text-ink-2">{assist.rationale}</p>
            )}
            {decision?.ai && (
              <p className="mt-1 text-[11px] text-violet-900/70 tnum">
                {decision.ai.status === "ERRO" ? "IA indisponível nesta mensagem" : `IA${decision.ai.mode === "mock" ? " simulada" : ""} · ${decision.ai.tokens.toLocaleString("pt-BR")} tokens · US$ ${decision.ai.costUsd.toFixed(4).replace(".", ",")}`}
                {" · "}
                <Link href="/configuracoes?secao=ia-consumo" className="font-medium text-violet-800 hover:underline">
                  ver consumo
                </Link>
              </p>
            )}
          </div>

          {decision?.outcome === "ENCAMINHADA" || (!decision && intent === "POSSIVEL_RELATO_CLINICO") ? (
            <div className="rounded-lg bg-red-50 p-2.5 text-[12px] text-red-800 ring-1 ring-red-200">
              <div className="mb-0.5 flex items-center gap-1.5 font-semibold">
                <ShieldAlert className="size-3.5" /> Encaminhada à equipe médica
              </div>
              A assistência não interpreta sintomas nem responde. Uma pendência de alta prioridade foi criada para a coordenação.
            </div>
          ) : decision?.outcome === "AUTOMATICA" ? (
            <div className="rounded-lg bg-emerald-50 p-2.5 ring-1 ring-emerald-200">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-800">
                <Zap className="size-3.5" /> Aplicada automaticamente
              </div>
              {decision.action && <p className="mt-0.5 text-[12px] text-ink-2">{decision.action}</p>}
              <p className="mt-0.5 text-[11.5px] text-ink-3">{decision.reason}</p>
              <div className="mt-2 border-t border-emerald-200/80 pt-2">
                {decision.verdict ? (
                  <span className={cn("inline-flex items-center gap-1 text-[11.5px] font-medium", decision.verdict === "CORRETA" ? "text-emerald-700" : "text-red-700")}>
                    {decision.verdict === "CORRETA" ? <ThumbsUp className="size-3" /> : <ThumbsDown className="size-3" />}
                    Revisada como {decision.verdict === "CORRETA" ? "correta" : "incorreta"}
                    {decision.reviewedByName ? ` por ${decision.reviewedByName}` : ""}
                  </span>
                ) : canReview ? (
                  <div className="flex items-center gap-1.5">
                    <span className="mr-auto text-[11.5px] text-ink-3">A IA acertou?</span>
                    <button type="button" disabled={pending} onClick={() => run(() => reviewAutoDecisionAction(decision.id, "CORRETA"))} className={buttonClasses("secondary", "xs")}>
                      <ThumbsUp className="size-3" /> Correta
                    </button>
                    <button type="button" disabled={pending} onClick={() => run(() => reviewAutoDecisionAction(decision.id, "INCORRETA"))} className={buttonClasses("danger", "xs")}>
                      <ThumbsDown className="size-3" /> Incorreta
                    </button>
                  </div>
                ) : (
                  <span className="text-[11.5px] text-ink-3">Aguardando revisão por amostragem.</span>
                )}
              </div>
            </div>
          ) : decision?.outcome === "PENDENTE" ? (
            <div className="rounded-lg bg-surface p-2.5 ring-1 ring-amber-200">
              <div className="text-[12px] font-semibold text-amber-800">Na fila de revisão</div>
              <p className="mt-0.5 text-[11.5px] text-ink-3">{decision.reason}</p>
              {isActionable(intent) && (
                <>
                  <p className="mt-1.5 text-[12px] text-ink-2">
                    <span className="font-medium text-ink">Sugestão:</span> {decision.action ?? INTENT_ACTION[intent]}.
                  </p>
                  {canSend && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button type="button" disabled={pending} onClick={() => run(() => approveAssistDecisionAction(decision.id))} className={buttonClasses(intent === "DESCADASTRO" ? "danger" : "primary", "xs")}>
                        {pending ? <Spinner /> : <Check className="size-3.5" />} {approveLabel(intent, decision.action)}
                      </button>
                      {isNewTimeSuggestion(decision.action) && !otherTime && (
                        <button type="button" onClick={() => setOtherTime(true)} className={buttonClasses("subtle", "xs")}>
                          Outro horário
                        </button>
                      )}
                      {onUseTemplate && suggestedTemplateName && !isCallAction(decision.action) && !isVisitSlot(decision.action) && (
                        <button type="button" onClick={onUseTemplate} className={buttonClasses("subtle", "xs")}>
                          Revisar no envio
                        </button>
                      )}
                      <button type="button" disabled={pending} onClick={() => run(() => dismissAssistDecisionAction(decision.id))} className={buttonClasses("ghost", "xs")}>
                        Tratar manualmente
                      </button>
                    </div>
                  )}
                </>
              )}
              {canSend && otherTime && isNewTimeSuggestion(decision.action) && (
                <form
                  className="mt-2 flex flex-wrap items-center gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(() => approveAssistDecisionAction(decision.id, { date, time }), { onSuccess: () => setOtherTime(false) });
                  }}
                >
                  <input type="date" required aria-label={isVisitSlot(decision.action) ? "Data da visita" : "Data da ligação"} value={date} onChange={(e) => setDate(e.target.value)} className="h-7 rounded-md border-0 bg-surface px-1.5 text-[12px] ring-1 ring-line-strong ring-inset" />
                  <input type="time" required aria-label={isVisitSlot(decision.action) ? "Horário da visita" : "Horário da ligação"} step={900} value={time} onChange={(e) => setTime(e.target.value)} className="h-7 rounded-md border-0 bg-surface px-1.5 text-[12px] ring-1 ring-line-strong ring-inset" />
                  <button type="submit" disabled={pending || !date || !time} className={buttonClasses("primary", "xs")}>
                    {isVisitSlot(decision.action) ? "Propor este horário" : "Aprovar este horário"}
                  </button>
                  <button type="button" onClick={() => setOtherTime(false)} className={buttonClasses("ghost", "xs")}>
                    Cancelar
                  </button>
                  {isVisitSlot(decision.action) && <p className="w-full text-[11.5px] text-ink-3">Outro horário vira proposta: o participante confirma e só então a visita muda.</p>}
                </form>
              )}
              {!isActionable(intent) && <p className="mt-1.5 text-[12px] text-ink-2">Responda pela conversa com um modelo aprovado.</p>}
            </div>
          ) : decision ? (
            <div className="flex items-start gap-1.5 rounded-lg bg-surface p-2.5 text-[12px] text-ink-2 ring-1 ring-line">
              <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
              <span>
                {decision.outcome === "APROVADA" ? "Sugestão aprovada" : "Tratada pela equipe"}
                {decision.reviewedByName ? ` por ${decision.reviewedByName}` : ""}
                {decision.action ? ` · ${decision.action}` : ""}
              </span>
            </div>
          ) : (
            assist?.guardrail && <p className="text-[12px] text-ink-2">{assist.guardrail}</p>
          )}
        </div>
      )}

      <p className="mt-3 border-t border-violet-200/70 pt-2 text-[11px] leading-snug text-violet-900/70">
        Age sozinha só quando o estudo permite e a confiança atinge o mínimo; o resto vai para a fila de revisão. Usa apenas modelos aprovados, não avalia elegibilidade e não interpreta sintomas.
      </p>
    </div>
  );
}
