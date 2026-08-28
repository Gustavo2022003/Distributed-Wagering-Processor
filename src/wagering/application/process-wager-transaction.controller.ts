import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import {
  WagerTransactionKind,
  type WagerTransactionStatus,
  PayloadConflictError,
  type WagerTransactionBusinessPayload,
  computePayloadHash,
} from '../domain/wager-transaction';
import type { MoneyProps } from '../../shared/money';
import { ProviderIdentityGuard } from '../../shared/guards/provider-identity.guard';
import { ProcessWagerTransactionUseCase, type ProcessWagerTransactionDto } from './process-wager-transaction.use-case';
import { WagerTransactionRepository } from '../persistence/wager-transaction.repository';
import { TerminalBusinessError, TransientInfraError } from './errors';

interface SubmitWagerRequestBody {
  providerId?: string;
  externalTransactionId?: string;
  playerId?: string;
  walletId?: string;
  roundId?: string;
  gameId?: string;
  kind?: WagerTransactionKind;
  money?: MoneyProps;
  referenceExternalTransactionId?: string;
  occurredAt?: string;
}

@Controller('wagering')
@UseGuards(ProviderIdentityGuard)
export class WagerTransactionHttpController {
  constructor(
    private readonly useCase: ProcessWagerTransactionUseCase,
    private readonly wtxRepo: WagerTransactionRepository,
  ) {}

  @Post('transactions')
  @HttpCode(HttpStatus.OK)
  async submit(
    @Body() body: any,
    @Req() req: any,
  ): Promise<{
    transactionId: string;
    status: WagerTransactionStatus;
    balance: MoneyProps | null;
    failureCode?: string;
    referenceTransactionId?: string;
    idempotentReplay: boolean;
  }> {
    const headerKey = req.headers['idempotency-key'] ?? req.headers['Idempotency-Key'];
    const missing: string[] = [];
    if (!body.providerId) missing.push('providerId');
    if (!body.externalTransactionId) missing.push('externalTransactionId');
    if (!body.playerId) missing.push('playerId');
    if (!body.walletId) missing.push('walletId');
    if (!body.roundId) missing.push('roundId');
    if (!body.gameId) missing.push('gameId');
    if (!body.kind) missing.push('kind');
    if (!body.money?.amount || !body.money?.currency) missing.push('money');
    if (missing.length > 0) {
      throw new BadRequestException(`Invalid payload: missing ${missing.join(', ')}`);
    }
    if (!headerKey) {
      throw new BadRequestException('Idempotency-Key header required');
    }

    const payload: WagerTransactionBusinessPayload = {
      providerId: body.providerId!,
      externalTransactionId: body.externalTransactionId!,
      playerId: body.playerId!,
      walletId: body.walletId!,
      roundId: body.roundId!,
      gameId: body.gameId!,
      kind: body.kind!,
      money: body.money!,
      referenceExternalTransactionId: body.referenceExternalTransactionId,
    };
    const payloadHash = computePayloadHash(payload);

    const dto: ProcessWagerTransactionDto = {
      id: crypto.randomUUID(),
      providerId: body.providerId!,
      externalTransactionId: body.externalTransactionId!,
      idempotencyKey: headerKey,
      payloadHash,
      playerId: body.playerId!,
      walletId: body.walletId!,
      roundId: body.roundId!,
      gameId: body.gameId!,
      kind: body.kind!,
      money: body.money!,
      referenceExternalTransactionId: body.referenceExternalTransactionId,
      correlationId: headerKey,
      now: body.occurredAt ? new Date(body.occurredAt) : new Date(),
    };

    try {
      const result = await this.useCase.execute(dto);
      return result;
    } catch (err) {
      if (err instanceof PayloadConflictError) {
        throw new ConflictException({ message: err.message, code: 'PAYLOAD_CONFLICT' });
      }
      if (err instanceof TerminalBusinessError) {
        throw new ConflictException({ message: err.message, code: 'BUSINESS_RULE_VIOLATION' });
      }
      if (err instanceof TransientInfraError) {
        throw new ServiceUnavailableException('Service temporarily unavailable');
      }
      throw err;
    }
  }

  @Get('transactions/:transactionId')
  async getById(@Param('transactionId') id: string) {
    const tx = await this.wtxRepo.findById(id);
    if (!tx) throw new NotFoundException(`Transaction not found: ${id}`);
    return {
      id: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      status: tx.status,
      kind: tx.kind,
      money: tx.money.toJSON(),
      failureCode: tx.failureCode,
      processedAt: tx.processedAt,
      referenceTransactionId: tx.referenceTransactionId,
      referenceExternalTransactionId: tx.referenceExternalTransactionId,
    };
  }

  @Get('providers/:providerId/transactions/:externalTransactionId')
  async getByProviderExternal(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') extId: string,
  ) {
    const tx = await this.wtxRepo.findByProviderExternalId(providerId, extId);
    if (!tx) throw new NotFoundException(`Transaction not found: ${providerId}:${extId}`);
    return {
      id: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      status: tx.status,
      kind: tx.kind,
      money: tx.money.toJSON(),
    };
  }
}
