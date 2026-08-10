# Groupay

Plataforma SaaS para gestão de cobranças recorrentes em grupos esportivos.

## Resumo

O Groupay elimina o trabalho manual de organizadores de grupos com mensalistas (vôlei, futebol, basquete, handebol, beach tennis). A plataforma fornece:

- Cadastro de grupos e participantes
- Controle por competência (mês/ano)
- Link permanente de pagamento por grupo
- Conciliação automática via webhook + baixa manual
- Painel de pagos e pendentes
- Histórico completo

## Arquitetura

**Estilo:** Monólito modular (MVP)
- Next.js 16 (App Router)
- React 19 + TypeScript
- Tailwind CSS 4
- PostgreSQL + Drizzle ORM
- Drizzle Kit para migrations

## Estrutura de Pastas

```
src/
├── app/                    # Rotas do Next.js (App Router)
│   ├── api/health/         # Healthcheck da aplicação
│   ├── globals.css         # Estilos globais e tema visual
│   ├── layout.tsx          # Layout raiz
│   └── page.tsx            # Dashboard principal
├── components/             # Componentes React
│   └── groupay-dashboard.tsx  # Interface completa do dashboard
├── db/                     # Camada de banco de dados
│   ├── index.ts            # Cliente Drizzle
│   └── schema.ts           # Schema das tabelas
└── lib/                    # Utilitários e dados
    └── mock-data.ts        # Dados simulados (pronto para API)
```

## Regras de Negócio Principais

- **RB-001:** Cada grupo possui link público permanente
- **RB-002:** Telefone localiza participante, mas não é chave primária
- **RB-003:** Participante pode pertencer a vários grupos (N:N)
- **RB-004:** Competência é imutável como referência histórica
- **RB-005:** Pendências acumulam (julho + agosto = ambas visíveis)
- **RB-006:** Valor vem do backend (cliente não informa valor)
- **RB-007:** Pagamento confirmado apenas por fonte confiável
- **RB-008:** Webhook é idempotente
- **RB-009:** Checkout com proteção contra duplicidade
- **RB-010:** Pagamento manual sempre possível
- **RB-011:** Origem da baixa é registrada (ator, data, observação)
- **RB-012:** Pagamento confirmado não é apagado (eventos compensatórios)
- **RB-013:** Split é regra de liquidação, não de cobrança
- **RB-014:** Gateway é abstraído (não depende de IDs específicos)
- **RB-015:** WhatsApp não participa do fluxo transacional
- **RB-016:** Multi-tenant desde o início
- **RB-017:** Alterações de valor são auditadas
- **RB-018:** Participante removido não apaga histórico
- **RB-019:** Uma cobrança representa uma obrigação distinta
- **RB-020:** Reprocessamento seguro (sem duplicar efeitos)

## Telas Funcionais

### Navegação Principal
- **Visão Geral** — Resumo financeiro, grupos ativos, pendências do mês
- **Grupos** — Lista de grupos com progresso de pagamento
- **Cobrança** — Todas as cobranças com filtros (Todas/Pendentes/Pagas)
- **Configurações** — Chave PIX, gateway, modelo de cobrança

### Detalhe do Grupo
- Participantes do grupo com situação de pagamento
- Botões: Copiar link, Copiar mensagem, Link de pagamento
- Adicionar novo participante
- Baixa manual individual

### Checkout Nativo (Link de Pagamento)
1. **Identificação** — Campo de celular para localizar participante
2. **Confirmação** — Exibe pendência, solicita nome completo, mostra chave PIX

### Mensagem de Cobrança
Texto gerado automaticamente com:
- Saudação do grupo
- Lista de jogadores com indicadores ✅ (pago) / 🔴 (pendente)
- Link de pagamento
- Assinatura amigável

## Design System

- **Fundo:** Branco com pontilhado espaçado (22px)
- **Tipografia:** Carvão (`#24282a`), títulos em Georgia
- **Elementos:** Bordas e molduras em cinza claro/prata, **sem arredondamentos**
- **Cards de status:**
  - Verde semitransparente (`rgba(202,231,215,0.4)`) — recebido
  - Vermelho semitransparente (`rgba(242,211,210,0.42)`) — pendente
- **Identificação:** Grupos identificados por nome completo (sem badges de iniciais)
- **Responsividade:** Layout fluido, menu lateral vira drawer em mobile

## Como Executar

```bash
# Instalar dependências
npm install

# Executar em desenvolvimento
npm run dev

# Build de produção
npm run build

# Validação de tipos
npm run typecheck

# Aplicar schema no banco (quando DATABASE_URL configurado)
npx drizzle-kit push
```

## Variáveis de Ambiente

```env
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
```

## Próximos Passos (Roadmap)

- [ ] Integração com gateway de pagamento (Stripe, Pagar.me, etc.)
- [ ] Webhooks para conciliação automática
- [ ] Sistema de planos e comissões
- [ ] Relatórios financeiros exportáveis
- [ ] Notificações por email
- [ ] App mobile (PWA)

## Licença

Proprietário — Groupay Team
