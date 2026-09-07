// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16159 row 3 of 3 in this batch — `SummaryRecomputeError` publishes its
 * ADR-0112 `code` as an importable constant.
 *
 * ## Why this row's cost is already shipped rather than latent
 *
 * TWO first-party consumers already re-spell this code, and both do it to
 * implement the very recovery the class was designed for — "the triggering
 * records WERE written, so treat a failed roll-up as a warning and keep them":
 *
 *   - `packages/rest/src/import-runner.ts`
 *   - `packages/metadata-protocol/src/seed-loader.ts`
 *
 * Three spellings of one code across three packages, kept equal by nothing but
 * a grep. That was the only option available, because the code was an inline
 * literal with nothing to import. ⛔ This PR does NOT rewire those two
 * consumers: that is a consumer-side change in two other packages, outside a
 * producer-side sweep, and no gate asks for it.
 *
 * ⚠️ This refusal carries NO `status` field, so ADR-0112's `code` + `status`
 * minimum reduces here to `code` plus the fields that discriminate the refusal.
 * ⛔ Inventing one would be new published surface.
 *
 * Five facts, each its own case; the reasoning for each shape is spelled out in
 * `driver-connect-code-constant.test.ts` (same batch). The two load-bearing
 * points, repeated because they are the ones a later edit is tempted to undo:
 * case 1 spells the wire string LITERALLY and must not be "simplified" into a
 * constant compare (a pin that reads the constant cannot catch the constant
 * being wrong), and case 5's cross-realm copy is the control without which the
 * file would pass just as happily against an `instanceof` recommendation.
 *
 * ⭐ Case 2 also pins `written`, because that field is inseparable from the
 * code's meaning here: a consumer matching this code does so precisely to
 * recover the records the write DID persist.
 */

import { describe, it, expect } from 'vitest';
import { SummaryRecomputeError, SUMMARY_RECOMPUTE_CODE } from './summary-errors.js';
import * as barrel from './index.js';

const failure = {
  childObject: 'crm_invoice_line',
  parentObject: 'crm_invoice',
  parentId: 'inv_1',
  field: 'total_amount',
  error: new Error('driver timeout'),
};

describe('#16159 SummaryRecomputeError publishes its code as a constant', () => {
  it('the constant holds the exact wire string it replaced', () => {
    expect(SUMMARY_RECOMPUTE_CODE).toBe('ERR_SUMMARY_RECOMPUTE');
  });

  it('the constant IS the code the refusal carries, alongside the records that WERE written', () => {
    const written = [{ _id: 'line_1' }, { _id: 'line_2' }];
    const err = new SummaryRecomputeError([failure], written);

    expect(err.code).toBe(SUMMARY_RECOMPUTE_CODE);
    expect(err.name).toBe('SummaryRecomputeError');
    // The whole reason a consumer matches this code rather than treating it as
    // a failed write: the records are recoverable from the refusal itself.
    expect(err.written).toBe(written);
    expect(err.failures).toHaveLength(1);
    expect(err.message).toContain('WERE written');
  });

  it('it is re-exported from the package barrel, which is where a consumer reaches it', () => {
    // Identity, not equality — see the header.
    expect(barrel.SUMMARY_RECOMPUTE_CODE).toBe(SUMMARY_RECOMPUTE_CODE);
  });

  it("the barrel's constant and the barrel's already-exported class name the same refusal", () => {
    const err = new barrel.SummaryRecomputeError([failure], { _id: 'line_1' });
    expect(err.code).toBe(barrel.SUMMARY_RECOMPUTE_CODE);
  });

  it("a `code` compare matches the OTHER realm's copy — the exact case `instanceof` gets wrong", () => {
    class SummaryRecomputeErrorOtherRealmCopy extends Error {
      readonly code = 'ERR_SUMMARY_RECOMPUTE';
    }
    const fromOtherRealm = new SummaryRecomputeErrorOtherRealmCopy();

    // THE CONTROL — see the header.
    expect(fromOtherRealm instanceof SummaryRecomputeError).toBe(false);
    expect(fromOtherRealm.code).toBe(SUMMARY_RECOMPUTE_CODE);
  });
});
