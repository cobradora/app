import type { Metadata } from "next";
import { LegalPageShell } from "@/components/legal-page-shell";

const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://www.cobradora.com.br";
const DESCRIPTION = "Termos de Uso da CobraDora: regras de acesso, planos, cobranças, cancelamento, reembolsos e responsabilidades.";

export const metadata: Metadata = {
  title: "Termos de Uso",
  description: DESCRIPTION,
  alternates: { canonical: `${APP_BASE_URL}/termos-de-uso` },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "CobraDora",
    title: "Termos de Uso | CobraDora",
    description: DESCRIPTION,
    url: `${APP_BASE_URL}/termos-de-uso`,
  },
  twitter: {
    card: "summary",
    title: "Termos de Uso | CobraDora",
    description: DESCRIPTION,
  },
};

const LAST_UPDATED = "17 de agosto de 2026";

export default function TermsOfUsePage() {
  return (
    <LegalPageShell title="Termos de Uso" updated={LAST_UPDATED}>
      <p>
        Estes Termos de Uso regulam o acesso e a utilização da plataforma <strong>CobraDora</strong>, uma solução
        digital para organização e gestão de cobranças recorrentes de grupos, disponibilizada por{" "}
        <strong>Mentel Soluções Digitais</strong> (&quot;CobraDora&quot;, &quot;nós&quot; ou &quot;plataforma&quot;). Ao criar uma conta,
        contratar um plano ou utilizar a plataforma, o usuário declara que leu e concorda com estes Termos.
      </p>
      <div className="notice">
        <strong>Atenção antes da publicação:</strong> complete o CNPJ e o logradouro da Mentel Soluções Digitais.
        Esses dados devem constar de forma clara no comércio eletrônico.
      </div>

      <h2>1. Identificação do fornecedor</h2>
      <p>
        <strong>Responsável:</strong> Mentel Soluções Digitais
        <br />
        <strong>CNPJ:</strong> [INFORMAR CNPJ]
        <br />
        <strong>Endereço:</strong> [INFORMAR LOGRADOURO], nº 133, sala 3, CEP 03687-010, São Paulo/SP
        <br />
        <strong>Contato:</strong> <a href="mailto:contato@cobradora.com.br">contato@cobradora.com.br</a>
      </p>

      <h2>2. O que é a CobraDora</h2>
      <p>
        A CobraDora é uma ferramenta tecnológica de apoio à gestão de cobranças recorrentes. A plataforma permite,
        entre outras funcionalidades disponibilizadas conforme o plano contratado, cadastrar grupos e participantes,
        registrar valores e vencimentos, gerar mensagens e links de cobrança, acompanhar pagamentos e manter o
        histórico operacional.
      </p>
      <p>
        A CobraDora <strong>não é instituição financeira, banco, carteira digital, empresa de cobrança
        extrajudicial ou garantidora do pagamento das obrigações cadastradas</strong>. O processamento de pagamentos
        online é realizado por prestadores de pagamento integrados, atualmente a InfinitePay.
      </p>

      <h2>3. Elegibilidade e idade mínima</h2>
      <p>
        O cadastro de organizadores é permitido apenas a pessoas com <strong>18 anos ou mais</strong> e com
        capacidade para celebrar contratos. Ao criar uma conta, o usuário declara cumprir esses requisitos e
        fornecer informações verdadeiras, completas e atualizadas.
      </p>

      <h2>4. Conta, credenciais e segurança</h2>
      <ul>
        <li>O usuário é responsável pela guarda de suas credenciais e pelas atividades realizadas em sua conta.</li>
        <li>É proibido compartilhar acesso de modo que contorne limites do plano, comprometa a segurança da plataforma ou permita uso por pessoas não autorizadas.</li>
        <li>Suspeitas de uso indevido, fraude ou comprometimento de credenciais devem ser comunicadas ao suporte.</li>
      </ul>

      <h2>5. Responsabilidade do organizador pelas cobranças</h2>
      <p>
        O organizador é integralmente responsável pela <strong>origem, legitimidade, valor, vencimento, descrição e
        destinatários</strong> das cobranças cadastradas. Cabe ao organizador assegurar que possui relação legítima
        com os participantes e fundamento adequado para utilizar seus dados de contato e realizar as cobranças.
      </p>
      <p>
        A CobraDora fornece a infraestrutura tecnológica para organizar informações e facilitar o processo de
        cobrança, mas não valida a existência da dívida, não decide controvérsias entre organizador e participante e
        não assume responsabilidade por cobranças indevidas, duplicadas, abusivas ou cadastradas com informações
        incorretas pelo usuário.
      </p>

      <h2>6. Dados de participantes</h2>
      <p>
        Ao inserir nome, telefone ou outras informações de participantes, o organizador declara que está autorizado
        a utilizar esses dados para as finalidades relacionadas ao grupo e às cobranças. O tratamento de dados pela
        CobraDora segue a <a href="/politica-de-privacidade">Política de Privacidade</a>.
      </p>

      <h2>7. Pagamentos dos participantes</h2>
      <p>
        A CobraDora não mantém saldo financeiro dos grupos e não recebe os valores das mensalidades como instituição
        custodiante. Quando o organizador disponibiliza pagamento online, o processamento ocorre por meio da{" "}
        <strong>InfinitePay</strong>, de acordo com as condições do respectivo checkout.
      </p>
      <p>
        A disponibilidade, aprovação, compensação, estorno e demais operações inerentes ao meio de pagamento também
        podem depender da infraestrutura e das regras do prestador de pagamento.
      </p>

      <h2>8. Planos e contratação da CobraDora</h2>
      <p>
        Os recursos, limites de grupos, quantidade de participantes, preços e demais condições de cada plano são
        aqueles exibidos na página comercial no momento da contratação e integram estes Termos.
      </p>
      <p>
        O pagamento da assinatura é processado por meio da <strong>InfinitePay</strong>. Os planos podem ser pagos
        via Pix ou cartão de crédito, inclusive em até 12 parcelas sem juros quando essa condição estiver disponível
        e apresentada no checkout.
      </p>

      <h2>9. Período inicial de 7 dias</h2>
      <p>
        Após a confirmação do pagamento, o usuário recebe <strong>7 dias de utilização gratuita</strong>. O ciclo
        mensal ou anual contratado começa a ser contado após o encerramento desses 7 dias.
      </p>
      <p>
        Sem prejuízo de direitos previstos em lei, quando aplicável a relação de consumo o usuário poderá exercer o
        direito de arrependimento dentro do prazo legal contado da contratação. Se o cancelamento ocorrer durante o
        período inicial de 7 dias, o valor pago será integralmente reembolsado.
      </p>

      <h2>10. Ausência de renovação automática e fidelidade</h2>
      <p>
        Os planos da CobraDora <strong>não possuem renovação automática</strong> e <strong>não exigem
        fidelidade</strong>. Ao terminar o período contratado, o usuário deverá realizar novo pagamento para
        continuar utilizando as funcionalidades pagas.
      </p>
      <p>
        Se não houver nova contratação ao final do ciclo, o acesso às funcionalidades do sistema será suspenso até a
        contratação de novo período. A expiração do plano, por si só, não equivale à exclusão da conta.
      </p>

      <h2>11. Cancelamento e reembolsos</h2>
      <h3>11.1. Durante os 7 dias iniciais</h3>
      <p>
        O usuário poderá cancelar e solicitar reembolso integral do valor pago, observados também os direitos de
        arrependimento previstos na legislação quando aplicáveis.
      </p>
      <h3>11.2. Plano mensal após o período inicial</h3>
      <p>
        Como não há renovação automática, o plano mensal permanecerá disponível até o encerramento do ciclo
        contratado. Após os 7 dias iniciais, não haverá reembolso proporcional pelo período já iniciado, salvo
        quando exigido por lei ou quando decorrente de falha imputável à CobraDora que justifique restituição.
      </p>
      <h3>11.3. Plano anual após o período inicial</h3>
      <p>
        O usuário poderá solicitar o cancelamento antecipado. Nesse caso, será realizado{" "}
        <strong>reembolso proporcional ao período pago e ainda não utilizado</strong>, descontado o período
        efetivamente disponibilizado até a data do cancelamento. O estorno será processado pelo meio de pagamento
        original, respeitados os prazos técnicos da instituição financeira ou do gateway.
      </p>

      <h2>12. Exclusão da conta</h2>
      <p>
        O organizador poderá solicitar ou realizar a exclusão diretamente pelo sistema. A exclusão removerá os
        grupos, participantes e demais dados operacionais associados à conta, ressalvados dados e registros cuja
        conservação seja necessária para cumprimento de obrigação legal ou regulatória, exercício regular de
        direitos, prevenção a fraudes, segurança ou outras hipóteses admitidas pela legislação.
      </p>
      <p>
        A exclusão da conta é distinta da expiração de um plano. O fim do período pago suspende o acesso, mas não
        exclui automaticamente a conta.
      </p>

      <h2>13. Usos proibidos</h2>
      <p>É proibido utilizar a CobraDora para:</p>
      <ul>
        <li>fraudes, golpes, cobranças inexistentes ou qualquer atividade ilícita;</li>
        <li>assédio, ameaça, perseguição, constrangimento abusivo ou spam;</li>
        <li>cobrança relacionada a produtos, serviços ou atividades ilegais;</li>
        <li>violar direitos de privacidade, proteção de dados, propriedade intelectual ou outros direitos de terceiros;</li>
        <li>inserir dados obtidos de forma ilícita ou sem fundamento legítimo;</li>
        <li>tentar acessar contas, bancos de dados ou áreas restritas sem autorização;</li>
        <li>explorar vulnerabilidades, interferir na disponibilidade do serviço, realizar engenharia reversa abusiva ou contornar mecanismos de segurança e limites técnicos;</li>
        <li>utilizar automações ou integrações de forma que violem regras de terceiros ou prejudiquem a plataforma.</li>
      </ul>

      <h2>14. Suspensão e encerramento</h2>
      <p>
        A CobraDora poderá suspender ou limitar o acesso quando houver término do período contratado, suspeita
        razoável de fraude, risco à segurança, violação destes Termos, uso ilícito, ordem de autoridade competente ou
        necessidade técnica emergencial. Sempre que razoavelmente possível e juridicamente permitido, o usuário será
        informado sobre a medida.
      </p>

      <h2>15. Disponibilidade e evolução do serviço</h2>
      <p>
        Buscamos manter a plataforma disponível e segura, mas serviços online podem sofrer interrupções programadas
        ou incidentais. Recursos podem ser ajustados, substituídos ou aprimorados ao longo do tempo. Alterações
        materiais que reduzam de forma relevante o que já foi contratado serão tratadas de maneira compatível com a
        oferta vigente e com a legislação aplicável.
      </p>

      <h2>16. Serviços de terceiros</h2>
      <p>
        A plataforma depende de serviços de terceiros, incluindo infraestrutura de hospedagem, banco de dados,
        e-mail e pagamentos. Falhas exclusivamente atribuíveis a esses prestadores poderão afetar temporariamente
        determinadas funcionalidades. Isso não afasta direitos do usuário quando a responsabilidade legal da
        CobraDora estiver caracterizada.
      </p>

      <h2>17. Propriedade intelectual</h2>
      <p>
        A marca CobraDora, interface, identidade visual, software, textos, elementos gráficos, documentação, fluxos
        e demais componentes próprios da plataforma são protegidos pela legislação aplicável. A contratação concede
        apenas licença limitada, revogável, não exclusiva e intransferível para utilizar o serviço durante o período
        autorizado.
      </p>

      <h2>18. Limitação de responsabilidade</h2>
      <p>
        Na máxima extensão permitida pela legislação, a CobraDora não responde por prejuízos decorrentes de
        informações incorretas inseridas pelo organizador, cobranças ilegítimas, conflitos entre organizador e
        participante, indisponibilidade de serviços de terceiros fora de seu controle razoável ou uso da plataforma
        em desacordo com estes Termos.
      </p>
      <p>
        Nenhuma disposição destes Termos exclui ou restringe responsabilidade que não possa ser legalmente afastada,
        nem reduz direitos assegurados ao consumidor quando a relação estiver sujeita ao Código de Defesa do
        Consumidor.
      </p>

      <h2>19. Privacidade e cookies</h2>
      <p>
        O tratamento de dados pessoais é descrito na <a href="/politica-de-privacidade">Política de Privacidade</a>.
        O uso de cookies e tecnologias semelhantes é explicado na{" "}
        <a href="/politica-de-cookies">Política de Cookies</a>.
      </p>

      <h2>20. Alterações destes Termos</h2>
      <p>
        Estes Termos poderão ser atualizados para refletir mudanças no serviço, nos modelos comerciais ou na
        legislação. A versão vigente será identificada pela data de atualização. Alterações materiais serão
        comunicadas pelos meios razoavelmente disponíveis.
      </p>

      <h2>21. Atendimento</h2>
      <p>
        Dúvidas, cancelamentos, solicitações de reembolso ou outras demandas podem ser encaminhadas para{" "}
        <a href="mailto:contato@cobradora.com.br">contato@cobradora.com.br</a>.
      </p>

      <h2>22. Legislação e foro</h2>
      <p>
        Estes Termos são regidos pelas leis da República Federativa do Brasil. Para relações que não sejam de
        consumo, fica eleito o foro da Comarca de São Paulo/SP, sem prejuízo de outro foro obrigatório por lei. Nas
        relações de consumo, será respeitado o foro legalmente competente e os direitos assegurados ao consumidor.
      </p>
    </LegalPageShell>
  );
}
