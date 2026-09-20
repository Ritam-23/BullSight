import type { Metadata } from "next";
import { Bruno_Ace_SC, Geist, Geist_Mono } from "next/font/google";
import RouteProgress from "@/components/RouteProgress";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const brunoAce = Bruno_Ace_SC({ weight: "400", variable: "--font-bruno-ace", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "BullSight",
  description: "Search NASDAQ, NYSE, BSE and NSE stocks, see backtested forecasts, and screen by volume, buying pressure and profitability.",
};

// Runs before paint so the saved (or system) theme applies without a flash.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} ${brunoAce.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className="min-h-full flex flex-col font-sans"
        suppressHydrationWarning
      >
        <RouteProgress />
        {children}
      </body>
    </html>
  );
}
