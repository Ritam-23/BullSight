"use client";
import { useEffect } from "react";

// Reads the short-lived `fresh_login` cookie the backend sets on every sign-in. Returns true
// once and clears it, so a receipt is requested at most once per login (not on every render).
function consumeFreshLogin(): boolean {
  const hit = document.cookie.split("; ").some((c) => c.startsWith("fresh_login="));
  if (hit) {
    document.cookie = "fresh_login=; Max-Age=0; path=/";
  }
  return hit;
}

/**
 * On a fresh login, asks the server to email a PDF receipt of the user's latest purchase to the
 * address they signed in with (sent via nodemailer in /receipt). Renders nothing and never blocks
 * the UI — the route no-ops when there's no purchase, no email, or SMTP isn't configured.
 */
export default function LoginReceipt() {
  useEffect(() => {
    if (!consumeFreshLogin()) return;
    fetch("/receipt", { method: "POST", credentials: "same-origin" }).catch(() => {});
  }, []);

  return null;
}
