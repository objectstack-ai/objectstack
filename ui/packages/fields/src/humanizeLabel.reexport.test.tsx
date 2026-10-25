/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5444 — `@object-ui/fields` re-exports the value-fallback prettifier,
 * it does not redefine it.
 *
 * `humanizeLabel` had TWO byte-identical implementations: this package's export
 * (read by `plugin-grid`, `plugin-gantt`, `plugin-detail` and by this package's
 * own `SelectCellRenderer` / boolean-off label) and a deliberate local copy in
 * `plugin-charts`' `ObjectChart.tsx`. Two copies of one convention is a live
 * hazard, not just duplication: one dashboard can hold a chart and a grid over
 * the same stored value, so a change landing on one copy alone would render
 * that value under two spellings at once. The single implementation now lives
 * in `@object-ui/core` — the shared ancestor both packages already depend on,
 * and the direction objectui#4389 already ruled for this family.
 *
 * The identity assertion is what makes that structural rather than a promise: a
 * membership- or output-only check would pass just as happily on a restored
 * copy and let the two drift apart again, which is the exact failure this card
 * removed.
 */
import { describe, it, expect } from 'vitest';
import { humanizeLabel as fromCore } from '@object-ui/core';
// This package's own entry is imported RELATIVELY, not as `@object-ui/fields`:
// a package self-import resolves through the published `exports` map to
// `dist/*.d.ts`, which does not exist on a cold CI cache (see
// `cascadeOptionWidgetTypes.reexport.test.tsx` for the full note). The relative
// specifier reads the SOURCE entry, which is what the vitest alias resolves
// `@object-ui/fields` to as well.
import { humanizeLabel as fromFields } from './index';

describe('humanizeLabel re-export (objectui#5444)', () => {
  it('is the SAME function as the core definition, not a copy', () => {
    expect(fromFields).toBe(fromCore);
  });

  it('still produces what this doorway produced before the convergence', () => {
    // The card's measured input table, verbatim. These are the outputs the
    // deleted local implementation produced on `origin/main`, so this is the
    // behaviour-preserving claim for the three plugins that read the value
    // fallback through this package.
    expect(fromFields('needs_analysis')).toBe('Needs Analysis');
    expect(fromFields('NeedsAnalysis')).toBe('NeedsAnalysis');
    expect(fromFields('unitPrice')).toBe('UnitPrice');
    expect(fromFields('BestCase')).toBe('BestCase');
    expect(fromFields('lost-to-competitor')).toBe('Lost To Competitor');
  });
});
