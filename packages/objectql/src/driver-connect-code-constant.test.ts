// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16159 row 1 of 3 in this batch — `DriverConnectError` publishes its ADR-0112
 * `code` as an importable constant.
 *
 * ## What this pins, and why each assertion is here
 *
 * `DriverConnectError`'s own docblock says it is "Identified by `code` rather
 * than `instanceof` so it survives crossing package boundaries", and until this
 * change offered nothing to import. Following that published instruction meant
 * RE-SPELLING the wire string in the consumer's own package, which acquires a
 * `check:error-code-provenance` stamp site there and can then drift from what
 * this engine throws with no compile error to say so.
 *
 * ⚠️ This refusal carries NO `status` field, so ADR-0112's `code` + `status`
 * minimum reduces here to `code` plus the fields that discriminate the refusal.
 * ⛔ Inventing a `status` to satisfy a habit would be new published surface, and
 * that is not what this card converts.
 *
 * Five facts, each its own case so a failure reads as the specific regression:
 *
 *   1. the constant holds the exact wire string, spelled LITERALLY here on
 *      purpose. The test layer sits outside `check:error-code-provenance`'s
 *      scanned population, so pinning it costs no stamp site while making a
 *      silent rename of a published code impossible to pass off as "still the
 *      same code". ⛔ This is the byte-identity fence — the conversion moves
 *      where a spelling lives, never what it says. Slice 1 (#16259) measured
 *      that mutating a constant's VALUE turns ONLY a case of this shape red,
 *      because every other case compares AGAINST the constant. ⛔ Do not
 *      "simplify" it into a constant compare; a pin that reads the constant
 *      cannot catch the constant being wrong.
 *   2. the constant IS the code a real refusal carries, asserted with `name`
 *      and with the failure detail the class exists to report. ⛔ Never a bare
 *      `toThrow()`: this package's own history is the argument — a
 *      throw-shaped assertion stays green when a DIFFERENT refusal fires one
 *      step later, which is exactly the confusion `code` is meant to end.
 *   3. it is reachable from the package BARREL, which is the whole affordance
 *      this card buys — a constant a consumer cannot import is not an answer to
 *      "identify it by `code`" — and it is what a future barrel edit would lose
 *      silently.
 *   4. the barrel's constant and the barrel's already-exported class name the
 *      same refusal. Both routes are published here, so a consumer can hold
 *      either and they must agree.
 *   5. a `code` compare matches a foreign-realm copy of the refusal where
 *      `instanceof` returns false. THE CONTROL, and the reason the convention
 *      exists (#14936): `@objectstack/objectql` declares both realms in its own
 *      `exports`, so a consumer holding the other realm's copy of the class
 *      gets `instanceof` === false, silently. Without this case the others
 *      would pass just as happily against an `instanceof`-based
 *      recommendation — the thing the docblock tells readers NOT to use.
 */

import { describe, it, expect } from 'vitest';
import { DriverConnectError, DRIVER_CONNECT_CODE } from './driver-connect-errors.js';
import * as barrel from './index.js';

describe('#16159 DriverConnectError publishes its code as a constant', () => {
  it('the constant holds the exact wire string it replaced', () => {
    expect(DRIVER_CONNECT_CODE).toBe('ERR_DRIVER_CONNECT');
  });

  it('the constant IS the code a boot-abort refusal carries', () => {
    const err = new DriverConnectError(
      [{ driverName: 'default', error: new Error('ECONNREFUSED 127.0.0.1:5432') }],
      2,
    );
    expect(err.code).toBe(DRIVER_CONNECT_CODE);
    expect(err.name).toBe('DriverConnectError');
    // The refusal's payload is part of what a `code` match buys a caller: it
    // names every driver that failed, which is why the CLI can print
    // `error.message` alone.
    expect(err.failedDrivers).toEqual(['default']);
    expect(err.message).toContain('1 of 2 data driver(s) failed to connect');
  });

  it('it is re-exported from the package barrel, which is where a consumer reaches it', () => {
    // Identity, not equality: a barrel that re-declared the string instead of
    // re-exporting the constant would satisfy `toBe` on the VALUE while having
    // re-introduced exactly the second spelling this card exists to remove.
    expect(barrel.DRIVER_CONNECT_CODE).toBe(DRIVER_CONNECT_CODE);
  });

  it("the barrel's constant and the barrel's already-exported class name the same refusal", () => {
    const err = new barrel.DriverConnectError([{ driverName: 'reporting', error: 'timeout' }], 1);
    expect(err.code).toBe(barrel.DRIVER_CONNECT_CODE);
  });

  it("a `code` compare matches the OTHER realm's copy — the exact case `instanceof` gets wrong", () => {
    // What a consumer holding the other realm's copy of this module actually
    // has: a structurally identical refusal from a DIFFERENT class object.
    class DriverConnectErrorOtherRealmCopy extends Error {
      readonly code = 'ERR_DRIVER_CONNECT';
    }
    const fromOtherRealm = new DriverConnectErrorOtherRealmCopy();

    // THE CONTROL. Without this line the assertion below would pass against an
    // `instanceof` recommendation too, i.e. against the defect the convention
    // exists to avoid.
    expect(fromOtherRealm instanceof DriverConnectError).toBe(false);
    expect(fromOtherRealm.code).toBe(DRIVER_CONNECT_CODE);
  });
});
