import { ChevronDown } from "lucide-react";
import { formatNumber, formatPct, ratio } from "@/lib/format";

export interface FunnelStage {
  key: string;
  name: string;
  description?: string;
  value: number;
}

/** Funil de recrutamento: uma série, barras centradas e conversão entre etapas. */
export function Funnel({ stages }: { stages: FunnelStage[] }) {
  const top = Math.max(1, stages[0]?.value ?? 1);
  return (
    <ol className="space-y-0">
      {stages.map((s, i) => {
        const pct = Math.max(2, (s.value / top) * 100);
        const prev = i > 0 ? stages[i - 1].value : null;
        return (
          <li key={s.key}>
            {prev !== null && (
              <div className="flex items-center justify-center gap-1.5 py-1 text-[11.5px] text-ink-3">
                <ChevronDown className="size-3" />
                <span className="tnum">{formatPct(ratio(s.value, prev))}</span> avançam
              </div>
            )}
            <div className="group grid grid-cols-[140px_1fr_96px] items-center gap-4" title={`${s.name}: ${formatNumber(s.value)} (${formatPct(ratio(s.value, top), 1)} da base)`}>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-ink">{s.name}</div>
                {s.description && <div className="truncate text-[11.5px] text-ink-3">{s.description}</div>}
              </div>
              <div className="flex h-8 items-center justify-center rounded-md bg-stone-50">
                <div className="h-full rounded-[4px] bg-chart-accent transition-opacity group-hover:opacity-85" style={{ width: `${pct}%` }} />
              </div>
              <div className="text-right">
                <div className="text-[15px] font-semibold text-ink tnum">{formatNumber(s.value)}</div>
                <div className="text-[11.5px] whitespace-nowrap text-ink-3 tnum">{i === 0 ? "base" : `${formatPct(ratio(s.value, top), 1)} da base`}</div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
