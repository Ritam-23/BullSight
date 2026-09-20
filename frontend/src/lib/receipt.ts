import { jsPDF } from "jspdf";
import { receiptAssets } from "./receipt-assets";

// Shape returned by GET /api/portfolio/last-order (also used by the receipt route handler).
export type Order = {
  symbol: string;
  name: string;
  exchange: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  currency: string;
  amount_inr: number;
  realized_pnl_inr: number | null;
  at: number;
  buyer_name: string | null;
  buyer_email: string | null;
};

/** "bought"/"sold" for prose, "Bought"/"Sold" for headings. */
export function sideVerb(side: Order["side"]): string {
  return side === "sell" ? "sold" : "bought";
}
export function sideTitle(side: Order["side"]): string {
  return side === "sell" ? "Sold" : "Bought";
}

// Indian exchanges quote in rupees, US exchanges in dollars. Drive the symbol off the stored
// order currency (authoritative), falling back to the exchange name.
export function currencySymbol(p: Pick<Order, "currency" | "exchange">): string {
  if (p.currency === "INR") return "₹";
  if (p.currency === "USD") return "$";
  const ex = (p.exchange || "").toUpperCase();
  return ex === "BSE" || ex === "NSE" ? "₹" : "$";
}

function fmtAmount(value: number, symbol: string): string {
  const locale = symbol === "₹" ? "en-IN" : "en-US";
  return symbol + value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Price of one share in its native currency, e.g. "₹1,234.50" or "$212.00". */
export function nativePrice(p: Order): string {
  return fmtAmount(p.price, currencySymbol(p));
}

/** Total value of the order in its native currency (price × qty). */
export function nativeTotal(p: Order): string {
  return fmtAmount(p.price * p.qty, currencySymbol(p));
}

export function orderDate(at: number): Date {
  // `at` is a POSIX timestamp in seconds (backend `created_at`).
  return new Date(at * 1000);
}

// Palette (matches the app's light theme).
const INK = "#0b0b0b";
const GREY = "#6f6d68";
const MUTED = "#9a988f";
const LINE = "#e1e0d9";
const CARD = "#f6f5f1";
const UP = "#15803d";
const DOWN = "#b91c1c";

/** Register embedded fonts on a jsPDF doc. Returns the font names to use, falling back to the
 *  built-in helvetica if an asset is missing so a receipt is always produced. */
function registerFonts(doc: jsPDF): { brand: string; body: string } {
  const { brunoTtf, hindTtf } = receiptAssets();
  let brand = "helvetica";
  let body = "helvetica";
  if (brunoTtf) {
    doc.addFileToVFS("BrunoAceSC.ttf", brunoTtf);
    doc.addFont("BrunoAceSC.ttf", "BrunoAceSC", "normal");
    brand = "BrunoAceSC";
  }
  if (hindTtf) {
    // Hind carries the ₹ (U+20B9) and $ glyphs helvetica lacks.
    doc.addFileToVFS("Hind.ttf", hindTtf);
    doc.addFont("Hind.ttf", "Hind", "normal");
    body = "Hind";
  }
  return { brand, body };
}

/** Builds a one-page trade receipt PDF and returns it as a Node Buffer. */
export function buildReceiptPdf(p: Order): Buffer {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const { brand, body } = registerFonts(doc);
  const { bgPng } = receiptAssets();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 56;
  const right = pageW - 56;
  const contentW = right - left;

  // --- faint background watermark, centred ---
  if (bgPng) {
    const size = 380;
    const gs = doc.GState({ opacity: 0.05 });
    doc.setGState(gs);
    doc.addImage(`data:image/png;base64,${bgPng}`, "PNG", (pageW - size) / 2, (pageH - size) / 2, size, size);
    doc.setGState(doc.GState({ opacity: 1 }));
  }

  // --- header: BullSight wordmark (Bruno) + subtitle ---
  let y = 76;
  doc.setFont(brand, "normal");
  doc.setFontSize(26);
  doc.setTextColor(INK);
  doc.text("BullSight", left, y);

  doc.setFont(body, "normal");
  doc.setFontSize(11);
  doc.setTextColor(GREY);
  doc.text(`Stocks ${sideVerb(p.side)} details`, left, y + 20);

  // Buy/Sell pill, right-aligned to the header baseline.
  const pillText = sideTitle(p.side).toUpperCase();
  const pillColor = p.side === "sell" ? DOWN : UP;
  doc.setFontSize(10);
  const pillW = doc.getTextWidth(pillText) + 24;
  const pillH = 22;
  const pillX = right - pillW;
  const pillY = y - 16;
  doc.setFillColor(pillColor);
  doc.roundedRect(pillX, pillY, pillW, pillH, 11, 11, "F");
  doc.setTextColor("#ffffff");
  doc.text(pillText, pillX + 12, pillY + 15);

  y += 44;
  doc.setDrawColor(LINE);
  doc.setLineWidth(1);
  doc.line(left, y, right, y);

  // --- total amount card ---
  y += 24;
  const cardH = 64;
  doc.setFillColor(CARD);
  doc.roundedRect(left, y, contentW, cardH, 12, 12, "F");
  doc.setFont(body, "normal");
  doc.setFontSize(10);
  doc.setTextColor(GREY);
  doc.text(p.side === "sell" ? "Total proceeds" : "Total amount", left + 20, y + 26);
  doc.setFontSize(24);
  doc.setTextColor(INK);
  doc.text(nativeTotal(p), left + 20, y + 50);
  // qty × price, right side of card
  doc.setFontSize(11);
  doc.setTextColor(GREY);
  const qtyLine = `${p.qty} ${p.qty === 1 ? "share" : "shares"} × ${nativePrice(p)}`;
  doc.text(qtyLine, right - 20 - doc.getTextWidth(qtyLine), y + 40);

  // --- details table ---
  y += cardH + 34;
  const when = orderDate(p.at);
  const partyLabel = p.side === "sell" ? "Seller" : "Buyer";
  const rows: [string, string][] = [
    ["Stock", `${p.name} (${p.symbol})`],
    ["Stock exchange", p.exchange || "—"],
    [partyLabel, p.buyer_name || "—"],
    [p.buyer_email ? "Email" : "", p.buyer_email || ""],
    ["Date", when.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })],
    ["Time", when.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })],
    ["Price per share", nativePrice(p)],
    ["Quantity", String(p.qty)],
  ].filter(([label]) => label !== "") as [string, string][];

  doc.setFontSize(11.5);
  for (const [label, value] of rows) {
    doc.setTextColor(GREY);
    doc.text(label, left, y);
    doc.setTextColor(INK);
    doc.text(value, left + 170, y);
    y += 15;
    doc.setDrawColor(LINE);
    doc.setLineWidth(0.5);
    doc.line(left, y, right, y);
    y += 17;
  }

  // --- footer ---
  const footY = pageH - 60;
  doc.setDrawColor(LINE);
  doc.setLineWidth(1);
  doc.line(left, footY, right, footY);
  doc.setFont(body, "normal");
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text(
    "This is a paper-trading receipt from BullSight. No real securities were bought or sold.",
    left,
    footY + 20,
    { maxWidth: contentW },
  );

  return Buffer.from(doc.output("arraybuffer"));
}
