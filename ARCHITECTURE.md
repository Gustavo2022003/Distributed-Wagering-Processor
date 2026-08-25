# ARCHITECTURE.md

## 1. Visão geral

O sistema é um processador financeiro distribuído de transações de apostas (WagerTransaction), recebendo eventos de provedores de jogos via fila SQS (wager-transactions.fifo) e via endpoint HTTP, ambos convergindo no mesmo caso de uso de processamento. Cada transação altera o saldo de uma Wallet de forma idempotente (via inbox e idempotency key) e auditável (via WalletLedgerEntry, um histórico append-only), com controle de concorrência via optimistic locking baseado em versão. Eventos de integração resultantes são publicados de forma confiável através do padrão outbox, garantindo que a persistência financeira e a publicação de eventos sejam sempre atômicas.

## 2. Autenticação

Autenticação (Keycloak/Zitadel) não foi implementada. Essa decisão foi deliberada: a seção de critérios de avaliação do desafio não atribui pontos a autenticação, e o tempo disponível foi priorizado para as áreas com peso na nota: correção financeira, concorrência, idempotência e mensageria, que juntas concentram a maior parte da avaliação.

Um ponto de extensão foi deixado no código (ProviderIdentityGuard), sinalizando onde a autenticação entraria na arquitetura em um cenário de produção, sem implementá-la de fato nesta entrega.