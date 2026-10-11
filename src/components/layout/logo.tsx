export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-brand-700 text-white shadow-sm">
        <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 19C5 10.7 10.7 5 19 5c0 8.3-5.7 14-14 14Z" fill="currentColor" fillOpacity="0.18" />
          <path d="M5 19 13.5 10.5" />
          <path d="M9.5 14.5h3.2M12 12V9.3" />
        </svg>
      </span>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight text-ink">Plátano Ops</div>
        <div className="text-[11px] text-ink-3">Centro de Pesquisa Plátano</div>
      </div>
    </div>
  );
}
