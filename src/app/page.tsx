import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/session";
import { getUserById } from "@/services/auth";
import CobraDoraDashboard from "@/components/cobradora-dashboard";
import LandingPage from "@/components/landing-page";

const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://www.cobradora.com.br";
const DESCRIPTION =
  "Escolha como cobrar seu grupo: use a Dora grátis para organizar e compartilhar listas ou a CobraDora para automatizar cobranças privadas e atualizações.";

export const metadata: Metadata = {
  title: "Grátis ou Premium — Escolha como cobrar seu grupo",
  description: DESCRIPTION,
  alternates: { canonical: `${APP_BASE_URL}/` },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "CobraDora",
    title: "Grátis ou Premium — Cobranças no seu ritmo",
    description: "Controle grátis pelo painel ou automatize cobranças privadas e atualizações para o organizador.",
    url: `${APP_BASE_URL}/`,
  },
  twitter: {
    card: "summary",
    title: "Grátis ou Premium — Assistente de Cobranças",
    description: "Escolha entre controle manual gratuito e cobrança automatizada para seus grupos.",
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
      description: "Plataforma com módulo gratuito para controle pelo painel e módulo de automação para cobranças privadas.",
      publisher: { "@id": `${APP_BASE_URL}/#organization` },
      isAccessibleForFree: true,
      featureList: [
        "Painel de mensalidades e pendências",
        "Checkout com InfinitePay",
        "Lista para copiar ou compartilhar",
        "Cobranças privadas automatizadas no módulo CobraDora",
      ],
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
