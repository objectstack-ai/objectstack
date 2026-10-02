// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ComponentPropsMap } from '@objectstack/spec/ui';

import { CommandCenterPage } from '../src/ui/pages/index.js';

/**
 * The Command Center's KPI tiles write `filter` in the form their own contract
 * declares.
 *
 * The page is built through local helpers (`kpi()`, `band()`, `panel()`), and
 * `kpi()` spreads its `filter` argument straight into the `object-metric`
 * node's `properties`. `PageComponent.properties` is an open bag, so nothing in
 * `definePage()` judges what lands there: four tiles wrote the MongoDB-style
 * record form (`{ status: 'active' }`) that `ComponentPropsMap['object-metric']`
 * refuses by name, and the page still loaded. `os validate` reports it only as
 * an advisory warning, so a green run did not mean a clean page.
 *
 * This pin evaluates the page as authored (helpers included), finds every
 * `object-metric` node wherever it sits in the tree, and parses its WHOLE
 * `properties` bag against the row: the verdict on a `filter` value is a value
 * verdict, so the full parse has to be green, not just free of unknown keys.
 */

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/** Every `object-metric` node in the page, at any depth. */
function metricNodes(root: unknown): AnyRec[] {
  const out: AnyRec[] = [];
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }
    if (!isRec(v)) return;
    if (v.type === 'object-metric') out.push(v);
    for (const child of Object.values(v)) visit(child);
  };
  visit(root);
  return out;
}

/** The tiles that scope their count by a filter; dropping one changes what the tile counts. */
const FILTERED_TILES = ['cc_k1', 'cc_k2', 'cc_k3', 'cc_k4'];

const metricRow = ComponentPropsMap['object-metric'];

describe('Command Center — object-metric properties parse against their ComponentPropsMap row', () => {
  const nodes = metricNodes(CommandCenterPage.regions);

  it('finds the KPI tiles through the helpers, filtered ones included', () => {
    expect(nodes.length).toBeGreaterThan(0);
    const filtered = nodes.filter((n) => isRec(n.properties) && n.properties.filter !== undefined);
    expect(filtered.map((n) => n.id).sort()).toEqual(expect.arrayContaining(FILTERED_TILES));
  });

  it('every object-metric properties bag parses clean', () => {
    const failures: string[] = [];
    for (const node of nodes) {
      const result = metricRow.safeParse(node.properties);
      if (result.success) continue;
      for (const issue of result.error.issues) {
        failures.push(`${String(node.id)} › properties.${issue.path.join('.')}: ${issue.code}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('the filtered tiles carry a non-empty ViewFilterRule array', () => {
    for (const id of FILTERED_TILES) {
      const node = nodes.find((n) => n.id === id);
      const filter = isRec(node?.properties) ? node.properties.filter : undefined;
      expect(Array.isArray(filter) && filter.length > 0, `${id}: filter is a non-empty array`).toBe(true);
    }
  });
});
