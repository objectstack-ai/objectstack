/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/fields` ↔ `@objectstack/spec` symbol-collision guards
 * (objectui#3161, objectstack#4115 ledger batch 7).
 *
 * Two symbols, two different verdicts:
 *
 *  - `isFileIdToken` was a character-for-character copy of the spec's function
 *    under the spec's own name. It is a re-export now, and the gate below is
 *    REFERENCE IDENTITY — not behaviour. A faithful copy passes every behaviour
 *    test ever written for it (objectui#3003, re-proved on
 *    `isAggregatedViewContainer` in objectui#3169), so `toBe` is the only
 *    assertion that can tell a re-export from a fork.
 *
 *  - `FieldWidgetProps` is now `FieldWidgetComponentProps`. The spec owns that
 *    name for the DECLARED widget-plugin props contract; this package's is the
 *    React interface its widgets implement. The pins record what still makes
 *    re-exporting impossible (`field` is the far richer `FieldMetadata` here)
 *    and, since objectui#3222, what no longer does: the validation slot is the
 *    spec's `error` on both sides.
 *
 * The other direction — "the spec must not start owning the NEW names" — is not
 * asserted here because `scripts/check-spec-symbol-derivation.mjs` already
 * answers it on every CI run, for every name in the package rather than the
 * handful a test would remember to list.
 */

import { describe, it, expect } from 'vitest';
import { isFileIdToken as specIsFileIdToken } from '@objectstack/spec/data';
import type { FieldWidgetProps as SpecFieldWidgetProps } from '@objectstack/spec/ui';

import { isFileIdToken, fileIdOf } from '../widgets/file-value';
import type { FieldWidgetComponentProps } from '../widgets/types';

describe('isFileIdToken IS the spec function', () => {
  it('is the same function object, not an equivalent one', () => {
    // The whole point. Every value/behaviour assertion below this line would
    // also pass against a re-forked copy; this one would not.
    expect(isFileIdToken).toBe(specIsFileIdToken);
  });

  it('is the arbiter the rest of the module routes through', () => {
    // `fileIdOf` must keep agreeing with the shared predicate, so a future
    // "small local tweak" to the id shape cannot be reintroduced one caller at
    // a time.
    for (const value of ['abc123', 'AbC-_9', 'x'.repeat(64)]) {
      expect(specIsFileIdToken(value)).toBe(true);
      expect(fileIdOf(value)).toBe(value);
    }
    for (const value of ['https://example.com/f.png', '/api/v1/storage/files/1', 'a.b', 'x'.repeat(65)]) {
      expect(specIsFileIdToken(value)).toBe(false);
      expect(fileIdOf(value)).toBeUndefined();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Compile-time pins. A violation is a `tsc` error, not a runtime failure.     */
/* This package's tsconfig.json includes its tests, so `type-check` compiles   */
/* them (scripts/check-type-check-coverage.mjs keeps that true).              */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Extends<A, B> = [A] extends [B] ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
type HasKey<T, K extends string> = K extends keyof T ? true : false;

describe('FieldWidgetComponentProps is the RENDERED layer of the spec contract', () => {
  it('is pinned at compile time', () => {
    // The import above is itself half the tripwire: the day the spec stops
    // exporting `FieldWidgetProps`, this file stops compiling and the rename's
    // reason is up for re-triage (the plain name could come back).
    type _SpecIsReal = Assert<Equal<IsAny<SpecFieldWidgetProps>, false>>;

    // The validation-message slot no longer diverges. objectui#3161 could only
    // RECORD that the declared contract called it `error` while every widget
    // here read `errorMessage`; objectui#3222 resolved it in the direction the
    // contract points — this package adopted `error`, and the form renderer
    // started producing it, so the name and the delivery landed together.
    // Both sides are pinned: the spec still owns the name, and this package
    // still spells it the same way.
    type _SpecNamesItError = Assert<HasKey<SpecFieldWidgetProps, 'error'>>;
    type _LocalNamesItErrorToo = Assert<HasKey<FieldWidgetComponentProps, 'error'>>;
    type _SameOptionalStringSlot = Assert<
      Equal<FieldWidgetComponentProps['error'], SpecFieldWidgetProps['error']>
    >;
    // The old name is gone, not kept as an alias. An alias would be exactly the
    // lenient second dialect AGENTS.md #0.1 forbids — and the reason a missed
    // call site would have gone quiet again.
    type _OldNameRetired = Assert<Equal<HasKey<FieldWidgetComponentProps, 'errorMessage'>, false>>;

    // …and the reason nobody noticed used to sit right here: three pins
    // asserting that `[key: string]: any` was still present, and that
    // `props.required` / `props.error` therefore read as `any`. objectui#3221
    // removed that index signature, so those pins have gone red on purpose and
    // are gone with it. What replaces them is the inverse claim — the type is
    // now CLOSED, so a key the spec declares and this one does not can finally
    // be reported as missing. That is what made objectui#3222's rename
    // decidable by the compiler instead of by a symbol guard.
    type _NoStringIndexSignature = Assert<Equal<Extends<string, keyof FieldWidgetComponentProps>, false>>;
    // `required` is the one key that stayed behind, and deliberately so
    // (objectui#3222): the required marker has a single author — the form
    // renderer's `<FormLabel>` — and lowering the flag into widget props gives
    // it a second, i.e. the double-display failure that also keeps the
    // validation TEXT out of the widget. The a11y state a widget could
    // legitimately carry is `aria-required`, and `AriaAttributes` already
    // supplies that key with no contract change at all.
    type _RequiredIsAbsent = Assert<Equal<HasKey<FieldWidgetComponentProps, 'required'>, false>>;

    // `data-*` stays open (it is open in HTML too), but as a template-literal
    // key — the distinction that keeps `keyof` finite above. A pin, because
    // widening it back to `[key: string]` would silently restore the defect
    // while every assertion here still read as "closed".
    type _DataAttributesStayOpen = Assert<Extends<'data-testid', keyof FieldWidgetComponentProps>>;

    expect(true).toBe(true);
  });
});
