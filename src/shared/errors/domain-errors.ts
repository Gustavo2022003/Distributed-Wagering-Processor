import { DomainError } from './domain-error';

export class UpdateConditionFailedError extends DomainError {
  readonly code = 'UPDATE_CONDITION_FAILED';
  constructor(public readonly reason: 'CONCURRENCY' | 'PRECONDITION') {
    super(`Atomic update failed: ${reason}`);
  }
}
