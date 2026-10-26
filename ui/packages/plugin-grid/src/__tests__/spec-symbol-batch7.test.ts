/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/plugin-grid` ↔ `@objectstack/spec` symbol-collision guards
 * (objectui#3161, objectstack#4115 ledger batch 7).
 *
 *  - `ColumnSummaryConfig` → `ColumnSummarySetting`, and the aggregation union
 *    beside it now IS the spec's `ColumnSummary` enum instead of a hand copy of
 *    its eleven members. This one was not a near-miss: the spec's
 *    `ColumnSummaryConfig` is the OBJECT form of `ListColumn.summary` alone,
 *    while the local declaration under that name was the whole union — the
 *    shorthand included. Same word, strictly different type, and no test could
 *    have caught it because both sides were "correct" about different things.
 *
 *  - `isMultiValueField` → `hasMultiValueShape`, which now delegates to the
 *    spec function it used to shadow. The pins below assert the delegation
 *    (same answers for the same defs) AND the precondition gap that made the
 *    shared name dangerous: the spec's function throws on the `undefined` this
 *    one is routinely called with.
 */

import { describe, it, expect } from 'vitest';
import {
  ColumnSummarySchema,
  type ColumnSummary as SpecColumnSummary,
  type ColumnSummaryConfig as SpecColumnSummaryConfig,
} from '@objectstack/spec/ui';
import {
  isMultiValueField as specIsMultiValueField,
  MULTI_CAPABLE_TYPES,
  MULTI_OPTION_TYPES,
} from '@objectstack/spec/data';
import { enumOptions } from '@object-ui/test-support';

import { SUPPORTED_SUMMARY_TYPES, type ColumnSummarySetting, type ColumnSummaryType } from '../useColumnSummary';
import { hasMultiValueShape } from '../hooks/multiValueFields';

/**
 * The spec's column-summary vocabulary.
 *
 * The wrapper walk is `@object-ui/test-support`'s shared reader (objectui#6924).
 * No throw wrapper here — unlike the module-scope readers converted alongside it
 * in objectui#7025, this suite already discharges the reader's non-vacuity duty
 * with its OWN first assertion below, which is the sanctioned alternative. What
 * it replaces was a NON-OPTIONAL cast of the enum node to an options-bearing
 * shape; the loudness that cast provided is preserved by that assertion, not
 * lost to `[]`.
 */
const specSummaryOptions: readonly string[] = enumOptions(ColumnSummarySchema);

describe('the column-summary vocabulary comes from the spec', () => {
  it('reads a non-empty enum from the spec (the probe itself is not vacuous)', () => {
    // The reader answers `[]` when it cannot read the enum, so THIS is what
    // keeps every assertion below from passing over an empty list.
    expect(
      specSummaryOptions,
      'could not read ColumnSummarySchema.options from the spec',
    ).not.toEqual([]);
  });

  it('every aggregation the spec accepts is one this renderer computes', () => {
    for (const name of specSummaryOptions) {
      expect(
        SUPPORTED_SUMMARY_TYPES.has(name),
        `the spec accepts summary '${name}' and this renderer has no label/aggregation for it — ` +
          `an authored column would validate and then render a blank footer cell`,
      ).toBe(true);
    }
  });

  it('and nothing beyond it — a renderer-only aggregation is a dialect', () => {
    for (const name of SUPPORTED_SUMMARY_TYPES) {
      expect(specSummaryOptions).toContain(name);
    }
  });
});

describe('hasMultiValueShape delegates instead of restating', () => {
  it('answers exactly what the spec answers, for every def with a type', () => {
    const types = [...MULTI_OPTION_TYPES, ...MULTI_CAPABLE_TYPES, 'text', 'number'];
    for (const type of types) {
      for (const multiple of [undefined, true, false]) {
        const def = { type, ...(multiple === undefined ? {} : { multiple }) };
        expect(hasMultiValueShape(def), `disagreed with the spec on ${JSON.stringify(def)}`).toBe(
          specIsMultiValueField(def),
        );
      }
    }
  });

  it('tolerates the missing-field lookup the spec function does not', () => {
    // The reason these two could never have been the same function. The call
    // site is `objectFields?.[param.name]`, which is `undefined` whenever the
    // action names a param the object has no field for.
    expect(hasMultiValueShape(undefined)).toBe(false);
    expect(hasMultiValueShape(null)).toBe(false);
    expect(hasMultiValueShape({})).toBe(false);
    expect(() => specIsMultiValueField(undefined as never)).toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* Compile-time pins — compiled by tsconfig.test.json, chained off             */
/* "type-check" (objectui#4291 retired the narrow project that named this      */
/* file alone, once the package left TEST_DEBT in objectui#4040).              */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Extends<A, B> = [A] extends [B] ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;

describe('the summary types are bound to the spec, not parallel to it', () => {
  it('is pinned at compile time', () => {
    type _SpecIsReal = Assert<Equal<IsAny<SpecColumnSummary>, false>>;

    // The eleven members are the spec's, by identity — a re-fork of the union
    // fails here as well as at the guard.
    type _VocabularyIsTheSpecEnum = Assert<Equal<ColumnSummaryType, SpecColumnSummary>>;

    // …and the setting is exactly the spec's two accepted forms.
    type _SettingIsBothForms = Assert<Equal<ColumnSummarySetting, SpecColumnSummary | SpecColumnSummaryConfig>>;

    // The mis-description this rename removed, stated as a fact: the spec's
    // `ColumnSummaryConfig` does NOT include the shorthand, so the old local
    // declaration accepted `'sum'` under a name that, imported from the spec,
    // rejects it.
    type _SpecConfigExcludesShorthand = Assert<Equal<Extends<SpecColumnSummary, SpecColumnSummaryConfig>, false>>;
    type _SettingIncludesShorthand = Assert<Extends<SpecColumnSummary, ColumnSummarySetting>>;

    expect(true).toBe(true);
  });
});
