# WhatsApp Premium com XGate

## Implementação

- Organização ativa Premium/CobraDora pode enfileirar cobranças e avisos de ciclo sem conta InfinitePay. Grupos ativos, telefone do organizador e consentimentos dos pagadores continuam sendo exigidos conforme o tipo de mensagem.
- Pagamento XGate confirmado cria a atualização de lista na mesma transação que quita cobranças e credita saldo. A chave única usa pagamento + competência; repetição do webhook não gera outra notificação.
- O envio à Meta ocorre fora da transação financeira, pela outbox existente. Falha de envio não desfaz pagamento.
- `/api/cron/whatsapp-dispatch` processa até quatro mensagens elegíveis por execução, a cada minuto no vercel.json. Não cria campanhas nem cobranças históricas. O cron diário de lembretes continua separado.
- Ausência de credenciais/templates/configuração local adia a mensagem por 15 minutos, sem consumir tentativas de envio. Falhas externas mantêm a política existente de retry.
- A outbox deduplica eventos internos e usa claim atômico. Não garante entrega externa exatamente uma vez se a Meta aceitar a mensagem e a resposta se perder.

## Configuração pelo operador

Configurar no servidor, sem compartilhar segredos no chat ou versioná-los:

- WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID.
- WHATSAPP_CHARGE_TEMPLATE_NAME, WHATSAPP_ORGANIZER_CYCLE_TEMPLATE_NAME e WHATSAPP_ORGANIZER_UPDATE_TEMPLATE_NAME, com nomes e parâmetros compatíveis com os templates aprovados.
- APP_BASE_URL apontando para a URL pública que os pagadores conseguem abrir; localhost no celular não aponta para o computador de desenvolvimento.
- CRON_SECRET com ao menos 32 caracteres para os agendamentos autenticados.
- WHATSAPP_WEBHOOK_VERIFY_TOKEN e WHATSAPP_APP_SECRET para a rota HTTPS pública `/api/webhooks/whatsapp`, responsável por confirmação de entrega/leitura.

Fora de produção, WHATSAPP_META_TEST_MODE=true usa o template de teste já previsto pelo projeto; ele envia mensagem real, não é simulação. Não habilitar em produção. Templates de teste não apresentam o conteúdo real da cobrança/lista.

O servidor local pode enviar mensagens com as configurações corretas, mas `npm run dev` não executa os crons de vercel.json. Agendamento local e URL HTTPS pública/túnel para callbacks exigem configuração separada. Não acionar o cron contra dados reais sem autorização de envio. Na hospedagem, confirmar suporte ao agendamento por minuto e capacidade para o volume da fila.

## Verificação desta entrega

Somente leitura/revisão de código; sem testes, build, typecheck, envio de WhatsApp, alteração de credenciais ou deploy. Nenhuma migration adicional exigida nesta rodada. Pagamentos já confirmados antes desta alteração não geram mensagens retroativas automaticamente.
