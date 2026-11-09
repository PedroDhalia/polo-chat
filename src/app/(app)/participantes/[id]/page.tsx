import { ArrowLeft, CalendarClock, CircleCheck, CircleX, Database, MessagesSquare, Target } from "lucide-react";
import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar, EmptyState, Page, RestrictedAccess, SourceTag } from "@/components/ui/misc";
import { CHANNEL, PARTICIPANT_STATUS, REIMBURSEMENT_STATUS, ROLE, TASK_PRIORITY, VISIT_STATUS } from "@/domain/labels";
import { LogContactButton, RevealPhone, StatusMenu } from "@/features/participants/participant-client";
import { Timeline } from "@/features/participants/timeline";
import { TaskCheck } from "@/features/tasks/task-check";
import { VisitActions } from "@/features/visits/visit-actions";
import { formatDate, formatDayMonth, formatRelativeDateTime, formatTime, toDateParam, addDays } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { formatBRL, maskPhone } from "@/lib/format";
import { can, getCurrentUser } from "@/server/auth/session";
import { RESCHEDULE_LIMIT } from "@/domain/rules";
import { getParticipantDetail } from "@/server/queries/participants";

export const metadata = { title: "Participante" };

const CONSENT_LABEL = { CONTATO_WHATSAPP: "Contato por WhatsApp", CONTATO_TELEFONE: "Contato por telefone", BANCO_VOLUNTARIOS: "Banco de voluntários" } as const;

