/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8086 — the `dataKey` arm of `ChartRendererProps.schema.series`
 * declares the per-series family override `type`, with the `name` arm's own
 * member type.
 *
 * Ruling (align): the published TS face states what the contract
 * (`ChartDataSeriesSchema`, where `dataKey` and `name` are each independently
 * optional beside `type`) and the renderer (every entry goes through
 * `normalizeSeries`, objectui#7681) already accept. No other arm changes.
 *
 * ## Why every pin is ARM-level, not union-level
 *
 * `series` is a union with no literal discriminant, so TypeScript's excess-
 * property check on an object literal only asks whether each key is known to
 * SOME arm. A `{ dataKey, type }` literal therefore type-checked against the
 * whole union before this card too (`type` is known to the `name` arm), and a
 * `{ name, chartType }` literal type-checks against it today (`chartType` is
 * known to the `dataKey` arm). A union-level assertion would be green on both
 * sides of the change and pin nothing. What was missing is the `dataKey` ARM's
 * member: a value typed as that arm could not carry `type`, and an entry
 * narrowed to it with `'dataKey' in entry` could not read it.
 *
 * `tsconfig.test.json` compiles this file, so each statement is enforcement:
 * without the member, the `Equal` pin and the narrowed read fail (TS2339) and
 * the arm-typed literal fails (TS2353); the `@ts-expect-error` fails the build
 * (TS2578) the moment its refusal stops happening.
 */

import { describe, it, expect } from 'vitest';
import type { ChartRendererProps } from './ChartRenderer';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type SeriesEntry = NonNullable<ChartRendererProps['schema']['series']>[number];
type DataKeyArm = Extract<SeriesEntry, { dataKey: string }>;
type NameArm = Extract<SeriesEntry, { name: string }>;

/** The ruling's letter: the `dataKey` arm's `type` is the `name` arm's `type`, member for member. */
export type assertionDataKeyArmTypeMatchesNameArm = Expect<Equal<DataKeyArm['type'], NameArm['type']>>;
/** The helper can FAIL — a synthetic control, so a vacuous `Equal` cannot pass this file. */
export type assertionEqualCanFail = Expect<Equal<Equal<NameArm['type'], number | undefined>, false>>;

describe('ChartRendererProps.series — the `dataKey` arm declares `type` (objectui#8086)', () => {
  it('accepts `type` on a value typed as the `dataKey` arm', () => {
    const entry: DataKeyArm = { dataKey: 'margin', type: 'line' };
    expect(entry.type).toBe('line');
  });

  it('reads `type` off an entry narrowed to the `dataKey` arm', () => {
    const familyOf = (e: SeriesEntry): string | undefined => ('dataKey' in e ? e.type : undefined);
    expect(familyOf({ dataKey: 'margin', type: 'line' })).toBe('line');
  });

  it('changes no other arm: the `name` arm still carries no `chartType`', () => {
    // @ts-expect-error — `chartType` is the renderer's INTERNAL spelling of `type`; the `name` arm never carried it, and objectui#8086 widened only the `dataKey` arm.
    const authored: NameArm = { name: 'margin', chartType: 'line' };
    expect(authored.name).toBe('margin');
  });
});
