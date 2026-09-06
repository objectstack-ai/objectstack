// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16159 — the registry's three conflict refusals publish their ADR-0112
 * `code` as an importable constant.
 *
 * ## What this pins, and why each assertion is here
 *
 * `NamespaceConflictError`, `ArtifactObjectNameConflictError` and
 * `ObjectOwnershipConflictError` each already told the reader, in their own
 * docblocks, to identify them by `code`. Until this change the code was an
 * inline string literal, so the only way to follow that instruction was to
 * RE-SPELL it in the consumer's package — which acquires a
 * `check:error-code-provenance` stamp site there and can drift from what this
 * engine throws with no compile error to say so.
 *
 * Four facts, each its own case so a failure reads as the specific regression:
 *
 *   1. each constant holds the exact wire string. Spelled literally HERE on
 *      purpose: the test layer is outside `check:error-code-provenance`'s
 *      scanned population, so pinning it costs no stamp site while making a
 *      silent rename of a published code impossible to pass off as "still the
 *      same code". ⛔ This is the byte-identity fence the card asked for — the
 *      conversion moves where a spelling lives, never what it says.
 *   2. the constant IS the code the thrown refusal carries, asserted together
 *      with `status`. ⛔ Never a bare `toThrow()`: #14367 measured on this very
 *      path that a throw-shaped assertion stayed GREEN with the install-time
 *      check one layer up ablated, because a second refusal fired one step
 *      later and was indistinguishable to `toThrow()`.
 *   3. the constants are reachable from the package BARREL. This is the whole
 *      affordance the card buys — a constant a consumer cannot import is not
 *      an answer to "catch it by `code`" — and it is what a re-export deleted
 *      by a future barrel edit would lose silently.
 *   4. a `code` compare matches a foreign-realm copy of the refusal where
 *      `instanceof` returns false. THE CONTROL, and the reason the convention
 *      exists (#14936): `@objectstack/objectql` declares both realms in its
 *      own `exports`, so a consumer holding the other realm's copy gets
 *      `instanceof` === false, silently. Without this case the others would
 *      pass just as happily against an `instanceof`-based recommendation.
 */

import { describe, it, expect } from 'vitest';
import {
  NAMESPACE_CONFLICT_CODE,
  DUPLICATE_ARTIFACT_OBJECT_NAME_CODE,
  OBJECT_OWNERSHIP_CONFLICT_CODE,
  NamespaceConflictError,
  ArtifactObjectNameConflictError,
  ObjectOwnershipConflictError,
} from './registry.js';
import * as barrel from './index.js';

describe('#16159 the registry conflict codes are published constants', () => {
  it('each constant holds the exact wire string it replaced', () => {
    expect(NAMESPACE_CONFLICT_CODE).toBe('NAMESPACE_CONFLICT');
    expect(DUPLICATE_ARTIFACT_OBJECT_NAME_CODE).toBe('DUPLICATE_ARTIFACT_OBJECT_NAME');
    expect(OBJECT_OWNERSHIP_CONFLICT_CODE).toBe('OBJECT_OWNERSHIP_CONFLICT');
  });

  it('the constant IS the code the thrown namespace refusal carries, at its 422 status', () => {
    const err = new NamespaceConflictError('crm', 'app.crm', 'app.other');
    expect(err.code).toBe(NAMESPACE_CONFLICT_CODE);
    expect(err.status).toBe(422);
    // ADR-0112 D5's spelling, which is what a consumer holding the THROWN
    // error reads out of the CLI `--json` envelope. Asserting only `status`
    // would not notice these two drifting apart.
    expect(err.httpStatus).toBe(422);
  });

  it('the constant IS the code the thrown artifact object-name refusal carries, at its 422 status', () => {
    const err = new ArtifactObjectNameConflictError('crm_account', 'app.crm', 'app.other');
    expect(err.code).toBe(DUPLICATE_ARTIFACT_OBJECT_NAME_CODE);
    expect(err.status).toBe(422);
    expect(err.httpStatus).toBe(422);
  });

  it('the constant IS the code the thrown ownership refusal carries, at its 422 status', () => {
    const err = new ObjectOwnershipConflictError('crm_account', 'app.crm', 'app.other');
    expect(err.code).toBe(OBJECT_OWNERSHIP_CONFLICT_CODE);
    expect(err.status).toBe(422);
    expect(err.httpStatus).toBe(422);
  });

  it('all three are re-exported from the package barrel, which is where a consumer reaches them', () => {
    // Identity, not equality: a barrel that re-declared the string instead of
    // re-exporting the constant would satisfy `toBe` on the VALUE while having
    // re-introduced exactly the second spelling this card exists to remove.
    expect(barrel.NAMESPACE_CONFLICT_CODE).toBe(NAMESPACE_CONFLICT_CODE);
    expect(barrel.DUPLICATE_ARTIFACT_OBJECT_NAME_CODE).toBe(DUPLICATE_ARTIFACT_OBJECT_NAME_CODE);
    expect(barrel.OBJECT_OWNERSHIP_CONFLICT_CODE).toBe(OBJECT_OWNERSHIP_CONFLICT_CODE);
  });

  it("a `code` compare matches the OTHER realm's copy — the exact case `instanceof` gets wrong", () => {
    // What a consumer holding the other realm's copy of this module actually
    // has: a structurally identical refusal from a DIFFERENT class object.
    class NamespaceConflictErrorOtherRealmCopy extends Error {
      readonly code = 'NAMESPACE_CONFLICT';
      readonly status = 422;
    }
    const fromOtherRealm = new NamespaceConflictErrorOtherRealmCopy();

    // THE CONTROL. Without this line the assertion below would pass against an
    // `instanceof` recommendation too, i.e. against the defect.
    expect(fromOtherRealm instanceof NamespaceConflictError).toBe(false);
    expect(fromOtherRealm.code).toBe(NAMESPACE_CONFLICT_CODE);
  });
});
