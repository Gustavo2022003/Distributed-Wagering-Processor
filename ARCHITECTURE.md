# ARCHITECTURE.md

## 1. Visão geral

O sistema é um processador financeiro distribuído de transações de apostas (WagerTransaction), recebendo eventos de provedores de jogos via fila SQS (wager-transactions.fifo) e via endpoint HTTP, ambos convergindo no mesmo caso de uso de processamento. Cada transação altera o saldo de uma Wallet de forma idempotente (via inbox e idempotency key) e auditável (via WalletLedgerEntry, um histórico append-only), com controle de concorrência via optimistic locking baseado em versão. Eventos de integração resultantes são publicados de forma confiável através do padrão outbox, garantindo que a persistência financeira e a publicação de eventos sejam sempre atômicas.

## 2. Autenticação

Autenticação (Keycloak/Zitadel) não foi implementada. Essa decisão foi deliberada: a seção de critérios de avaliação do desafio não atribui pontos a autenticação, e o tempo disponível foi priorizado para as áreas com peso na nota: correção financeira, concorrência, idempotência e mensageria, que juntas concentram a maior parte da avaliação.

Um ponto de extensão foi deixado no código (ProviderIdentityGuard), sinalizando onde a autenticação entraria na arquitetura em um cenário de produção, sem implementá-la de fato nesta entrega.

## 3. Persistência

### 3.1 ORM — MikroORM 7

Escolha: **MikroORM** (preferencial conforme seção 4 do README).

Justificativas:
- **Unit of Work explícito** — `em.transactional(...)` delega o ciclo de vida da transação. O use case não precisa lembrar de BEGIN/COMMIT/ROLLBACK.
- **Identity Map** — uma instância de cada aggregate por sessão; não há risco de mexer em dois `Wallet` "iguais" em paralelo sem perceber.
- **LockMode** — `OPTIMISTIC` mapeia naturalmente pra `WHERE version = ?`.
- **Decorator-based entities** — o `tsconfig.json` já tem `emitDecoratorMetadata: true` e `experimentalDecorators: true` desde o scaffold, então não foi preciso tocar.
- **Migrations versionadas e reversíveis** — geradas a partir das entities ou escritas à mão (como neste projeto), com `up()` e `down()` por migration.

Em MikroORM 7, os decorators saíram de `@mikro-orm/core` para `@mikro-orm/decorators/legacy` (decorator syntax experimental). Os imports no projeto refletem isso.

### 3.2 Mapeamento de Money

`Money` (value object em `src/shared/money.ts`) é internamente um `Decimal` da lib `decimal.js`, exposto como `{ amount: string, currency: string }`. Na persistência, esses dois campos viram **duas colunas separadas** por instância de `Money`:

| Coluna | Tipo Postgres | Por quê |
|---|---|---|
| `*_amount` | `NUMERIC(20, 2) NOT NULL` | Exatidão decimal. Não é `float`, não é `double`. |
| `*_currency` | `CHAR(3) NOT NULL` | ISO 4217 fixo em 3 letras, validado por CHECK. |

Por que **não** `MONEY` (tipo do Postgres): precisão dependente de locale, não portável, e não é ISO.

Por que **não** `JSONB { amount, currency }`: impossibilita CHECK constraint por coluna, índice composto, e queries que filtram por faixa de valor.

A reidratação é exata: `Money.from(entity.balance_amount, entity.balance_currency)` reconstrói o value object sem perda. O `toFixed(2)` do `Money` garante que `25.00` é sempre `25.00` (não `25` ou `25.00000001`).

Toda coluna de valor tem `CHECK (... > 0)` ou `CHECK (... >= 0)`, e toda coluna de moeda tem `CHECK (currency ~ '^[A-Z]{3}$')` — defesa em profundidade, não só no domínio.

### 3.3 Estratégia de concorrência — Optimistic Locking

A unidade de concorrência é a `walletId` (seção 8 do README).

Escolha: **optimistic locking** baseado na coluna `version` que já existe no `Wallet`.

Como funciona:
1. Use case reidrata o `Wallet` do banco (com `version: 5`).
2. Chama `wallet.debit(...)` que retorna um `MovementPlan` com `newVersion: 6`.
3. Repository faz `UPDATE wallets SET balance_amount = ?, version = 6 WHERE id = ? AND version = 5`.
4. Se `affected === 0`, outra instância moveu essa wallet no meio tempo — lança `OptimisticLockError`.
5. Caller pega o erro, **reidrata de novo** e tenta outra vez (retry limitado, N vezes).

