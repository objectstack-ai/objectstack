// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16159 — the LAST row of the card's eleven-row census: `ValidationError`
 * publishes its ADR-0112 `code` as an importable constant.
 *
 * ## What this pins, and why each assertion is here
 *
 * `@objectstack/objectql` declares BOTH realms in its own `exports` (`import`
 * to `dist/index.mjs`, `require` to `dist/index.js`), so a consumer holding the
 * other realm's copy of this class gets `instanceof` === false — measured on
 * #14936, and silent. The sound route is a `code` compare, and until this
 * change the only way to write one was to RE-SPELL the wire string in the
 * consumer's own package: that acquires a `check:error-code-provenance` stamp
 * site there and can then drift from what this engine throws with no compile
 * error to say so. Two in-repo recognizers do exactly that today
 * (`packages/types/src/validation-failure.ts` and
 * `packages/rest/src/error-response.ts`), each holding its own copy of the
 * string.
 *
 * ⚠️ This refusal carries NO `status` field, so ADR-0112's `code` + `status`
 * minimum reduces here to `code` plus the field that discriminates the refusal
 * (`fields[]`). ⛔ Inventing a `status` on the class to satisfy a habit would be
 * new published surface, and that is not what this card converts.
 *
 * Six facts, each its own case so a failure reads as the specific regression:
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
 *      and with `fields[]` — the field the class exists to report. ⛔ Never a
 *      bare `toThrow()`: a throw-shaped assertion stays green when a DIFFERENT
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
 *      exists (#14936). Without this case the others would pass just as happily
 *      against an `instanceof`-based recommendation — the thing this card
 *      replaces.
 *   6. ⛔ the constant is NOT the sibling validation spelling. `secret-fields.ts`
 *      publishes `EMPTY_CREDENTIAL_REFUSAL_CODE = 'VALIDATION_ERROR'`, and the
 *      card explicitly leaves "whether they should converge" unruled. This case
 *      pins that this conversion did NOT quietly converge them: the two remain
 *      two, and a future ruling that merges them will fail HERE first, which is
 *      where a rename of a registered wire code should be forced to argue for
 *      itself rather than arriving as a side effect.
 */

import { describe, it, expect } from 'vitest';
import { ValidationError, VALIDATION_FAILED_CODE } from './validation/record-validator.js';
import { EMPTY_CREDENTIAL_REFUSAL_CODE } from './secret-fields.js';
import * as barrel from './index.js';

describe('#16159 ValidationError publishes its code as a constant', () => {
  it('the constant holds the exact wire string it replaced', () => {
    expect(VALIDATION_FAILED_CODE).toBe('VALIDATION_FAILED');
  });

  it('the constant IS the code a real record-validation refusal carries', () => {
    const err = new ValidationError([
      { field: 'amount', code: 'required', message: 'Amount is required' },
    ]);

    expect(err.code).toBe(VALIDATION_FAILED_CODE);
    expect(err.name).toBe('ValidationError');
    // `fields[]` is what a form acts on — the per-field breakdown this refusal
    // exists to carry, and the half a caller reads after branching on `code`.
    expect(err.fields).toEqual([
      { field: 'amount', code: 'required', message: 'Amount is required' },
    ]);
    // The top-level message carries the HUMAN text, which is what generic UI
    // surfaces display verbatim.
    expect(err.message).toBe('Amount is required');
  });

  it('it is re-exported from the package barrel, which is where a consumer reaches it', () => {
    // Identity, not equality: a barrel that re-declared the string instead of
    // re-exporting the constant would satisfy `toBe` on the VALUE while having
    // re-introduced exactly the second spelling this card exists to remove.
    expect(barrel.VALIDATION_FAILED_CODE).toBe(VALIDATION_FAILED_CODE);
  });

  it("the barrel's constant and the barrel's already-exported class name the same refusal", () => {
    const err = new barrel.ValidationError([
      { field: 'email', code: 'invalid_format', message: 'Not an email' },
    ]);
    expect(err.code).toBe(barrel.VALIDATION_FAILED_CODE);
  });

  it("a `code` compare matches the OTHER realm's copy — the exact case `instanceof` gets wrong", () => {
    // What a consumer holding the other realm's copy of this module actually
    // has: a structurally identical refusal from a DIFFERENT class object.
    class ValidationErrorOtherRealmCopy extends Error {
      readonly code = 'VALIDATION_FAILED';
    }
    const fromOtherRealm = new ValidationErrorOtherRealmCopy();

    // THE CONTROL. Without this line the assertion below would pass against an
    // `instanceof` recommendation too, i.e. against the defect the convention
    // exists to avoid.
    expect(fromOtherRealm instanceof ValidationError).toBe(false);
    expect(fromOtherRealm.code).toBe(VALIDATION_FAILED_CODE);
  });

  it('⛔ it did NOT converge with the sibling `VALIDATION_ERROR` spelling — that question stays open', () => {
    // The card fences this off in its own words: EMPTY_CREDENTIAL_REFUSAL_CODE
    // is already 'VALIDATION_ERROR' while this site uses 'VALIDATION_FAILED',
    // "and whether they should converge is a question this card does not
    // answer". Publishing the current spelling must not decide it by side
    // effect, so the divergence is pinned rather than left to be noticed.
    expect(EMPTY_CREDENTIAL_REFUSAL_CODE).toBe('VALIDATION_ERROR');
    expect(VALIDATION_FAILED_CODE).not.toBe(EMPTY_CREDENTIAL_REFUSAL_CODE);
  });
});
