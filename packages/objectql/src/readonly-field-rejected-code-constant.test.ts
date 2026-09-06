// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16159 — `ReadonlyFieldRejectedError` publishes its ADR-0112 `code` as an
 * importable constant.
 *
 * ## What this pins, and why each assertion is here
 *
 * This row was converted ahead of the rest of #16159's table because it is the
 * only one whose cost is already SHIPPED rather than latent:
 * `content/docs/kernel/contracts/data-engine.mdx` tells customers, of this
 * exact refusal, to "Catch it by `code`, not `instanceof`" — while the code was
 * an inline string literal with nothing to import. The published guidance and
 * the published surface disagreed, in the documentation's own words. Following
 * that instruction meant RE-SPELLING the string in the consumer's own package,
 * which acquires a `check:error-code-provenance` stamp site there and can drift
 * from what this engine throws with no compile error to say so.
 *
 * Six facts, each its own case so a failure reads as the specific regression:
 *
 *   1. the constant holds the exact wire string. Spelled LITERALLY here on
 *      purpose: the test layer is outside `check:error-code-provenance`'s
 *      scanned population, so pinning it costs no stamp site while making a
 *      silent rename of a published code impossible to pass off as "still the
 *      same code". ⛔ This is the byte-identity fence — the conversion moves
 *      where a spelling lives, never what it says. Slice 1 (#16259) measured
 *      that mutating a constant's VALUE turns ONLY this case and case 6 red,
 *      because every other case compares AGAINST the constant. ⛔ Do not
 *      "simplify" this case into a constant compare; a pin that reads the
 *      constant cannot catch the constant being wrong.
 *   2/3. the constant IS the code the thrown refusal carries, on BOTH throw
 *      sites' operations — `update` (#5126) and `insert` (#5503) — asserted
 *      together with `status`. ⛔ Never a bare `toThrow()`: this file's own
 *      history is the argument (#14367 measured on this path that a
 *      throw-shaped assertion stayed GREEN with a check one layer up ablated,
 *      because a second refusal fired one step later and was
 *      indistinguishable). Both operations are driven because the `code`
 *      deliberately does NOT branch on `operation` while the MESSAGE does — a
 *      future message split must not be able to take the code with it.
 *   4. the constant is reachable from the package BARREL. This is the whole
 *      affordance the card buys — a constant a consumer cannot import is not an
 *      answer to "catch it by `code`" — and it is what a future barrel edit
 *      would lose silently.
 *   5. the barrel's `code` and the barrel's CLASS agree. This class, unlike
 *      slice 1's three, was ALREADY exported, so both routes are published and
 *      a consumer can hold either; they must name the same refusal.
 *   6. a `code` compare matches a foreign-realm copy of the refusal where
 *      `instanceof` returns false. THE CONTROL, and the reason the convention
 *      exists (#14936): `@objectstack/objectql` declares both realms in its own
 *      `exports`, so a consumer holding the other realm's copy gets
 *      `instanceof` === false, silently. Without this case the others would
 *      pass just as happily against an `instanceof`-based recommendation —
 *      which is precisely what the docs tell readers NOT to use.
 */

import { describe, it, expect } from 'vitest';
import { ReadonlyFieldRejectedError, READONLY_FIELD_REJECTED_CODE } from './readonly-strict-errors.js';
import * as barrel from './index.js';

describe('#16159 ReadonlyFieldRejectedError publishes its code as a constant', () => {
  it('the constant holds the exact wire string it replaced', () => {
    expect(READONLY_FIELD_REJECTED_CODE).toBe('ERR_READONLY_FIELD_REJECTED');
  });

  it('the constant IS the code an UPDATE refusal carries', () => {
    const err = new ReadonlyFieldRejectedError('crm_account', ['created_at'], [
      { object: 'crm_account', fields: ['created_at'], reason: 'readonly' },
    ]);
    expect(err.code).toBe(READONLY_FIELD_REJECTED_CODE);
    expect(err.operation).toBe('update');
    expect(err.name).toBe('ReadonlyFieldRejectedError');
  });

  it('the constant IS the code an INSERT refusal carries — the code does not branch on operation', () => {
    const err = new ReadonlyFieldRejectedError(
      'crm_account',
      ['record_no'],
      [{ object: 'crm_account', fields: ['record_no'], reason: 'readonly' }],
      'insert',
    );
    expect(err.code).toBe(READONLY_FIELD_REJECTED_CODE);
    expect(err.operation).toBe('insert');
    // The MESSAGE differs per operation by design; the CODE deliberately does
    // not. Pinning both here is what stops a future message split taking the
    // code with it.
    expect(err.message).not.toBe(
      new ReadonlyFieldRejectedError('crm_account', ['record_no'], [
        { object: 'crm_account', fields: ['record_no'], reason: 'readonly' },
      ]).message,
    );
  });

  it('it is re-exported from the package barrel, which is where a consumer reaches it', () => {
    // Identity, not equality: a barrel that re-declared the string instead of
    // re-exporting the constant would satisfy `toBe` on the VALUE while having
    // re-introduced exactly the second spelling this card exists to remove.
    expect(barrel.READONLY_FIELD_REJECTED_CODE).toBe(READONLY_FIELD_REJECTED_CODE);
  });

  it("the barrel's constant and the barrel's already-exported class name the same refusal", () => {
    const err = new barrel.ReadonlyFieldRejectedError('crm_account', ['created_at'], [
      { object: 'crm_account', fields: ['created_at'], reason: 'readonly' },
    ]);
    expect(err.code).toBe(barrel.READONLY_FIELD_REJECTED_CODE);
  });

  it("a `code` compare matches the OTHER realm's copy — the exact case `instanceof` gets wrong", () => {
    // What a consumer holding the other realm's copy of this module actually
    // has: a structurally identical refusal from a DIFFERENT class object.
    class ReadonlyFieldRejectedErrorOtherRealmCopy extends Error {
      readonly code = 'ERR_READONLY_FIELD_REJECTED';
    }
    const fromOtherRealm = new ReadonlyFieldRejectedErrorOtherRealmCopy();

    // THE CONTROL. Without this line the assertion below would pass against an
    // `instanceof` recommendation too, i.e. against the defect the docs warn of.
    expect(fromOtherRealm instanceof ReadonlyFieldRejectedError).toBe(false);
    expect(fromOtherRealm.code).toBe(READONLY_FIELD_REJECTED_CODE);
  });
});
