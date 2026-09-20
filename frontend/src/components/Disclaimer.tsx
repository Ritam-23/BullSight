import { Info } from "lucide-react";

export default function Disclaimer() {
  return (
    <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
      <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
      Forecasts and screener rankings are statistical estimates from historical prices, not investment advice.
      Market data comes from Yahoo Finance and may be delayed.
    </p>
  );
}
