import type { Metadata } from "next";
import type { ReactNode } from "react";
import favicon from "@/images/favicon.png";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "CobraDora — Cobranças para grupos",
    template: "%s · CobraDora",
  },
  description: "Organize grupos, acompanhe pagamentos e cobre sem enrolação com a CobraDora.",
  icons: {
    icon: [{ url: favicon.src, type: "image/png" }],
    shortcut: favicon.src,
    apple: favicon.src,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
