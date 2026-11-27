// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36423 — `kanban.cardFooter`: the counts a card shows at its foot
 * (its open comment threads, its attachments).
 *
 * Legs: the key is a member of the bare block and of a list view's `kanban`
 * block; absence writes nothing, nor does an absent member (no spec default,
 * so a stored view is unchanged); each member is a boolean; an unknown member
 * (a later foot item no reader draws, or a misspelling) is refused by name.
 */

import { describe, it, expect } from 'vitest';
import { KanbanConfigSchema, ListViewSchema } from './view.zod';

const BOARD = { groupByField: 'stage', columns: ['name'] } as const;

describe('KanbanConfigSchema: the card footer counts', () => {
  it('accepts the key on the bare block and on a list view\'s block', () => {
    const block = { ...BOARD, cardFooter: { comments: true, attachments: false } };
    expect(KanbanConfigSchema.parse(block)).toMatchObject(block);
    const view = ListViewSchema.parse({ type: 'kanban', data: { provider: 'object', object: 'deal' }, columns: ['name'], kanban: block });
    expect(view.kanban).toMatchObject(block);
  });

  it('writes nothing when the key or a member is absent', () => {
    expect(KanbanConfigSchema.parse(BOARD)).not.toHaveProperty('cardFooter');
    const parsed = KanbanConfigSchema.parse({ ...BOARD, cardFooter: { comments: true } });
    expect(parsed.cardFooter).toEqual({ comments: true });
    expect(KanbanConfigSchema.parse({ ...BOARD, cardFooter: {} }).cardFooter).toEqual({});
  });

  it('refuses a member that is not a boolean, and an unknown member by name', () => {
    expect(KanbanConfigSchema.safeParse({ ...BOARD, cardFooter: { comments: 'yes' } }).success).toBe(false);
    expect(KanbanConfigSchema.safeParse({ ...BOARD, cardFooter: true }).success).toBe(false);
    const unknown = KanbanConfigSchema.safeParse({ ...BOARD, cardFooter: { timeInColumn: true } });
    expect(unknown.success).toBe(false);
    expect(JSON.stringify(unknown.error?.issues)).toContain('timeInColumn');
  });
});
