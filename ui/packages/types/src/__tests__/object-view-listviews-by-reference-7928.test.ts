/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#7928 — `ObjectViewSchema.listViews` is the protocol's named-view
 * record BY REFERENCE (maintainer ruling A, comment 5565628927; director ruling
 * on `options`, comment 5856694523).
 *
 * The measurement that made this the natural pin is objectui#7928 comment
 * 5708219442: every alias refusal the list-view vocabulary declares stopped at
 * `listViews`, because the key was unmirrored and the document rode
 * `.passthrough()`. The objectui#8365 stray `kanban.groupBy` was REFUSED on a
 * `list-view` document and ACCEPTED inside a named view. With the record mirrored
 * it is refused in both places, by name, and a spec-shaped control beside it
 * parses green, so the refusal is a reading of that key and not of a closed door.
 */
import { describe, it, expect } from 'vitest';
import { ObjectViewSchema } from '../zod/objectql.zod';
import { safeValidateSchema } from '../zod/index.zod';

/** A spec-shaped kanban named view: `columns` at the top and inside the block. */
const KANBAN_VIEW = {
  label: 'Board',
  type: 'kanban',
  columns: ['name', 'stage'],
  kanban: { groupByField: 'stage', columns: ['name'] },
} as const;

const doc = (view: Record<string, unknown>) => ({ type: 'object-view', objectName: 'deal', listViews: { v1: view } });

type Issue = { code?: string; path?: readonly PropertyKey[]; keys?: readonly string[] };
const issuesOf = (r: { success: boolean; error?: { issues: readonly unknown[] } }): Issue[] =>
  (r.success ? [] : (r.error!.issues as Issue[]));
const at = (issues: Issue[], path: string) => issues.filter((i) => (i.path ?? []).join('.') === path);

describe('objectui#7928 — `listViews.v1.kanban.groupBy` is refused BY NAME, beside an accepted spec-shaped control', () => {
  it('CONTROL: the spec-shaped kanban named view parses green, directly and through the union door', () => {
    const direct = ObjectViewSchema.safeParse(doc(KANBAN_VIEW));
    expect(direct.success, JSON.stringify(issuesOf(direct))).toBe(true);
    const union = safeValidateSchema(doc(KANBAN_VIEW));
    expect(union.success, JSON.stringify(issuesOf(union))).toBe(true);
  });

  it('the stray `groupBy` inside that same block is refused `unrecognized_keys` AT `listViews.v1.kanban`, naming the key', () => {
    const view = { ...KANBAN_VIEW, kanban: { ...KANBAN_VIEW.kanban, groupBy: 'stage' } };
    for (const r of [ObjectViewSchema.safeParse(doc(view)), safeValidateSchema(doc(view))]) {
      expect(r.success).toBe(false);
      const refusals = at(issuesOf(r), 'listViews.v1.kanban').filter((i) => i.code === 'unrecognized_keys');
      expect(refusals).toHaveLength(1);
      expect(refusals[0].keys).toEqual(['groupBy']);
    }
  });

  it('the legacy `options` bag is refused `unrecognized_keys` AT the named view, naming `options` (director ruling, Q1 A)', () => {
    const view = { ...KANBAN_VIEW, options: { kanban: { groupByField: 'stage' } } };
    for (const r of [ObjectViewSchema.safeParse(doc(view)), safeValidateSchema(doc(view))]) {
      expect(r.success).toBe(false);
      const refusals = at(issuesOf(r), 'listViews.v1').filter((i) => i.code === 'unrecognized_keys');
      expect(refusals).toHaveLength(1);
      expect(refusals[0].keys).toEqual(['options']);
    }
  });

  it('a named view without `columns` is refused AT `listViews.v1.columns` — the protocol requires it', () => {
    const { columns: _columns, ...noColumns } = KANBAN_VIEW;
    const r = ObjectViewSchema.safeParse(doc(noColumns));
    expect(r.success).toBe(false);
    expect(at(issuesOf(r), 'listViews.v1.columns').length).toBeGreaterThan(0);
  });

  it('no default is written into the parsed named view — the import boundary strips the protocol\'s (objectui#8317)', () => {
    // `ObjectListViewSchema` defaults `type` to `grid`; the mirror authors no
    // default, so a view that omits `type` comes back without one.
    const r = ObjectViewSchema.safeParse(doc({ label: 'All', columns: ['name'] }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.listViews?.v1).toEqual({ label: 'All', columns: ['name'] });
  });
});
