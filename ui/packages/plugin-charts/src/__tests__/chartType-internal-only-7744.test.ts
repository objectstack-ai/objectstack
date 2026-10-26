/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7744 — `chartType` on a series is the INTERNAL spelling only, and
 * the authoring face and the reader disagree about it ON PURPOSE.
 *
 * Two facts, each already true, each already load-bearing:
 *
 * - the AUTHORING face refuses `chartType` BY NAME — `ChartDataSeriesSchema`
 *   (`@object-ui/types`, objectui#7694 / PR #7737). Its rule, its message and
 *   its remedy are pinned in that package's
 *   `chart-series-chart-type-alias-refusal-7694.test.ts`; this file does not
 *   restate them, it only asks WHICH key is refused;
 * - the READER honours it, and reads it FIRST — `normalizeSeries`'
 *   `str(raw.chartType) ?? str(raw.type)` — because the internal `dataKey`
 *   shape carries the per-series family under that name and
 *   `normalizeChartSchema` translates BOTH shapes through the one function.
 *
 * Neither fact is a defect, and until now NEITHER FILE PINNED THE PAIR — which
 * is how the split survived to be found in the contract review of PR #7737.
 * What this file pins is the RELATIONSHIP: the key the validator refuses is
 * the key the reader prefers. Bring the two faces into agreement from either
 * side — make the refusal accept, or reorder or delete the reader's first limb
 * — and this goes red naming the side that moved.
 *
 * ⚠️ It is deliberately not written as "`chartType` is honoured somehow": an
 * assertion loose enough to stay green under both behaviours pins nothing.
 *
 * ⛔ A green ablation on the reader's first limb is not a licence to delete it;
 * the `normalizeSeries` docblock carries that measurement and why.
 */

import { describe, it, expect } from 'vitest';
import { ChartDataSeriesSchema } from '@object-ui/types/zod';

import { normalizeChartSchema, type NormalizedSeries } from '../normalizeChartSchema';
import type { ChartRendererProps } from '../ChartRenderer';

/**
 * ONE document, read by every assertion below, so the two faces are measured
 * against the same input instead of against two fixtures free to drift apart.
 *
 * It writes BOTH spellings with DIFFERENT values, and that is what makes the
 * reader's precedence observable at all: with only `chartType` written, a
 * reordered reader returns the identical answer and a pin on the value alone
 * stays green straight through the change it exists to catch.
 */
const AUTHORED = { name: 'margin', type: 'area', chartType: 'line' } as const;

/** The same document with the refused spelling dropped — the accept control. */
const AUTHORED_WITHOUT_ALIAS = { name: AUTHORED.name, type: AUTHORED.type } as const;

/** `null` when the document parses; the refused paths otherwise. */
const issuePathsOf = (input: unknown): string[] | null => {
  const r = ChartDataSeriesSchema.safeParse(input);
  return r.success ? null : r.error.issues.map((i) => i.path.join('.'));
};

const seriesOf = (raw: unknown): NormalizedSeries | undefined =>
  normalizeChartSchema({ series: [raw] }).series?.[0];

describe('objectui#7744 — the `chartType` split between the authoring face and the reader', () => {
  it('the AUTHORING face refuses `chartType`, and that is the ONLY thing wrong with the document', () => {
    expect(
      issuePathsOf(AUTHORED),
      'objectui#7744: `ChartDataSeriesSchema` no longer refuses `chartType` by name on an authored '
      + 'series (objectui#7694 / PR #7737) — the AUTHORING face moved. If that is intended, the '
      + 'reader half of this split and the `normalizeSeries` docblock are the other half of the edit.',
    ).toEqual(['chartType']);
  });

  it('CONTROL — the same series is ACCEPTED once `chartType` is dropped', () => {
    expect(
      issuePathsOf(AUTHORED_WITHOUT_ALIAS),
      'objectui#7744: the fixture is refused for something other than `chartType`, so the refusal '
      + 'asserted above is not measuring the key it names.',
    ).toBeNull();
  });

  it('the READER honours `chartType`, and takes it OVER the declared `type`', () => {
    expect(
      seriesOf(AUTHORED)?.chartType,
      'objectui#7744: `normalizeSeries` no longer resolves the per-series family from `chartType` '
      + 'first. `"area"` here means the limb was REORDERED; `undefined` means it was DELETED. '
      + 'Either one changes what the internal `dataKey`-shape producers render (DashboardRenderer / '
      + 'ObjectView / the dataset path) — that is a reader-side decision, not a doc fix.',
    ).toBe('line');
  });

  it('THE SPLIT — the key the validator refuses is the key the reader prefers', () => {
    const [refused] = issuePathsOf(AUTHORED) ?? [];
    const written = AUTHORED as unknown as Record<string, unknown>;

    expect(refused, 'objectui#7744: nothing on this fixture is refused by name any more').toBe('chartType');
    expect(
      written[refused],
      'the fixture must write the refused key and the declared key with DIFFERENT values, or the '
      + 'reader\'s precedence between them is not observable and this case pins nothing.',
    ).not.toBe(written.type);

    expect(
      seriesOf(AUTHORED)?.chartType,
      'objectui#7744: the reader no longer prefers the very key the authoring face refuses. The two '
      + 'faces have converged, and the `normalizeSeries` docblock now describes a split that is gone.',
    ).toBe(written[refused]);
  });

  it('the internal `dataKey` shape is the limb\'s LEGITIMATE carrier — it is not the defect', () => {
    expect(
      seriesOf({ dataKey: 'margin', chartType: 'line' })?.chartType,
      'objectui#7744: the internal-shape producers lost their per-series family override.',
    ).toBe('line');
  });
});

/* -------------------------------------------------------------------------- */
/* Compile-time half — this package's tsconfig.json includes its tests, so     */
/* `type-check` compiles these (the `spec-symbol-batch7.test.ts` precedent).   */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type HasKey<T, K extends string> = K extends keyof T ? true : false;

type SeriesArm = NonNullable<ChartRendererProps['schema']['series']>[number];
type InternalArm = Extract<SeriesArm, { dataKey: string }>;
type AuthoredArm = Extract<SeriesArm, { name: string }>;

describe('objectui#7744 — `ChartRenderer` states the same split in TypeScript', () => {
  it('is pinned at compile time (the assertion IS the compile)', () => {
    // `series?` is a union of the two shapes. `chartType` is a member of the
    // INTERNAL arm and of no other; the authored arm carries `type` instead.
    // Move `chartType` onto the authored arm and these stop compiling.
    type _ChartTypeIsInternal = Assert<HasKey<InternalArm, 'chartType'>>;
    type _ChartTypeIsNotAuthored = Assert<HasKey<AuthoredArm, 'chartType'> extends false ? true : false>;
    type _AuthoredArmDeclaresType = Assert<HasKey<AuthoredArm, 'type'>>;

    expect(true).toBe(true);
  });
});
