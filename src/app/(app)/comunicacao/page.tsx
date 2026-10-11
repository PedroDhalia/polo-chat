import { MessagesSquare, Workflow } from "lucide-react";
import Link from "@/components/ui/link";
import { EmptyState, Page, RestrictedAccess } from "@/components/ui/misc";
import { FilterChips, hrefWith, Tabs } from "@/components/ui/nav";
import { UrlSearch, UrlSelect } from "@/components/ui/url-filters";
import { ROLE } from "@/domain/labels";
import { ConversationWorkspace } from "@/features/communication/conversation-workspace";
import { ListPreview, TypingProvider } from "@/features/communication/typing-context";
import { ReviewView } from "@/features/communication/review-view";
import { TemplatesView } from "@/features/communication/templates-view";
import { formatAgo, formatRelativeDay, formatTime } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { maskPhone } from "@/lib/format";
import { can, getCurrentUser } from "@/server/auth/session";
import { countPendingReview, getConversation, INBOX_PAGE, listConversations, type InboxFilter } from "@/server/queries/communication";
import { studyOptions } from "@/server/queries/studies";

export const metadata = { title: "Comunicação" };

type SP = Promise<Record<string, string | undefined>>;
const FILTERS: InboxFilter[] = ["todas", "aguardando", "atencao", "novas"];

