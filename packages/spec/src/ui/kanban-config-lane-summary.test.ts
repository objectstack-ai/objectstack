// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36370 — the board's own view settings: `kanban.summary` (the lane
 * foot statistic), `showFieldLabels` and `hideEmptyFields`.
 *
 * Legs: the three keys are members of the bare block and of a list view's
 * `kanban` block; absence writes nothing (no spec default, so a stored view is
 * unchanged); `summary` takes only what the board computes, `none`, `count`
 * and the `sum` of a named field, and refuses `avg` / `min` / `max` (which wait
 * for a server lane read) and a `sum` without its field. Whether the field is a
 * number is judged against the object by `@objectstack/lint`
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

  it('takes none, count and a field\'s sum', () => {
    for (const summary of [{ type: 'none' }, { type: 'count' }, { type: 'sum', field: 'amount' }]) {
      expect(KanbanLaneSummarySchema.safeParse(summary).success, JSON.stringify(summary)).toBe(true);
    }
  });

  it('refuses what the board does not compute, a sum without its field, and a stray key', () => {
    for (const summary of [
      { type: 'avg', field: 'amount' },
      { type: 'min', field: 'amount' },
      { type: 'max', field: 'amount' },
      { type: 'count_unique', field: 'amount' },
      { type: 'sum' },
      { type: 'sum', field: '' },
      { type: 'count', field: 'amount' },
      'sum',
    ]) {
      expect(KanbanLaneSummarySchema.safeParse(summary).success, JSON.stringify(summary)).toBe(false);
    }
  });
});
