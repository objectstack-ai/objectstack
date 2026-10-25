/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10327 — a view filter on a `chart` view bound to a semantic
 * `dataset` is refused at authoring (ruling 5825582592, letter A: a dataset
 * chart takes its scope from the dataset).
 *
 * The dataset shape of `ListView`'s `case 'chart'` builds a node with no
 * `filter`, so an authored view filter there was accepted and silently dropped.
 * `ListViewSchema` now refuses it, loudly, in the channel its neighbours use: a
 * `custom` issue at the written key, whose message names the key and the
 * condition and ends with the remedy the ruling wrote.
 *
 * Each refused case asserts it is the ONLY issue, so the refusal cannot ride on
 * some other failure of the same document; each control asserts a full parse,
 * on both doors (the schema and the published `safeValidateSchema`).
 *
 * Since objectui#12670 the two doors take two spellings of the same list view:
 * `ListViewSchema` is the `ListView` component's props (`viewType` the kind),
 * and the published door judges the authored PAGE node, its props in the
 * `properties` bag with the kind as the bag's `type` (`asPageListView`). The
 * bag also carries `@objectstack/spec`'s own `checkListViewChartBinding`, which
 * the component's props cannot (their kind is `viewType`), so the two controls
 * that author a `chart` view with no dataset binding are refused there by the
 * spec's check, never by this refusal.
 */
import { describe, it, expect } from 'vitest';
import { ListViewSchema as SpecListViewSchema } from '@objectstack/spec/ui';
import { ListViewSchema, safeValidateSchema } from '../zod/index.zod';
import { asPageListView, bagPath } from './list-view-page-node';

const REMEDY = "a dataset chart's scope is written in the dataset.";

const DATASET_BLOCK = { chartType: 'bar', dataset: 'task_ds', dimensions: ['status'], values: ['total_estimate'] };
// A legacy `options.chart` bag that binds NO dataset. It carried the object-bound
// axes (`xAxisField` / `yAxisFields` / `aggregation`) until objectui#6152 round 12,
// when the bag became the spec's list-overlay bag, whose chart block refuses
// them (pinned in `list-view-options-bag-6152.test.ts`). What this control
// guards is unchanged: the filter refusal reads `dataset`, nothing else.
const OBJECT_BAG = { chartType: 'bar' };
const VIEW_FILTER = [{ field: 'status', operator: 'equals', value: 'open' }];
const LEGACY_FILTERS = [['status', '=', 'open']];

const node = (extra: Record<string, unknown>) => ({
  type: 'list-view',
  objectName: 'task',
  columns: ['name'],
  ...extra,
});

type Parsed = { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[]; message: string }> } };

/** The component's props, and the page node the published door judges, each issue path read relative to the bag. */
const bothDoors = (doc: Record<string, unknown>): Parsed[] => [
  ListViewSchema.safeParse(doc),
  safeValidateSchema(asPageListView(doc)),
];

const issuesOf = (r: Parsed) =>
  (r.error?.issues ?? []).map((i) => ({ code: i.code, path: bagPath(i.path), message: i.message }));

describe('objectui#10327 — a view filter on a dataset-bound chart view is refused', () => {
  it.each([
    ['`filter` on a `chart` block bound to a dataset', { chart: DATASET_BLOCK, filter: VIEW_FILTER }, 'filter'],
    ['`filter` on the legacy `options.chart` bag bound to a dataset', { options: { chart: DATASET_BLOCK }, filter: VIEW_FILTER }, 'filter'],
    ['the legacy `filters` alias on a `chart` block bound to a dataset', { chart: DATASET_BLOCK, filters: LEGACY_FILTERS }, 'filters'],
  ])('%s: one `custom` issue at the written key, naming it, with the ruling\'s remedy', (_label, extra, key) => {
    for (const r of bothDoors(node({ viewType: 'chart', ...extra }))) {
      expect(r.success).toBe(false);
      const issues = issuesOf(r);
      expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([{ code: 'custom', path: key }]);
      expect(issues[0].message.startsWith(`\`${key}\` is refused on a \`chart\` view bound to a semantic \`dataset\``)).toBe(true);
      expect(issues[0].message.endsWith(REMEDY)).toBe(true);
    }
  });

  it('both spellings written at once: one issue at each key', () => {
    for (const r of bothDoors(node({ viewType: 'chart', chart: DATASET_BLOCK, filter: VIEW_FILTER, filters: LEGACY_FILTERS }))) {
      expect(r.success).toBe(false);
      expect(issuesOf(r).map(({ code, path }) => ({ code, path }))).toEqual([
        { code: 'custom', path: 'filter' },
        { code: 'custom', path: 'filters' },
      ]);
    }
  });
});

describe('objectui#10327 — controls: every neighbour of the refused shape parses', () => {
  // `unbound`: a `chart` view whose effective block binds no dataset. The page
  // door refuses it with the spec's own `checkListViewChartBinding` (its issue at
  // `chart`, or at the bag block's missing binding keys), the same document the
  // spec's list view refuses — ⛔ never at the view filter, which is this card's.
  it.each([
    ['a chart whose legacy `options.chart` bag binds no dataset, with a view filter', { viewType: 'chart', options: { chart: OBJECT_BAG }, filter: VIEW_FILTER }, 'unbound'],
    ['a chart view declaring no block, with a view filter', { viewType: 'chart', filter: VIEW_FILTER }, 'unbound'],
    ['a dataset-bound chart with no view filter', { viewType: 'chart', chart: DATASET_BLOCK }, 'parses'],
    ['a dataset-bound chart with an EMPTY view filter', { viewType: 'chart', chart: DATASET_BLOCK, filter: [] }, 'parses'],
    [
      'a grid that offers a switch to a dataset chart, with a view filter (the filter scopes the grid)',
      { viewType: 'grid', chart: DATASET_BLOCK, appearance: { allowedVisualizations: ['grid', 'chart'] }, filter: VIEW_FILTER },
      'parses',
    ],
  ] as const)('%s', (_label, extra, pageDoor) => {
    const [component, page] = bothDoors(node(extra));
    expect(issuesOf(component)).toEqual([]);
    expect(component.success).toBe(true);
    if (pageDoor === 'parses') {
      expect(issuesOf(page)).toEqual([]);
      expect(page.success).toBe(true);
      return;
    }
    const issues = issuesOf(page);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every(({ code, path }) => code === 'custom' && (path === 'chart' || path.startsWith('options.chart.')))).toBe(true);
    expect(issues.some(({ path }) => path === 'filter' || path === 'filters')).toBe(false);
    // Lit control: the spec's own list view refuses the same document (the spec requires
    // `columns`). Read only where the document is spec-shaped: the spec's authoring list
    // view declares no legacy `options` bag at all.
    const { viewType, ...rest } = extra as Record<string, unknown>;
    if ('options' in rest) return;
    const spec = SpecListViewSchema.safeParse({ ...rest, type: viewType, columns: ['name'] });
    expect(spec.success).toBe(false);
    expect(spec.error!.issues.map((i) => i.path.join('.')).sort()).toEqual(issues.map(({ path }) => path).sort());
  });
});
