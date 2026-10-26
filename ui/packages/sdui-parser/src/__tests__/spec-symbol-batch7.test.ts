/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/sdui-parser` ↔ `@objectstack/spec` symbol-collision guard
 * (objectui#3161, objectstack#4115 ledger batch 7).
 *
 * `ValidationResult` → `ManifestValidationResult`, the name registered for this
 * package on objectstack#4115 when batch 4 worked out that the four
 * `ValidationResult`s in this codebase are four different things and settled a
 * CONVENTION rather than a shared name: `<what was validated>Validation<Error |
 * Result>`. `@object-ui/core` took `SchemaNodeValidationResult` under it
 * (objectui#3188); this is the third.
 *
 * The spec exports `ValidationResult` twice — `kernel` and `contracts`, both
 * `{ valid, errors?, warnings? }` for plugin-manifest validation. This one has
 * no `valid` flag at all: severity lives per diagnostic, and the result also
 * carries the `requires` set and the binding sites the server must resolve. The
 * pins state that, so "these are different concepts" cannot quietly stop being
 * true.
 */

import { describe, it, expect } from 'vitest';
import type { ValidationResult as SpecKernelValidationResult } from '@objectstack/spec/kernel';
import type { ValidationResult as SpecContractsValidationResult } from '@objectstack/spec/contracts';

import type { ManifestValidationResult } from '../types.js';
import { validateTree } from '../validate.js';

describe('validateTree still returns the manifest-shaped result', () => {
  it('returns diagnostics / requires / bindings, not a `valid` flag', () => {
    const result = validateTree(null, { components: {} });
    expect(Object.keys(result).sort()).toEqual(['bindings', 'diagnostics', 'requires']);
    expect('valid' in result).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Compile-time pins — compiled by tsconfig.test.json, chained off type-check. */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Extends<A, B> = [A] extends [B] ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
type HasKey<T, K extends string> = K extends keyof T ? true : false;

describe('the spec ValidationResults are plugin-manifest results, this one is not', () => {
  it('is pinned at compile time', () => {
    // Load-bearing imports: the day the spec retires either name, this file
    // stops compiling and the convention can be revisited.
    type _KernelIsReal = Assert<Equal<IsAny<SpecKernelValidationResult>, false>>;
    type _ContractsIsReal = Assert<Equal<IsAny<SpecContractsValidationResult>, false>>;

    type _SpecCarriesAValidFlag = Assert<HasKey<SpecKernelValidationResult, 'valid'>>;
    type _ThisOneDoesNot = Assert<Equal<HasKey<ManifestValidationResult, 'valid'>, false>>;
    type _ThisOneCarriesRequires = Assert<HasKey<ManifestValidationResult, 'requires'>>;

    // Not assignable in either direction — sharing the name was never a
    // narrowing or a widening, it was two subjects under one word.
    type _NotAssignable = Assert<Equal<Extends<ManifestValidationResult, SpecKernelValidationResult>, false>>;
    type _NorTheOtherWay = Assert<Equal<Extends<SpecKernelValidationResult, ManifestValidationResult>, false>>;

    expect(true).toBe(true);
  });
});