Por que **não** `SELECT FOR UPDATE`:
- Lock pessimista segura a linha durante toda a transação, incluindo o `INSERT` no outbox. Em hot wallet, vira gargalo.
- Optimistic não bloqueia leitura; só a escrita conflita.

Por que **não** `UPDATE ... WHERE balance_amount >= ?` (update atômico condicional):
- Funciona pra `BET`, mas `REFUND`/`ROLLBACK` dependem de checar a referência antes — precisa reidratar a transação de referência mesmo assim. Misturar as duas estratégias complica o use case.

### 3.4 Idempotência persistente

A regra do README é dura: **idempotência não pode depender de cache em memória**. A garantia mora no banco, em três lugares:

1. **`UNIQUE (idempotency_key)` em `wager_transactions`** — segunda inserção com mesma key falha com constraint violation. O use case pega o erro, consulta o registro existente e decide replay vs. conflito (comparando `payload_hash`).
2. **`UNIQUE (consumer_name, message_id)` em `inbox_messages`** — mensagem SQS duplicada não é processada duas vezes. O consumer grava na inbox **dentro da mesma transação** que processa o evento, e o `INSERT` falha se a mensagem já foi recebida.
3. **`UNIQUE (event_id)` em `outbox_messages`** — o publisher nunca publica o mesmo evento duas vezes (a coluna `published_at` é setada na primeira vez, e o worker pula entradas já publicadas).

### 3.5 Imutabilidade do ledger

A regra 5 do seção 5 do README: "Não sobrescrever nem excluir lançamentos do ledger." Garantias:

- **Defense in depth 1** (código): `WalletLedgerEntry` não tem setters nem métodos de transição. Imutabilidade **estrutural**.
- **Defense in depth 2** (banco): `REVOKE UPDATE, DELETE ON wallet_ledger_entries FROM app_role`. A aplicação conecta com `app_role`, que só tem `SELECT` e `INSERT`. Qualquer tentativa de UPDATE ou DELETE retorna `permission denied`.

Por que `REVOKE` em vez de trigger: é mais barato, mais visível, e fica no mesmo migration que cria a tabela. O test `constraints.spec.ts > REVOKE bloqueia UPDATE no wallet_ledger_entries` valida que isso funciona de verdade.

### 3.6 Estrutura física

```
src/
  db/
    mikro-orm.config.ts       # DataSource usado pelo CLI e runtime
    database.module.ts        # MikroOrmModule.forRoot pro Nest
  wallet/persistence/
    wallet.entity.ts          # @Entity wallets
    wallet.mapper.ts          # Wallet <-> WalletEntity
  wagering/persistence/
    wager-transaction.entity.ts
    wager-transaction.mapper.ts
  ledger/persistence/
    wallet-ledger-entry.entity.ts
    wallet-ledger-entry.mapper.ts
  messaging/persistence/
    inbox-message.entity.ts
    inbox-message.mapper.ts
    outbox-message.entity.ts
    outbox-message.mapper.ts
  migrations/
    Migration20260826000000.ts  # schema completo, up + down
```

Entities ficam em `persistence/`, não em `domain/`. O domínio **não conhece** ORM/decorators. A ponte é o mapper.

### 3.7 Índices principais

| Índice | Por quê |
|---|---|
| `ix_wtx_reference_resolution (provider_id, reference_external_transaction_id)` | Quando chega um `REFUND`/`ROLLBACK`, o use case busca a transação de referência. Esse índice é o caminho crítico. |
| `ix_wtx_wallet_status (wallet_id, status)` | Worker de `PENDING_REFERENCE` busca por wallet + status. |
| `ix_wtx_status_created (status, created_at)` | Worker de retries varre por status antigo primeiro. |
| `ix_wle_wallet_created (wallet_id, created_at)` | Extrato da wallet (ordenado por tempo). |
| `ix_outbox_pending_due (published_at, next_attempt_at)` | Worker de outbox busca `WHERE published_at IS NULL AND next_attempt_at <= NOW()`. Esse índice é composto parcial na prática — em produção, substituir por índice parcial real. |
| `uq_wallets_player_currency UNIQUE (player_id, currency)` | Garante no máximo uma wallet por jogador+moeda. |
| `uq_wtx_idempotency_key UNIQUE (idempotency_key)` | Idempotência persistente. |
| `uq_wtx_provider_external UNIQUE (provider_id, external_transaction_id)` | Defesa em profundidade: idempotencyKey pode estar mal formado, mas o par provedor+id externo é a fonte da verdade. |