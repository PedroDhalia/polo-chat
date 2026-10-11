"use client";

import { useState } from "react";
import { formatNumber } from "@/lib/format";

export interface ColumnSeries {
  key: string;
  label: string;
  color: string;
}

export interface ColumnDatum {
  label: string;
  /** Rótulo longo exibido no tooltip. */
  title?: string;
  values: Record<string, number>;
}

/**
 * Colunas (empilhadas quando há mais de uma série). Barras de até 24px, ponta arredondada,
 * 2px de respiro entre segmentos, grade em linha fina e tooltip por coluna.
 */
export function ColumnChart({ data, series, height = 200, labelLast = true }: { data: ColumnDatum[]; series: ColumnSeries[]; height?: number; labelLast?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = data.map((d) => series.reduce((a, s) => a + (d.values[s.key] ?? 0), 0));
  const rawMax = Math.max(1, ...totals);
  const step = niceStep(rawMax / 4);
  const max = Math.ceil(rawMax / step) * step;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const plotH = height - 24;

  return (
    <div className="relative select-none">
      <div className="flex gap-3">
        {/* eixo y */}
        <div className="relative w-8 shrink-0 text-right text-[11px] text-ink-3 tnum" style={{ height: plotH }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: plotH - (t / max) * plotH }}>
              {formatNumber(t)}
            </span>
          ))}
        </div>
        <div className="relative flex-1">
          {/* grade */}
          <div className="absolute inset-x-0 top-0" style={{ height: plotH }}>
            {ticks.map((t) => (
              <div key={t} className={t === 0 ? "absolute inset-x-0 h-px bg-chart-axis" : "absolute inset-x-0 h-px bg-chart-grid"} style={{ top: plotH - (t / max) * plotH }} />
            ))}
          </div>
          {/* colunas */}
          <div className="relative flex items-end" style={{ height: plotH }}>
            {data.map((d, i) => {
              const isLast = i === data.length - 1;
              return (
                <div
                  key={d.label + i}
                  className="relative flex h-full flex-1 cursor-default items-end justify-center"
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover((h) => (h === i ? null : h))}
                  tabIndex={0}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  aria-label={`${d.title ?? d.label}: ${series.map((s) => `${s.label} ${d.values[s.key] ?? 0}`).join(", ")}`}
                >
                  {hover === i && <div className="absolute inset-y-0 inset-x-0.5 rounded bg-stone-100/70" />}
                  <div className="relative flex w-full max-w-6 flex-col-reverse gap-[2px]">
                    {series.map((s, si) => {
                      const v = d.values[s.key] ?? 0;
                      if (v <= 0) return null;
                      const isTop = series.slice(si + 1).every((x) => (d.values[x.key] ?? 0) <= 0);
                      return <div key={s.key} style={{ height: Math.max(2, (v / max) * plotH - 2), background: s.color }} className={isTop ? "rounded-t-[4px]" : ""} />;
                    })}
                  </div>
                  {labelLast && isLast && totals[i] > 0 && hover === null && (
                    <span className="absolute text-[11.5px] font-semibold text-ink tnum" style={{ bottom: (totals[i] / max) * plotH + 4 }}>
                      {formatNumber(totals[i])}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {/* eixo x */}
          <div className="mt-1.5 flex text-[11px] text-ink-3">
            {data.map((d, i) => (
              <span key={d.label + i} className="flex-1 truncate text-center">
                {data.length > 14 && i % 2 === 1 ? "" : d.label}
              </span>
            ))}
          </div>
          {hover !== null && (
            <div
              className="pointer-events-none absolute z-10 min-w-36 rounded-lg border border-line bg-surface px-3 py-2 shadow-[var(--shadow-pop)]"
              style={{ left: `calc(${((hover + 0.5) / data.length) * 100}% + ${hover > data.length / 2 ? -160 : 12}px)`, top: 4 }}
            >
              <div className="mb-1 text-[11.5px] text-ink-3">{data[hover].title ?? data[hover].label}</div>
              {series.map((s) => (
                <div key={s.key} className="flex items-center gap-2 text-[12.5px]">
                  <span className="h-0.5 w-3 rounded" style={{ background: s.color }} />
                  <span className="font-semibold text-ink tnum">{formatNumber(data[hover].values[s.key] ?? 0)}</span>
                  <span className="text-ink-3">{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {series.length > 1 && <Legend series={series.map((s) => ({ label: s.label, color: s.color, shape: "rect" as const }))} className="mt-3 pl-11" />}
    </div>
  );
}

export function Legend({ series, className }: { series: { label: string; color: string; shape: "rect" | "line" }[]; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-2 ${className ?? ""}`}>
      {series.map((s) => (
        <span key={s.label} className="inline-flex items-center gap-1.5">
          {s.shape === "rect" ? <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} /> : <span className="h-0.5 w-3.5 rounded" style={{ background: s.color }} />}
          {s.label}
        </span>
      ))}
    </div>
  );
}

function niceStep(raw: number): number {
  if (raw <= 1) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return Math.max(1, Math.round(nice * pow));
}
