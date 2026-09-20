import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import {
  buildReceiptPdf,
  nativePrice,
  nativeTotal,
  orderDate,
  sideVerb,
  type Order,
} from "@/lib/receipt";
import { receiptAssets } from "@/lib/receipt-assets";

// nodemailer needs the Node.js runtime (not Edge).
export const runtime = "nodejs";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
// Display name shown in the inbox. The address should be on the same domain as your SMTP
// credentials so SPF/DKIM line up (that's what keeps mail out of spam).
const SMTP_FROM = process.env.SMTP_FROM ?? (SMTP_USER ? `BullSight <${SMTP_USER}>` : "");

function smtpConfigured(): boolean {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function subjectFor(o: Order): string {
  return `Stocks ${sideVerb(o.side)} details`;
}

// "BullSight" wordmark. Email clients (Gmail especially) strip custom @font-face/@import web
// fonts, so the Bruno Ace SC brand can only be shown reliably as an image — a pre-rendered PNG
// embedded by CID (see attachments below). `hasWordmark` decides image vs. styled-text fallback.
function brandMark(hasWordmark: boolean, height: number): string {
  if (hasWordmark) {
    return `<img src="cid:bullsight-wordmark" alt="BullSight" height="${height}" style="display:inline-block;height:${height}px;width:auto;border:0;" />`;
  }
  return `<span style="font-family:'Bruno Ace SC',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-weight:400;letter-spacing:0.5px;">BullSight</span>`;
}

function emailHtml(o: Order, hasWordmark: boolean): string {
  const when = orderDate(o.at).toLocaleString("en-IN");
  const partyLabel = o.side === "sell" ? "Seller" : "Buyer";
  const accent = o.side === "sell" ? "#b91c1c" : "#15803d";
  const badge = o.side === "sell" ? "SOLD" : "BOUGHT";
  const row = (label: string, value: string) =>
    `<tr>
       <td style="padding:9px 16px 9px 0;color:#6f6d68;font-size:14px;border-bottom:1px solid #eeece5;white-space:nowrap;">${label}</td>
       <td style="padding:9px 0;color:#0b0b0b;font-size:14px;font-weight:600;border-bottom:1px solid #eeece5;text-align:right;">${value}</td>
     </tr>`;
  return `<!doctype html>
<html>
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body style="margin:0;background:#f9f9f7;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:540px;margin:0 auto;background:#fcfcfb;border:1px solid #e1e0d9;border-radius:16px;padding:28px;">
      <table style="width:100%;border-collapse:collapse;"><tr>
        <td style="vertical-align:middle;">${brandMark(hasWordmark, 26)}</td>
        <td style="vertical-align:middle;text-align:right;">
          <span style="display:inline-block;background:${accent};color:#fff;font-size:11px;font-weight:700;letter-spacing:0.5px;padding:5px 12px;border-radius:999px;">${badge}</span>
        </td>
      </tr></table>
      <p style="margin:8px 0 22px;color:#6f6d68;font-size:13px;">Stocks ${sideVerb(o.side)} details</p>

      <div style="background:#f6f5f1;border-radius:12px;padding:18px 20px;margin-bottom:20px;">
        <div style="color:#6f6d68;font-size:12px;">${o.side === "sell" ? "Total proceeds" : "Total amount"}</div>
        <div style="color:#0b0b0b;font-size:26px;font-weight:700;margin-top:2px;">${nativeTotal(o)}</div>
        <div style="color:#6f6d68;font-size:13px;margin-top:4px;">${o.qty} ${o.qty === 1 ? "share" : "shares"} × ${nativePrice(o)}</div>
      </div>

      <p style="margin:0 0 14px;color:#0b0b0b;font-size:15px;">
        Hi ${o.buyer_name || "investor"}, here are the details of the stock you ${sideVerb(o.side)}. The full receipt is attached as a PDF.
      </p>
      <table style="border-collapse:collapse;width:100%;">
        ${row("Stock", `${o.name} (${o.symbol})`)}
        ${row("Stock exchange", o.exchange || "—")}
        ${row(partyLabel, o.buyer_name || "—")}
        ${row("Date &amp; time", when)}
        ${row("Price per share", nativePrice(o))}
      </table>
      <p style="margin:22px 0 0;color:#9a988f;font-size:12px;">
        Sent by ${brandMark(hasWordmark, 13)} — paper-trading receipt. No real securities were bought or sold.
      </p>
    </div>
  </body>
</html>`;
}

function emailText(o: Order): string {
  const when = orderDate(o.at).toLocaleString("en-IN");
  const partyLabel = o.side === "sell" ? "Seller" : "Buyer";
  return [
    `BullSight — Stocks ${sideVerb(o.side)} details`,
    "",
    `Hi ${o.buyer_name || "investor"}, here are the details of the stock you ${sideVerb(o.side)}:`,
    "",
    `Stock:          ${o.name} (${o.symbol})`,
    `Stock exchange: ${o.exchange || "-"}`,
    `${partyLabel}:${" ".repeat(Math.max(1, 15 - partyLabel.length))}${o.buyer_name || "-"}`,
    `Date & time:    ${when}`,
    `Quantity:       ${o.qty}`,
    `Price/share:    ${nativePrice(o)}`,
    `Total amount:   ${nativeTotal(o)}`,
    "",
    "The full receipt is attached as a PDF.",
    "Sent by BullSight — paper-trading receipt. No real securities were bought or sold.",
  ].join("\n");
}

export async function POST() {
  if (!smtpConfigured()) {
    return NextResponse.json({ ok: false, reason: "smtp-not-configured" });
  }

  // The recipient is always the signed-in user: we re-fetch the order from the backend using
  // this request's session cookie rather than trusting anything from the client.
  const session = (await cookies()).get("session")?.value;
  if (!session) {
    return NextResponse.json({ ok: false, reason: "not-authenticated" }, { status: 401 });
  }

  let order: Order | null = null;
  try {
    const res = await fetch(`${BACKEND_URL}/api/portfolio/last-order`, {
      headers: { cookie: `session=${session}` },
      cache: "no-store",
    });
    if (res.ok) order = (await res.json()).order;
  } catch {
    return NextResponse.json({ ok: false, reason: "backend-unreachable" }, { status: 502 });
  }

  if (!order) return NextResponse.json({ ok: false, reason: "no-order" });
  if (!order.buyer_email) return NextResponse.json({ ok: false, reason: "no-email" });

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // 465 = implicit TLS; 587 = STARTTLS
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    const { wordmarkPng } = receiptAssets();
    const attachments: Mail.Attachment[] = [
      {
        filename: `bullsight-receipt-${order.side}-${order.symbol}.pdf`,
        content: buildReceiptPdf(order),
        contentType: "application/pdf",
      },
    ];
    if (wordmarkPng) {
      // Inline (CID) image so the Bruno wordmark renders even where web fonts are blocked.
      attachments.push({
        filename: "bullsight.png",
        content: Buffer.from(wordmarkPng, "base64"),
        contentType: "image/png",
        cid: "bullsight-wordmark",
      });
    }

    await transporter.sendMail({
      from: SMTP_FROM,
      to: order.buyer_email,
      replyTo: SMTP_FROM,
      subject: subjectFor(order),
      text: emailText(order),
      html: emailHtml(order, Boolean(wordmarkPng)),
      attachments,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.warn("Receipt email failed:", err);
    return NextResponse.json({ ok: false, reason: "send-failed" }, { status: 500 });
  }
}
