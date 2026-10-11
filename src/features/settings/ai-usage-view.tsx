import { Coins, Cpu, MessagesSquare, TrendingUp } from "lucide-react";
import Link from "@/components/ui/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { BarList } from "@/components/charts/bar-list";
import { ColumnChart } from "@/components/charts/column-chart";
import { EmptyState } from "@/components/ui/misc";
import { FilterChips, hrefWith } from "@/components/ui/nav";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { INTENT_LABEL, type AssistIntent } from "@/domain/assist-policy";
import { formatDateTime } from "@/lib/dates";
import { formatNumber } from "@/lib/format";
import { AI_USAGE_PERIODS, type AiOutcome, type AiUsageReport } from "@/server/queries/ai-usage";

const usd = (n: number) => `US$ ${(n >= 1 ? n.toFixed(2) : n.toFixed(4)).replace(".", ",")}`;

const OUTCOME_LABEL: Record<AiOutcome, string> = {
  AUTOMATICA: "Aplicada sozinha",
  EQUIPE: "Foi para a fila",
  ENCAMINHADA: "Encaminhada (clínico)",
  SEM_GANHO: "Valeram as regras",
  ERRO: "Erro ou indisponível",
};
const OUTCOME_TONE: Record<AiOutcome, "brand" | "amber" | "red" | "neutral"> = {
  AUTOMATICA: "brand",
  EQUIPE: "amber",
  ENCAMINHADA: "red",
  SEM_GANHO: "neutral",
  ERRO: "red",
};

