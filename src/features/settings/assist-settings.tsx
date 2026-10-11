"use client";

import type { AssistMode } from "@prisma/client";
import { Lock, Sparkles, Workflow, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Spinner, useActionRunner } from "@/components/ui/toast";
import {
  ACTIONABLE_INTENTS,
  ATTEMPT_OPTIONS,
  CONFIDENCE_OPTIONS,
  DEFAULT_FOLLOW_UP,
  DEFAULT_POLICY,
  INTENT_ACTION,
  INTENT_LABEL,
  INTERVAL_OPTIONS,
  LOCKED_INTENTS,
} from "@/domain/assist-policy";
import { AI_CONFIDENCE_OPTIONS, AI_MODE_LABEL, DEFAULT_AI, type AiMode } from "@/domain/assist-ai";
import { cn } from "@/lib/cn";
import { formatPct, ratio } from "@/lib/format";
import { updateAiSettingsAction, updateAssistPolicyAction, updateFollowUpSettingsAction } from "@/server/actions/assist";

export interface StudyAssistSettings {
  id: string;
  code: string;
  name: string;
  settings: { followUpEnabled: boolean; followUpMaxAttempts: number; followUpIntervalHours: number; sendWindowStart: number; sendWindowEnd: number; aiMode: string; aiMinConfidence: number } | null;
  policies: { intent: string; mode: AssistMode; minConfidence: number }[];
  stats: { auto30: number; reviewed: number; correct: number; pending: number };
}

const select = "h-8 rounded-lg border-0 bg-surface px-2 text-[12.5px] ring-1 ring-line-strong ring-inset focus:ring-2 focus:ring-brand-400 disabled:bg-subtle disabled:text-ink-3";

export function AssistSettingsEditor({ studies, canManage }: { studies: StudyAssistSettings[]; canManage: boolean }) {
  return (
    <div className="space-y-4">
      {studies.map((s) => (
        <StudyCard key={s.id} study={s} canManage={canManage} />
      ))}
    </div>
  );
}

