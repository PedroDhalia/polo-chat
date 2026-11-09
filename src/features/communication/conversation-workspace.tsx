"use client";

import type { ConversationStatus, MessageDirection, MessageStatus, TaskPriority, TemplateApprovalStatus, TemplateCategory, VisitCategory, VisitStatus } from "@prisma/client";
import { Bot, CalendarClock, CalendarPlus, Check, CheckCheck, ChevronDown, Clock, ExternalLink, Lock, MessageSquareText, PenLine, Send, ShieldAlert, Sparkles, StickyNote, Workflow } from "lucide-react";
import Link from "@/components/ui/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Avatar, SourceTag } from "@/components/ui/misc";
import { Spinner, useActionRunner, useToast } from "@/components/ui/toast";
import { CONVERSATION_STATUS, PARTICIPANT_STATUS, TASK_PRIORITY, TEMPLATE_CATEGORY, VISIT_CATEGORY, VISIT_STATUS } from "@/domain/labels";
import { buildTemplateVars, FREE_TEXT_MAX, renderTemplate, SERVICE_WINDOW_HOURS, systemVariablesIn } from "@/domain/templates";
import { NEW_VISIT_MIN, VISIT_HOURS } from "@/domain/visit-slot";
import { isWindowClosed } from "@/domain/visit-window";
import { formatDayMonth, formatRelativeDateTime, formatRelativeDay, formatTime, isSameDay, localHour, parseDateParam, toDateParam } from "@/lib/dates";
import { cn } from "@/lib/cn";
import type { AssistResult } from "@/server/ai/assist";
import { addNoteAction, markConversationReadAction, resolveConversationAction, sendFreeTextAction, sendTemplateAction, simulateReplyAction } from "@/server/actions/messaging";
import { confirmProposedDateAction, dayAgendaAction, proposeVisitDateAction, scheduleVisitAction, setVisitStatusAction, type DayAgendaItem } from "@/server/actions/visits";
import { TaskCheck } from "@/features/tasks/task-check";
import { AssistPanel, type PanelDecision } from "./assist-panel";
import { useTypingContext } from "./typing-context";
import { useTypingReveal } from "./use-typing-reveal";
import type { ParticipantStatus } from "@prisma/client";

export interface WorkspaceMessage {
  id: string;
  direction: MessageDirection;
  body: string;
  status: MessageStatus;
  automated: boolean;
  intent: string | null;
  sentAt: Date;
  templateName: string | null;
  templateVersion: number | null;
  /** Mensagem composta de mais de um modelo aprovado: nomes e versões. */
  combinedTemplates?: string | null;
  sentByName: string | null;
  automationKey: string | null;
  /** Texto escrito pela equipe, fora dos modelos aprovados. */
  freeText: boolean;
}

export interface WorkspaceTemplate {
  id: string;
  key: string;
  name: string;
  category: TemplateCategory;
  body: string;
  approvalStatus: TemplateApprovalStatus;
  version: number;
  cepReference: string | null;
  studyId: string | null;
}

export interface WorkspaceProps {
  conversation: { id: string; status: ConversationStatus; unreadCount: number };
  participant: {
    id: string;
    fullName: string;
    code: string;
    status: ParticipantStatus;
    phoneMasked: string;
    ownerName: string | null;
    studyCode: string;
    tasks: { id: string; title: string; priority: TaskPriority; dueAt: Date; assigneeName: string | null }[];
  };
  visit: { id: string; name: string; scheduledAt: Date; status: VisitStatus; windowStart: Date | null; windowEnd: Date | null; rescheduleCount: number; proposedAt: Date | null } | null;
  messages: WorkspaceMessage[];
  templates: WorkspaceTemplate[];
  whatsappConsent: boolean;
  assist: AssistResult | null;
  decision: PanelDecision | null;
  policyMin: number | null;
  followUp: { enabled: boolean; attempts: number; max: number; nextAt: Date | null; exhausted: boolean; paused: boolean; waiting: boolean; window: string };
  permissions: { send: boolean; agenda: boolean; tasks: boolean; review: boolean };
}

const INTENT_SHORT: Record<string, string> = {
  CONFIRMACAO: "Confirmação",
  REAGENDAMENTO: "Remarcação",
  POSSIVEL_RELATO_CLINICO: "Possível relato clínico",
  DUVIDA_FREQUENTE: "Dúvida frequente",
  INTERESSE: "Interesse",
  DESCADASTRO: "Descadastro",
  OUTRO: "Não classificada",
};

const SIMULATED_REPLIES = [
  "Confirmo, estarei aí!",
  "Preciso remarcar, tive um imprevisto no trabalho.",
  "O transporte é reembolsado?",
  "Estou com febre e o braço inchado desde ontem.",
  "Não quero mais receber mensagens.",
];

