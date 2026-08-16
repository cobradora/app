/**
 * Só libera chamadas às rotas públicas vindas do próprio site, em produção.
 * Fora de produção sempre libera — não atrapalha curl/testes locais. Uma
 * requisição de produção sem Origin nem Referer é bloqueada de propósito:
 * essas rotas são só para o frontend do CobraDora, não para uso
 * server-to-server de terceiros.
 */
export function assertTrustedOrigin(request: Request): boolean {
  if (process.env.NODE_ENV !== "production") return true;

  const appBaseUrl = process.env.APP_BASE_URL;
  if (!appBaseUrl) return false;
  const trustedOrigin = new URL(appBaseUrl).origin;

  const originHeader = request.headers.get("origin");
  if (originHeader) return originHeader === trustedOrigin;

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === trustedOrigin;
    } catch {
      return false;
    }
  }

  return false;
}
