export enum FailureCode {
  // ───────────────────────────────────────────────────────────────────────
  //  REFERÊNCIA (REFUND/ROLLBACK)
  // ───────────────────────────────────────────────────────────────────────

  ReferenceNotFound = 'REFERENCE_NOT_FOUND',

  ReferenceMismatch = 'REFERENCE_MISMATCH',

  ReferenceAlreadyReversed = 'REFERENCE_ALREADY_REVERSED',

  ReferenceNotProcessed = 'REFERENCE_NOT_PROCESSED',

  ReferenceResolutionExhausted = 'REFERENCE_RESOLUTION_EXHAUSTED',

  // ───────────────────────────────────────────────────────────────────────
  //  IDEMPOTÊNCIA
  // ───────────────────────────────────────────────────────────────────────

  PayloadConflict = 'PAYLOAD_CONFLICT',

  // ───────────────────────────────────────────────────────────────────────
  //  SALDO / REGRA DE NEGÓCIO
  // ───────────────────────────────────────────────────────────────────────

  InsufficientFunds = 'INSUFFICIENT_FUNDS',

  NegativeBalanceOnReversal = 'NEGATIVE_BALANCE_ON_REVERSAL',

  // ───────────────────────────────────────────────────────────────────────
  //  KIND / CONTRATO
  // ───────────────────────────────────────────────────────────────────────

  InvalidKind = 'INVALID_KIND',

  OpeningNotAllowed = 'OPENING_NOT_ALLOWED',

  // ───────────────────────────────────────────────────────────────────────
  //  MOEDA
  // ───────────────────────────────────────────────────────────────────────

  CurrencyMismatch = 'CURRENCY_MISMATCH',

  // ───────────────────────────────────────────────────────────────────────
  //  FALHA DE INFRA (auditável mas terminal)
  // ───────────────────────────────────────────────────────────────────────

  InfrastructureError = 'INFRASTRUCTURE_ERROR',
}

export interface FailureCodeMetadata {
  readonly code: FailureCode;
  readonly category: 'REFERENCE' | 'IDEMPOTENCY' | 'BALANCE' | 'KIND' | 'CURRENCY' | 'INFRA';
  readonly providerAction: 'RESEND' | 'FIX' | 'GIVE_UP';
  readonly description: string;
}

export const FAILURE_CODE_METADATA: Record<FailureCode, FailureCodeMetadata> = {
  [FailureCode.ReferenceNotFound]: {
    code: FailureCode.ReferenceNotFound,
    category: 'REFERENCE',
    providerAction: 'FIX',
    description: 'Referência inexistente ou expirada.',
  },
  [FailureCode.ReferenceMismatch]: {
    code: FailureCode.ReferenceMismatch,
    category: 'REFERENCE',
    providerAction: 'FIX',
    description: 'Referência encontrada não casa com provider/player/wallet/rodada.',
  },
  [FailureCode.ReferenceAlreadyReversed]: {
    code: FailureCode.ReferenceAlreadyReversed,
    category: 'REFERENCE',
    providerAction: 'GIVE_UP',
    description: 'Referência já foi revertida antes — reversão é única.',
  },
  [FailureCode.ReferenceNotProcessed]: {
    code: FailureCode.ReferenceNotProcessed,
    category: 'REFERENCE',
    providerAction: 'FIX',
    description: 'Referência não está PROCESSED; reversão não faz sentido.',
  },
  [FailureCode.ReferenceResolutionExhausted]: {
    code: FailureCode.ReferenceResolutionExhausted,
    category: 'REFERENCE',
    providerAction: 'GIVE_UP',
    description: 'PENDING_REFERENCE esgotou tentativas; referência nunca chegou.',
  },
  [FailureCode.PayloadConflict]: {
    code: FailureCode.PayloadConflict,
    category: 'IDEMPOTENCY',
    providerAction: 'FIX',
    description: 'Mesmo idempotencyKey com payload divergente.',
  },
  [FailureCode.InsufficientFunds]: {
    code: FailureCode.InsufficientFunds,
    category: 'BALANCE',
    providerAction: 'RESEND',
    description: 'Saldo insuficiente no momento da operação.',
  },
  [FailureCode.NegativeBalanceOnReversal]: {
    code: FailureCode.NegativeBalanceOnReversal,
    category: 'BALANCE',
    providerAction: 'GIVE_UP',
    description: 'Reversão produziria saldo negativo — matematicamente impossível.',
  },
  [FailureCode.InvalidKind]: {
    code: FailureCode.InvalidKind,
    category: 'KIND',
    providerAction: 'FIX',
    description: 'Kind desconhecido ou não suportado.',
  },
  [FailureCode.OpeningNotAllowed]: {
    code: FailureCode.OpeningNotAllowed,
    category: 'KIND',
    providerAction: 'GIVE_UP',
    description: 'OPENING só pode ser criado internamente.',
  },
  [FailureCode.CurrencyMismatch]: {
    code: FailureCode.CurrencyMismatch,
    category: 'CURRENCY',
    providerAction: 'FIX',
    description: 'Moeda da transação diverge da moeda da wallet.',
  },
  [FailureCode.InfrastructureError]: {
    code: FailureCode.InfrastructureError,
    category: 'INFRA',
    providerAction: 'GIVE_UP',
    description: 'Erro permanente de infraestrutura — não é problema do payload.',
  },
};
