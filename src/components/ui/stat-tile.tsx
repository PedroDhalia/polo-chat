import Link from "@/components/ui/link";
import type { Tone } from "@/domain/labels";
import { cn } from "@/lib/cn";
import { TONE_CLASSES } from "./badge";

export function StatTile({
  label,
  value,
  sub,
  subTone,
  icon,
  href,
  footer,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  subTone?: Tone;
  icon?: React.ReactNode;
  href?: string;
  footer?: React.ReactNode;
}) {
  const body = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium text-ink-2">{label}</span>
        {icon && <span className="text-ink-3 [&_svg]:size-4">{icon}</span>}
      </div>
      <div className="mt-2 text-[26px] leading-none font-semibold tracking-tight text-ink">{value}</div>
      {sub && <div className={cn("mt-2 text-[12.5px]", subTone ? TONE_CLASSES[subTone].text : "text-ink-3")}>{sub}</div>}
      {footer && <div className="mt-auto pt-2">{footer}</div>}
    </div>
  );
  const cls = "block rounded-xl border border-line bg-surface p-4 shadow-[var(--shadow-card)]";
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:border-line-strong hover:bg-subtle/60")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
