// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16159 row 2 of 3 in this batch — `DatasourceUnavailableError` publishes its
 * ADR-0112 `code` as an importable constant.
 *
 * ## Why this row has the strongest evidence in the batch
 *
 * It has a LIVE first-party consumer doing precisely what the card describes:
 * `packages/rest/src/error-response.ts` matches this refusal by `code` and then
 * re-authors the same spelling into the response envelope it builds. That is
 * two spellings of one refusal, in two packages, kept equal by nothing but a
 * grep — and it is the ONLY option a consumer had, because the code was an
 * inline literal with nothing to import.
 *
 * ⚠️ This refusal carries NO `status` field of its own (the REST door assigns
 * the HTTP status when it recognises the code), so ADR-0112's `code` + `status`
 * minimum reduces here to `code` plus the fields that discriminate the refusal.
 * ⛔ Inventing a `status` on the class would be new published surface, which is
 * not what this card converts.
 *
 * Five facts, each its own case. The reasoning behind each is spelled out in
 * `driver-connect-code-constant.test.ts` (same batch, same shape); the
 * load-bearing points repeated here are (1) the literal spelling is the
 * byte-identity fence and must NOT be "simplified" into a constant compare, and
 * (5) the cross-realm case is the control without which the whole file would
 * pass just as happily against an `instanceof` recommendation.
 *
 * ⭐ Case 2 drives BOTH `kind`s — `blocked` and `failed`. The MESSAGE branches
 * on `kind` by design while the CODE deliberately does not; pinning both is
 * what stops a future message split taking the code with it.
 */

import { describe, it, expect } from 'vitest';
import {
  DatasourceUnavailableError,
  DATASOURCE_UNAVAILABLE_CODE,
} from './driver-connect-errors.js';
import * as barrel from './index.js';

describe('#16159 DatasourceUnavailableError publishes its code as a constant', () => {
  it('the constant holds the exact wire string it replaced', () => {
    expect(DATASOURCE_UNAVAILABLE_CODE).toBe('ERR_DATASOURCE_UNAVAILABLE');
  });

  it('the constant IS the code both kinds of refusal carry — the code does not branch on kind', () => {
    const blocked = new DatasourceUnavailableError('billing', 'crm_invoice', 'blocked');
    const failed = new DatasourceUnavailableError('billing', 'crm_invoice', 'failed');

    expect(blocked.code).toBe(DATASOURCE_UNAVAILABLE_CODE);
    expect(failed.code).toBe(DATASOURCE_UNAVAILABLE_CODE);
    expect(blocked.name).toBe('DatasourceUnavailableError');
    expect(blocked.datasource).toBe('billing');
    expect(blocked.objectName).toBe('crm_invoice');

    // The MESSAGE branches on `kind` by design; the CODE deliberately does not.
    expect(blocked.message).not.toBe(failed.message);
  });

  it('it is re-exported from the package barrel, which is where a consumer reaches it', () => {
    // Identity, not equality: a barrel that re-declared the string instead of
    // re-exporting the constant would satisfy `toBe` on the VALUE while having
    // re-introduced the second spelling this card exists to remove.
    expect(barrel.DATASOURCE_UNAVAILABLE_CODE).toBe(DATASOURCE_UNAVAILABLE_CODE);
  });

  it("the barrel's constant and the barrel's already-exported class name the same refusal", () => {
    const err = new barrel.DatasourceUnavailableError('billing', 'crm_invoice', 'failed');
    expect(err.code).toBe(barrel.DATASOURCE_UNAVAILABLE_CODE);
  });

  it("a `code` compare matches the OTHER realm's copy — the exact case `instanceof` gets wrong", () => {
    class DatasourceUnavailableErrorOtherRealmCopy extends Error {
      readonly code = 'ERR_DATASOURCE_UNAVAILABLE';
    }
    const fromOtherRealm = new DatasourceUnavailableErrorOtherRealmCopy();

    // THE CONTROL — see the header.
    expect(fromOtherRealm instanceof DatasourceUnavailableError).toBe(false);
    expect(fromOtherRealm.code).toBe(DATASOURCE_UNAVAILABLE_CODE);
  });
});
