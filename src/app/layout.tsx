import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import favicon from "@/images/favicon.png";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        <CookieConsentBanner />
      </body>
    </html>
  );
}
