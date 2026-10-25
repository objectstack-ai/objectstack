/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5444 — `ObjectChart.tsx` reaches the value-fallback prettifier, it
 * no longer carries its own.
 *
 * The local copy here existed "to avoid a dependency on `@object-ui/fields`"
 * and was byte-identical to that package's export. The dependency it avoided is
 * still avoided: the single implementation lives in `@object-ui/core`, which
 * this package already depends on.
 *
 * This is the chart half of the pair — the fields half is
 * `packages/fields/src/humanizeLabel.reexport.test.tsx`. Both assert IDENTITY
 * against the same core function, which is what makes "the chart and the grid
 * cannot disagree" a structural fact rather than two output tables that someone
 * has to remember to edit together. The card's hazard was exactly that: a
 * chart's free-form member reading `Unit Price` while a grid's option fallback
 * over the same stored value read `UnitPrice`.
 */
import { describe, it, expect } from 'vitest';
import { humanizeLabel as fromCore } from '@object-ui/core';
// Relative, not `@object-ui/plugin-charts` — a package self-import resolves
// through the published `exports` map to `dist/`, which does not exist on a
// cold CI cache. This reads the source module, which is also what the axis
// paths in `resolveGroupByLabels` call.
import { humanizeLabel as fromObjectChart } from './ObjectChart';

describe('humanizeLabel in ObjectChart (objectui#5444)', () => {
  it('is the SAME function as the core definition, not a local copy', () => {
    expect(fromObjectChart).toBe(fromCore);
  });

  it('still produces what the chart axis fallback produced before the convergence', () => {
    // The card's measured input table, verbatim — the outputs the deleted local
    // copy produced on `origin/main`.
    expect(fromObjectChart('needs_analysis')).toBe('Needs Analysis');
    expect(fromObjectChart('NeedsAnalysis')).toBe('NeedsAnalysis');
    expect(fromObjectChart('unitPrice')).toBe('UnitPrice');
    expect(fromObjectChart('BestCase')).toBe('BestCase');
    expect(fromObjectChart('lost-to-competitor')).toBe('Lost To Competitor');
  });
});
