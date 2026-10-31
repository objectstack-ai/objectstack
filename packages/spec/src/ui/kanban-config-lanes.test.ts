// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `kanban.lanes` — the lanes a board draws, in order, as stored option values
 * of `groupByField`.
 *
 * Legs: the key is a MEMBER on both doors an author reaches (the bare block
 * and a list view's `kanban` block), its order survives the parse, absence
 * writes nothing, and the two shapes that can never name a real lane are
 * refused at the key: an empty list, and a display label in place of the
 * stored value. Membership in `groupByField`'s options and a repeated value
 * are judged against the object by `@objectstack/lint`
 * (`validate-list-view-field-refs`), which pins them.
 */

import { describe, it, expect } from 'vitest';
import { KanbanConfigSchema, ListViewSchema } from './view.zod';

const BOARD = { groupByField: 'status', columns: ['subject'] } as const;

/** The HotCRM task board shape: the view filters out completed tasks. */
const TASK_BOARD = {
  type: 'kanban',
  data: { provider: 'object', object: 'crm_task' },
  columns: ['subject', 'priority'],
  filter: [{ field: 'is_completed', operator: 'equals', value: false }],
} as const;

describe('KanbanConfigSchema.lanes', () => {
  it('accepts an ordered lane list as a member and keeps its order', () => {
    // CONTROL — the parser refuses an unknown key on this very block.
    const control = KanbanConfigSchema.safeParse({ ...BOARD, zzUnlikelyBogusKey__: true });
    expect(control.success).toBe(false);
    expect(JSON.stringify(control.error?.issues)).toContain('unrecognized_keys');

    const lanes = ['in_progress', 'not_started', 'waiting'];
    const parsed = KanbanConfigSchema.parse({ ...BOARD, lanes });
    expect(parsed.lanes).toEqual(lanes);
  });

  it('is accepted inside a list view, the shape a stored board takes', () => {
    const result = ListViewSchema.safeParse({
      ...TASK_BOARD,
      kanban: { ...BOARD, lanes: ['not_started', 'in_progress', 'waiting'] },
    });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    expect(result.data?.kanban?.lanes).toEqual(['not_started', 'in_progress', 'waiting']);
  });

  it('writes nothing when omitted, so a board stored before the key parses unchanged', () => {
    const parsed = KanbanConfigSchema.parse(BOARD);
    expect('lanes' in parsed).toBe(false);
  });

  it('refuses an empty list at the key (omitting the key is what draws every option)', () => {
    const result = KanbanConfigSchema.safeParse({ ...BOARD, lanes: [] });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path[0] === 'lanes');
    expect(issue?.code).toBe('too_small');
  });

  it('refuses a display label in place of the stored option value', () => {
    const result = KanbanConfigSchema.safeParse({ ...BOARD, lanes: ['not_started', 'In Progress'] });
    expect(result.success).toBe(false);
    const issues = result.error!.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['lanes', 1]);
    expect(issues[0].code).toBe('invalid_format');
  });
});