export default async function ParticipantPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!can(user, "participants.view")) return <RestrictedAccess area="Participantes" role={ROLE[user.role].label} />;
  const { id } = await params;
  const p = await getParticipantDetail(user, id);
  if (!p) notFound();
  const now = new Date();
  const canEdit = can(user, "participants.edit");
  const canAgenda = can(user, "agenda.manage");
  const canTasks = can(user, "tasks.manage");
  const conversation = p.conversations[0];
  const latestConsent = (purpose: keyof typeof CONSENT_LABEL) => p.consents.find((c) => c.purpose === purpose);
  const upcoming = p.visits.filter((v) => v.scheduledAt >= addDays(now, -1) || v.status === "FALTOU" || v.status === "REAGENDAMENTO_SOLICITADO");
  const past = p.visits.filter((v) => !upcoming.includes(v)).reverse();
  const overdue = p.nextActionDueAt && p.nextActionDueAt < now;

  return (
    <Page>
      <Link href="/participantes" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink">
        <ArrowLeft className="size-3.5" /> Participantes
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar name={p.fullName} size="lg" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-semibold tracking-tight">{p.fullName}</h1>
              <StatusBadge map={PARTICIPANT_STATUS} value={p.status} />
            </div>
            <p className="mt-0.5 text-[13px] text-ink-3">
              <span className="tnum">{p.code}</span> ·{" "}
              <Link href={`/estudos/${p.study.code}`} className="font-medium text-ink-2 hover:text-brand-700">
                {p.study.code}
              </Link>{" "}
              · {p.study.name}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can(user, "communication.view") && (
            <ButtonLink href={conversation ? `/comunicacao?c=${conversation.id}` : "/comunicacao"} variant="secondary">
              <MessagesSquare className="size-3.5" /> Abrir conversa
            </ButtonLink>
          )}
          <LogContactButton participantId={p.id} disabled={!canEdit} />
          <StatusMenu participantId={p.id} status={p.status} disabled={!canEdit} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* Coluna esquerda */}
        <div className="space-y-5 xl:col-span-4">
          <Card>
            <CardHeader title="Dados básicos" />
            <CardBody>
              <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-3 text-[13px]">
                <dt className="text-ink-3">Telefone</dt>
                <dd>
                  <RevealPhone participantId={p.id} masked={maskPhone(p.phone)} allowed={can(user, "participants.contact")} />
                </dd>
                <dt className="text-ink-3">Estudo</dt>
                <dd className="text-ink">{p.study.code}</dd>
                <dt className="text-ink-3">Status</dt>
                <dd>
                  <StatusBadge map={PARTICIPANT_STATUS} value={p.status} />
                </dd>
                <dt className="text-ink-3">Origem</dt>
                <dd className="text-ink">
                  {CHANNEL[p.channel].label}
                  {p.recruitment?.campaign && <div className="text-[12px] text-ink-3">{p.recruitment.campaign}</div>}
                </dd>
                <dt className="text-ink-3">Responsável</dt>
                <dd className="flex items-center gap-2 text-ink">
                  {p.owner ? (
                    <>
                      <Avatar name={p.owner.name} size="xs" /> {p.owner.name}
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
                <dt className="text-ink-3">Etapa do funil</dt>
                <dd className="text-ink">{p.recruitment?.stage.name ?? "—"}</dd>
                <dt className="text-ink-3">Cadastro</dt>
                <dd className="text-ink tnum">{formatDate(p.createdAt)}</dd>
                {p.externalRefs.length > 0 && (
                  <>
                    <dt className="text-ink-3">IDs externos</dt>
                    <dd className="space-y-1">
                      {p.externalRefs.map((r) => (
                        <div key={r.id} className="flex items-center gap-1.5 text-[12px] text-ink-2">
                          <Database className="size-3 text-ink-3" />
                          {r.system === "POLO_TRIAL" ? "Polo Trial" : r.system === "FORMS" ? "Formulário" : r.system}: <span className="tnum">{r.externalId}</span>
                        </div>
                      ))}
                    </dd>
                  </>
                )}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Consentimentos" description="Base para contato e retenção de dados." />
            <CardBody className="space-y-2.5">
              {(["CONTATO_WHATSAPP", "CONTATO_TELEFONE"] as const).map((purpose) => {
                const c = latestConsent(purpose);
                const ok = !!c && c.granted && !c.revokedAt;
                return (
                  <div key={purpose} className="flex items-start gap-2.5 text-[13px]">
                    {ok ? <CircleCheck className="mt-0.5 size-4 text-brand-600" /> : <CircleX className="mt-0.5 size-4 text-red-500" />}
                    <div>
                      <div className="font-medium text-ink">{CONSENT_LABEL[purpose]}</div>
                      <div className="text-[12px] text-ink-3">
                        {c ? (c.revokedAt ? `Revogado em ${formatDate(c.revokedAt)}` : ok ? `${c.source} · ${formatDate(c.recordedAt)}` : "Não autorizado") : "Sem registro"}
                        {c?.retentionUntil && ok && ` · retenção até ${formatDate(c.retentionUntil)}`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Visitas" description="Nomes e janelas conforme o Polo Trial." />
            <div className="border-t border-line">
              {p.visits.length === 0 && <EmptyState title="Nenhuma visita" className="py-6" />}
              {[...upcoming, ...past].map((v) => (
                <div key={v.id} className="border-b border-line px-5 py-3 last:border-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-ink">{v.name}</div>
                      <div className="text-[12px] text-ink-3 tnum">
                        {formatRelativeDateTime(v.scheduledAt, now)} · {v.room}
                      </div>
                    </div>
                    <StatusBadge map={VISIT_STATUS} value={v.status} />
                  </div>
                  {(v.windowEnd || v.rescheduleCount > 0) && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-3">
                      {v.windowStart && v.windowEnd && (
                        <SourceTag kind="polo">
                          Janela {formatDayMonth(v.windowStart)}–{formatDayMonth(v.windowEnd)}
                        </SourceTag>
                      )}
                      {v.rescheduleCount > 0 && (
                        <Badge tone={v.rescheduleCount >= RESCHEDULE_LIMIT - 1 ? "amber" : "neutral"}>
                          {v.rescheduleCount} de {RESCHEDULE_LIMIT} remarcações
                        </Badge>
                      )}
                    </div>
                  )}
                  {canAgenda && upcoming.includes(v) && (
                    <div className="mt-2">
                      <VisitActions visitId={v.id} status={v.status} defaultDate={toDateParam(addDays(now, 1))} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Coluna direita */}
        <div className="space-y-5 xl:col-span-8">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className={cn("rounded-xl border p-5", overdue ? "border-red-200 bg-red-50/60" : "border-brand-200 bg-brand-50/70")}>
              <div className={cn("flex items-center gap-2 text-[12px] font-semibold tracking-wide uppercase", overdue ? "text-red-700" : "text-brand-700")}>
                <Target className="size-3.5" /> Próxima ação
              </div>
              <p className="mt-2 text-[17px] font-semibold tracking-tight text-ink">{p.nextAction ?? "Nenhuma ação pendente"}</p>
              {p.nextActionDueAt && (
                <p className={cn("mt-1 flex items-center gap-1.5 text-[13px]", overdue ? "font-medium text-red-700" : "text-ink-2")}>
                  <CalendarClock className="size-3.5" />
                  {overdue ? "Vencida · " : "Até "}
                  {formatRelativeDateTime(p.nextActionDueAt, now)}
                </p>
              )}
              {p.lastContactAt && <p className="mt-3 text-[12px] text-ink-3">Último contato: {formatRelativeDateTime(p.lastContactAt, now)}</p>}
            </div>

            <Card>
              <CardHeader title="Pendências abertas" description={`${p.tasks.length} relacionada(s) a este participante`} />
              <ul className="border-t border-line">
                {p.tasks.length === 0 && <li className="px-5 py-5 text-center text-[13px] text-ink-3">Nenhuma pendência aberta.</li>}
                {p.tasks.map((t) => (
                  <li key={t.id} className="flex items-start gap-3 border-b border-line px-5 py-2.5 last:border-0">
                    <span className="pt-0.5">
                      <TaskCheck taskId={t.id} done={false} disabled={!canTasks} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-ink">{t.title}</div>
                      <div className={cn("text-[12px] tnum", t.dueAt < now ? "text-red-600" : "text-ink-3")}>
                        {formatRelativeDateTime(t.dueAt, now)} · {t.assignee?.name ?? "Sem responsável"}
                      </div>
                    </div>
                    <StatusBadge map={TASK_PRIORITY} value={t.priority} />
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card>
            <CardHeader title="Linha do tempo" description="Tudo o que aconteceu com o participante, de todas as fontes, em um só lugar." />
            <CardBody>
              <Timeline items={p.timeline} />
            </CardBody>
          </Card>

          {p.reimbursements.length > 0 && (
            <Card>
              <CardHeader title="Reembolsos" />
              <ul className="border-t border-line">
                {p.reimbursements.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 border-b border-line px-5 py-2.5 text-[13px] last:border-0">
                    <span className="w-20 text-ink-3 tnum">{r.code}</span>
                    <span className="flex-1 text-ink-2">{r.visit?.name ?? r.description}</span>
                    <span className="font-medium text-ink tnum">{formatBRL(r.amountCents)}</span>
                    <StatusBadge map={REIMBURSEMENT_STATUS} value={r.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <p className="text-[12px] text-ink-3">
            Ficha operacional com dados fictícios. Informações clínicas (eventos adversos, exames, CRF) não são registradas no Polo Chat. Cadastro {formatDayMonth(p.createdAt)} às {formatTime(p.createdAt)}.
          </p>
        </div>
      </div>
    </Page>
  );
}
