/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `isConcurrentUpdateError` — declared = enforced inside the type predicate
 * (objectui#6421).
 *
 * The runtime check has TWO limbs and KEEPS them: `code === 'CONCURRENT_UPDATE'`
 * (the wire shape) OR `name === 'ConcurrentUpdateError'` (the deliberate
 * cross-realm discriminator, for a host that bundles the adapter twice so
 * `instanceof` fails). The narrowed TYPE used to declare `code:
 * 'CONCURRENT_UPDATE'` as a REQUIRED literal — a property the second limb
 * knowingly accepts values without. Nothing read it, so there was no runtime
 * symptom: the sole consumer, `InlineEditSaveBar`'s `buildConflict`, takes
 * `err: any` and reads only `currentVersion` / `currentRecord`. The next
 * caller to write `err.code === 'CONCURRENT_UPDATE'` would have got a silent
 * `undefined` with the compiler agreeing it could not happen.
 *
 * WHAT EACH PIN BELOW IS FOR. The two kinds are labelled, because a pin that
 * passes against `origin/main` too proves nothing about this change:
 *
 *  - DISAGREES — red before this change, green after. These are the pins that
 *    measure the fix, and all of them sit on the one shape where the old and
 *    new types differ: an error with `name` set and NO `code`.
 *  - CONTROL — passes both ways ON PURPOSE. Each names the future wrong shape
 *    it exists to catch, and together they stop the DISAGREES pins from
 *    passing vacuously: a predicate that stopped being exported, stopped
 *    narrowing, or widened `code` to `string` would all satisfy "`code` is
 *    optional" while destroying the contract.
 *
 * The compile-time half is ERASED at runtime — vitest proves nothing about it.
 * `tsc -p packages/plugin-detail/tsconfig.test.json`, chained off this
 * package's `type-check` script, is the only thing that checks it, and it
 * reads `../ConcurrentUpdateDialog` as SOURCE (a relative import), never
 * through a built `dist/*.d.ts`.
 */

import { describe, it, expect } from 'vitest';
import { isConcurrentUpdateError } from '../ConcurrentUpdateDialog';

/* -------------------------------------------------------------------------- */
/* The witness                                                                 */
/*                                                                             */
/* Exactly what the `name` limb accepts and the old narrowed type refused: a   */
/* cross-realm error object carrying NO `code` at all. Two deliberate choices: */
/*                                                                             */
/*  - A named interface, NOT an inline object literal. Excess-property         */
/*    checking fires only on FRESH literals, so a literal would have gone red  */
/*    in BOTH directions (on `name`, which is on neither version of the        */
/*    narrowed type) and measured nothing about `code`. Declared this way the  */
/*    pins below bite by ASSIGNABILITY, which is the relation that actually    */
/*    changed.                                                                 */
/*  - `message: string` is load-bearing, not decoration. The new narrowed type */
/*    has only optional properties, i.e. it is a "weak type"; TypeScript       */
/*    rejects a source that shares NO property name with a weak type. `message`*/
/*    is the shared name that keeps the assignability pin a real measurement   */
/*    of `code` rather than an accident of weak-type detection.                */
/* -------------------------------------------------------------------------- */

interface NameOnlyConcurrentUpdateError {
  name: 'ConcurrentUpdateError';
  message: string;
}

const nameOnly: NameOnlyConcurrentUpdateError = {
  name: 'ConcurrentUpdateError',
  message: 'record changed underneath',
};

describe('isConcurrentUpdateError: both runtime limbs stay', () => {
  // CONTROL (passes both ways) — the predicate is live at RUNTIME and the
  // two-limb check is intact. Guards the "simplification" that drops the
  // `name` limb, which is the very thing the optional `code` describes.
  it('accepts the wire shape', () => {
    expect(isConcurrentUpdateError({ code: 'CONCURRENT_UPDATE' })).toBe(true);
  });

  it('accepts a name-only error — the limb that carries no `code`', () => {
    expect(isConcurrentUpdateError(nameOnly)).toBe(true);
    // The witness really is code-less; the type pins below describe THIS value.
    expect((nameOnly as { code?: unknown }).code).toBeUndefined();
  });

  it('rejects everything else', () => {
    expect(isConcurrentUpdateError(new Error('boom'))).toBe(false);
    expect(isConcurrentUpdateError({ code: 'NOT_FOUND' })).toBe(false);
    expect(isConcurrentUpdateError({ name: 'ValidationError' })).toBe(false);
    expect(isConcurrentUpdateError({ httpStatus: 409 })).toBe(false);
    expect(isConcurrentUpdateError(null)).toBe(false);
    expect(isConcurrentUpdateError('CONCURRENT_UPDATE')).toBe(false);
  });
});

describe('the narrowed type promises only what BOTH limbs guarantee', () => {
  it('narrows a name-only error, and `code` reads back as possibly-absent', () => {
    const err: unknown = nameOnly;
    if (!isConcurrentUpdateError(err)) {
      // CONTROL — if the `name` limb ever stops accepting a code-less error,
      // every compile-time pin in this file becomes a statement about an
      // unreachable branch. Fail loudly rather than pass vacuously.
      throw new Error('the `name` limb no longer accepts a code-less error');
    }
    // DISAGREES — a `typeof` query reads the DECLARED type of the symbol, so
    // `code` is captured through a const rather than as `typeof err.code`
    // (which does not see control-flow narrowing). `'CONCURRENT_UPDATE'` under
    // the old required declaration; `'CONCURRENT_UPDATE' | undefined` now.
    const code = err.code;
    type _CodeReadsAsMaybeUndefined = Assert<
      Equal<typeof code, 'CONCURRENT_UPDATE' | undefined>
    >;
    // ...and the runtime agrees with what the type now admits.
    expect(code).toBeUndefined();
    expect(err.currentVersion).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Compile-time pins                                                           */
/*                                                                             */
/* Erased at runtime; checked only by `tsc -p tsconfig.test.json`, which this  */
/* package's `type-check` script runs after `tsc --noEmit`. `Assert<false>` is */
/* a TS2344 "does not satisfy the constraint 'true'" error, so a false verdict */
/* is a red build, not a skipped assertion.                                    */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Extends<A, B> = [A] extends [B] ? true : false;
type IsNever<T> = [T] extends [never] ? true : false;

/**
 * The type a `x is T` predicate narrows to — `never` when the function is not
 * a type predicate at all. That collapse is what lets the liveness control
 * below tell "narrows to an optional-`code` object" apart from "stopped
 * narrowing", since `never` is assignable to everything and would satisfy
 * every other pin here silently.
 */
type NarrowedBy<F> = F extends (arg: unknown) => arg is infer N ? N : never;
type Narrowed = NarrowedBy<typeof isConcurrentUpdateError>;

// CONTROL (passes both ways) — the import above still resolves to a live,
// exported TYPE PREDICATE over `unknown`. Guards a future change to a bare
// `boolean` return (like `plugin-form`'s copy) or to a different parameter
// type: either collapses `Narrowed` to `never` and turns this line red.
type _PredicateStillNarrows = Assert<Equal<IsNever<Narrowed>, false>>;

// CONTROL (passes both ways) — `code`, when present, is still the exact wire
// literal. Guards the WRONG way to make this type honest: widening it to
// `code?: string`, which satisfies "optional" while throwing the
// discriminator away.
type _CodeIsStillTheWireLiteral = Assert<
  Equal<NonNullable<Narrowed['code']>, 'CONCURRENT_UPDATE'>
>;

// CONTROL (passes both ways) — the two payload fields the only consumer
// actually reads are still on the narrowed type and still optional. Guards a
// future "tidy-up" that trims the narrowed type down to `code` alone.
type _PayloadFieldsSurvive = Assert<
  Equal<Narrowed['currentVersion'], string | undefined>
>;

// DISAGREES — `code` is an OPTIONAL property: the narrowed type still accepts
// a value with that key removed. Stated as an assignability relation rather
// than as `undefined extends Narrowed['code']`, because the latter measures
// the property's TYPE (which `exactOptionalPropertyTypes` moves) instead of
// whether the key may be missing (which is the actual invariant).
type _CodeIsOptional = Assert<Extends<Omit<Narrowed, 'code'>, Narrowed>>;

// DISAGREES — the invariant itself, in one line: the value the RUNTIME accepts
// through the `name` limb is assignable to the type the predicate hands its
// caller. This is the same `nameOnly` witness the runtime block above asserts
// `true` for, so the two halves cannot drift apart.
type _NameOnlyErrorIsAssignableToTheNarrowedType = Assert<
  Extends<NameOnlyConcurrentUpdateError, Narrowed>
>;
