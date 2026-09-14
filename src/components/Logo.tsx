export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-terracotta-500 font-serif text-lg font-bold text-white shadow-sm">
        L
      </span>
      {!compact && (
        <span className="font-serif text-lg font-semibold tracking-tight text-ink-900">
          Língua<span className="text-terracotta-500">Viva</span>
        </span>
      )}
    </span>
  );
}
