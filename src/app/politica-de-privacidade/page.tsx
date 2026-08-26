import type { Metadata } from "next";
import { LegalPageShell } from "@/components/legal-page-shell";

const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://www.cobradora.com.br";
const DESCRIPTION =
  "Entenda como a CobraDora coleta, utiliza, compartilha, protege e elimina dados pessoais de organizadores e participantes.";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description: DESCRIPTION,
  robots: { index: false, follow: true },
  alternates: { canonical: `${APP_BASE_URL}/politica-de-privacidade` },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "CobraDora",
    title: "Política de Privacidade | CobraDora",
    description: DESCRIPTION,
    url: `${APP_BASE_URL}/politica-de-privacidade`,
  },
  twitter: {
    card: "summary",
    title: "Política de Privacidade | CobraDora",
    description: DESCRIPTION,
  },
};

const LAST_UPDATED = "24 de agosto de 2026";
// TODO(legal): incluir CNPJ e endereço cadastral somente após confirmação dos dados oficiais.

export default function PrivacyPolicyPage() {
  return (
    <LegalPageShell title="Política de Privacidade" updated={LAST_UPDATED}>
      <p>
        Esta Política de Privacidade explica como a <strong>Mentel Soluções Digitais</strong> (&quot;nós&quot;), responsável
        pela CobraDora, coleta, utiliza, compartilha, armazena e protege dados pessoais de organizadores e
        participantes da plataforma, em conformidade com a Lei Geral de Proteção de Dados Pessoais — LGPD (Lei nº
        13.709/2018).
      </p>
      <h2>1. Quem é o responsável pelo tratamento</h2>
      <p>
        <strong>Mentel Soluções Digitais</strong>
        <br />
        Contato de privacidade: <a href="mailto:contato@cobradora.com.br">contato@cobradora.com.br</a>
      </p>

      <h2>2. Quais dados coletamos</h2>
      <ul>
        <li><strong>Dados do organizador:</strong> nome, e-mail, telefone de WhatsApp quando informado, senha protegida por hash e demais informações fornecidas no cadastro.</li>
        <li><strong>Dados dos participantes:</strong> nome, número de celular e registros relacionados à autorização ou oposição ao recebimento de mensagens, inseridos pelo organizador ou fornecidos pelo próprio participante ao utilizar a plataforma.</li>
        <li><strong>Dados de cobranças:</strong> grupo relacionado, competência, valor, vencimento, status, forma de pagamento, comprovantes e histórico operacional.</li>
        <li><strong>Dados do módulo:</strong> módulo Dora ou CobraDora selecionado, configurações de automação, histórico de alterações e, quando houver contratação paga, informações necessárias à sua administração.</li>
        <li><strong>Dados de mensagens:</strong> destinatário, tipo de comunicação, identificador fornecido pela Meta, tentativas e estados como enviado, entregue, lido ou falhou.</li>
        <li><strong>Dados técnicos:</strong> informações de sessão e registros técnicos necessários à segurança, funcionamento e cumprimento de obrigações legais aplicáveis.</li>
        <li><strong>Cookie de sessão:</strong> <code>cobradora_session</code>, necessário para manter o organizador autenticado, com validade de até 30 dias e configuração httpOnly.</li>
      </ul>

      <h2>3. Para quais finalidades usamos os dados</h2>
      <ul>
        <li>criar, autenticar e manter a conta do organizador;</li>
        <li>criar e administrar grupos e participantes;</li>
        <li>gerar, organizar e acompanhar cobranças recorrentes;</li>
        <li>processar e conciliar pagamentos realizados por integrações disponibilizadas na plataforma;</li>
        <li>administrar o módulo selecionado e, quando aplicável, sua contratação;</li>
        <li>enviar comunicações transacionais, inclusive redefinição de senha, cobranças privadas aos participantes e atualizações de pagamento ao organizador;</li>
        <li>prevenir fraude, abuso e incidentes de segurança;</li>
        <li>cumprir obrigações legais, regulatórias, fiscais, contábeis ou determinações de autoridades competentes;</li>
        <li>exercer ou defender direitos em processos judiciais, administrativos ou arbitrais.</li>
      </ul>

      <h2>4. Bases legais</h2>
      <p>
        Conforme a finalidade e o contexto, o tratamento poderá se apoiar na execução de contrato ou de procedimentos
        preliminares, cumprimento de obrigação legal ou regulatória, exercício regular de direitos, legítimo
        interesse e, quando efetivamente necessário, consentimento ou outra hipótese prevista na LGPD.
      </p>

      <h2>5. Responsabilidade do organizador pelos dados inseridos</h2>
      <p>
        O organizador é responsável por assegurar que possui fundamento legítimo para cadastrar e utilizar os dados
        dos participantes no contexto do grupo e das cobranças. A CobraDora trata essas informações para
        disponibilizar as funcionalidades contratadas e adota medidas para limitar o uso às finalidades compatíveis
        com a plataforma e com esta Política.
      </p>

      <h2>6. Com quem compartilhamos dados</h2>
      <p>Não vendemos dados pessoais. Compartilhamos informações somente quando necessário para operar a plataforma ou cumprir obrigações aplicáveis, inclusive com:</p>
      <ul>
        <li><strong>InfinitePay:</strong> processamento de pagamentos e checkout;</li>
        <li><strong>Meta/WhatsApp:</strong> envio e acompanhamento das comunicações transacionais do módulo CobraDora;</li>
        <li><strong>Resend:</strong> envio de e-mails transacionais;</li>
        <li><strong>Supabase:</strong> infraestrutura de banco de dados e serviços relacionados;</li>
        <li><strong>Vercel:</strong> hospedagem e entrega da aplicação web;</li>
        <li><strong>autoridades públicas, Poder Judiciário ou terceiros legitimados:</strong> quando houver obrigação legal, ordem válida ou necessidade de exercício regular de direitos.</li>
      </ul>

      <h2>7. Transferências e infraestrutura internacional</h2>
      <p>
        Alguns prestadores tecnológicos podem utilizar infraestrutura localizada fora do Brasil. Quando houver
        transferência internacional de dados, serão observados os requisitos aplicáveis da LGPD e as salvaguardas
        compatíveis com o serviço contratado.
      </p>

      <h2>8. Por quanto tempo guardamos os dados</h2>
      <p>
        Dados operacionais são mantidos enquanto a conta permanecer ativa ou enquanto necessários à prestação do
        serviço. Se o organizador excluir a conta, os grupos, participantes e demais dados operacionais associados
        serão eliminados, observadas as exceções legais.
      </p>
      <p>
        Determinados registros podem ser conservados por prazo adicional quando isso for necessário para cumprir
        obrigação legal ou regulatória, manter registros de segurança, atender deveres de guarda aplicáveis a
        provedores de aplicações, realizar defesa em processos ou prevenir fraudes. Encerrado o motivo de retenção,
        os dados serão eliminados ou anonimizados conforme aplicável.
      </p>

      <h2>9. Seus direitos</h2>
      <p>Nos termos da LGPD, o titular poderá exercer, quando cabível, direitos como:</p>
      <ul>
        <li>confirmação da existência de tratamento e acesso aos dados;</li>
        <li>correção de dados incompletos, inexatos ou desatualizados;</li>
        <li>anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade;</li>
        <li>portabilidade, conforme regulamentação aplicável;</li>
        <li>informação sobre compartilhamentos;</li>
        <li>eliminação de dados tratados com base em consentimento, ressalvadas hipóteses legais de conservação;</li>
        <li>informações sobre a possibilidade de não fornecer consentimento e suas consequências, quando essa for a base utilizada;</li>
        <li>revogação do consentimento, quando aplicável;</li>
        <li>revisão e informações sobre decisões automatizadas, quando houver tratamento sujeito a esse direito.</li>
      </ul>
      <p>
        Participantes que não possuam conta própria também podem exercer seus direitos entrando em contato com o
        organizador responsável pelo grupo ou diretamente conosco.
      </p>

      <h2>10. Exclusão da conta</h2>
      <p>
        O organizador pode solicitar a exclusão pelo contato de privacidade informado nesta Política. Após a
        validação do pedido, serão removidos os dados operacionais da conta, grupos e participantes, ressalvados os
        registros que devam permanecer armazenados por obrigação legal, regulatória, segurança, prevenção à fraude
        ou exercício regular de direitos.
      </p>

      <h2>11. Segurança</h2>
      <p>
        Adotamos medidas técnicas e organizacionais destinadas a proteger os dados, incluindo comunicação por HTTPS,
        proteção de credenciais e cookie de sessão com atributo httpOnly. Nenhum ambiente digital é totalmente imune
        a incidentes; caso ocorra incidente que gere obrigação de comunicação, serão adotadas as providências
        exigidas pela legislação e pela autoridade competente.
      </p>

      <h2>12. Cookies</h2>
      <p>
        Atualmente utilizamos apenas cookie necessário de sessão e não utilizamos cookies de publicidade, rastreamento
        comportamental ou analytics de terceiros. Detalhes estão na <a href="/politica-de-cookies">Política de Cookies</a>.
      </p>

      <h2>13. Crianças e adolescentes</h2>
      <p>
        A conta de organizador é destinada a pessoas com <strong>18 anos ou mais</strong>. A plataforma não deve ser
        utilizada para criar conta de organizador em nome de menor de idade. Quando um grupo incluir crianças ou
        adolescentes, o organizador é responsável por assegurar a participação do responsável legal e uma base
        adequada para o tratamento, observando o melhor interesse do menor e evitando dados desnecessários.
      </p>

      <h2>14. Alterações desta Política</h2>
      <p>
        Esta Política poderá ser atualizada para refletir alterações no serviço, fornecedores, funcionalidades ou
        requisitos legais. A versão mais recente será identificada pela data de atualização.
      </p>

      <h2>15. Contato</h2>
      <p>
        Dúvidas, solicitações ou exercício de direitos relacionados a dados pessoais podem ser enviados para{" "}
        <a href="mailto:contato@cobradora.com.br">contato@cobradora.com.br</a>.
      </p>
    </LegalPageShell>
  );
}
