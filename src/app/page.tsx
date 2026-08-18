import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/session";
import { getUserById } from "@/services/auth";
import CobraDoraDashboard from "@/components/cobradora-dashboard";
import LandingPage from "@/components/landing-page";

const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://www.cobradora.com.br";
const DESCRIPTION =
  "Organize mensalidades e cobranças recorrentes de grupos com a CobraDora. Cadastre participantes, gere links de cobrança e acompanhe pagamentos em um só lugar.";

export const metadata: Metadata = {
  title: "CobraDora — Organize as cobranças do seu grupo de WhatsApp",
  description: DESCRIPTION,
  alternates: { canonical: `${APP_BASE_URL}/` },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "CobraDora",
    title: "CobraDora — Organize as cobranças do seu grupo",
    description: "Cadastre participantes, organize mensalidades, gere links de cobrança e acompanhe pagamentos sem depender de planilhas.",
    url: `${APP_BASE_URL}/`,
  },
  twitter: {
    card: "summary",
    title: "CobraDora — Assistente de Cobranças",
    description: "Controle mensalidades e cobranças recorrentes do seu grupo em um só lugar.",
  },
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${APP_BASE_URL}/#organization`,
      name: "Mentel Soluções Digitais",
      brand: { "@type": "Brand", name: "CobraDora" },
      url: `${APP_BASE_URL}/`,
      email: "contato@cobradora.com.br",
    },
    {
      "@type": "SoftwareApplication",
      name: "CobraDora",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: `${APP_BASE_URL}/`,
      description: "Plataforma para organização e gestão de cobranças recorrentes de grupos.",
      publisher: { "@id": `${APP_BASE_URL}/#organization` },
      offers: {
        "@type": "AggregateOffer",
        priceCurrency: "BRL",
        lowPrice: "14.90",
        highPrice: "99.90",
        offerCount: "3",
      },
    },
  ],
};

function LandingPageWithSchema() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <LandingPage />
    </>
  );
}

export default async function HomePage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return <LandingPageWithSchema />;

  let userId: string;
  try {
    ({ userId } = await verifySession(token));
  } catch {
    return <LandingPageWithSchema />;
  }

  const user = await getUserById(userId);
  if (!user) return <LandingPageWithSchema />;

  return <CobraDoraDashboard user={{ name: user.name, role: user.role }} />;
}
