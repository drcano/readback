import { IBM_Plex_Mono, Plus_Jakarta_Sans } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// Self-hosted at build time by next/font: no request to Google from the visitor's browser.
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-jakarta" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono" });

export const metadata = {
  title: "Readback",
  description: "The safe way to let your AI shop with PayPal. Every purchase your agent makes, on the record.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
