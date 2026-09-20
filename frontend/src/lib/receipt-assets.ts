import { readFileSync } from "node:fs";
import path from "node:path";

// Fonts + background used by the receipt PDF (and the wordmark image used by the email). These
// live outside /public so they aren't publicly served; they're read from disk once and cached.
// Server-only module — never import this from a client component.
const ASSET_DIR = path.join(process.cwd(), "src", "receipt-assets");
const PUBLIC_DIR = path.join(process.cwd(), "public");

function loadBase64(file: string, dir = ASSET_DIR): string | null {
  try {
    return readFileSync(path.join(dir, file)).toString("base64");
  } catch {
    return null; // missing asset: caller falls back gracefully
  }
}

let cache: {
  brunoTtf: string | null;
  hindTtf: string | null;
  bgPng: string | null;
  wordmarkPng: string | null;
  wordmarkMutedPng: string | null;
} | null = null;

export function receiptAssets() {
  if (!cache) {
    cache = {
      brunoTtf: loadBase64("BrunoAceSC-Regular.ttf"),
      hindTtf: loadBase64("Hind-Regular.ttf"),
      bgPng: loadBase64("pdf_bg.png", PUBLIC_DIR),
      wordmarkPng: loadBase64("wordmark.png"),
      wordmarkMutedPng: loadBase64("wordmark-muted.png"),
    };
  }
  return cache;
}
