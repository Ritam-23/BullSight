/** Branded loader: five candlesticks breathing in sequence. */
export default function Loader({ label, size = "md" }: { label?: string; size?: "sm" | "md" | "lg" }) {
  const h = { sm: 18, md: 32, lg: 48 }[size];
  const w = { sm: 3, md: 5, lg: 7 }[size];
  const bars = ["--candle-up", "--candle-down", "--candle-up", "--candle-up", "--candle-down"];
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center justify-center gap-3">
      <div className="flex items-end" style={{ height: h, gap: w * 0.8 }} aria-hidden>
        {bars.map((c, i) => (
          <span key={i} className="relative flex h-full items-center justify-center" style={{ width: w }}>
            <span className="absolute inset-y-0 w-px" style={{ background: `var(${c})`, opacity: 0.6 }} />
            <span
              className="candle-bar relative rounded-[1px]"
              style={{ width: w, height: h * 0.7, background: `var(${c})`, animationDelay: `${i * 120}ms` }}
            />
          </span>
        ))}
      </div>
      {label ? <span className="text-sm text-ink-2">{label}</span> : <span className="sr-only">Loading</span>}
    </div>
  );
}
