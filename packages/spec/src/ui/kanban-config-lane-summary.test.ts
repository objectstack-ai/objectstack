// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36370 — the board's own view settings: `kanban.summary` (the lane
 * foot statistic), `showFieldLabels` and `hideEmptyFields`.
 *
 * Legs: the three keys are members of the bare block and of a list view's
 * `kanban` block; absence writes nothing (no spec default, so a stored view is
 * unchanged); `summary` takes `none`, `count`, and the `sum`, `avg`, `min`
 * and `max` of a named field (objectstack#36520: the server lane read answers
 * all four over every record of the lane), and refuses an aggregate without its
 * field and any other calculation. Whether the field's type takes the aggregate
 * is judged against the object by `@objectstack/lint`
 * (`validate-list-view-field-refs`), which pins it.
 */

import { describe, it, expect } from 'vitest';
import { KanbanConfigSchema, KanbanLaneSummarySchema, ListViewSchema } from './view.zod';

const BOARD = { groupByField: 'stage', columns: ['name'] } as const;

describe('KanbanConfigSchema: the lane statistic and the two card toggles', () => {
  it('accepts the three keys on the bare block and on a list view\'s block', () => {
    const block = { ...BOARD, summary: { type: 'sum', field: 'amount' }, showFieldLabels: false, hideEmptyFields: false };
    expect(KanbanConfigSchema.parse(block)).toMatchObject(block);
    const view = ListViewSchema.parse({ type: 'kanban', data: { provider: 'object', object: 'deal' }, columns: ['name'], kanban: block });
    expect(view.kanban).toMatchObject(block);
  });

  it('writes nothing when the keys are absent', () => {
    const parsed = KanbanConfigSchema.parse(BOARD);
    for (const key of ['summary', 'showFieldLabels', 'hideEmptyFields']) expect(parsed).not.toHaveProperty(key);
  });

  it('takes none, count and a field\'s sum, average, minimum and maximum', () => {
    for (const summary of [
      { type: 'none' },
      { type: 'count' },
      { type: 'sum', field: 'amount' },
      { type: 'avg', field: 'amount' },
      { type: 'min', field: 'amount' },
      { type: 'max', field: 'amount' },
    ]) {
      expect(KanbanLaneSummarySchema.safeParse(summary).success, JSON.stringify(summary)).toBe(true);
    }
  });

  it('refuses what the board does not compute, an aggregate without its field, and a stray key', () => {
    for (const summary of [
      { type: 'count_unique', field: 'amount' },
      { type: 'median', field: 'amount' },
      { type: 'sum' },
      { type: 'sum', field: '' },
      { type: 'avg' },
      { type: 'min', field: '' },
      { type: 'max' },
      { type: 'avg', field: 'amount', extra: true },
      { type: 'count', field: 'amount' },
      'sum',
    ]) {
      expect(KanbanLaneSummarySchema.safeParse(summary).success, JSON.stringify(summary)).toBe(false);
    }
  });
});
