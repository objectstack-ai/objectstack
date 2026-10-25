/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `DatasetResultField` IS `@objectstack/spec`'s `AnalyticsResult.fields[]`
 * element — pinned at COMPILE TIME (objectui#3815).
 *
 * Why a whole file for one alias: the alias is the fix, and an alias cannot
 * drift while it exists — but nothing stops the next session from "restoring"
 * a readable local interface, which is exactly how the restatement this
 * replaced was born. So the sabotage direction is recorded here as a negative
 * pin rather than in a commit message: re-hand-writing the six keys turns
 * `_NotTheHandWrittenCopy` red.
 *
 * The assertions below are TYPES. `Assert< Equal< Local, Spec > >` is a compile
 * error or it is nothing — and this package's own `tsconfig.json` is the BUILD
 * config, which excludes every `.test.ts` file under `src` (correctly: a test
 * must not emit into `dist`). What compiles them is
 * `packages/core/tsconfig.test.json`, which takes the package's test tree by
 * glob — this file included — and is chained off the package's `type-check`
 * script (`tsc --noEmit && tsc -p tsconfig.test.json`), the script CI's Type
 * Check job runs. That coverage arrived late: `@object-ui/core` sat in
 * `scripts/check-type-check-coverage.mjs`'s TEST_DEBT with a narrow
 * `tsconfig.typetests.json` naming this file by hand, until the package
 * graduated in objectui#4040 and the narrow project was retired with it. The
 * debt table is now empty.
 *
 * Without SOME such project these pins would be the "declared != enforced"
 * landmine objectstack#4115 exists to remove, sitting inside a guard for it
 * (objectui#3009 found precisely that: reverting a derived alias produced zero
 * errors under a header calling the assertions "the real enforcement").
 */

import { describe, it, expect } from 'vitest';
import type { AnalyticsResult as SpecAnalyticsResult } from '@objectstack/spec/contracts';
import type { PercentScale as SpecPercentScale } from '@objectstack/spec/data';
import { buildDatasetFieldHelpers, type DatasetResultField } from '../dataset-format.js';
import type { ChartResultField } from '../chart-series.js';

type Assert<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type Extends<A, B> = A extends B ? true : false;
type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;

/** The spec element this name is supposed to BE. */
type SpecResultField = SpecAnalyticsResult['fields'][number];

describe('DatasetResultField IS @objectstack/spec AnalyticsResult.fields[]', () => {
  it('is pinned at compile time', () => {
    // The spec side has to have resolved to a real type: every assertion below
    // is vacuously true against `any`, so this is what keeps a broken import
    // from reading as a green pin.
    type _SpecNotAny = Assert<Equal<IsAny<SpecAnalyticsResult>, false>>;

    // THE pin. `Equal` rather than a two-way `extends` on purpose (the #3613
    // reason): a restatement that merely *overlaps* the contract stays mutually
    // assignable in the drifted direction too — a required `type` is still
    // assignable to an optional one, which is exactly how this declaration sat
    // "not drifted" while being one relaxation away from lying. Structural
    // identity is the only assertion a hand copy cannot pass while drifting.
    type _IsTheSpecField = Assert<Equal<DatasetResultField, SpecResultField>>;

    // The single difference the restatement had accumulated, named so a reader
    // learns WHICH relaxation cost something rather than merely that one
    // existed: `type` is REQUIRED on the wire, and was optional here.
    type _TypeIsRequired = Assert<Equal<DatasetResultField['type'], string>>;
    type _TypeIsNotOptional = Assert<
      Equal<Equal<DatasetResultField['type'], string | undefined>, false>
    >;

    // `percentScale` (#3136) is the spec's union, not a widened `string` — a
    // renderer branches on `fraction` vs `whole` instead of guessing from the
    // value's magnitude, so the union IS the capability.
    type _HasPercentScale = Assert<HasKey<DatasetResultField, 'percentScale'>>;
    type _PercentScaleIsTheSpecUnion = Assert<
      Equal<DatasetResultField['percentScale'], SpecPercentScale | undefined>
    >;
    type _PercentScaleIsNotString = Assert<
      Equal<Equal<DatasetResultField['percentScale'], string | undefined>, false>
    >;

    // The exact interface this replaced, kept as a NEGATIVE pin: hand-writing
    // the six keys back — with the `type?` relaxation that made it a superset
    // of the contract rather than the contract — turns this red.
    type _NotTheHandWrittenCopy = Assert<
      Equal<
        Equal<
          DatasetResultField,
          {
            name: string;
            type?: string;
            label?: string;
            format?: string;
            currency?: string;
            percentScale?: SpecPercentScale;
          }
        >,
        false
      >
    >;

    expect(true).toBe(true);
  });

  // The file-header claim on `DatasetResultField`, stated as a type instead of
  // as prose. `ChartResultField` is `@object-ui/core`'s own renderer-internal
  // shape (nothing in the spec owns it), and `DatasetWidget` hands its
  // `DatasetResultField[]` state straight to `buildChartSeries`, which accepts
  // `ChartResultField[]` — so the superset direction is load-bearing, not
  // documentation.
  it('is still a superset of ChartResultField', () => {
    type _DatasetFieldIsAChartField = Assert<Extends<DatasetResultField, ChartResultField>>;
    type _ChartKeysAreDatasetKeys = Assert<Extends<keyof ChartResultField, keyof DatasetResultField>>;

    // …and NOT the other way round, which is new: with `type` required, a bare
    // `{ name, label?, format? }` no longer satisfies `DatasetResultField`. No
    // caller flows in that direction (`buildChartSeries` and
    // `buildDatasetFieldHelpers` both take the wider value), but the asymmetry
    // is the whole content of the word "superset" and is recorded rather than
    // assumed.
    type _ChartFieldIsNotADatasetField = Assert<
      Equal<Extends<ChartResultField, DatasetResultField>, false>
    >;

    expect(true).toBe(true);
  });

  // The runtime half: a spec-shaped column — every key the contract carries,
  // including the required `type` — flows through the shared helper the three
  // dataset surfaces build their headers with.
  it('a spec-shaped column feeds buildDatasetFieldHelpers', () => {
    const fields: DatasetResultField[] = [
      { name: 'win_rate', type: 'number', label: 'Win rate', format: '0.0%', percentScale: 'fraction' },
      { name: 'revenue', type: 'number', label: 'Revenue', format: '0,0', currency: 'USD' },
    ];
    const { measureField, headerLabel } = buildDatasetFieldHelpers(fields, 'opportunity');

    expect(headerLabel('win_rate')).toBe('Win rate');
    expect(measureField('win_rate')?.percentScale).toBe('fraction');
    expect(measureField('revenue')?.currency).toBe('USD');
    // Every column the wire produces declares its `type`; the helper passes it
    // through untouched.
    expect(measureField('revenue')?.type).toBe('number');
  });
});
