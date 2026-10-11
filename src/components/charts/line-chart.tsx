"use client";

import { useEffect, useRef, useState } from "react";
import { formatNumber } from "@/lib/format";
import { Legend } from "./column-chart";

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  /** Série de referência (cinza, mais fina). */
  muted?: boolean;
}

export interface LinePoint {
  label: string;
  title?: string;
  values: Record<string, number | null>;
}

/** Linha (evolução no tempo) com cruzeta que acompanha o ponteiro e rótulos no fim das séries. */
export function LineChart({ data, series, height = 240, target }: { data: LinePoint[]; series: LineSeries[]; height?: number; target?: { value: number; label: string } }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [W, setW] = useState(800);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(280, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = height;
  const pad = { l: 40, r: W < 500 ? 78 : 104, t: 14, b: 26 };
  const values = data.flatMap((d) => series.map((s) => d.values[s.key] ?? 0));
  const rawMax = Math.max(1, ...values, target?.value ?? 0);
  const step = niceStep(rawMax / 4);
  const max = Math.ceil(rawMax / step) * step;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const x = (i: number) => pad.l + (data.length <= 1 ? 0 : (i / (data.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);

  const onMove = (e: React.PointerEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };

  // Rótulos de fim que colidiriam: mantém o da série principal; o da referência fica no tooltip.
  const lastY = series.map((s) => {
    const d = [...data].reverse().find((p) => p.values[s.key] != null);
    return d ? y(d.values[s.key] as number) : null;
  });
  const labelHidden = (i: number) =>
    !!series[i].muted && series.some((o, j) => j !== i && !o.muted && lastY[j] !== null && lastY[i] !== null && Math.abs((lastY[j] as number) - (lastY[i] as number)) < 14);

  const labelEvery = Math.ceil(data.length / Math.max(3, Math.floor(W / 90)));

  return (
    <div className="relative">
      <div ref={ref} onPointerMove={onMove} onPointerLeave={() => setHover(null)} className="relative">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block overflow-visible" role="img" aria-label={series.map((s) => s.label).join(" e ")}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--color-chart-axis)" : "var(--color-chart-grid)"} strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-ink-3)" className="tnum">
                {formatNumber(t)}
              </text>
            </g>
          ))}
          {target && (
            <g>
              <line x1={pad.l} x2={W - pad.r} y1={y(target.value)} y2={y(target.value)} stroke="var(--color-ink-2)" strokeWidth={1} strokeOpacity={0.5} vectorEffect="non-scaling-stroke" />
              <text x={W - pad.r + 8} y={y(target.value)} dy="0.32em" fontSize={11.5} fill="var(--color-ink-2)" fontWeight={500}>
                {target.label}
              </text>
            </g>
          )}
          {data.map((d, i) =>
            (i % labelEvery === 0 && data.length - 1 - i >= Math.ceil(labelEvery / 2)) || i === data.length - 1 ? (
              <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--color-ink-3)">
                {d.label}
              </text>
            ) : null,
          )}
          {series.map((s, si) => {
            const pts = data.map((d, i) => (d.values[s.key] == null ? null : ([x(i), y(d.values[s.key] as number)] as const))).filter(Boolean) as (readonly [number, number])[];
            if (pts.length === 0) return null;
            const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
            const last = pts[pts.length - 1];
            const lastVal = [...data].reverse().find((d) => d.values[s.key] != null)?.values[s.key] ?? 0;
            return (
              <g key={s.key}>
                {!s.muted && <path d={`${path} L${last[0]},${y(0)} L${pts[0][0]},${y(0)} Z`} fill={s.color} fillOpacity={0.08} />}
                <path d={path} fill="none" stroke={s.color} strokeWidth={s.muted ? 1.5 : 2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                <circle cx={last[0]} cy={last[1]} r={4.5} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} />
                {!labelHidden(si) && <text x={last[0] + 10} y={last[1]} dy="0.32em" fontSize={12} fill="var(--color-ink)" fontWeight={600} className="tnum">
                  {formatNumber(lastVal as number)}
                  {W >= 500 && <tspan fill="var(--color-ink-3)" fontWeight={400}>{` ${s.label.toLowerCase()}`}</tspan>}
                </text>}
              </g>
            );
          })}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--color-ink-3)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              {series.map((s) => {
                const v = data[hover].values[s.key];
                return v == null ? null : <circle key={s.key} cx={x(hover)} cy={y(v)} r={4} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} />;
              })}
            </g>
          )}
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute z-10 min-w-40 rounded-lg border border-line bg-surface px-3 py-2 shadow-[var(--shadow-pop)]"
            style={{ left: `calc(${(x(hover) / W) * 100}% + ${hover > data.length * 0.6 ? -176 : 12}px)`, top: 8 }}
          >
            <div className="mb-1 text-[11.5px] text-ink-3">{data[hover].title ?? data[hover].label}</div>
            {series.map((s) => (
              <div key={s.key} className="flex items-center gap-2 text-[12.5px]">
                <span className="h-0.5 w-3 rounded" style={{ background: s.color }} />
                <span className="font-semibold text-ink tnum">{data[hover].values[s.key] == null ? "—" : formatNumber(data[hover].values[s.key] as number)}</span>
                <span className="text-ink-3">{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {series.length > 1 && <Legend series={series.map((s) => ({ label: s.label, color: s.color, shape: "line" as const }))} className="mt-2 pl-11" />}
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
