"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const EVENT = "route-progress-start";

/** Call before a programmatic navigation (router.push) to show the top progress bar. */
export function startRouteProgress() {
  window.dispatchEvent(new Event(EVENT));
}

/** Thin top bar shown from a navigation's start until the new route renders. */
export default function RouteProgress() {
  const pathname = usePathname();
  // The bar belongs to the path it started on; once the path changes it is no longer shown.
  const [startedOn, setStartedOn] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      setStartedOn(window.location.pathname);
      clearTimeout(timer);
      timer = setTimeout(() => setStartedOn(null), 10_000); // never spin forever
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element).closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      start();
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener(EVENT, start);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(EVENT, start);
      clearTimeout(timer);
    };
  }, []);

  if (startedOn === null || startedOn !== pathname) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden" aria-hidden>
      <div className="route-progress h-full w-full" style={{ background: "var(--accent)" }} />
    </div>
  );
}
