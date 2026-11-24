/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36370 — a board's 视图设置 under the #35955 draft rules: each
 * change applies at once, is held as the list's draft (`ListDraft.kanban`, the
 * changed keys only), and is written only by Save.
 *
 * Rows:
 *   (a) `nextKanbanDraft` keeps the keys that differ from the view's own block,
 *       drops a key changed back, and answers `undefined` once nothing differs;
 *       `null` is "absent" (a key the reader removed);
 *   (b) `layKanbanDraft` lays the draft over the block, `null` deleting a key;
 *   (c) Save (`buildPersonalViewConfig` / `layListStateOverView`) writes the
 *       laid block, which the spec's `ListViewSchema` accepts with the new
 *       keys; without a kanban draft the view's block is written as it is;
 *   (d) `kanbanViewOptions` relays `lanes` (objectstack#28211 — the Console
 *       board drew every option before this) and the three new keys, each only
 *       when the view declares it.
 */

import { describe, expect, it } from 'vitest';
import { ListViewSchema } from '@objectstack/spec/ui';
import { layKanbanDraft, nextKanbanDraft } from './listDraftStore';
import { buildPersonalViewConfig, layListStateOverView } from './personalViews';
import { kanbanViewOptions } from './objectViewOptions';

const OWN = {
  groupByField: 'stage',
  columns: ['amount', 'account'],
  lanes: ['new', 'proposal', 'won'],
};

describe('the board draft (objectstack#36370)', () => {
  it('(a) keeps the changed keys, drops one changed back, and is undefined once nothing differs', () => {
    const one = nextKanbanDraft(undefined, { groupByField: 'owner', lanes: null }, OWN);
    expect(one).toEqual({ groupByField: 'owner', lanes: null });

    const two = nextKanbanDraft(one, { showFieldLabels: false }, OWN);
    expect(two).toEqual({ groupByField: 'owner', lanes: null, showFieldLabels: false });

    // Back to the view's own lane field and lanes: only the toggle is left.
    const three = nextKanbanDraft(two, { groupByField: 'stage', lanes: ['new', 'proposal', 'won'] }, OWN);
    expect(three).toEqual({ showFieldLabels: false });

    // The toggle on again is the key absent, as the view has it.
    expect(nextKanbanDraft(three, { showFieldLabels: null }, OWN)).toBeUndefined();
  });

  it('(a) a lane order differs from the view\'s even with the same lanes', () => {
    expect(nextKanbanDraft(undefined, { lanes: ['won', 'new', 'proposal'] }, OWN)).toEqual({
      lanes: ['won', 'new', 'proposal'],
    });
  });

  it('(b) lays the draft over the block, null deleting a key', () => {
    expect(layKanbanDraft(OWN, { lanes: null, summary: { type: 'count' } })).toEqual({
      groupByField: 'stage',
      columns: ['amount', 'account'],
      summary: { type: 'count' },
    });
    expect(layKanbanDraft(undefined, { showFieldLabels: false })).toEqual({ showFieldLabels: false });
    // CONTROL: no draft is the block as it is.
    expect(layKanbanDraft(OWN, undefined)).toEqual(OWN);
  });
});

describe('Save writes the board draft (objectstack#36370)', () => {
  const VIEW = {
    id: 'pipeline',
    name: 'pipeline',
    label: 'Pipeline',
    type: 'kanban',
    columns: ['name', 'stage', 'amount'],
    kanban: OWN,
  };

  it('(c) lays the changed keys over the view\'s block, in a body the spec accepts', () => {
    const draft = nextKanbanDraft(undefined, {
      lanes: ['proposal', 'new'],
      hideEmptyFields: false,
      summary: { type: 'sum', field: 'amount' },
    }, OWN);
    const laid = layListStateOverView(VIEW, { url: {}, display: { kanban: draft } });
    expect(laid.ok).toBe(true);
    if (!laid.ok) return;
    expect(laid.view.kanban).toEqual({
      groupByField: 'stage',
      columns: ['amount', 'account'],
      lanes: ['proposal', 'new'],
      hideEmptyFields: false,
      summary: { type: 'sum', field: 'amount' },
    });

    const built = buildPersonalViewConfig('deal', VIEW, { url: {}, display: { kanban: draft } });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(ListViewSchema.safeParse(built.config).success).toBe(true);
    expect(built.config.kanban).toMatchObject({ hideEmptyFields: false, summary: { type: 'sum', field: 'amount' } });
  });

  it('(c) CONTROL: without a board draft the view\'s block is written as it is', () => {
    const laid = layListStateOverView(VIEW, { url: {} });
    expect(laid.ok && laid.view.kanban).toEqual(OWN);
  });
});

describe('the Console relays the board block (objectstack#36370)', () => {
  const OBJECT = { name: 'deal', fields: { name: { type: 'text' }, stage: { type: 'select' } } };

  it('(d) carries lanes and the new keys when the view declares them', () => {
    const out = kanbanViewOptions({
      kanban: {
        groupByField: 'stage',
        lanes: ['won', 'new'],
        summary: { type: 'count' },
        showFieldLabels: false,
        hideEmptyFields: false,
      },
    }, OBJECT);
    expect(out.lanes).toEqual(['won', 'new']);
    expect(out.summary).toEqual({ type: 'count' });
    expect(out.showFieldLabels).toBe(false);
    expect(out.hideEmptyFields).toBe(false);
  });

  it('(d) omits each key the view does not declare, and an empty lane list', () => {
    const out = kanbanViewOptions({ kanban: { groupByField: 'stage', lanes: [] } }, OBJECT);
    for (const key of ['lanes', 'summary', 'showFieldLabels', 'hideEmptyFields']) {
      expect(out).not.toHaveProperty(key);
    }
    // CONTROL: the bag is not empty.
    expect(out.groupByField).toBe('stage');
  });
});
