/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7495 — `chartTypeIgnoresCompareTo`, the ONE declaration of "which
 * chart families ignore `compareTo`".
 *
 * Two copies used to exist and disagreed: `@object-ui/plugin-charts`' ObjectChart
 * said pie / donut / funnel / scatter, `@object-ui/plugin-dashboard`'s
 * DatasetWidget said scatter only. The ruling (letter A, ratified) makes the
 * charts package's published statement the contract, so the answers pinned here
 * are exactly the ones ObjectChart's retired local predicate gave — the same
 * `true` for those four families, the same `false` for every other family, for
 * an unknown string, and for `undefined`.
 *
 * The population is the spec's own `ChartTypeSchema` enum, read at run time,
 * so a family the spec adds later is judged here without anyone listing it.
 */

import { describe, it, expect } from 'vitest';
import { ChartTypeSchema } from '@objectstack/spec/ui';

import { chartTypeIgnoresCompareTo } from '../chart-presentation.js';
import * as corePublicEntry from '../../index.js';

/** The families the charts package publishes as ignoring `compareTo`. */
const IGNORING = ['pie', 'donut', 'funnel', 'scatter'];

describe('chartTypeIgnoresCompareTo (objectui#7495)', () => {
  const families: string[] = [...ChartTypeSchema.options];

  it('judges a non-empty population — the spec enum, including every ignoring family', () => {
    // Without this a renamed or emptied enum would make the loop below vacuous.
    expect(families.length).toBeGreaterThan(IGNORING.length);
    for (const f of IGNORING) expect(families).toContain(f);
  });

  it('answers true for exactly pie, donut, funnel and scatter among every spec chart family', () => {
    expect(families.filter((f) => chartTypeIgnoresCompareTo(f)).sort()).toEqual([...IGNORING].sort());
  });

  it.each([...ChartTypeSchema.options])('%s', (family) => {
    expect(chartTypeIgnoresCompareTo(family)).toBe(IGNORING.includes(family));
  });

  it('answers false for undefined — a chart with no declared family keeps its comparison', () => {
    expect(chartTypeIgnoresCompareTo(undefined)).toBe(false);
  });

  it('answers false for an unknown family and for the empty string', () => {
    expect(chartTypeIgnoresCompareTo('not-a-chart-family')).toBe(false);
    expect(chartTypeIgnoresCompareTo('')).toBe(false);
  });

  it('matches the family spelling exactly — no case folding', () => {
    expect(chartTypeIgnoresCompareTo('Pie')).toBe(false);
    expect(chartTypeIgnoresCompareTo('SCATTER')).toBe(false);
  });

  it('reads chart FAMILIES, not dashboard widget types: bubble and pyramid are the caller’s to map', () => {
    // The dashboard maps `bubble` → `scatter` and `pyramid` → `funnel` before
    // asking; the predicate itself does not know widget-type aliases, which is
    // also what ObjectChart's local predicate answered for these spellings.
    expect(chartTypeIgnoresCompareTo('bubble')).toBe(false);
    expect(chartTypeIgnoresCompareTo('pyramid')).toBe(false);
  });

  it('is exported from the package entry — the one both plugins import', () => {
    expect(corePublicEntry.chartTypeIgnoresCompareTo).toBe(chartTypeIgnoresCompareTo);
  });
});
