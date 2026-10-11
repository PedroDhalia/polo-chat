export default function Loading() {
  return (
    <div className="flex flex-1 items-start justify-center pt-24" aria-busy="true" aria-live="polite">
      <span className="inline-flex items-center gap-2 text-[13px] text-ink-3">
        <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-brand-500 border-r-transparent" />
        Carregando…
      </span>
    </div>
  );
}
