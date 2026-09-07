// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16159 row 2 of 2 in this batch — `CrossDatasourceTransactionWriteError`
 * publishes its ADR-0112 `code` as an importable constant.
 *
 * ## Why this row is the batch's strongest case for the affordance
 *
 * This refusal is one a caller is meant to RECOVER from, not merely log: the
 * class's own docblock records the decided behaviour as "refuse, by name,
 * before anything runs", and the remedy it prescribes — "split the work into
 * per-datasource units and have the caller reconcile them explicitly" — is
 * something a caller implements AROUND this exact refusal. Recognising it by
 * `instanceof` is what #14936 measured as silently false across the realm split
 * this package declares in its own `exports`; recognising it by `code` meant
 * re-authoring the wire string, until now.
 *
 * ⚠️ This refusal carries NO `status` field, so ADR-0112's `code` + `status`
 * minimum reduces here to `code` plus the fields that discriminate the refusal.
 * ⛔ Inventing a `status` would be new published surface, which is not what this
 * card converts.
 *
 * The five facts and the reasoning behind each are spelled out in
 * `transaction-unsupported-code-constant.test.ts` (same batch, same shape,
 * same file). The load-bearing points repeated here are (1) the literal
 * spelling is the byte-identity fence and must NOT be "simplified" into a
 * constant compare, and (5) the cross-realm case is the control without which
 * the whole file would pass just as happily against an `instanceof`
 * recommendation.
 *
 * ⭐ Case 2 drives all three write operations. The MESSAGE embeds the operation
 * by design while the CODE deliberately does not; pinning all three is what
 * stops a future per-operation message split taking the code with it.
 */

import { describe, it, expect } from 'vitest';
import {
  CrossDatasourceTransactionWriteError,
  CROSS_DATASOURCE_TRANSACTION_WRITE_CODE,
} from './transaction-errors.js';
import * as barrel from './index.js';

describe('#16159 CrossDatasourceTransactionWriteError publishes its code as a constant', () => {
  it('the constant holds the exact wire string it replaced', () => {
    expect(CROSS_DATASOURCE_TRANSACTION_WRITE_CODE).toBe('ERR_CROSS_DATASOURCE_TRANSACTION_WRITE');
  });

  it('the constant IS the code every operation carries — the code does not branch on the verb', () => {
    const operations = ['insert', 'update', 'delete'] as const;
    const errors = operations.map(
      (operation) =>
        new CrossDatasourceTransactionWriteError('crm_invoice', operation, 'billing', 'default'),
    );

    for (const err of errors) {
      expect(err.code).toBe(CROSS_DATASOURCE_TRANSACTION_WRITE_CODE);
      expect(err.name).toBe('CrossDatasourceTransactionWriteError');
    }

    // The four fields are what a `code` match buys a caller: which write, on
    // which object, and the two datasources whose divergence caused the
    // refusal. They are how a caller splits the unit per datasource, which is
    // the remedy the message prescribes.
    const [insertError] = errors;
    expect(insertError.object).toBe('crm_invoice');
    expect(insertError.operation).toBe('insert');
    expect(insertError.datasource).toBe('billing');
    expect(insertError.transactionDatasource).toBe('default');

    // The MESSAGE embeds the operation by design; the CODE deliberately does
    // not, so the three messages differ while the three codes are equal.
    expect(new Set(errors.map((e) => e.message)).size).toBe(3);
    // Fail-closed, and the sentence a caller is told to trust.
    expect(insertError.message).toContain('Nothing was written');
  });

  it('it is re-exported from the package barrel, which is where a consumer reaches it', () => {
    // Identity, not equality: a barrel that re-declared the string instead of
    // re-exporting the constant would satisfy `toBe` on the VALUE while having
    // re-introduced the second spelling this card exists to remove.
    expect(barrel.CROSS_DATASOURCE_TRANSACTION_WRITE_CODE).toBe(
      CROSS_DATASOURCE_TRANSACTION_WRITE_CODE,
    );
  });

  it("the barrel's constant and the barrel's already-exported class name the same refusal", () => {
    const err = new barrel.CrossDatasourceTransactionWriteError(
      'crm_payment',
      'update',
      'ledger',
      'default',
    );
    expect(err.code).toBe(barrel.CROSS_DATASOURCE_TRANSACTION_WRITE_CODE);
  });

  it("a `code` compare matches the OTHER realm's copy — the exact case `instanceof` gets wrong", () => {
    class CrossDatasourceTransactionWriteErrorOtherRealmCopy extends Error {
      readonly code = 'ERR_CROSS_DATASOURCE_TRANSACTION_WRITE';
    }
    const fromOtherRealm = new CrossDatasourceTransactionWriteErrorOtherRealmCopy();

    // THE CONTROL — see the header.
    expect(fromOtherRealm instanceof CrossDatasourceTransactionWriteError).toBe(false);
    expect(fromOtherRealm.code).toBe(CROSS_DATASOURCE_TRANSACTION_WRITE_CODE);
  });
});
