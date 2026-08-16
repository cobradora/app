import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description: "Como o CobraDora coleta, usa e protege os dados de organizadores e participantes de grupos.",
};

const LAST_UPDATED = "15 de agosto de 2026";

export default function PrivacyPolicyPage() {
  return (
    <div className="legal-page">
      <Link className="legal-page__back" href="/login"><ArrowLeft size={16} /> Voltar</Link>

      <h1>Política de Privacidade</h1>
      <p className="legal-page__updated">Última atualização: {LAST_UPDATED}</p>

      <p>
        Esta política explica como a <strong>Athrios Soluções</strong> ("nós"), responsável pelo CobraDora, coleta,
        usa, compartilha e protege os dados pessoais de quem organiza grupos de cobrança recorrente ("organizador")
        e de quem participa desses grupos ("participante") na plataforma, em conformidade com a Lei Geral de
        Proteção de Dados (Lei nº 13.709/2018 — LGPD).
      </p>

      <h2>1. Quais dados coletamos</h2>
      <p>Coletamos apenas o necessário para o CobraDora funcionar como uma ferramenta de cobrança recorrente:</p>
      <ul>
        <li><strong>Dados de cadastro do organizador</strong>: nome, e-mail e senha. A senha nunca é armazenada em texto puro — guardamos apenas um hash criptográfico (scrypt) que não pode ser revertido.</li>
        <li><strong>Dados dos participantes</strong>: nome e número de celular, informados pelo organizador ao cadastrar alguém no grupo, ou pelo próprio participante ao acessar o link público de cobrança do grupo (que não exige login nem senha).</li>
        <li><strong>Dados financeiros</strong>: histórico de cobranças geradas, valores, status de pagamento, forma de pagamento (Pix, dinheiro ou via checkout do gateway de pagamento) e comprovantes associados.</li>
        <li><strong>Dados técnicos de sessão</strong>: um cookie de sessão (`cobradora_session`), necessário para manter o organizador autenticado. É um cookie <em>httpOnly</em> (não acessível por scripts) com validade de 30 dias. Não usamos cookies de rastreamento, publicidade ou analytics de terceiros.</li>
      </ul>

      <h2>2. Para que usamos esses dados</h2>
      <ul>
        <li>Criar e manter sua conta e a dos grupos que você organiza.</li>
        <li>Gerar, enviar e cobrar mensalidades/cobranças recorrentes dos participantes de cada grupo.</li>
        <li>Processar pagamentos e conciliar quais cobranças já foram pagas.</li>
        <li>Autenticar o acesso à plataforma e manter a conta segura (ex.: envio de e-mail para redefinição de senha).</li>
        <li>Cumprir obrigações legais e fiscais relacionadas ao processamento de pagamentos.</li>
      </ul>

      <h2>3. Com quem compartilhamos dados</h2>
      <p>Não vendemos dados pessoais. Compartilhamos apenas o estritamente necessário com prestadores de serviço que nos ajudam a operar o CobraDora, cada um responsável pelo tratamento que realiza:</p>
      <ul>
        <li><strong>InfinitePay</strong> — processa os pagamentos feitos pelos participantes via checkout (recebe nome, telefone e valor da cobrança).</li>
        <li><strong>Resend</strong> — envia e-mails transacionais, como o de redefinição de senha (recebe o e-mail do organizador).</li>
        <li><strong>Supabase</strong> — hospeda o banco de dados da aplicação.</li>
        <li><strong>Vercel</strong> — hospeda a aplicação web.</li>
      </ul>
      <p>Podemos também divulgar dados quando exigido por lei, ordem judicial ou autoridade competente.</p>

      <h2>4. Por quanto tempo guardamos os dados</h2>
      <p>
        Mantemos os dados enquanto a conta do organizador estiver ativa. Dados de cobranças e pagamentos podem ser
        mantidos por período adicional necessário para cumprir obrigações legais, fiscais e contábeis relacionadas a
        transações financeiras, mesmo após o encerramento da conta.
      </p>

      <h2>5. Seus direitos como titular de dados</h2>
      <p>Nos termos do art. 18 da LGPD, você pode solicitar, a qualquer momento:</p>
      <ul>
        <li>Confirmação de que tratamos seus dados e acesso a eles.</li>
        <li>Correção de dados incompletos, inexatos ou desatualizados.</li>
        <li>Anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade com a lei.</li>
        <li>Portabilidade dos dados a outro fornecedor de serviço.</li>
        <li>Eliminação dos dados tratados com base no seu consentimento.</li>
        <li>Informação sobre com quem compartilhamos seus dados.</li>
      </ul>
      <p>
        Participantes que não têm conta própria (o acesso ao link público não exige cadastro) também podem exercer
        esses direitos entrando em contato com o organizador do grupo ou diretamente conosco.
      </p>

      <h2>6. Segurança</h2>
      <p>
        Senhas são armazenadas com hash criptográfico, a comunicação com a plataforma é feita por HTTPS e o cookie de
        sessão é protegido contra acesso via JavaScript (httpOnly). Ainda assim, nenhum sistema é 100% livre de
        riscos — se identificarmos um incidente de segurança que afete seus dados, iremos notificá-lo conforme
        exigido pela LGPD.
      </p>

      <h2>7. Alterações nesta política</h2>
      <p>
        Podemos atualizar esta política para refletir mudanças no CobraDora ou na legislação. A data no topo desta
        página sempre indica a versão mais recente.
      </p>

      <h2>8. Contato</h2>
      <p>
        Dúvidas, solicitações sobre seus dados ou qualquer assunto relacionado a esta política podem ser enviados
        para <a className="link" href="mailto:contato@cobradora.com.br">contato@cobradora.com.br</a>.
      </p>
    </div>
  );
}