function StudyCard({ study, canManage }: { study: StudyAssistSettings; canManage: boolean }) {
  const { run, pending } = useActionRunner();
  const cfg = study.settings ?? { ...DEFAULT_FOLLOW_UP, ...DEFAULT_AI };
  const policy = (intent: string) => study.policies.find((p) => p.intent === intent) ?? DEFAULT_POLICY;
  const autoCount = ACTIONABLE_INTENTS.filter((i) => policy(i).mode === "AUTOMATICO").length;
  const disabled = !canManage || pending;

  return (
    <section className="rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
        <span className="text-[15px] font-semibold text-ink">{study.code}</span>
        <span className="text-[12.5px] text-ink-3">{study.name}</span>
        {autoCount > 0 ? (
          <Badge tone="violet" dot>
            Piloto automático · {autoCount} intenç{autoCount === 1 ? "ão" : "ões"}
          </Badge>
        ) : (
          <Badge>Só sugestões</Badge>
        )}
        {pending && <Spinner className="text-ink-3" />}
        <span className="ml-auto text-[12px] text-ink-3">
          30 dias: {study.stats.auto30} aplicadas sozinhas
          {study.stats.reviewed > 0 && ` · acerto ${formatPct(ratio(study.stats.correct, study.stats.reviewed))} em ${study.stats.reviewed} revisadas`}
          {study.stats.pending > 0 && ` · ${study.stats.pending} na fila`}
        </span>
      </header>

      {/* Follow-up */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-subtle/60 px-5 py-3 text-[12.5px] text-ink-2">
        <span className="flex items-center gap-1.5 font-medium text-ink">
          <Workflow className="size-3.5 text-violet-500" /> Follow-up de quem não respondeu
        </span>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={cfg.followUpEnabled}
            disabled={disabled}
            onChange={(e) => run(() => updateFollowUpSettingsAction(study.id, { followUpEnabled: e.target.checked }))}
            className="accent-brand-600"
          />
          Envio automático
        </label>
        <label className="flex items-center gap-1.5">
          até
          <select className={select} value={cfg.followUpMaxAttempts} disabled={disabled || !cfg.followUpEnabled} onChange={(e) => run(() => updateFollowUpSettingsAction(study.id, { followUpMaxAttempts: Number(e.target.value) }))}>
            {ATTEMPT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} tentativa{n === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          a cada
          <select className={select} value={cfg.followUpIntervalHours} disabled={disabled || !cfg.followUpEnabled} onChange={(e) => run(() => updateFollowUpSettingsAction(study.id, { followUpIntervalHours: Number(e.target.value) }))}>
            {INTERVAL_OPTIONS.map((h) => (
              <option key={h} value={h}>
                {h}h
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          envio das
          <select className={select} value={cfg.sendWindowStart} disabled={disabled} onChange={(e) => run(() => updateFollowUpSettingsAction(study.id, { sendWindowStart: Number(e.target.value) }))}>
            {[6, 7, 8, 9, 10].map((h) => (
              <option key={h} value={h}>
                {h}h
              </option>
            ))}
          </select>
          às
          <select className={select} value={cfg.sendWindowEnd} disabled={disabled} onChange={(e) => run(() => updateFollowUpSettingsAction(study.id, { sendWindowEnd: Number(e.target.value) }))}>
            {[17, 18, 19, 20, 21, 22].map((h) => (
              <option key={h} value={h}>
                {h}h
              </option>
            ))}
          </select>
        </label>
        <span className="basis-full text-[11.5px] text-ink-3">
          Esgotadas as tentativas — ou com visita em menos de 24h ainda sem confirmação — vira pendência de ligação para o responsável. Use só cadências aprovadas no plano de recrutamento do estudo.
        </span>
      </div>

      {/* Segunda opinião da IA */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-violet-50/40 px-5 py-3 text-[12.5px] text-ink-2">
        <span className="flex items-center gap-1.5 font-medium text-ink">
          <Sparkles className="size-3.5 text-violet-500" /> Interpretação por IA
        </span>
        <label className="flex items-center gap-1.5">
          <select
            aria-label={`Interpretação por IA em ${study.code}`}
            className={cn(select, cfg.aiMode === "AUTOMATICO" && "font-medium text-violet-800 ring-violet-300")}
            value={cfg.aiMode}
            disabled={disabled}
            onChange={(e) => run(() => updateAiSettingsAction(study.id, { aiMode: e.target.value }))}
          >
            {(Object.keys(AI_MODE_LABEL) as AiMode[]).map((m) => (
              <option key={m} value={m}>
                {AI_MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          confiança mínima da IA
          <select
            className={select}
            value={cfg.aiMinConfidence}
            disabled={disabled || cfg.aiMode !== "AUTOMATICO"}
            onChange={(e) => run(() => updateAiSettingsAction(study.id, { aiMinConfidence: Number(e.target.value) }))}
          >
            {AI_CONFIDENCE_OPTIONS.map((c) => (
              <option key={c} value={c}>
                ≥ {c}
              </option>
            ))}
          </select>
        </label>
        <span className="basis-full text-[11.5px] text-ink-3">
          Só para mensagens que as regras não resolveram (confiança baixa, não classificada ou mais de uma intenção). A IA só rotula: a ação segue a política da intenção abaixo e, no automático, também precisa atingir a confiança mínima da IA. Relato clínico nunca é automático.
        </span>
      </div>

      {/* Política por intenção */}
      <table className="w-full text-left text-[13px]">
        <thead className="border-b border-line text-[11.5px] font-medium tracking-wide text-ink-3 uppercase">
          <tr>
            <th className="px-5 py-2 font-medium">Intenção</th>
            <th className="px-3 py-2 font-medium">O que a IA faz quando aplica</th>
            <th className="px-3 py-2 font-medium">Modo</th>
            <th className="px-5 py-2 font-medium">Confiança mínima</th>
          </tr>
        </thead>
        <tbody>
          {ACTIONABLE_INTENTS.map((intent) => {
            const p = policy(intent);
            const auto = p.mode === "AUTOMATICO";
            return (
              <tr key={intent} className="border-b border-line/70 last:border-0">
                <td className="px-5 py-2.5 font-medium whitespace-nowrap text-ink">
                  {auto && <Zap className="mr-1 inline size-3.5 text-violet-500" />}
                  {INTENT_LABEL[intent]}
                </td>
                <td className="px-3 py-2.5 text-[12.5px] text-ink-2">{INTENT_ACTION[intent]}</td>
                <td className="px-3 py-2.5">
                  <select
                    className={cn(select, auto && "font-medium text-violet-800 ring-violet-300")}
                    value={p.mode}
                    disabled={disabled}
                    onChange={(e) => run(() => updateAssistPolicyAction(study.id, intent, e.target.value as AssistMode, p.minConfidence))}
                  >
                    <option value="SUGERIR">Só sugerir</option>
                    <option value="AUTOMATICO">Automático</option>
                  </select>
                </td>
                <td className="px-5 py-2.5">
                  <select className={select} value={p.minConfidence} disabled={disabled || !auto} onChange={(e) => run(() => updateAssistPolicyAction(study.id, intent, p.mode, Number(e.target.value)))}>
                    {CONFIDENCE_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        ≥ {c}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
          {LOCKED_INTENTS.map((l) => (
            <tr key={l.intent} className="border-b border-line/70 bg-subtle/50 last:border-0">
              <td className="px-5 py-2.5 font-medium whitespace-nowrap text-ink-2">{INTENT_LABEL[l.intent]}</td>
              <td className="px-3 py-2.5 text-[12.5px] text-ink-3" colSpan={3}>
                <Lock className="mr-1 inline size-3" />
                {l.rule}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
