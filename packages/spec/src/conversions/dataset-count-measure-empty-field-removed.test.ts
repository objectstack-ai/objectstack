// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { MIGRATIONS_BY_MAJOR } from '../migrations/registry.js';
import { DatasetSchema } from '../ui/dataset.zod.js';
import { applyConversions } from './apply.js';
import { ALL_CONVERSIONS, CONVERSIONS_BY_MAJOR } from './registry.js';
import { applyConversionsToStoredItem } from './stored.js';
import type { ConversionNotice, ConversionTodoNotice } from './types.js';

/**
 * [#21220] `dataset-count-measure-empty-field-removed` — the D2 half of the
 * dataset `field` narrowing: the one sub-shape with a working row and a
 * lossless repair.
 *
 * A dataset measure's `field` is a column reference, so `''` is refused at
 * parse. A `count` measure with `field: ''` (the shape Studio's dataset
 * inspector stores when the Field box is left blank) parsed before, the
 * dataset door skipped it, and it compiled to the row count on SQLite's native
 * path. Dropping the key compiles it to `COUNT(*)`, the same row count.
 *
 * The fixture pair in `conversions.test.ts` proves before → after over the
 * whole table. This file pins it on a STORED row, the seam that replays it:
 * the key is dropped and the row then parses; everything outside the
 * sub-shape is the same reference and stays refused where it was.
 */

const ID = 'dataset-count-measure-empty-field-removed';
const D3_ID = 'dataset-member-field-expression-refused';

function storedDataset(measures: unknown[], dimensions: unknown[] = [{ name: 'stage', field: 'stage' }]) {
  return { name: 'deal_metrics', label: 'Deal Metrics', object: 'deal', dimensions, measures };
}

function convertStored(row: Record<string, unknown>) {
  const notices: ConversionNotice[] = [];
  const todos: ConversionTodoNotice[] = [];
  const item = applyConversionsToStoredItem('dataset', row, {
    onNotice: (n) => notices.push(n),
    onTodo: (t) => todos.push(t),
  });
  return { item, notices: notices.filter((n) => n.conversionId === ID), allNotices: notices, todos };
}

function fieldIssuePaths(row: unknown): string[] {
  const r = DatasetSchema.safeParse(row);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.')).filter((p) => p.endsWith('field'));
}

describe('[#21220] dataset-count-measure-empty-field-removed (ADR-0087 D2)', () => {
  it('is registered for protocol 18, retired from the authoring load path, and linked from its D3 entry', () => {
    const entry = ALL_CONVERSIONS.find((c) => c.id === ID);
    expect(entry, 'the conversion is registered').toBeDefined();
    expect(entry!.toMajor).toBe(18);
    expect(entry!.retiredFromLoadPath).toBe(true);
    expect(CONVERSIONS_BY_MAJOR[18]!.map((c) => c.id)).toContain(ID);
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain(ID);
    const d3 = MIGRATIONS_BY_MAJOR[18]!.semantic.find((s) => s.id === D3_ID);
    expect(d3?.conversionIds).toEqual([ID]);
  });

  it('a stored count measure with `field: \'\'` loses the key, and the row then parses', () => {
    const row = storedDataset([
      { name: 'deal_count', aggregate: 'count', field: '' },
      { name: 'won_count', aggregate: 'count', field: '', filter: { stage: 'won' } },
    ]);
    expect(fieldIssuePaths(row), 'refused before the replay').toEqual(['measures.0.field', 'measures.1.field']);
    const { item, notices, todos } = convertStored(row);
    const measures = (item as typeof row).measures as Array<Record<string, unknown>>;
    expect(measures).toEqual([
      { name: 'deal_count', aggregate: 'count' },
      { name: 'won_count', aggregate: 'count', filter: { stage: 'won' } },
    ]);
    expect(notices.map((n) => [n.path, n.from, n.to])).toEqual([
      ['datasets[0].measures[0].field', 'field', '(removed)'],
      ['datasets[0].measures[1].field', 'field', '(removed)'],
    ]);
    expect(todos).toEqual([]);
    expect(DatasetSchema.safeParse(item).success, 'parses after the replay').toBe(true);
  });

  it('control: outside the sub-shape a row is the same reference — a sum or a dimension over `\'\'` stays refused', () => {
    const rows = [
      storedDataset([{ name: 'blank_sum', aggregate: 'sum', field: '' }]),
      storedDataset([{ name: 'row_count', aggregate: 'count' }], [{ name: 'blank_axis', field: '' }]),
      storedDataset([{ name: 'star_count', aggregate: 'count', field: '*' }]),
      storedDataset([{ name: 'row_count', aggregate: 'count' }]),
      storedDataset([{ name: 'owner_count', aggregate: 'count', field: 'owner' }]),
      storedDataset([{ name: 'padded_count', aggregate: 'count', field: ' ' }]),
      storedDataset([{ name: 'expr_count', aggregate: 'count', field: 'COUNT(*)' }]),
    ];
    for (const row of rows) {
      const { item, allNotices, todos } = convertStored(row);
      expect(item, JSON.stringify(row.measures)).toBe(row);
      expect(allNotices).toEqual([]);
      expect(todos).toEqual([]);
    }
    expect(fieldIssuePaths(rows[0])).toEqual(['measures.0.field']);
    expect(fieldIssuePaths(rows[1])).toEqual(['dimensions.0.field']);
  });

  it('is idempotent — the converted result replays to itself with no second notice', () => {
    const once = applyConversions(
      { datasets: [storedDataset([{ name: 'deal_count', aggregate: 'count', field: '' }])] },
      { includeRetired: true },
    );
    const notices: ConversionNotice[] = [];
    const twice = applyConversions(once, { includeRetired: true, onNotice: (n) => notices.push(n) });
    expect(twice).toBe(once);
    expect(notices).toEqual([]);
  });
});
