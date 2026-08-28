import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProviderIdentityGuard } from '../../shared/guards/provider-identity.guard';
import { CreateWalletUseCase, WalletAlreadyExistsError } from './create-wallet.use-case';
import { ReconcileWalletUseCase } from './reconcile-wallet.use-case';
import { WalletRepository } from '../persistence/wallet.repository';
import { WalletLedgerEntryRepository } from '../../ledger/persistence/wallet-ledger-entry.repository';
import { Money } from '../../shared/money';
import { NotFoundError } from './errors';

interface CreateWalletBody {
  playerId?: string;
  currency?: string;
  initialBalance?: string;
}

interface LedgerQuery {
  cursor?: string;
  limit?: string;
}

@Controller('wallets')
@UseGuards(ProviderIdentityGuard)
export class WalletController {
  constructor(
    private readonly createUseCase: CreateWalletUseCase,
    private readonly reconcileUseCase: ReconcileWalletUseCase,
    private readonly walletRepo: WalletRepository,
    private readonly ledgerRepo: WalletLedgerEntryRepository,
  ) {}

  @Post()
  async create(@Body() body: CreateWalletBody) {
    if (!body.playerId) throw new BadRequestException('playerId required');
    if (!body.currency) throw new BadRequestException('currency required');
    if (!body.initialBalance) throw new BadRequestException('initialBalance required');

    let initialBalance: Money;
    try {
      initialBalance = Money.from(body.initialBalance, body.currency);
    } catch (err) {
      throw new BadRequestException(`Invalid initialBalance: ${(err as Error).message}`);
    }

    try {
      const result = await this.createUseCase.execute({
        playerId: body.playerId,
        currency: body.currency,
        initialBalance,
      });
      return {
        walletId: result.walletId,
        balance: result.balance,
        openingTransactionId: result.openingTransactionId,
      };
    } catch (err) {
      if (err instanceof WalletAlreadyExistsError) {
        throw new ConflictException({ message: err.message, code: 'WALLET_ALREADY_EXISTS' });
      }
      throw err;
    }
  }

  @Get(':walletId')
  async getOne(@Param('walletId') id: string) {
    const w = await this.walletRepo.findById(id);
    if (!w) throw new NotFoundException(`Wallet not found: ${id}`);
    return {
      walletId: w.id,
      playerId: w.playerId,
      currency: w.currency,
      balance: w.balance.toJSON(),
      version: w.version,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    };
  }

  @Get(':walletId/ledger')
  async getLedger(@Param('walletId') id: string, @Query() q: LedgerQuery) {
    const w = await this.walletRepo.findById(id);
    if (!w) throw new NotFoundException(`Wallet not found: ${id}`);

    const limit = Math.min(Math.max(parseInt(q.limit ?? '50', 10) || 50, 1), 200);

    let cursorCreatedAt: Date | undefined;
    let cursorId: string | undefined;
    if (q.cursor) {
      // cursor = base64( "<iso>:<id>" )
      try {
        const decoded = Buffer.from(q.cursor, 'base64').toString('utf-8');
        const [iso, cid] = decoded.split(':');
        if (!iso || !cid) throw new Error('bad cursor');
        cursorCreatedAt = new Date(iso);
        cursorId = cid;
      } catch {
        throw new BadRequestException('Invalid cursor');
      }
    }

    const entries = await this.ledgerRepo.findByWalletPaginated(
      id,
      limit + 1,
      cursorCreatedAt,
      cursorId,
    );

    const hasMore = entries.length > limit;
    const page = hasMore ? entries.slice(0, limit) : entries;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? Buffer.from(`${last.createdAt.toISOString()}:${last.id}`).toString('base64')
        : null;

    return {
      entries: page.map((e) => ({
        id: e.id,
        walletId: e.walletId,
        transactionId: e.transactionId,
        direction: e.direction,
        money: e.money.toJSON(),
        balanceBefore: e.balanceBefore.toJSON(),
        balanceAfter: e.balanceAfter.toJSON(),
        createdAt: e.createdAt,
      })),
      nextCursor,
    };
  }

  @Post(':walletId/reconciliation')
  async reconcile(@Param('walletId') id: string) {
    try {
      return await this.reconcileUseCase.execute(id);
    } catch (err) {
      if (err instanceof NotFoundError) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
  }
}
