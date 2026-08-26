# CobraDora — escopo funcional

## Módulos de cobrança

- **Dora (grátis):** mantém o painel e o compartilhamento manual. O organizador entra no sistema para copiar ou compartilhar a lista conforme os mensalistas pagam.
- **CobraDora:** no início de cada ciclo envia cobranças privadas consolidadas aos responsáveis, avisa o organizador sobre o novo ciclo e, após cada checkout confirmado, envia a lista atualizada ao WhatsApp do organizador.
- A escolha é feita por organização entre `dora` e `cobradora`.
- Os dois módulos exigem conta InfinitePay e InfiniteTag ativa para checkout; a abertura da conta acontece diretamente na InfinitePay.
- Sem InfiniteTag ativa, checkout e automações ficam pendentes, embora ações administrativas manuais possam continuar disponíveis.
- O modo Dora não envia mensagens automáticas pela Meta.
- O preço e a assinatura do módulo CobraDora ainda não foram definidos nem implementados.

## Base da aplicação

- Tela principal única, sem sidebar.
- Header com seletor de competência.
- Cards Previsto, Recebido e Pendente.
- Grupos como badges clicáveis com gerenciamento em drawer.
- Pendências na tela principal.
- Configurações ao final: InfiniteTag, ciclo por grupo e mensagem com lista automática somente leitura.
- Footer com atalhos, usuário e logout.
- Importação de participantes, edição, remoção e baixa manual.
- Contato financeiro organizacional com responsável e dependentes.
- Renovação automática por Vercel Cron e aviso de entrada no próximo ciclo.
- Checkout InfinitePay com idempotência, replay protection, webhook validado, `payment_check` e recuperação de interrupções.
- Identidade visual CobraDora e responsividade mobile.

## Integrações do modo CobraDora

- WhatsApp Cloud API com credenciais mantidas somente no servidor.
- Três templates Meta distintos e aprovados em `pt_BR`: `cobranca`, `novo_ciclo` e `lista_atualizada`.
- Handshake do webhook por verify token e validação HMAC do corpo bruto com o App Secret.
- Cron autenticado para o envio das cobranças privadas, filtrado por módulo e deduplicado pela outbox; timeouts externos ambíguos da Meta continuam sujeitos a entrega repetida.
- Fila/ledger persistente: cobrança deduplicada por período e contato financeiro; novo ciclo por período; atualização do organizador por pagamento e período.
- Confirmações InfinitePay via webhook e `payment_check` convergem antes de qualquer atualização automática ao organizador.
- Estados de entrega/leitura do WhatsApp não alteram o estado financeiro da cobrança.
- Cobranças privadas respeitam opt-in/opt-out persistido no contato financeiro.
- O módulo CobraDora exibe controle para registrar a autorização ao adicionar, importar ou editar um participante; a revogação interrompe novos envios.

## Dependências externas para produção

- Aplicativo Meta apto a produção, número vinculado e token de acesso válido.
- Templates configurados na Meta com os mesmos nomes informados no ambiente.
- Callback público `/api/webhooks/whatsapp` configurado e inscrito nos eventos necessários.
- `CRON_SECRET` forte configurado no deploy para os endpoints agendados.
- Conta InfinitePay aberta pelo organizador e InfiniteTag conectada à organização.
