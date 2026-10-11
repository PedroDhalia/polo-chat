import Link from "@/components/ui/link";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type Size = "xs" | "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm disabled:bg-brand-600/60",
  secondary: "bg-surface text-ink ring-1 ring-inset ring-line-strong hover:bg-subtle shadow-[var(--shadow-card)]",
  ghost: "text-ink-2 hover:bg-stone-100 hover:text-ink",
  subtle: "bg-brand-50 text-brand-700 hover:bg-brand-100",
  danger: "bg-surface text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-50",
};

const SIZES: Record<Size, string> = {
  xs: "h-7 px-2 text-xs gap-1",
  sm: "h-8 px-2.5 text-[13px] gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
};

export function buttonClasses(variant: Variant = "secondary", size: Size = "sm", className?: string) {
  return cn(
    "inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export function Button({ variant, size, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type="button" className={buttonClasses(variant, size, className)} {...props} />;
}

export function ButtonLink({ href, variant, size, className, children }: { href: string; variant?: Variant; size?: Size; className?: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={buttonClasses(variant, size, className)}>
      {children}
    </Link>
  );
}