export function ConversationWorkspace(props: WorkspaceProps) {
  const { conversation, participant, visit, messages, templates, whatsappConsent, assist, decision, policyMin, followUp, permissions } = props;
  const { run, pending } = useActionRunner();
  const { push } = useToast();
  const { visible, typing, whenSettled } = useTypingReveal(messages, conversation.id);
  const typingCtx = useTypingContext();
  const [templateId, setTemplateId] = useState<string>("");
  const [mode, setMode] = useState<"template" | "free" | "note">("template");
  const [note, setNote] = useState("");
  const [freeText, setFreeText] = useState("");
  const [expectsReply, setExpectsReply] = useState(true);
  const [custom, setCustom] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const now = new Date();

  // Ao abrir a conversa: vai direto ao fim. Depois: rolagem suave a cada mensagem ou "digitando…".
  const lastConversation = useRef<string | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const opened = lastConversation.current !== conversation.id;
    lastConversation.current = conversation.id;
    el.scrollTo({ top: el.scrollHeight, behavior: opened ? "auto" : "smooth" });
  }, [visible.length, typing, conversation.id]);

  // Lista lateral mostra "digitando…" para esta conversa enquanto a automação responde.
  const setTypingId = typingCtx?.setTypingId;
  useEffect(() => {
    setTypingId?.(typing ? conversation.id : null);
  }, [typing, conversation.id, setTypingId]);

  /** Simula a mensagem do participante; o aviso aparece só depois que a resposta automática for "digitada". */
  const simulate = (body: string, after?: () => void) =>
    run(() => simulateReplyAction(participant.id, body), {
      silent: true,
      onSuccess: (r) => {
        after?.();
        whenSettled(() => r.message && push({ tone: "success", title: r.message, details: r.details }));
      },
    });

  useEffect(() => {
    if (conversation.unreadCount > 0) markConversationReadAction(conversation.id);
  }, [conversation.id, conversation.unreadCount]);

  // Trocar de conversa limpa o rascunho: evita mandar um texto para a pessoa errada.
  // Ajuste durante a renderização (e não em useEffect): o rascunho antigo nunca chega a aparecer na conversa nova.
  const [draftFor, setDraftFor] = useState(conversation.id);
  if (draftFor !== conversation.id) {
    setDraftFor(conversation.id);
    setTemplateId("");
    setMode("template");
    setFreeText("");
    setExpectsReply(true);
  }

  const selected = templates.find((t) => t.id === templateId) ?? null;
  const preview = useMemo(() => {
    if (!selected) return "";
    return renderTemplate(selected.body, buildTemplateVars({ participantName: participant.fullName, studyCode: participant.studyCode, visitAt: visit?.scheduledAt }));
  }, [selected, participant.fullName, participant.studyCode, visit?.scheduledAt]);
  const needsVisit = !!selected && /\{\{(data|hora)\}\}/.test(selected.body) && !visit;
  const canCompose = permissions.send && whatsappConsent;

  // Janela de atendimento do WhatsApp: texto livre só é aceito até 24h após a última mensagem do participante.
  const lastInboundAt = [...messages].reverse().find((m) => m.direction === "INBOUND")?.sentAt ?? null;
  const windowOpen = !!lastInboundAt && now.getTime() - lastInboundAt.getTime() < SERVICE_WINDOW_HOURS * 3_600_000;
  const freeTrimmed = freeText.trim();
  const sendFree = () => {
    if (!freeTrimmed || freeTrimmed.length > FREE_TEXT_MAX || pending || !canCompose) return;
    run(() => sendFreeTextAction(participant.id, freeTrimmed, expectsReply), { onSuccess: () => setFreeText("") });
  };

  const suggested = assist?.suggestedTemplateKey ? templates.find((t) => t.key === assist.suggestedTemplateKey) : undefined;
  // "Pedir confirmação" no banner da visita: abre o modelo aprovado "Lembrete de visita" já preenchido.
  const reminderTpl = templates.find((t) => t.key === "tpl-lembrete-visita" && t.approvalStatus === "APROVADO");
  const askConfirmation =
    reminderTpl && canCompose
      ? () => {
          setMode("template");
          setTemplateId(reminderTpl.id);
        }
      : undefined;

  return (
    <>
      {/* ── Centro: conversa ── */}
      <section className="flex min-h-0 min-w-0 flex-col border-r border-line">
        <header className="flex items-center gap-3 border-b border-line px-5 py-3">
          <Avatar name={participant.fullName} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[14px] font-semibold text-ink">{participant.fullName}</span>
              {messages.length === 0 ? <Badge tone="neutral">Sem mensagens</Badge> : <StatusBadge map={CONVERSATION_STATUS} value={conversation.status} />}
            </div>
            <div className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-ink-3">
              <span>WhatsApp (simulado) · {participant.studyCode}</span>
              {followUp.waiting && (
                <span className={cn("inline-flex items-center gap-1", followUp.exhausted ? "text-amber-700" : "text-violet-700")}>
                  · <Workflow className="size-3" />
                  {!followUp.enabled
                    ? "Follow-up automático desligado neste estudo"
                    : followUp.paused
                      ? "Follow-up pausado: há pendência aberta com a equipe"
                      : followUp.exhausted
                        ? `Follow-ups esgotados (${followUp.attempts}/${followUp.max}) — vira pendência de ligação`
                        : followUp.nextAt
                          ? `Follow-up ${followUp.attempts + 1}/${followUp.max} ${followUp.nextAt > now ? `previsto ${formatRelativeDateTime(followUp.nextAt, now).toLowerCase()}` : "no próximo ciclo"} (${followUp.window})`
                          : null}
                </span>
              )}
            </div>
          </div>
          {permissions.send && conversation.status !== "RESOLVIDA" && (
            <button type="button" disabled={pending} onClick={() => run(() => resolveConversationAction(conversation.id))} className={buttonClasses("secondary", "sm")}>
              <Check className="size-3.5" /> Marcar como resolvida
            </button>
          )}
        </header>

        {visit && (
          <VisitBanner key={visit.id} visit={visit} ownerName={participant.ownerName} canManage={permissions.agenda} canPropose={permissions.agenda && permissions.send} onAskConfirmation={askConfirmation} now={now} />
        )}
        {!visit && permissions.agenda && <ScheduleVisitBar key={participant.id} participantId={participant.id} ownerName={participant.ownerName} notifies={canCompose} now={now} />}

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#f7f6f2] px-6 py-5 scrollbar-thin">
          {messages.length === 0 && (
            <p className="mx-auto mt-6 max-w-sm text-center text-[12.5px] text-ink-3">
              Nenhuma mensagem ainda. Comece pelo modelo aprovado de primeiro contato do estudo; a resposta do participante aparece aqui.
            </p>
          )}
          {visible.map((m, i) => {
            const prev = visible[i - 1];
            const showDay = !prev || !isSameDay(prev.sentAt, m.sentAt);
            return (
              <div key={m.id}>
                {showDay && (
                  <div className="my-2 flex justify-center">
                    <span className="rounded-full bg-surface px-2.5 py-0.5 text-[11.5px] text-ink-3 ring-1 ring-line">{formatRelativeDay(m.sentAt, now)}</span>
                  </div>
                )}
                <MessageBubble m={m} />
              </div>
            );
          })}
          {typing && <TypingBubble />}
        </div>

        {/* Composer */}
        <div className="border-t border-line bg-surface px-5 py-3">
          <div className="mb-2 flex items-center gap-1">
            <button type="button" onClick={() => setMode("template")} className={cn("rounded-md px-2.5 py-1 text-[12.5px] font-medium whitespace-nowrap", mode === "template" ? "bg-stone-100 text-ink" : "text-ink-3 hover:text-ink-2")}>
              <MessageSquareText className="mr-1 inline size-3.5" /> Modelo aprovado
            </button>
            <button type="button" onClick={() => setMode("free")} className={cn("rounded-md px-2.5 py-1 text-[12.5px] font-medium whitespace-nowrap", mode === "free" ? "bg-stone-100 text-ink" : "text-ink-3 hover:text-ink-2")}>
              <PenLine className="mr-1 inline size-3.5" /> Texto livre
            </button>
            <button type="button" onClick={() => setMode("note")} className={cn("rounded-md px-2.5 py-1 text-[12.5px] font-medium whitespace-nowrap", mode === "note" ? "bg-stone-100 text-ink" : "text-ink-3 hover:text-ink-2")}>
              <StickyNote className="mr-1 inline size-3.5" /> Nota interna
            </button>
            <div className="ml-auto">
              <Menu
                align="right"
                side="top"
                panelClassName="w-80"
                trigger={() => (
                  <button type="button" className={buttonClasses("ghost", "xs")} title="Recurso de demonstração">
                    <Bot className="size-3.5" /> Simular resposta <ChevronDown className="size-3" />
                  </button>
                )}
              >
                {(close) => (
                  <div>
                    <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-ink-3 uppercase">Demonstração · resposta simulada</div>
                    {SIMULATED_REPLIES.map((r) => (
                      <MenuItem
                        key={r}
                        onClick={() => {
                          close();
                          simulate(r);
                        }}
                      >
                        “{r}”
                      </MenuItem>
                    ))}
                    <form
                      className="flex gap-1.5 border-t border-line p-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!custom.trim()) return;
                        close();
                        simulate(custom, () => setCustom(""));
                      }}
                    >
                      <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Outra mensagem…" className="h-7 flex-1 rounded-md border-0 px-2 text-[12.5px] ring-1 ring-line-strong ring-inset" />
                      <button type="submit" className={buttonClasses("secondary", "xs")}>
                        Receber
                      </button>
                    </form>
                  </div>
                )}
              </Menu>
            </div>
          </div>

          {mode !== "note" ? (
            !permissions.send ? (
              <Notice icon={<Lock className="size-3.5" />}>Seu perfil pode consultar a conversa, mas não enviar mensagens.</Notice>
            ) : !whatsappConsent ? (
              <Notice icon={<ShieldAlert className="size-3.5" />} tone="red">
                Sem consentimento registrado para WhatsApp — envio bloqueado. Use contato telefônico.
              </Notice>
            ) : mode === "free" ? (
              <div className="space-y-2">
                <div className="flex items-end gap-2">
                  <textarea
                    value={freeText}
                    onChange={(e) => setFreeText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        sendFree();
                      }
                    }}
                    rows={3}
                    aria-label="Texto livre para o participante"
                    placeholder={`Escreva para ${participant.fullName.split(" ")[0]}… (operacional: agenda, logística, documentos — sem orientação clínica)`}
                    className="min-h-[76px] flex-1 resize-y rounded-lg border-0 bg-surface px-3 py-2 text-[13px] leading-relaxed ring-1 ring-line-strong ring-inset placeholder:text-ink-3 focus:ring-2 focus:ring-brand-400"
                  />
                  <button type="button" disabled={!freeTrimmed || freeTrimmed.length > FREE_TEXT_MAX || pending || !canCompose} onClick={sendFree} className={buttonClasses("primary", "md")}>
                    {pending ? <Spinner /> : <Send className="size-4" />} Enviar
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-ink-2">
                    <input type="checkbox" checked={expectsReply} onChange={(e) => setExpectsReply(e.target.checked)} className="size-3.5 accent-[var(--color-brand-600)]" />
                    Aguardar resposta <span className="text-ink-3">(sem retorno, entra no follow-up automático)</span>
                  </label>
                  <span className={cn("ml-auto tnum", freeTrimmed.length > FREE_TEXT_MAX ? "font-medium text-red-600" : "text-ink-3")}>
                    {freeTrimmed.length}/{FREE_TEXT_MAX} · Ctrl+Enter envia
                  </span>
                </div>
                <p className={cn("flex items-start gap-1.5 text-[11.5px]", windowOpen ? "text-ink-3" : "text-amber-700")}>
                  <Clock className="mt-px size-3 shrink-0" />
                  {windowOpen
                    ? `Texto livre não é modelo aprovado pelo CEP e fica registrado como tal. Janela de 24h do WhatsApp aberta: participante escreveu ${formatRelativeDateTime(lastInboundAt!, now).toLowerCase()}.`
                    : "Fora da janela de 24h do WhatsApp (o participante não escreveu nas últimas 24h). No WhatsApp real este texto seria recusado e seria preciso um modelo aprovado; aqui o envio é simulado."}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <select
                    value={templateId}
                    onChange={(e) => setTemplateId(e.target.value)}
                    className="h-9 flex-1 rounded-lg border-0 bg-surface px-2.5 text-[13px] ring-1 ring-line-strong ring-inset focus:ring-2 focus:ring-brand-400"
                  >
                    <option value="">Selecione um modelo aprovado…</option>
                    {groupByCategory(templates).map(([cat, items]) => (
                      <optgroup key={cat} label={TEMPLATE_CATEGORY[cat]}>
                        {items.map((t) => (
                          <option key={t.id} value={t.id} disabled={t.approvalStatus !== "APROVADO" || systemVariablesIn(t.body).length > 0}>
                            {t.name}
                            {t.approvalStatus !== "APROVADO" ? " — não aprovado pelo CEP" : systemVariablesIn(t.body).length > 0 ? " — enviado pelo sistema" : ""}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!selected || pending || needsVisit || !canCompose}
                    onClick={() => selected && run(() => sendTemplateAction(participant.id, selected.id), { onSuccess: () => setTemplateId("") })}
                    className={buttonClasses("primary", "md")}
                  >
                    {pending ? <Spinner /> : <Send className="size-4" />} Enviar
                  </button>
                </div>
                {selected ? (
                  <div className="rounded-lg bg-brand-50/70 p-3 ring-1 ring-brand-100">
                    <p className="text-[13px] whitespace-pre-line text-ink">{preview}</p>
                    <p className="mt-1.5 text-[11.5px] text-ink-3">
                      Texto aprovado pelo CEP · v{selected.version}
                      {selected.cepReference ? ` · ${selected.cepReference}` : ""} · variáveis preenchidas automaticamente
                    </p>
                    {needsVisit && <p className="mt-1 text-[11.5px] font-medium text-red-600">Este modelo exige uma visita agendada.</p>}
                  </div>
                ) : (
                  <p className="text-[11.5px] text-ink-3">Modelos aprovados pelo CEP, com variáveis preenchidas automaticamente. Precisa de algo fora dos modelos? Use “Texto livre”.</p>
                )}
              </div>
            )
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => addNoteAction(conversation.id, note), { onSuccess: () => setNote("") });
              }}
            >
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={!permissions.send}
                placeholder="Nota visível apenas para a equipe (operacional, sem dados clínicos)…"
                className="h-9 flex-1 rounded-lg border-0 bg-amber-50/60 px-3 text-[13px] ring-1 ring-amber-200 ring-inset placeholder:text-ink-3 focus:ring-2 focus:ring-amber-300"
              />
              <button type="submit" disabled={!note.trim() || pending || !permissions.send} className={buttonClasses("secondary", "md")}>
                Salvar nota
              </button>
            </form>
          )}
        </div>
      </section>

      {/* ── Direita: contexto do participante ── */}
      <aside className="min-h-0 space-y-4 overflow-y-auto p-4 scrollbar-thin">
        <div className="rounded-xl border border-line p-4">
          <div className="flex items-center gap-3">
            <Avatar name={participant.fullName} size="md" />
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold">{participant.fullName}</div>
              <div className="text-[12px] text-ink-3 tnum">{participant.code}</div>
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-[84px_1fr] gap-y-1.5 text-[12.5px]">
            <dt className="text-ink-3">Estudo</dt>
            <dd className="font-medium text-ink">{participant.studyCode}</dd>
            <dt className="text-ink-3">Status</dt>
            <dd>
              <StatusBadge map={PARTICIPANT_STATUS} value={participant.status} />
            </dd>
            <dt className="text-ink-3">Responsável</dt>
            <dd className="text-ink-2">{participant.ownerName ?? "—"}</dd>
            <dt className="text-ink-3">Telefone</dt>
            <dd className="text-ink-2 tnum">{participant.phoneMasked}</dd>
            <dt className="text-ink-3">WhatsApp</dt>
            <dd className={whatsappConsent ? "text-brand-700" : "text-red-600"}>{whatsappConsent ? "Consentimento registrado" : "Sem consentimento"}</dd>
          </dl>
          <Link href={`/participantes/${participant.id}`} className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-brand-700 hover:underline">
            Abrir ficha <ExternalLink className="size-3" />
          </Link>
        </div>

        {visit && (
          <div className="rounded-xl border border-line p-4">
            <div className="mb-2 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">Próxima visita</div>
            <div className="text-[13.5px] font-medium text-ink">{visit.name}</div>
            <div className="mb-2 text-[12.5px] text-ink-2">{formatRelativeDateTime(visit.scheduledAt, now)}</div>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge map={VISIT_STATUS} value={visit.status} />
              {visit.windowStart && visit.windowEnd && (
                <SourceTag kind="polo">
                  Janela {formatDayMonth(visit.windowStart)}–{formatDayMonth(visit.windowEnd)}
                </SourceTag>
              )}
              {visit.rescheduleCount > 0 && <Badge tone={visit.rescheduleCount >= 2 ? "amber" : "neutral"}>{visit.rescheduleCount}ª remarcação</Badge>}
            </div>
          </div>
        )}

        {/* Assistência IA */}
        <AssistPanel
          assist={assist}
          decision={decision}
          policyMin={policyMin}
          canSend={permissions.send}
          canReview={permissions.send || permissions.review}
          suggestedTemplateName={suggested?.name}
          onUseTemplate={suggested && whatsappConsent && permissions.send ? () => setTemplateId(suggested.id) : undefined}
        />

        <div className="rounded-xl border border-line p-4">
          <div className="mb-2 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">Pendências do participante</div>
          {participant.tasks.length === 0 && <p className="text-[12.5px] text-ink-3">Nenhuma pendência aberta.</p>}
          <ul className="space-y-2.5">
            {participant.tasks.map((t) => (
              <li key={t.id} className="flex items-start gap-2.5">
                <span className="pt-px">
                  <TaskCheck taskId={t.id} done={false} disabled={!permissions.tasks} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium text-ink">{t.title}</div>
                  <div className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
                    <StatusBadge map={TASK_PRIORITY} value={t.priority} dot={false} /> {formatRelativeDateTime(t.dueAt, now)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </>
  );
}

const minutesOf = (d: Date) => localHour(d) * 60 + d.getUTCMinutes();
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * Agenda do dia escolhido, para checar disponibilidade sem sair da conversa: visitas do dia,
 * conflito com o horário escolhido (destaque maior se for do mesmo responsável) e horários livres
 * do responsável (clique preenche o horário).
 */
function DayAvailability({
  date,
  time,
  ownerName,
  onPickTime,
  now,
  excludeVisitId,
}: {
  date: string;
  time: string;
  ownerName: string | null;
  onPickTime: (t: string) => void;
  now: Date;
  excludeVisitId?: string;
}) {
  // A agenda carregada guarda para qual dia ela vale: ao trocar o dia, volta a "carregando" sem setState no efeito.
  const key = `${date}|${excludeVisitId ?? ""}`;
  const [loaded, setLoaded] = useState<{ key: string; items: DayAgendaItem[] } | null>(null);
  useEffect(() => {
    let alive = true;
    dayAgendaAction(date).then((r) => alive && setLoaded({ key, items: r.filter((v) => v.id !== excludeVisitId) }));
    return () => {
      alive = false;
    };
  }, [date, excludeVisitId, key]);
  const items = loaded?.key === key ? loaded.items : null;

  const day = parseDateParam(date);
  const m = time.match(/^(\d{2}):(\d{2})$/);
  const chosen = m ? Number(m[1]) * 60 + Number(m[2]) : null;
  const overlaps = (v: DayAgendaItem, start: number, len = NEW_VISIT_MIN) => {
    const s = minutesOf(new Date(v.start));
    return s < start + len && start < s + v.durationMin;
  };
  const conflicts = items && chosen !== null ? items.filter((v) => overlaps(v, chosen)) : [];
  const ownerConflict = conflicts.some((v) => ownerName && v.staffName === ownerName);
  const isToday = day ? isSameDay(day, now) : false;
  const free =
    items && ownerName
      ? Array.from({ length: (VISIT_HOURS.lastStart - VISIT_HOURS.firstStart) * 2 + 1 }, (_, i) => VISIT_HOURS.firstStart * 60 + i * 30).filter(
          (s) => (!isToday || s > minutesOf(now) + 60) && !items.some((v) => v.staffName === ownerName && overlaps(v, s)),
        )
      : [];

  return (
    <div className="mt-1.5 mb-1 ml-7 rounded-lg bg-surface p-2.5 ring-1 ring-line">
      <div className="mb-1.5 flex items-center gap-2 text-[12px]">
        <span className="font-semibold text-ink">Agenda de {day ? formatRelativeDay(day, now).toLowerCase() : date}</span>
        <span className="text-ink-3">{items ? `${items.length} visita${items.length === 1 ? "" : "s"}` : "carregando…"}</span>
        <Link href={`/agenda?data=${date}`} target="_blank" className="ml-auto inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
          Abrir agenda do dia <ExternalLink className="size-3" />
        </Link>
      </div>
      {items && items.length === 0 && <p className="text-[12px] text-ink-3">Nenhuma visita neste dia.</p>}
      {items && items.length > 0 && (
        <ul aria-label="Visitas do dia" className="max-h-36 space-y-0.5 overflow-y-auto scrollbar-thin">
          {items.map((v) => {
            const s = minutesOf(new Date(v.start));
            const hit = conflicts.includes(v);
            const sameOwner = hit && !!ownerName && v.staffName === ownerName;
            return (
              <li key={v.id} className={cn("flex items-center gap-2 rounded px-1.5 py-0.5 text-[12px]", sameOwner ? "bg-red-50 text-red-800" : hit ? "bg-amber-50 text-amber-900" : "text-ink-2")}>
                <span className="w-[86px] shrink-0 font-medium tnum">
                  {hhmm(s)}–{hhmm(s + v.durationMin)}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {v.name} · {v.participantName} · {v.studyCode}
                </span>
                <span className="shrink-0 text-[11.5px] text-ink-3">{v.staffName?.split(" ")[0] ?? "—"}</span>
              </li>
            );
          })}
        </ul>
      )}
      {items && chosen !== null && (
        <p className={cn("mt-1.5 text-[11.5px] font-medium", ownerConflict ? "text-red-700" : conflicts.length ? "text-amber-700" : "text-emerald-700")}>
          {ownerConflict
            ? `${hhmm(chosen)} conflita com outra visita de ${ownerName?.split(" ")[0]} (responsável).`
            : conflicts.length
              ? `${hhmm(chosen)} coincide com ${conflicts.length} visita${conflicts.length === 1 ? "" : "s"} de outros responsáveis.`
              : `${hhmm(chosen)} está livre neste dia.`}
        </p>
      )}
      {free.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="mr-0.5 text-[11.5px] text-ink-3">Livres para {ownerName?.split(" ")[0]}:</span>
          {free.slice(0, 10).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPickTime(hhmm(s))}
              className={cn("rounded px-1.5 py-0.5 text-[11.5px] tnum ring-1", chosen === s ? "bg-brand-600 text-white ring-brand-600" : "bg-surface text-ink-2 ring-line hover:bg-subtle")}
            >
              {hhmm(s)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Sem visita: a equipe agenda a visita combinada (ex.: na ligação de pré-triagem). */
function ScheduleVisitBar({ participantId, ownerName, notifies, now }: { participantId: string; ownerName: string | null; notifies: boolean; now: Date }) {
  const { run, pending } = useActionRunner();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<VisitCategory>("TRIAGEM");
  const [name, setName] = useState(VISIT_CATEGORY.TRIAGEM);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [confirmed, setConfirmed] = useState(true);
  const field = "h-7 rounded-md border-0 bg-surface px-1.5 text-[12px] ring-1 ring-line-strong ring-inset";

  return (
    <div className="border-b border-line bg-subtle px-5 py-1.5">
      <div className="flex items-center gap-3">
        <CalendarClock className="size-4 shrink-0 text-ink-3" />
        <span className="flex-1 text-[12.5px] text-ink-3">Nenhuma visita agendada</span>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className={buttonClasses("secondary", "xs")}>
            <CalendarPlus className="size-3.5" /> Agendar visita
          </button>
        )}
      </div>
      {open && (
        <form
          className="mt-1.5 mb-1 flex flex-wrap items-center gap-1.5 pl-7"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => scheduleVisitAction(participantId, { name, category, date, time, confirmed }), { onSuccess: () => setOpen(false) });
          }}
        >
          <select
            aria-label="Tipo de visita"
            value={category}
            onChange={(e) => {
              const c = e.target.value as VisitCategory;
              setCategory(c);
              setName(VISIT_CATEGORY[c]);
            }}
            className={field}
          >
            {(Object.keys(VISIT_CATEGORY) as VisitCategory[]).map((c) => (
              <option key={c} value={c}>
                {VISIT_CATEGORY[c]}
              </option>
            ))}
          </select>
          <input aria-label="Nome da visita" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={cn(field, "w-36")} />
          <input type="date" required aria-label="Data da visita" min={toDateParam(now)} value={date} onChange={(e) => setDate(e.target.value)} className={field} />
          <input type="time" required aria-label="Horário da visita" step={900} value={time} onChange={(e) => setTime(e.target.value)} className={field} />
          <button type="submit" disabled={pending || !date || !name.trim()} className={buttonClasses("primary", "xs")}>
            {pending ? <Spinner /> : <CalendarPlus className="size-3.5" />} Agendar
          </button>
          <button type="button" onClick={() => setOpen(false)} className={buttonClasses("ghost", "xs")}>
            Cancelar
          </button>
          <label className="flex basis-full cursor-pointer items-center gap-1.5 text-[11.5px] text-ink-2">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="size-3.5 accent-[var(--color-brand-600)]" />
            Já combinado com o participante: confirmar{notifies ? " e enviar “Confirmação de agendamento”" : ""}
          </label>
        </form>
      )}
      {open && date && <DayAvailability date={date} time={time} ownerName={ownerName} onPickTime={setTime} now={now} />}
    </div>
  );
}

/**
 * Banner da visita: confirmar; na remarcação ou falta, propor nova data ao participante; com proposta
 * pendente, acompanhar e (se combinada por telefone) confirmar. A agenda só muda quando a data é confirmada.
 */
function VisitBanner({
  visit,
  ownerName,
  canManage,
  canPropose,
  onAskConfirmation,
  now,
}: {
  visit: NonNullable<WorkspaceProps["visit"]>;
  ownerName: string | null;
  canManage: boolean;
  canPropose: boolean;
  onAskConfirmation?: () => void;
  now: Date;
}) {
  const { run, pending } = useActionRunner();
  const [proposing, setProposing] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const needsNewDate = visit.status === "REAGENDAMENTO_SOLICITADO" || visit.status === "FALTOU";
  const attention = visit.status === "AGUARDANDO_CONFIRMACAO" || needsNewDate || !!visit.proposedAt;
  const windowClosed = isWindowClosed(visit, now);
  const today = toDateParam(now);
  const minDate = visit.windowStart && toDateParam(visit.windowStart) > today ? toDateParam(visit.windowStart) : today;
  const maxDate = visit.windowEnd ? toDateParam(visit.windowEnd) : undefined;

  return (
    <div className={cn("border-b px-5 py-2", attention ? "border-amber-200 bg-amber-50" : "border-line bg-subtle")}>
      <div className="flex items-center gap-3">
        <CalendarClock className={cn("size-4 shrink-0", attention ? "text-amber-600" : "text-ink-3")} />
        <span className="flex-1 text-[13px] text-ink">
          <strong className="font-semibold">
            Visita {formatRelativeDay(visit.scheduledAt, now).toLowerCase()} às {formatTime(visit.scheduledAt)}
          </strong>{" "}
          — {VISIT_STATUS[visit.status].label.toLowerCase()} <span className="text-ink-3">· {visit.name}</span>
        </span>
        {onAskConfirmation && visit.status === "AGUARDANDO_CONFIRMACAO" && (
          <button type="button" onClick={onAskConfirmation} className={buttonClasses("secondary", "xs")} title="Abre o modelo aprovado “Lembrete de visita” com a data preenchida">
            <Send className="size-3.5" /> Pedir confirmação
          </button>
        )}
        {canManage && visit.status === "AGUARDANDO_CONFIRMACAO" && (
          <button type="button" disabled={pending} onClick={() => run(() => setVisitStatusAction(visit.id, "CONFIRMADO"))} className={buttonClasses("primary", "xs")}>
            {pending ? <Spinner /> : <Check className="size-3.5" />} Confirmar visita
          </button>
        )}
        {canPropose && needsNewDate && !visit.proposedAt && !proposing && !windowClosed && (
          <button type="button" onClick={() => setProposing(true)} className={buttonClasses("primary", "xs")}>
            <CalendarClock className="size-3.5" /> Propor nova data
          </button>
        )}
      </div>

      {visit.proposedAt && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 pl-7 text-[12.5px]">
          <span className="text-ink-2">
            <strong className="font-semibold text-ink">
              Nova data proposta: {formatRelativeDay(visit.proposedAt, now).toLowerCase()} às {formatTime(visit.proposedAt)}
            </strong>{" "}
            — aguardando o participante. A agenda muda quando ele confirmar.
          </span>
          {canManage && (
            <button type="button" disabled={pending} onClick={() => run(() => confirmProposedDateAction(visit.id))} className={buttonClasses("secondary", "xs")}>
              {pending ? <Spinner /> : <Check className="size-3.5" />} Confirmar nova data
            </button>
          )}
          {canPropose && !proposing && (
            <button type="button" onClick={() => setProposing(true)} className={buttonClasses("ghost", "xs")}>
              Propor outra
            </button>
          )}
        </div>
      )}

      {proposing && (
        <form
          className="mt-2 flex flex-wrap items-center gap-1.5 pl-7"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => proposeVisitDateAction(visit.id, date, time), { onSuccess: () => setProposing(false) });
          }}
        >
          <input type="date" required aria-label="Nova data" min={minDate} max={maxDate} value={date} onChange={(e) => setDate(e.target.value)} className="h-7 rounded-md border-0 bg-surface px-1.5 text-[12px] ring-1 ring-line-strong ring-inset" />
          <input type="time" required aria-label="Novo horário" step={900} value={time} onChange={(e) => setTime(e.target.value)} className="h-7 rounded-md border-0 bg-surface px-1.5 text-[12px] ring-1 ring-line-strong ring-inset" />
          <button type="submit" disabled={pending || !date} className={buttonClasses("primary", "xs")}>
            {pending ? <Spinner /> : <Send className="size-3.5" />} Enviar proposta
          </button>
          <button type="button" onClick={() => setProposing(false)} className={buttonClasses("ghost", "xs")}>
            Cancelar
          </button>
          <span className="basis-full text-[11.5px] text-ink-3">
            {visit.windowStart && visit.windowEnd ? `Janela do Polo Trial: ${formatDayMonth(visit.windowStart)} a ${formatDayMonth(visit.windowEnd)}. ` : ""}O participante recebe “Proposta de nova data” e responde CONFIRMO ou pede outro horário.
          </span>
        </form>
      )}

      {proposing && date && <DayAvailability date={date} time={time} ownerName={ownerName} onPickTime={setTime} now={now} excludeVisitId={visit.id} />}

      {needsNewDate && windowClosed && !visit.proposedAt && (
        <p className="mt-1 pl-7 text-[11.5px] font-medium text-red-600">A janela informada pelo Polo Trial já encerrou: fale com a coordenação do estudo.</p>
      )}
    </div>
  );
}

