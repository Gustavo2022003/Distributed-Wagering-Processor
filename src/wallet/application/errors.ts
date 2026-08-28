import { DomainError } from '../../shared/errors/domain-error';

export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
}
