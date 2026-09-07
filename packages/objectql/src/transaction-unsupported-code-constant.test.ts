// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16159 row 1 of 2 in this batch — `TransactionUnsupportedError` publishes its
 * ADR-0112 `code` as an importable constant.
 *
 * ## What this pins, and why each assertion is here
 *
 * `transaction-errors.ts`'s module header already says the errors in it
 * "identify themselves by a `code` field rather than by `instanceof`, for the
 * reason `DriverConnectError` already records: the check has to survive
 * crossing a package boundary, where two copies of this module can exist" — and
 * until this change offered nothing to import. Following that published
 * instruction meant RE-SPELLING the wire string in the consumer's own package,
 * which acquires a `check:error-code-provenance` stamp site there and can then
 * drift from what this engine throws with no compile error to say so.
 *
 * ⚠️ This refusal carries NO `status` field, so ADR-0112's `code` + `status`
 * minimum reduces here to `code` plus the fields that discriminate the refusal.
 * ⛔ Inventing a `status` on the class to satisfy a habit would be new published
 * surface, and that is not what this card converts.
 *
 * Five facts, each its own case so a failure reads as the specific regression:
 *
 *   1. the constant holds the exact wire string, spelled LITERALLY here on
 *      purpose. The test layer sits outside `check:error-code-provenance`'s
 *      scanned population, so pinning it costs no stamp site while making a
 *      silent rename of a published code impossible to pass off as "still the
 *      same code". ⛔ This is the byte-identity fence — the conversion moves
 *      where a spelling lives, never what it says. ⛔ Do not "simplify" it into
 *      a constant compare: a pin that reads the constant cannot catch the
 *      constant being wrong, and every OTHER case in this file compares against
 *      the constant, so this is the only case that can.
 *   2. the constant IS the code a real refusal carries, asserted with `name`
 *      and with the field the class exists to report. ⛔ Never a bare
 *      `toThrow()`: a throw-shaped assertion stays green when a DIFFERENT
 *      refusal fires one step later, which is exactly the confusion `code` is
 *      meant to end.
 *   3. it is reachable from the package BARREL, which is the whole affordance
 *      this card buys — a constant a consumer cannot import is not an answer to
 *      "identify it by `code`" — and it is what a future barrel edit would lose
 *      silently.
 *   4. the barrel's constant and the barrel's already-exported class name the
 *      same refusal. Both routes are published, so a consumer can hold either
 *      and they must agree.
 *   5. a `code` compare matches a foreign-realm copy of the refusal where
 *      `instanceof` returns false. THE CONTROL, and the reason the convention
 *      exists (#14936): `@objectstack/objectql` declares both realms in its own
 *      `exports`, so a consumer holding the other realm's copy of the class
 *      gets `instanceof` === false, silently. Without this case the others
 *      would pass just as happily against an `instanceof`-based recommendation
 *      — the thing the module header tells readers NOT to use.
 */

import { describe, it, expect } from 'vitest';
import { TransactionUnsupportedError, TRANSACTION_UNSUPPORTED_CODE } from './transaction-errors.js';
import * as barrel from './index.js';

describe('#16159 TransactionUnsupportedError publishes its code as a constant', () => {
  it('the constant holds the exact wire string it replaced', () => {
    expect(TRANSACTION_UNSUPPORTED_CODE).toBe('ERR_TRANSACTION_UNSUPPORTED');
  });

  it('the constant IS the code the require:true refusal carries', () => {
    const err = new TransactionUnsupportedError('reporting');

    expect(err.code).toBe(TRANSACTION_UNSUPPORTED_CODE);
    expect(err.name).toBe('TransactionUnsupportedError');
    // The datasource is what a caller acts on: it names which driver has to
    // gain `beginTransaction` for this call to be honoured.
    expect(err.datasource).toBe('reporting');
    // Refused BEFORE the callback runs — the fail-closed posture ADR-0119 D4
    // established, and the half of the message a caller is told to trust.
    expect(err.message).toContain('nothing has been written');
  });

  it('it is re-exported from the package barrel, which is where a consumer reaches it', () => {
    // Identity, not equality: a barrel that re-declared the string instead of
    // re-exporting the constant would satisfy `toBe` on the VALUE while having
    // re-introduced exactly the second spelling this card exists to remove.
    expect(barrel.TRANSACTION_UNSUPPORTED_CODE).toBe(TRANSACTION_UNSUPPORTED_CODE);
  });

  it("the barrel's constant and the barrel's already-exported class name the same refusal", () => {
    const err = new barrel.TransactionUnsupportedError('billing');
    expect(err.code).toBe(barrel.TRANSACTION_UNSUPPORTED_CODE);
  });

  it("a `code` compare matches the OTHER realm's copy — the exact case `instanceof` gets wrong", () => {
    // What a consumer holding the other realm's copy of this module actually
    // has: a structurally identical refusal from a DIFFERENT class object.
    class TransactionUnsupportedErrorOtherRealmCopy extends Error {
      readonly code = 'ERR_TRANSACTION_UNSUPPORTED';
    }
    const fromOtherRealm = new TransactionUnsupportedErrorOtherRealmCopy();

    // THE CONTROL. Without this line the assertion below would pass against an
    // `instanceof` recommendation too, i.e. against the defect the convention
    // exists to avoid.
    expect(fromOtherRealm instanceof TransactionUnsupportedError).toBe(false);
    expect(fromOtherRealm.code).toBe(TRANSACTION_UNSUPPORTED_CODE);
  });
});
