import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { pct } from "@/lib/format";

/** Signed percentage with an arrow, so direction never relies on color alone. */
export default function Change({ value, digits = 2, className = "" }: { value: number | null | undefined; digits?: number; className?: string }) {
  if (value == null) return <span className={`text-muted ${className}`}>—</span>;
  const flat = Math.abs(value) < 10 ** -digits / 2;
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  const color = flat ? "text-muted" : value > 0 ? "text-up" : "text-down";
  return (
    <span className={`num inline-flex items-center gap-0.5 font-medium ${color} ${className}`}>
      <Icon size={14} aria-hidden />
      {pct(value, digits)}
    </span>
  );
}
