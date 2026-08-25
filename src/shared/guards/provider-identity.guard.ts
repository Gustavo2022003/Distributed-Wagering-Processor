import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';

// Placeholder -  Autenticação não implementada propositalmente
// Ver ARCHITECTURE.md

@Injectable()
export class ProviderIdentityGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    return true;
  }
}
