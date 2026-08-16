/**
 * Só libera chamadas às rotas públicas vindas do próprio site, em produção.
 * Fora de produção sempre libera — não atrapalha curl/testes locais. Uma
 * requisição de produção sem Origin nem Referer é bloqueada de propósito:
 * essas rotas são só para o frontend do CobraDora, não para uso
 * server-to-server de terceiros.
 */
function sameSite(origin: string, trustedOrigin: URL): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== trustedOrigin.protocol || url.port !== trustedOrigin.port) return false;
    // Compara o host sem o prefixo "www." dos dois lados: apex e www são o
    // mesmo site aqui (a Vercel redireciona um pro outro), e travar na
    // string exata já deixou o domínio real fora do ar uma vez.
    const strip = (host: string) => host.replace(/^www\./, "");
    return strip(url.hostname) === strip(trustedOrigin.hostname);
  } catch {
    return false;
  }
}

export function assertTrustedOrigin(request: Request): boolean {
  if (process.env.NODE_ENV !== "production") return true;

  const appBaseUrl = process.env.APP_BASE_URL;
  if (!appBaseUrl) return false;
  const trustedOrigin = new URL(appBaseUrl);

  const originHeader = request.headers.get("origin");
  if (originHeader) return sameSite(originHeader, trustedOrigin);

  const referer = request.headers.get("referer");
  if (referer) return sameSite(referer, trustedOrigin);

  return false;
}
