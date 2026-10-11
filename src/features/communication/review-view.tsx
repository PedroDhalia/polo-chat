import { Inbox, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import Link from "@/components/ui/link";
import { EmptyState } from "@/components/ui/misc";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { INTENT_ACTION, INTENT_LABEL, isActionable, type AssistIntent } from "@/domain/assist-policy";
import { formatAgo } from "@/lib/dates";
import { formatPct, ratio } from "@/lib/format";
import { can, type SessionUser } from "@/server/auth/session";
import { listAssistReview } from "@/server/queries/communication";
import { PendingActions, VerdictActions } from "./review-actions";

const label = (intent: string) => INTENT_LABEL[intent as AssistIntent] ?? intent;

function Message({ body, conversationId, name }: { body: string; conversationId: string | null; name: string }) {
  return (
    <div className="max-w-[340px]">
      <Link href={conversationId ? `/comunicacao?c=${conversationId}` : "/comunicacao"} className="font-medium whitespace-nowrap text-ink hover:text-brand-700">
        {name}
      </Link>
      <p className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-2">“{body}”</p>
    </div>
  );
}

export async function ReviewView({ user }: { user: SessionUser }) {
  const { pending, automatic, stats } = await listAssistReview(user);
  const now = new Date();
  const canSend = can(user, "communication.send");
  const canReview = canSend || can(user, "audit.view");

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Aguardando revisão" value={stats.pending} sub="Sugestões que precisam da equipe" subTone={stats.pending > 0 ? "amber" : undefined} />
        <StatTile label="Aplicadas sozinhas (7 dias)" value={stats.auto7} sub={`${stats.approved7} sugestões aprovadas pela equipe`} />
        <StatTile
          label="Acerto nas revisões"
          value={stats.reviewed ? formatPct(ratio(stats.correct, stats.reviewed)) : "—"}
          sub={stats.reviewed ? `${stats.correct} de ${stats.reviewed} decisões automáticas revisadas` : "Nenhuma decisão automática revisada ainda"}
          subTone={stats.reviewed && stats.correct < stats.reviewed ? "amber" : undefined}
        />
        <StatTile label="Encaminhadas à equipe médica" value={stats.escalated7} sub="Possíveis relatos clínicos (7 dias)" />
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title="Aguardando revisão"
          description="A assistência classificou, mas não agiu: modo sugestão, confiança abaixo do mínimo ou mais de uma intenção."
          action={
            can(user, "automations.manage") && (
              <Link href="/configuracoes?secao=ia" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand-700 hover:underline">
                <Settings2 className="size-3.5" /> Política por estudo
              </Link>
            )
          }
        />
        {pending.length === 0 ? (
          <EmptyState icon={<Inbox className="size-5" />} title="Fila vazia" description="Nenhuma mensagem esperando decisão da equipe." className="border-t border-line" />
        ) : (
          <Table className="border-t border-line">
            <THead>
              <Th>Mensagem</Th>
              <Th>Estudo</Th>
              <Th>Intenção · confiança</Th>
              <Th>Por que não foi automática</Th>
              <Th>Sugestão</Th>
              <Th className="text-right">Decisão</Th>
            </THead>
            <tbody>
              {pending.map((d) => (
                <Tr key={d.id}>
                  <Td>
                    <Message body={d.communication.body} conversationId={d.communication.conversationId} name={d.participant.fullName} />
                    <div className="text-[11.5px] text-ink-3">{formatAgo(d.createdAt, now)}</div>
                  </Td>
                  <Td className="font-medium whitespace-nowrap text-ink-2">{d.study.code}</Td>
                  <Td>
                    <div className="whitespace-nowrap text-ink">
                      {label(d.intent)}
                      {d.source === "IA" && <span className="ml-1.5 rounded bg-violet-100 px-1 py-px text-[10.5px] font-medium text-violet-700">IA</span>}
                    </div>
                    <div className="text-[11.5px] text-ink-3 tnum">confiança {d.confidence}{d.ambiguous ? " · ambígua" : ""}</div>
                  </Td>
                  <Td className="max-w-[220px] text-[12.5px] text-ink-2">{d.reason}</Td>
                  <Td className="max-w-[240px] text-[12.5px] text-ink-2">{isActionable(d.intent) ? (d.action ?? INTENT_ACTION[d.intent]) : "Responder pela conversa"}</Td>
                  <Td className="text-right">
                    <PendingActions decisionId={d.id} intent={d.intent} action={d.action} canSend={canSend} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Aplicadas sozinhas — revisão por amostragem" description="Últimos 14 dias. Marque se a assistência acertou: a taxa de acerto orienta a confiança mínima de cada estudo." />
        {automatic.length === 0 ? (
          <EmptyState title="Nenhuma decisão automática recente" description="Ative o modo automático para uma intenção em Configurações → Assistência IA." className="border-t border-line" />
        ) : (
          <Table className="border-t border-line">
            <THead>
              <Th>Mensagem</Th>
              <Th>Estudo</Th>
              <Th>Intenção · confiança</Th>
              <Th>O que foi feito</Th>
              <Th className="text-right">A IA acertou?</Th>
            </THead>
            <tbody>
              {automatic.map((d) => (
                <Tr key={d.id}>
                  <Td>
                    <Message body={d.communication.body} conversationId={d.communication.conversationId} name={d.participant.fullName} />
                    <div className="text-[11.5px] text-ink-3">{formatAgo(d.createdAt, now)}</div>
                  </Td>
                  <Td className="font-medium whitespace-nowrap text-ink-2">{d.study.code}</Td>
                  <Td>
                    <div className="whitespace-nowrap text-ink">
                      {label(d.intent)}
                      {d.source === "IA" && <span className="ml-1.5 rounded bg-violet-100 px-1 py-px text-[10.5px] font-medium text-violet-700">IA</span>}
                    </div>
                    <div className="text-[11.5px] text-ink-3 tnum">confiança {d.confidence}</div>
                  </Td>
                  <Td className="max-w-[280px] text-[12.5px] text-ink-2">
                    {d.action ?? "—"}
                    <div className="mt-0.5">
                      <Badge tone="green">Automática</Badge>
                    </div>
                  </Td>
                  <Td className="text-right">
                    <VerdictActions decisionId={d.id} verdict={d.verdict} reviewer={d.reviewedBy?.name ?? null} canReview={canReview} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
