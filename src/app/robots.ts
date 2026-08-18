import type { MetadataRoute } from "next";

const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://www.cobradora.com.br";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /g/ são links públicos de cobrança por participante (não fazem sentido
      // indexados) e /pagamento/ é retorno transacional do checkout — nenhuma
      // das duas é conteúdo pra buscador. O painel logado não tem rota própria
      // (renderiza na mesma "/" da landing pública), então não dá pra bloqueá-lo
      // separadamente aqui.
      disallow: ["/api/", "/g/", "/pagamento/"],
    },
    sitemap: `${APP_BASE_URL}/sitemap.xml`,
  };
}
