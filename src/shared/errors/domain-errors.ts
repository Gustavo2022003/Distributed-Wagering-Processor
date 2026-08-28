import { DomainError } from './domain-error';

export class WalletNotFoundError extends DomainError {
  readonly code = 'WALLET_NOT_FOUND';
  constructor(public readonly walletId: string) {
    super(`Wallet not found: ${walletId}`);
  }
}

export class UpdateConditionFailedError extends DomainError {
  readonly code = 'UPDATE_CONDITION_FAILED';
  constructor(public readonly reason: 'CONCURRENCY' | 'PRECONDITION') {
    super(`Atomic update failed: ${reason}`);
  }
}
