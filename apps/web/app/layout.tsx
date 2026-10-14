import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Readback",
  description: "The safe way to let your AI shop with PayPal. Every purchase your agent makes, on the record.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
