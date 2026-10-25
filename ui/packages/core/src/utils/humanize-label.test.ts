/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5444 — the VALUE-fallback convention, pinned at its single home.
 *
 * Until this module existed the convention lived in two byte-identical private
 * copies (`@object-ui/fields` and `plugin-charts`' `ObjectChart.tsx`). This
 * file pins what the surviving implementation RETURNS, in the exact terms the
 * card measured it in, so the convergence's "behaviour-preserving" claim is
 * checkable rather than asserted: every row below is the output BOTH former
 * copies produced on `origin/main`.
 *
 * The companion pins — `humanizeLabel.reexport.test.tsx` in `@object-ui/fields`
 * and `ObjectChart.humanizeLabelReexport.test.ts` in `@object-ui/plugin-charts`
 * — assert that each former call site now reaches THIS function by identity, so
 * the table below covers both of them and cannot go stale for one and not the
 * other.
 *
 * The `humanizeFieldKey` column is the KEY-fallback convention in
 * `@object-ui/plugin-dashboard`, quoted here because the DIFFERENCE is the
 * point: the two prettifiers are deliberately distinct and the reason is
 * written down in this module's docstring. Its own outputs are pinned in
 * `plugin-dashboard/src/__tests__/ObjectDataTable.headerSpelling.test.tsx`;
 * this file does not import it, to keep core's test graph free of a plugin.
 *
 *   input                humanizeFieldKey     humanizeLabel (pinned here)
 *   needs_analysis       Needs Analysis       Needs Analysis
 *   NeedsAnalysis        Needs Analysis       NeedsAnalysis        <- differ
 *   unitPrice            Unit Price           UnitPrice            <- differ
 *   BestCase             Best Case            BestCase             <- differ
 *   lost-to-competitor   Lost-To-Competitor   Lost To Competitor   <- differ
 */
import { describe, it, expect } from 'vitest';
import { humanizeLabel } from './humanize-label.js';

describe('humanizeLabel — the value-fallback convention (objectui#5444)', () => {
  it('maps `_` and `-` to spaces and title-cases word boundaries', () => {
    expect(humanizeLabel('in_progress')).toBe('In Progress');
    expect(humanizeLabel('high-priority')).toBe('High Priority');
    expect(humanizeLabel('active')).toBe('Active');
  });

  it('does NOT split camelCase — the row the two conventions disagree on', () => {
    // Deliberate, not an oversight: a stored VALUE is arbitrary tenant data, so
    // a mid-token capital is not reliably a word boundary and splitting it
    // would rewrite what the tenant wrote. Changing any expectation in this
    // test moves rendered output in grid, gantt, detail and charts at once —
    // that is a decision with its own card, not a refactor.
    expect(humanizeLabel('NeedsAnalysis')).toBe('NeedsAnalysis');
    expect(humanizeLabel('unitPrice')).toBe('UnitPrice');
    expect(humanizeLabel('BestCase')).toBe('BestCase');
    expect(humanizeLabel('McDonald')).toBe('McDonald');
  });

  it('rewrites the separator the key convention leaves alone', () => {
    // The two conventions do not nest — each leaves alone what the other
    // rewrites — which is why "converge" would have to pick a winner per input
    // class rather than adopt one side wholesale.
    expect(humanizeLabel('lost-to-competitor')).toBe('Lost To Competitor');
  });

  it('passes the empty string through', () => {
    expect(humanizeLabel('')).toBe('');
  });
});
