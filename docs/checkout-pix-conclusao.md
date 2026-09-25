# Checkout Pix: implementação e pendências de publicação

## Fluxo implementado

1. Link público `/g/[publicSlug]` de organização ativa Premium direciona ao checkout Pix. Grátis mantém a tela InfinitePay.
2. Pagador informa telefone, seleciona cobranças e informa nome e CPF/CNPJ. Backend calcula o total e reserva as cobranças antes de chamar a XGate, com idempotência.
3. Tela `/pagamento/pix/[depositId]` apresenta QR Code e copia e cola e acompanha a confirmação. O token de consulta não é removido do fragmento quando o navegador impede armazenamento de sessão.
4. Webhook de depósito grava identificadores mínimos na inbox antes de responder 200; status/valor recebidos não autorizam crédito.
5. Worker consulta os detalhes autenticados da XGate, confere cliente/transação/moeda/valor e confirma exclusivamente pelo `currency.status=PAID`. A transação financeira existente baixa cobranças e credita o líquido após taxa de 3%, de forma idempotente.
6. Cron de eventos tenta novamente falhas; cron de depósitos consulta pendências com ID conhecido. A inbox preserva o hint quando a criação perdeu a resposta e ainda não há ID persistido.

Nova criação InfinitePay para Premium é bloqueada. Consultas/confirmações de pagamentos InfinitePay anteriores não foram alteradas. Saques não foram implementados nem corrigidos nesta etapa.

## Antes de publicar

- Aplicar migration 0018 após confirmar as anteriores; arquivos SQL Drizzle/Supabase e snapshot estão preparados, não executados.
- Configurar credenciais XGate, segredo de sessão/tokens e CRON_SECRET; não colocar segredos no repositório ou no frontend.
- Cadastrar a URL pública HTTPS `/api/webhooks/xgate` no painel XGate com eventos de depósitos CURRENCY.
- Confirmar a execução dos dois novos crons a cada minuto. A inbox depende do worker; apenas publicar a rota não cria execução periódica fora de uma hospedagem que interprete vercel.json.
- Configurar whitelist do remetente no firewall/proxy confiável conforme a documentação XGate. Não confiar em cabeçalhos de IP enviados diretamente pelo cliente.

## Limites

Revisão por leitura, incluindo auditor independente. Nenhum teste, build, typecheck, migração, deploy ou transação real executado por instrução do usuário. Portanto, implementação local não equivale a homologação de produção.

Estornos/contestações continuam exigindo conciliação manual, com bloqueio preventivo já existente. Estados incertos não liberam cobranças automaticamente nem geram fallback de gateway. Se a resposta de criação foi perdida e a consulta autenticada não fornecer externalId, a confirmação automática continua bloqueada por segurança; requer apoio da XGate. Cada execução do worker processa até quatro eventos; volume maior exige dimensionamento.

Referências: [recebimento de webhooks](https://api.doc.xgateglobal.com/docs/webhooks/receive/) e [consulta de depósitos](https://api.doc.xgateglobal.com/docs/webhooks/deposit/status/).
