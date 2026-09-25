# Correção do cadastro Pix — 25/09/2026

## Atualização: habilitação automática pelo plano

Por solicitação posterior, a escolha salva do Premium (`billingModule=cobradora`) passa a habilitar a XGate para a organização. A seleção Premium foi reaberta no cadastro e nas configurações; Grátis continua usando InfinitePay. Não é criada assinatura paga por essa seleção.

`XGATE_ENABLED` e `XGATE_ORGANIZATION_IDS` deixam de controlar a disponibilidade: valores legados dessas variáveis não bloqueiam mais o Premium. Nenhuma variável global é escrita quando um usuário muda de plano. Credenciais XGate continuam obrigatórias e o cadastro financeiro permanece em `/financeiro`.

Esta atualização substitui as referências abaixo a liberação global/allowlist e à preservação dessas regras. Revisão somente por leitura, sem executar testes, build, typecheck ou operações reais. As expectativas existentes de `tests/gateway-policy.test.ts` foram ajustadas à nova regra, sem executar a suíte.

## Escopo

Correção dos bloqueios e da segurança da gravação do perfil de recebimento do organizador. Não altera planos, allowlist, credenciais, saldo, taxa de 3% ou seleção de gateway.

## Alterações

- Página e API usam a mesma disponibilidade da organização, com mensagens distintas para indisponibilidade global, liberação gradual e plano. Formulário oculto e saque desabilitado quando inelegível.
- CPF exige 11 dígitos e CNPJ exige 14, com verificação dos dígitos e correspondência ao documento do titular. Celular mantém normalização existente. Chave aleatória exige formato UUID e normaliza letras para minúsculas.
- API identifica o campo inválido, sem retornar valores pessoais nas mensagens.
- Confirma o documento do customer na XGate inclusive após criação. Consulta chaves existentes antes de cadastrar e tenta recuperá-las por leitura após falha do POST, sem repetir automaticamente a escrita.
- Só publica o novo perfil ativo após confirmação externa; uma falha preserva o perfil anterior. Publicação serializada por organização e comparação do estado anterior impedem sobrescrita concorrente silenciosa.

## Verificação e limites

Revisão estática local e por agente auditor. Nenhum teste, build, typecheck, migração ou chamada real de cadastro/saque executado, conforme instrução do usuário. Não representa homologação em produção; a suíte existente não foi executada nem atualizada nesta correção.

A organização continua precisando estar no módulo CobraDora e atender às configurações de liberação. Não houve alteração de cadastro/plano ou variáveis de ambiente para contornar essa regra.

Contratos consultados: [consulta de customer](https://api.doc.xgateglobal.com/en/docs/customer/search/), [listagem de chaves](https://api.doc.xgateglobal.com/en/docs/fiat/pix/keys/) e [cadastro de chave](https://api.doc.xgateglobal.com/en/docs/fiat/pix/add/).
