import { cn } from "@/lib/cn";

export function Table({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("overflow-x-auto scrollbar-thin", className)}>
      <table className="w-full border-collapse text-left text-[13px]">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="border-b border-line bg-subtle text-[11.5px] font-medium uppercase tracking-wide text-ink-3">
      <tr>{children}</tr>
    </thead>
  );
}

export function Th({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <th className={cn("px-4 py-2.5 font-medium whitespace-nowrap", className)}>{children}</th>;
}

export function Tr({ className, children }: { className?: string; children: React.ReactNode }) {
  return <tr className={cn("border-b border-line/70 last:border-0 hover:bg-subtle/70", className)}>{children}</tr>;
}

export function Td({ className, children, colSpan }: { className?: string; children?: React.ReactNode; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn("px-4 py-3 align-middle", className)}>
      {children}
    </td>
  );
}
