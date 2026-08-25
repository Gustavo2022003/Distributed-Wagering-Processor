export enum FailureCode {
  // --- referência (REFUND/ROLLBACK) ---
  /** referenceExternalTransactionId aponta para algo que não existe (ou expirou). */
  ReferenceNotFound = 'REFERENCE_NOT_FOUND',

  /** Referência encontrada, mas não casa com kind/jogador/wallet/rodada. */
  ReferenceMismatch = 'REFERENCE_MISMATCH',

  /** REFUND/ROLLBACK já foi aplicado antes sobre essa referência. */
  ReferenceAlreadyReversed = 'REFERENCE_ALREADY_REVERSED',

  /** REFUND/ROLLBACK é sobre uma referência que ainda não está PROCESSED. */
  ReferenceNotProcessed = 'REFERENCE_NOT_PROCESSED',

  // --- idempotência ---
  /** Mesmo idempotencyKey com payload divergente → conflito, não replay. */
  PayloadConflict = 'PAYLOAD_CONFLICT',

  // --- saldo / regra de negócio ---
  /** BET sem saldo suficiente. */
  InsufficientFunds = 'INSUFFICIENT_FUNDS',

  /**
   * Reversão que tornaria o saldo negativo. Diferente de InsufficientFunds:
   * aqui a wallet já tinha saldo, mas a operação de estorno viola a regra.
   * Operacionalmente são sinais distintos para o provedor.
   */
  NegativeBalanceOnReversal = 'NEGATIVE_BALANCE_ON_REVERSAL',

  // --- kind / contrato ---
  /** Kind desconhecido ou não suportado (defesa contra payload malformado). */
  InvalidKind = 'INVALID_KIND',

  /** OPENING foi submetido por canal externo — proibido por regra de domínio. */
  OpeningNotAllowed = 'OPENING_NOT_ALLOWED',

  // --- moeda ---
  /** Moeda da transação ≠ moeda da wallet. */
  CurrencyMismatch = 'CURRENCY_MISMATCH',

  // --- esgotamento ---
  /**
   * PENDING_REFERENCE esgotou o limite de tentativas do worker.
   * A transação de referência nunca apareceu; marcou-se REJECTED.
   */
  ReferenceResolutionExhausted = 'REFERENCE_RESOLUTION_EXHAUSTED',
}
