"use client";
import { Coins, LineChart } from "lucide-react";
import { useState } from "react";

/** Company logo from /api/logo, with a letter badge when no logo exists (and an icon for indices/futures). */
export default function Logo({ symbol, name, size = 32, className = "" }: { symbol: string; name?: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };
  const radius = size >= 40 ? "rounded-xl" : "rounded-lg";

  if (symbol.startsWith("^") || symbol.includes("=")) {
    const Icon = symbol.includes("=") ? Coins : LineChart;
    return (
      <span style={box} className={`inline-flex shrink-0 items-center justify-center bg-surface-2 text-accent ${radius} ${className}`} aria-hidden>
        <Icon size={Math.round(size * 0.5)} />
      </span>
    );
  }

  if (failed) {
    const label = (name || symbol).replace(/[^A-Za-z0-9 ]/g, "").trim();
    const words = label.split(/\s+/).filter(Boolean);
    const initials = (words.length > 1 ? words[0][0] + words[1][0] : label.slice(0, 2)).toUpperCase();
    return (
      <span style={{ ...box, fontSize: Math.max(10, Math.round(size * 0.36)) }}
        className={`inline-flex shrink-0 items-center justify-center border border-line bg-surface-2 font-semibold text-ink-2 ${radius} ${className}`} aria-hidden>
        {initials}
      </span>
    );
  }

  return (
    // Logos sit on a white tile so dark-on-transparent marks stay legible in dark mode.
    <span style={box} className={`inline-flex shrink-0 items-center justify-center overflow-hidden border border-line bg-white ${radius} ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/logo/${encodeURIComponent(symbol)}`}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="h-full w-full object-contain p-[8%]"
      />
    </span>
  );
}
