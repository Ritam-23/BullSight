"use client";
import { useSyncExternalStore } from "react";

// The <html class="dark"> flag is the source of truth (set before paint by the layout script).
function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}
const getSnapshot = () => document.documentElement.classList.contains("dark");
const getServerSnapshot = () => null;

/** true/false once mounted, null during server render. */
export function useIsDark(): boolean | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Resolve a CSS custom property (e.g. "--series-1") to its current value, for canvas-based charts. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