export default async function CommunicationPage({ searchParams }: { searchParams: SP }) {
  const user = await getCurrentUser();
  if (!can(user, "communication.view")) return <RestrictedAccess area="Comunicação" role={ROLE[user.role].label} />;
  const sp = await searchParams;
  const tab = sp.aba === "modelos" ? "modelos" : sp.aba === "revisao" ? "revisao" : "conversas";
  const pendingReview = await countPendingReview(user);
  const filter = FILTERS.includes(sp.filtro as InboxFilter) ? (sp.filtro as InboxFilter) : "todas";

  const header = (
    <div className="flex items-end justify-between gap-4 px-8 pt-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Comunicação</h1>
        <p className="mt-1 text-[13.5px] text-ink-2">Central de mensagens com participantes. WhatsApp simulado — nenhuma mensagem real é enviada.</p>
      </div>
      <Tabs
        className="border-b-0"
        items={[
          { label: "Conversas", href: hrefWith("/comunicacao", { c: sp.c }, {}), active: tab === "conversas" },
          { label: "Revisão da IA", href: "/comunicacao?aba=revisao", active: tab === "revisao", count: pendingReview },
          { label: "Modelos aprovados", href: "/comunicacao?aba=modelos", active: tab === "modelos" },
        ]}
      />
    </div>
  );

  if (tab === "revisao") {
    return (
      <>
        {header}
        <Page className="pt-5">
          <ReviewView user={user} />
        </Page>
      </>
    );
  }

  if (tab === "modelos") {
    return (
      <>
        {header}
        <Page className="pt-5">
          <TemplatesView user={user} />
        </Page>
      </>
    );
  }

  const [inbox, studies] = await Promise.all([listConversations(user, { filter, studyId: sp.estudo, q: sp.q, limit: Number(sp.limite) || undefined }), studyOptions(user)]);
  const selectedId = sp.c ?? inbox.items[0]?.id;
  const detail = selectedId ? await getConversation(user, selectedId) : null;
  const current = { filtro: sp.filtro, estudo: sp.estudo, q: sp.q, c: sp.c, limite: sp.limite };
  const now = new Date();

  return (
    <div className="flex h-[calc(100vh-16px-58px)] min-h-[620px] flex-col">
      {header}
      <TypingProvider>
      <div className="mt-4 grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_300px] border-t border-line">
        {/* Lista de conversas */}
        <nav className="flex min-h-0 flex-col border-r border-line">
          <div className="space-y-2 border-b border-line p-3">
            <UrlSearch placeholder="Buscar participante" />
            <UrlSelect param="estudo" placeholder="Todos os estudos" options={studies} className="w-full" />
            <FilterChips
              items={[
                { label: "Todas", href: hrefWith("/comunicacao", current, { filtro: null, c: null, limite: null }), active: filter === "todas", count: inbox.counts.todas },
                { label: "Aguardando", href: hrefWith("/comunicacao", current, { filtro: "aguardando", c: null, limite: null }), active: filter === "aguardando", count: inbox.counts.aguardando },
                { label: "Atenção", href: hrefWith("/comunicacao", current, { filtro: "atencao", c: null, limite: null }), active: filter === "atencao", count: inbox.counts.atencao, tone: "alert" },
                { label: "Novas", href: hrefWith("/comunicacao", current, { filtro: "novas", c: null, limite: null }), active: filter === "novas", count: inbox.counts.novas },
              ]}
              className="[&_a]:h-7 [&_a]:px-2 [&_a]:text-[12px]"
            />
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
            {inbox.items.length === 0 && <li className="px-4 py-8 text-center text-[13px] text-ink-3">Nenhuma conversa.</li>}
            {inbox.items.map((c) => {
              const active = c.id === selectedId;
              const awaiting = c.nextVisit?.status === "AGUARDANDO_CONFIRMACAO";
              return (
                <li key={c.id}>
                  <Link
                    href={hrefWith("/comunicacao", current, { c: c.id })}
                    scroll={false}
                    className={cn("block border-b border-line/70 px-4 py-3 transition-colors", active ? "bg-brand-50/70" : "hover:bg-subtle")}
                  >
                    <div className="flex items-center gap-2">
                      {c.status === "REQUER_ATENCAO" && <span className="size-2 shrink-0 rounded-full bg-red-500" title="Requer atenção" />}
                      <span className={cn("min-w-0 flex-1 truncate text-[13.5px]", c.unreadCount > 0 ? "font-semibold text-ink" : "font-medium text-ink")}>{c.participant.fullName}</span>
                      <span className="shrink-0 text-[11.5px] text-ink-3">{c.lastMessage ? formatAgo(c.lastMessage.sentAt, now).replace("há ", "") : ""}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className="text-[11.5px] font-medium text-ink-3">{c.study.code}</span>
                      {c.nextVisit && (
                        <span className={cn("rounded px-1 text-[11px]", awaiting ? "bg-amber-100 text-amber-800" : "bg-stone-100 text-ink-3")}>
                          Visita {formatRelativeDay(c.nextVisit.scheduledAt, now).toLowerCase()} {formatTime(c.nextVisit.scheduledAt)}
                          {awaiting ? " · aguardando" : ""}
                        </span>
                      )}
                    </div>
                    {c.lastMessage && (
                      <div className="mt-1 flex items-center gap-1 text-[12.5px] text-ink-3">
                        <ListPreview conversationId={c.id}>
                          {c.lastMessage.automated && <Workflow className="size-3 shrink-0 text-violet-500" />}
                          <span className="truncate">
                            {c.lastMessage.direction === "OUTBOUND" ? "Você: " : c.lastMessage.direction === "INTERNAL_NOTE" ? "Nota: " : ""}
                            {c.lastMessage.body}
                          </span>
                        </ListPreview>
                        {c.unreadCount > 0 && <span className="ml-auto flex size-4.5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[10px] font-semibold text-white">{c.unreadCount}</span>}
                      </div>
                    )}
                  </Link>
                </li>
              );
            })}
            {inbox.hasMore && (
              <li className="p-3">
                <Link
                  href={hrefWith("/comunicacao", current, { limite: String(inbox.limit + INBOX_PAGE) })}
                  scroll={false}
                  className="block rounded-lg py-2 text-center text-[12.5px] font-medium text-brand-700 ring-1 ring-line hover:bg-subtle"
                >
                  Carregar mais conversas
                </Link>
              </li>
            )}
          </ul>
        </nav>

        {detail ? (
          <ConversationWorkspace
            conversation={{ id: detail.conversation.id, status: detail.conversation.status, unreadCount: detail.conversation.unreadCount }}
            participant={{
              id: detail.conversation.participant.id,
              fullName: detail.conversation.participant.fullName,
              code: detail.conversation.participant.code,
              status: detail.conversation.participant.status,
              phoneMasked: maskPhone(detail.conversation.participant.phone),
              ownerName: detail.conversation.participant.owner?.name ?? null,
              studyCode: detail.conversation.study.code,
              tasks: detail.conversation.participant.tasks.map((t) => ({ id: t.id, title: t.title, priority: t.priority, dueAt: t.dueAt, assigneeName: t.assignee?.name ?? null })),
            }}
            visit={
              detail.visit && {
                id: detail.visit.id,
                name: detail.visit.name,
                scheduledAt: detail.visit.scheduledAt,
                status: detail.visit.status,
                windowStart: detail.visit.windowStart,
                windowEnd: detail.visit.windowEnd,
                rescheduleCount: detail.visit.rescheduleCount,
                proposedAt: detail.visit.proposedAt,
              }
            }
            messages={detail.conversation.messages.map((m) => ({
              id: m.id,
              direction: m.direction,
              body: m.body,
              status: m.status,
              automated: m.automated,
              intent: m.intent,
              sentAt: m.sentAt,
              templateName: m.template?.name ?? null,
              templateVersion: m.template?.version ?? null,
              sentByName: m.sentBy?.name ?? null,
              automationKey: m.automationKey,
              freeText: m.direction === "OUTBOUND" && !m.templateId,
            }))}
            templates={detail.templates.map((t) => ({ id: t.id, key: t.key, name: t.name, category: t.category, body: t.body, approvalStatus: t.approvalStatus, version: t.version, cepReference: t.cepReference, studyId: t.studyId }))}
            whatsappConsent={detail.whatsappConsent}
            assist={detail.assist}
            decision={
              detail.decision && {
                id: detail.decision.id,
                outcome: detail.decision.outcome,
                intent: detail.decision.intent,
                confidence: detail.decision.confidence,
                ambiguous: detail.decision.ambiguous,
                reason: detail.decision.reason,
                action: detail.decision.action,
                verdict: detail.decision.verdict,
                reviewedByName: detail.decision.reviewedBy?.name ?? null,
                source: detail.decision.source,
                rulesIntent: detail.decision.rulesIntent,
                rulesConfidence: detail.decision.rulesConfidence,
                ai: detail.aiUsage && {
                  mode: detail.aiUsage.mode,
                  model: detail.aiUsage.model,
                  status: detail.aiUsage.status,
                  rationale: detail.aiUsage.rationale,
                  tokens: detail.aiUsage.inputTokens + detail.aiUsage.outputTokens + detail.aiUsage.cacheReadTokens + detail.aiUsage.cacheWriteTokens,
                  costUsd: detail.aiUsage.costUsd,
                },
              }
            }
            policyMin={detail.policy?.minConfidence ?? null}
            followUp={detail.followUp}
            permissions={{ send: can(user, "communication.send"), agenda: can(user, "agenda.manage"), tasks: can(user, "tasks.manage"), review: can(user, "audit.view") }}
          />
        ) : (
          <div className="col-span-2 flex items-center justify-center">
            <EmptyState icon={<MessagesSquare className="size-5" />} title="Selecione uma conversa" />
          </div>
        )}
      </div>
      </TypingProvider>
    </div>
  );
}