/** Balão "digitando…" do lado do centro enquanto a resposta automática é preparada. */
function TypingBubble() {
  return (
    <div className="flex justify-end">
      <div>
        <div role="status" aria-label="Automação digitando" className="flex items-center gap-1 rounded-2xl rounded-br-md bg-[#e3f1e8] px-4 py-3.5 shadow-[var(--shadow-card)]">
          <span className="typing-dot" />
          <span className="typing-dot" style={{ animationDelay: "160ms" }} />
          <span className="typing-dot" style={{ animationDelay: "320ms" }} />
        </div>
        <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-violet-700">
          <Workflow className="size-3" /> Automação digitando…
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ m }: { m: WorkspaceMessage }) {
  if (m.direction === "INTERNAL_NOTE") {
    return (
      <div className="mx-auto max-w-[80%] rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
        <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-amber-700 uppercase">
          <StickyNote className="size-3" /> Nota interna · {m.sentByName}
        </div>
        {m.body}
        <div className="mt-0.5 text-right text-[11px] text-amber-700/80">{formatTime(m.sentAt)}</div>
      </div>
    );
  }
  const out = m.direction === "OUTBOUND";
  return (
    <div className={cn("flex", out ? "justify-end" : "justify-start")}>
      <div className="max-w-[75%]">
        <div className={cn("rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-line shadow-[var(--shadow-card)]", out ? "rounded-br-md bg-[#e3f1e8] text-ink" : "rounded-bl-md bg-surface text-ink ring-1 ring-line")}>
          {m.body}
        </div>
        <div className={cn("mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-ink-3", out ? "justify-end" : "justify-start")}>
          {out && m.automated && (
            <span className="inline-flex items-center gap-0.5 text-violet-700">
              <Workflow className="size-3" /> {m.automationKey === "sem-resposta-24h" ? "Follow-up automático" : m.automationKey === "assistencia-ia" ? "IA (automático)" : "Automação"}
            </span>
          )}
          {out && !m.automated && m.sentByName && <span>{m.sentByName}</span>}
          {out && m.freeText && (
            <span className="inline-flex items-center gap-0.5">
              · <PenLine className="size-3" /> Texto livre
            </span>
          )}
          {out && m.templateName && (
            <span>
              {m.combinedTemplates ? `· Modelos ${m.combinedTemplates}` : <>· Modelo “{m.templateName}”{m.templateVersion ? ` v${m.templateVersion}` : ""}</>}
            </span>
          )}
          {!out && m.intent && (
            <span className="inline-flex items-center gap-0.5 text-violet-700">
              <Sparkles className="size-3" /> {INTENT_SHORT[m.intent] ?? m.intent}
            </span>
          )}
          <span className="tnum">{formatTime(m.sentAt)}</span>
          {out && (m.status === "READ" ? <CheckCheck className="size-3.5 text-sky-500" /> : m.status === "DELIVERED" ? <CheckCheck className="size-3.5" /> : <Check className="size-3.5" />)}
        </div>
      </div>
    </div>
  );
}

function Notice({ children, icon, tone = "neutral" }: { children: React.ReactNode; icon: React.ReactNode; tone?: "neutral" | "red" }) {
  return (
    <div className={cn("flex items-center gap-2 rounded-lg px-3 py-2.5 text-[12.5px]", tone === "red" ? "bg-red-50 text-red-700" : "bg-stone-100 text-ink-2")}>
      {icon}
      {children}
    </div>
  );
}

function groupByCategory(templates: WorkspaceTemplate[]): [TemplateCategory, WorkspaceTemplate[]][] {
  const map = new Map<TemplateCategory, WorkspaceTemplate[]>();
  for (const t of templates) map.set(t.category, [...(map.get(t.category) ?? []), t]);
  return [...map.entries()];
}
