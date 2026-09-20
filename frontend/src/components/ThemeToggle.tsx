"use client";
import { Moon, Sun } from "lucide-react";
import { useIsDark } from "@/lib/theme";

export default function ThemeToggle() {
  const dark = useIsDark();

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
  }

  return (
    <button
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
    >
      {dark === null ? <span className="h-4 w-4" /> : dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
