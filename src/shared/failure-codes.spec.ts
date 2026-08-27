import { describe, it, expect } from 'bun:test';
import { FailureCode, FAILURE_CODE_METADATA } from './failure-codes';

describe('FailureCode metadata', () => {
  it('todo código no enum tem metadata registrada', () => {
    for (const code of Object.values(FailureCode)) {
      expect(FAILURE_CODE_METADATA[code]).toBeDefined();
      expect(FAILURE_CODE_METADATA[code].code).toBe(code);
    }
  });

  it('providerAction é sempre um dos 3 valores válidos', () => {
    const valid = new Set(['RESEND', 'FIX', 'GIVE_UP']);
    for (const meta of Object.values(FAILURE_CODE_METADATA)) {
      expect(valid.has(meta.providerAction)).toBe(true);
    }
  });

  it('InsufficientFunds é RESEND (provedor pode tentar de novo)', () => {
    expect(FAILURE_CODE_METADATA[FailureCode.InsufficientFunds].providerAction)
      .toBe('RESEND');
  });

  it('ReferenceAlreadyReversed é GIVE_UP (reversão é única)', () => {
    expect(FAILURE_CODE_METADATA[FailureCode.ReferenceAlreadyReversed].providerAction)
      .toBe('GIVE_UP');
  });

  it('PayloadConflict é FIX (provedor precisa gerar nova key)', () => {
    expect(FAILURE_CODE_METADATA[FailureCode.PayloadConflict].providerAction)
      .toBe('FIX');
  });

  it('NegativeBalanceOnReversal é GIVE_UP (matematicamente impossível)', () => {
    expect(FAILURE_CODE_METADATA[FailureCode.NegativeBalanceOnReversal].providerAction)
      .toBe('GIVE_UP');
  });
});
