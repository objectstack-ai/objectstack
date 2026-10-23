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

/**
 * The work queue lists the set the KPI tile above it counts.
 *
 * `cc_queue_g` sits under the heading 待审核列表 · Work Queue with the badge
 * 审批中, and the tile `cc_k3` (待复审 Review) counts tasks whose `status` is
 * `in_review`. The grid carried no filter, so it listed every task, done ones
 * included, while the tile beside it counted two.
 *
 * `filter` is the key `object-grid` declares (`ComponentPropsMap['object-grid']`,
 * the `ViewFilterRule` array) and the one the committed `sdui.manifest.json`
 * lists among the grid's inputs; the renderer lowers it to `$filter`. The pin
 * asserts that key, parses the whole bag against the grid's row, and holds the
 * queue's rules equal to the tile's so the two cannot drift apart.
 */
function nodeById(root: unknown, id: string): AnyRec | undefined {
  let found: AnyRec | undefined;
  const visit = (v: unknown): void => {
    if (found) return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }
    if (!isRec(v)) return;
    if (v.id === id) {
      found = v;
      return;
    }
    for (const child of Object.values(v)) visit(child);
  };
  visit(root);
  return found;
}

describe('Command Center — the work queue lists the review set its KPI counts', () => {
  const queue = nodeById(CommandCenterPage.regions, 'cc_queue_g');
  const tile = nodeById(CommandCenterPage.regions, 'cc_k3');
  const queueProps = isRec(queue?.properties) ? queue.properties : {};
  const tileProps = isRec(tile?.properties) ? tile.properties : {};

  it('finds the queue grid and the Review tile', () => {
    expect(queue?.type).toBe('object-grid');
    expect(tile?.type).toBe('object-metric');
    expect(queueProps.objectName).toBe(tileProps.objectName);
  });

  it('scopes the queue to in_review tasks through `filter`', () => {
    expect(queueProps.filter).toEqual([{ field: 'status', operator: 'equals', value: 'in_review' }]);
  });

  it("carries the same rules as the tile `cc_k3`", () => {
    expect(queueProps.filter).toEqual(tileProps.filter);
  });

  it('the queue properties bag parses clean against its ComponentPropsMap row', () => {
    const result = ComponentPropsMap['object-grid'].safeParse(queueProps);
    const failures = result.success
      ? []
      : result.error.issues.map((issue) => `properties.${issue.path.join('.')}: ${issue.code}`);
    expect(failures).toEqual([]);
  });
});
