import Link from "@/components/ui/link";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";

export interface BarListItem {
  label: string;
  value: number;
  /** Texto secundário à direita do valor (ex.: "39%"). */
  hint?: string;
  href?: string;
  emphasis?: boolean;
}

/**
 * Barras horizontais de magnitude (uma série, um tom). Valor na ponta da barra;
 * hover realça a linha e mostra o detalhe — o valor também está sempre visível.
 */
export function BarList({ items, max, className, valueFormatter = formatNumber, reserve = 170 }: { items: BarListItem[]; max?: number; className?: string; valueFormatter?: (n: number) => string; reserve?: number }) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className={cn("space-y-2.5", className)}>
      {items.map((item) => {
        const frac = Math.max(0, item.value / top);
        const width = `calc((100% - ${reserve}px) * ${frac.toFixed(4)})`;
        const row = (
          <div className="group grid grid-cols-[minmax(0,150px)_1fr] items-center gap-3" title={`${item.label}: ${valueFormatter(item.value)}${item.hint ? ` · ${item.hint}` : ""}`}>
            <span className="truncate text-[13px] text-ink-2 group-hover:text-ink">{item.label}</span>
            <div className="relative h-5">
              <div
                className={cn("absolute inset-y-0.5 left-0 rounded-r-[4px] transition-opacity group-hover:opacity-80", item.emphasis === false ? "bg-chart-muted/40" : "bg-chart-accent")}
                style={{ width, minWidth: item.value > 0 ? 3 : 0 }}
              />
              <span className="absolute inset-y-0 flex items-center pl-2 text-[12.5px] font-medium whitespace-nowrap text-ink tnum" style={{ left: `max(${width}, 3px)` }}>
                {valueFormatter(item.value)}
                {item.hint && <span className="ml-1.5 font-normal text-ink-3">{item.hint}</span>}
              </span>
            </div>
          </div>
        );
        return <li key={item.label}>{item.href ? <Link href={item.href}>{row}</Link> : row}</li>;
      })}
    </ul>
  );
}
