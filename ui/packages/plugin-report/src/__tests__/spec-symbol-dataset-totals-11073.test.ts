/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11073 — why `DatasetReportRenderer.tsx` names its totals grouping
 * `DatasetResultTotals`, not `DatasetTotals`.
 *
 * `@objectstack/spec` 17.5.0 began exporting `DatasetTotals` from
 * `@objectstack/spec/api`: the REQUEST side of ADR-0021's marginal aggregates
 * (`{ groupings }`, which totals to compute). The file-local interface is the
 * RESULT side, one grouping of the response's `totals[]` (`{ dimensions, rows }`),
 * so the two measured unequal and the local one was renamed
 * (`pnpm check:spec-symbols` refuses a local declaration under a spec export's
 * name). It was never exported, so no public name moved.
 *
 * This row pins the REASON off the spec's live schema: if the spec's
 * `DatasetTotals` ever becomes the result grouping, it goes red and the local
 * type should be derived instead. That the spec does not own the NEW name is
 * held by `pnpm check:spec-symbols` on every run.
 */
import { describe, expect, it } from 'vitest';
import { DatasetTotalsSchema } from '@objectstack/spec/api';

describe('objectui#11073 — the spec`s DatasetTotals is the request, not a result grouping', () => {
  it('declares `groupings` and none of the result grouping`s members', () => {
    const keys = Object.keys((DatasetTotalsSchema as unknown as { shape: Record<string, unknown> }).shape);
    expect(keys).toEqual(['groupings']);
    for (const resultMember of ['dimensions', 'rows']) expect(keys).not.toContain(resultMember);
  });
});
