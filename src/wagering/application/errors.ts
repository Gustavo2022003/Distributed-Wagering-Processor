// src/wagering/application/errors.ts
//
// Classificação de erros do consumer SQS:
//   - TerminalBusinessError: regra de negócio violada. Não adianta retry —
//     vai falhar igual. Ack e segue (o evento pode ser publicado via outbox
//     do use case com failureCode).
//   - TransientInfraError: erro temporário (Postgres offline, deadlock).
//     Retry com backoff via VisibilityTimeout do SQS. Após N tentativas,
//     o SQS joga na DLQ automaticamente.
//   - PermanentInfraError: erro permanente (mensagem corrompida, schema
//     inválido). DLQ imediato.
//
// A distinção Transient vs Permanent é feita pelo worker, não pelo
// domain — o domain só sabe que falhou.

import { DomainError } from '../../shared/errors/domain-error';

export class TerminalBusinessError extends DomainError {
  readonly code = 'TERMINAL_BUSINESS_ERROR';
}

export class TransientInfraError extends DomainError {
  readonly code = 'TRANSIENT_INFRA_ERROR';
}

export class PermanentInfraError extends DomainError {
  readonly code = 'PERMANENT_INFRA_ERROR';
}
