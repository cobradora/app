import type { Metadata } from "next";
import { LegalPageShell } from "@/components/legal-page-shell";

const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://www.cobradora.com.br";
const DESCRIPTION = "Saiba quais cookies a CobraDora utiliza, para que servem e como gerenciar as configurações do navegador.";

export const metadata: Metadata = {
  title: "Política de Cookies",
  description: DESCRIPTION,
  alternates: { canonical: `${APP_BASE_URL}/politica-de-cookies` },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "CobraDora",
    title: "Política de Cookies | CobraDora",
    description: DESCRIPTION,
    url: `${APP_BASE_URL}/politica-de-cookies`,
  },
  twitter: {
    card: "summary",
    title: "Política de Cookies | CobraDora",
    description: DESCRIPTION,
  },
};

const LAST_UPDATED = "17 de agosto de 2026";

export default function CookiesPolicyPage() {
  return (
    <LegalPageShell title="Política de Cookies" updated={LAST_UPDATED}>
      <p>
        Esta Política de Cookies explica como a <strong>Mentel Soluções Digitais</strong>, responsável pela
        CobraDora, utiliza cookies e tecnologias semelhantes no site e na aplicação.
      </p>

      <h2>1. O que são cookies</h2>
      <p>
        Cookies são pequenos arquivos ou identificadores armazenados ou associados ao navegador para permitir
        funcionalidades de um site ou aplicação. Eles podem ser essenciais ao funcionamento do serviço ou utilizados
        para outras finalidades, como preferências, medição de audiência e publicidade.
      </p>

      <h2>2. Cookies usados atualmente pela CobraDora</h2>
      <p>Atualmente, a CobraDora utiliza apenas cookie necessário para autenticação e funcionamento da sessão do organizador:</p>
      <div style={{ overflowX: "auto", margin: "1.25rem 0" }}>
        <table>
          <thead>
            <tr>
              <th>Cookie</th>
              <th>Finalidade</th>
              <th>Duração</th>
              <th>Tipo</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>cobradora_session</code></td>
              <td>Manter o organizador autenticado e proteger a sessão de acesso.</td>
              <td>Até 30 dias</td>
              <td>Necessário / essencial</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        O cookie <code>cobradora_session</code> é configurado como <strong>httpOnly</strong>, de forma que não possa
        ser lido diretamente por scripts executados no navegador.
      </p>

      <h2>3. Cookies de analytics, publicidade e rastreamento</h2>
      <p>
        A CobraDora <strong>não utiliza atualmente cookies próprios ou de terceiros para publicidade
        comportamental, remarketing ou analytics</strong>. Não estão integrados, neste momento, ferramentas como
        Google Analytics, Meta Pixel, Hotjar ou Microsoft Clarity.
      </p>

      <h2>4. Por que o cookie essencial é utilizado</h2>
      <p>
        O cookie de sessão é necessário para que a conta permaneça autenticada e para que funções protegidas do
        sistema operem corretamente. Por se tratar de tecnologia estritamente necessária à prestação solicitada pelo
        usuário, sua desativação pode impedir login, navegação autenticada e uso adequado da plataforma.
      </p>

      <h2>5. Como bloquear ou apagar cookies</h2>
      <p>
        O usuário pode configurar seu navegador para apagar ou bloquear cookies. Os caminhos variam conforme o
        navegador e o dispositivo. O bloqueio do cookie essencial da CobraDora poderá fazer com que a autenticação
        deixe de funcionar ou que seja necessário realizar login repetidamente.
      </p>

      <h2>6. Cookies em páginas de terceiros</h2>
      <p>
        Ao seguir um link para um ambiente externo, como o checkout da <strong>InfinitePay</strong>, o usuário passa
        a utilizar o domínio e as tecnologias do respectivo prestador. Esses ambientes podem utilizar cookies
        próprios de acordo com suas políticas, sobre os quais a CobraDora não possui controle direto.
      </p>

      <h2>7. Dados pessoais e cookies</h2>
      <p>
        Quando um cookie ou identificador estiver relacionado a uma pessoa identificada ou identificável, seu
        tratamento observará a Lei Geral de Proteção de Dados e a{" "}
        <a href="/politica-de-privacidade">Política de Privacidade da CobraDora</a>.
      </p>

      <h2>8. Inclusão futura de cookies não essenciais</h2>
      <p>
        Se futuramente a CobraDora passar a utilizar analytics, publicidade, personalização ou outras tecnologias
        não essenciais, esta Política será atualizada e serão adotados os mecanismos de transparência e, quando
        cabível, de escolha ou consentimento antes da ativação desses cookies.
      </p>

      <h2>9. Alterações desta Política</h2>
      <p>
        Podemos atualizar esta Política para refletir mudanças técnicas, regulatórias ou na forma como a plataforma
        opera. A data no topo da página indica a versão vigente.
      </p>

      <h2>10. Contato</h2>
      <p>
        Dúvidas relacionadas a cookies ou privacidade podem ser enviadas para{" "}
        <a href="mailto:contato@cobradora.com.br">contato@cobradora.com.br</a>.
      </p>
    </LegalPageShell>
  );
}
