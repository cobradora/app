# Sprint XGate

## Escopo acordado

Saldo virtual segregado por organização; depósitos efetivamente confirmados pela XGate geram taxa de 3% congelada e crédito líquido. Saque consome esse saldo sem nova taxa de plataforma. Pagamentos manuais e pagamentos InfinitePay não geram saldo XGate. Organização virtual não significa subconta bancária ou subconta XGate criada automaticamente.

## Equipe e dependências

| Fase | Especialista | Entrega | Dependência |
| --- | --- | --- | --- |
| 1 | fase_1_nucleo_financeiro | Schema, migrations, ledger e reservas | — |
| 2 | fase_2_cliente_xgate | Cliente servidor e testes de contratos | — |
| 3 | fase_3_depositos_pix | Depósito, confirmação e saldo | 1 e 2 |
| 4 | fase_4_saques | Perfil financeiro e saque | 1 e 2 |
| 5 | fase_5_migracao_checkout | Seleção por organização e interface | 3 e 4 |
| Auditoria | auditor_sprint | Revisão independente e evidências | Cada entrega |

O coordenador integra os contratos e executa verificações finais. Até três especialistas/auditor podem trabalhar simultaneamente além do coordenador; as vagas são reutilizadas entre as fases. Toda entrega deve passar por revisão; achados críticos impedem considerar a sprint concluída.

## Ativação

Implementação local e testes simulados não autorizam transações reais. O fluxo de novos depósitos exige `XGATE_ENABLED=true` e organização no plano premium (`organizations.billing_module = 'cobradora'`); o plano grátis (`dora`) nunca usa XGate. `XGATE_ORGANIZATION_IDS` é um filtro fino opcional (lista separada por vírgulas) pra restringir ainda mais dentro do premium durante o rollout gradual — vazio libera todas as organizações premium. O padrão permanece InfinitePay. A escolha fica congelada por transação; alterar a configuração não deve interromper sua reconciliação nem recriar uma cobrança pendente em outro provedor.

As migrations devem ser aplicadas apenas a um banco de testes identificado durante esta sprint. Homologação financeira real e ativação em produção são etapas posteriores, com configuração e autorização próprias. Não há ambiente sandbox público confirmado na documentação consultada.

## Aceite

- R$ 100,00 confirmados geram R$ 3,00 de taxa e R$ 97,00 líquidos.
- Crédito, reserva, consumo, liberação e estorno são idempotentes.
- Transações de organizações diferentes não se misturam.
- Saques concorrentes não gastam o mesmo saldo; falha ambígua mantém reserva.
- Webhook não autenticado não confirma dinheiro por seu próprio payload.
- Confirmação verifica transação, cliente, valor e moeda na API autenticada.
- Não há fallback automático após tentativa ambígua.
- Testes existentes da InfinitePay continuam válidos.

O relatório independente fica em `docs/auditoria-sprint-xgate.md`; a existência deste plano não indica aprovação ou homologação das fases.
