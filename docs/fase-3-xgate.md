# Fase 3 — depósitos Pix e saldo

Implementação local sobre o schema e cliente das fases 1 e 2. O usuário solicitou não executar testes; esta etapa não executou testes, lint, typecheck, build nem migrations. A implantação e as credenciais reais continuam fora desta entrega.

## Fluxo

1. O administrador acessa `/financeiro`. Organizações habilitadas encontram os links `/g/{publicSlug}/pix`.
2. O pagador consulta suas cobranças por telefone e informa nome legal e CPF/CNPJ. As cobranças, organização e valores são derivados do banco.
3. O servidor reserva cobranças e cria sessão/depósito antes das chamadas externas. O UUID do depósito é o `externalId`. Cada tentativa tem uma chave idempotente, e somente a criação vencedora envia o pedido financeiro.
4. O customer é criado ou reutilizado; seu documento e ID são conferidos por consulta autenticada. O ID fica congelado na sessão. A identificação não deve ser apresentada como comprovação de identidade civil ou autenticação do usuário.
5. A XGate retorna Pix Copia e Cola; `/pagamento/pix/{depositId}` gera o QR Code localmente com `qrcode`. O token de consulta viaja no fragmento inicial, depois em Authorization, sem integrar a URL enviada ao servidor.
6. Webhook e consulta da página convergem para a mesma confirmação. O servidor consulta a XGate, confere ID, cliente, BRL/PIX e valor e somente aceita `currency.status=PAID`, sem conversão cripto.
7. Cobranças, pagamento, alocações, depósito e crédito líquido são gravados na mesma transação. R$ 100,00 geram R$ 3,00 de taxa e R$ 97,00 de crédito; o ledger registra o líquido uma única vez e preserva bruto/taxa como metadados.

## Rotas

- `POST /api/public/groups/{publicSlug}/xgate-checkout`: telefone, nome, documento, cobranças e chave idempotente.
- `POST /api/public/xgate-deposits/{depositId}/payment-check`: token Bearer da sessão; dados públicos mínimos, sem documento.
- `POST /api/webhooks/xgate`: notificações DEPOSIT; payload nunca é prova de liquidação.
- `GET /api/finance/balance`: somente owner/admin, organização da sessão autenticada.
- `GET /api/cron/xgate-deposits`: Bearer CRON_SECRET, lote de até quatro depósitos com ID conhecido; agendamento externo ainda não configurado.

## Configuração e coexistência

`XGATE_EMAIL`, `XGATE_PASSWORD`, `XGATE_ENABLED=true` e UUIDs separados por vírgula em `XGATE_ORGANIZATION_IDS`. Configurações permanecem somente no servidor. Não há ativação em produção nesta entrega. A migration 0016 das fases anteriores precisa estar aplicada no ambiente que utilizará as novas rotas.

Checkout InfinitePay continua na página original. Sua expiração automática, liberação forçada e reuso de chave não podem cancelar ou reutilizar sessões XGate. O TTL local de 15 minutos não invalida o Pix no provedor. Sessões XGate continuam em conciliação após desligar a flag, sem migração automática para outro gateway.

## Tratamento de incerteza e limites

- Falha comprovadamente anterior ao envio do depósito ou rejeição definitiva libera a reserva. Timeout, resposta inválida ou gravação local incerta mantém as cobranças reservadas. Nunca repete POST financeiro automaticamente.
- A [consulta oficial de depósito](https://api.doc.xgateglobal.com/docs/webhooks/deposit/status/) não garante externalId na resposta. Para ID persistido a partir da criação autenticada, ele é opcional e conferido se presente. Para recuperar ID desconhecido a partir de um webhook, externalId na consulta autenticada é obrigatório. Sem essa evidência, é necessária conciliação com o provedor.
- Eventos não pagos ou de status desconhecido não liberam automaticamente a cobrança. Se a consulta autenticada detectar alteração de um depósito já confirmado, registra `xgate_deposit_review`, informa erro de conciliação ao webhook, zera a disponibilidade exibida da organização e impede novas reservas de saque. O saldo contábil/histórico não é apagado. Estornos e disputas precisam de conciliação específica; o ledger das fases anteriores oferece compensação, mas seu acionamento automático depende dos contratos de estados da XGate. O bloqueio só pode ser encerrado com conciliação financeira e registro explícito `xgate_deposit_review_resolved` para o depósito, jamais apenas apagando a notificação. Não utilizar este fluxo como implementação completa de estornos.
- Webhook usa consulta autenticada, rate limit por depósito e registro de hash; não confia em cabeçalhos de IP fornecidos pelo cliente. A restrição por IP no proxy/firewall pode ser configurada na hospedagem conforme documentação XGate. Em falha de consulta retorna 503; página e rotina de conciliação podem recuperar transações com ID conhecido.
- A mudança da experiência padrão de cobrança e as automações WhatsApp ficam para a fase 5. Saques pertencem à fase 4.
- Revisão estática não equivale a homologação financeira. Os especialistas originais foram interrompidos por limite de uso; registrar separadamente eventual parecer do auditor.

## Correções após revisão independente

- Retomada de `not_started` por compare-and-set após interrupção entre a reserva local e o início da chamada.
- Recuperação da sessão por fingerprint da organização, contato, grupo, CPF/CNPJ, nome e cobranças quando o navegador perde a chave. A recuperação não emite segundo POST financeiro para estados já iniciados.
- Consulta de alterações posteriores ao pagamento, registro de pendência e bloqueio do saldo para novos saques até conciliação.
- Nenhum teste executado nesta fase, por orientação expressa do usuário. O parecer independente e suas limitações estão em `docs/auditoria-sprint-xgate.md`.