/** Consumo da segunda opinião da IA: tokens, custo estimado e o que cada análise resolveu. */
export function AiUsageView({ report }: { report: AiUsageReport }) {
  const t = report.totals;
  const tokensIn = t.input + t.cacheRead + t.cacheWrite;
  const projection = (t.cost / report.days) * 30;
  const okCalls = t.calls - t.errors;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-4 text-[13px] text-ink-2">
        {report.mode === "mock" ? (
          <>
            <strong className="font-medium text-ink">Modo simulado.</strong> Nenhuma chamada real à API: os tokens e o custo abaixo são estimativas do que uma chamada real gastaria com{" "}
            <code className="rounded bg-violet-100 px-1 text-[12px]">{report.model}</code>. Para ligar a IA real, defina <code className="rounded bg-violet-100 px-1 text-[12px]">ASSIST_AI_MODE=live</code> e a chave da API da Anthropic.
          </>
        ) : (
          <>
            <strong className="font-medium text-ink">Chamadas reais à API da Anthropic</strong> (<code className="rounded bg-violet-100 px-1 text-[12px]">{report.model}</code>). Custo estimado pelo preço público do modelo; a fatura oficial fica no Console da Anthropic.
          </>
        )}{" "}
        A IA só é chamada para mensagens que as regras não resolveram. O consumo é mantido ao restaurar os dados de demonstração.
      </div>

      <FilterChips
        items={AI_USAGE_PERIODS.map((d) => ({ label: `${d} dias`, href: hrefWith("/configuracoes", { secao: "ia-consumo" }, { periodo: String(d) }), active: d === report.days }))}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Mensagens analisadas" icon={<MessagesSquare />} value={formatNumber(t.calls)} sub={t.errors ? `${t.errors} com erro` : "nenhum erro"} subTone={t.errors ? "red" : undefined} />
        <StatTile label="Tokens" icon={<Cpu />} value={formatNumber(tokensIn + t.output)} sub={`${formatNumber(tokensIn)} entrada · ${formatNumber(t.output)} saída`} />
        <StatTile label="Custo estimado" icon={<Coins />} value={usd(t.cost)} sub={okCalls ? `média ${usd(t.cost / okCalls)} por mensagem` : "—"} />
        <StatTile label="Projeção para 30 dias" icon={<TrendingUp />} value={usd(projection)} sub={`no ritmo dos últimos ${report.days} dias`} />
      </div>

      {t.calls === 0 ? (
        <Card>
          <EmptyState
            title="Nenhuma análise da IA no período"
            description="A IA só entra quando as regras não resolvem. Para testar, simule “comfirmo” ou “tô dentro!” numa conversa com visita aguardando confirmação."
          />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader
              title="Tokens por dia"
              description={`Entrada inclui as instruções fixas (em cache: ${formatNumber(t.cacheRead)} tokens lidos do cache no período). Saída inclui o raciocínio curto do modelo.`}
            />
            <CardBody>
              <ColumnChart
                data={report.byDay.map((d) => ({ label: report.days > 7 ? d.label.slice(0, 2) : d.label, title: `${d.title} · ${d.calls} mensage${d.calls === 1 ? "m" : "ns"} · ${usd(d.cost)}`, values: { entrada: d.input, saida: d.output } }))}
                series={[
                  { key: "entrada", label: "Entrada", color: "var(--color-chart-series-1)" },
                  { key: "saida", label: "Saída", color: "var(--color-chart-series-2)" },
                ]}
              />
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="O que a IA resolveu" description="Resultado de cada análise no período." />
              <CardBody>
                <BarList
                  items={(Object.keys(OUTCOME_LABEL) as AiOutcome[]).map((k) => ({ label: OUTCOME_LABEL[k], value: report.outcomes[k], hint: t.calls ? `${Math.round((report.outcomes[k] / t.calls) * 100)}%` : undefined }))}
                  reserve={230}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Custo por estudo" description="Estimativa no período." />
              <CardBody>
                <BarList items={report.byStudy.map((s) => ({ label: s.code, value: s.cost, hint: `${s.calls} mensage${s.calls === 1 ? "m" : "ns"}` }))} valueFormatter={usd} />
              </CardBody>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <CardHeader title="Últimas análises" description="Cada linha é uma mensagem que as regras não resolveram e foi para a IA." />
            <Table className="border-t border-line">
              <THead>
                <Th>Quando</Th>
                <Th>Participante</Th>
                <Th>Mensagem</Th>
                <Th>Leitura da IA</Th>
                <Th>Resultado</Th>
                <Th className="text-right">Tokens (entrada · saída)</Th>
                <Th className="text-right">Custo</Th>
              </THead>
              <tbody>
                {report.recent.map((r) => (
                  <Tr key={r.id}>
                    <Td className="text-[12px] whitespace-nowrap text-ink-3 tnum">{formatDateTime(r.createdAt)}</Td>
                    <Td>
                      {!r.participantName ? (
                        <span className="text-[12.5px] text-ink-3">Antes da restauração da demo</span>
                      ) : r.conversationId ? (
                        <Link href={`/comunicacao?c=${r.conversationId}`} className="font-medium whitespace-nowrap text-ink hover:text-brand-700">
                          {r.participantName}
                        </Link>
                      ) : (
                        <span className="font-medium text-ink">{r.participantName}</span>
                      )}
                      <div className="text-[11.5px] text-ink-3">{r.studyCode}</div>
                    </Td>
                    <Td className="max-w-[260px] text-[12.5px] text-ink-2">
                      {r.body ? (
                        <span className="block truncate" title={r.body}>
                          “{r.body}”
                        </span>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </Td>
                    <Td className="text-[12.5px] whitespace-nowrap">
                      {r.intent ? `${INTENT_LABEL[r.intent as AssistIntent] ?? r.intent} · ${r.confidence}` : <span className="text-red-700" title={r.error ?? ""}>{r.error ? "erro" : "—"}</span>}
                    </Td>
                    <Td>
                      <Badge tone={OUTCOME_TONE[r.outcome]}>{OUTCOME_LABEL[r.outcome]}</Badge>
                    </Td>
                    <Td className="text-right text-[12.5px] whitespace-nowrap text-ink-2 tnum">
                      {formatNumber(r.input)} · {formatNumber(r.output)}
                      {r.cached > 0 && <div className="text-[11px] text-ink-3">{formatNumber(r.cached)} do cache</div>}
                    </Td>
                    <Td className="text-right text-[12.5px] whitespace-nowrap tnum">
                      {usd(r.cost)}
                      {r.mode === "mock" && <div className="text-[11px] text-ink-3">simulado</div>}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
