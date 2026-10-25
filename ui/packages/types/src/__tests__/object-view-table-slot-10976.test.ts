/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10976 — the `object-view` `table` slot types only the grid keys the
 * view hands its grid, so a withheld key is a COMPILE error on the authoring
 * face, not a silent no-op.
 *
 * Before this card the slot declared every `ObjectGridSchema` member but the
 * two identity keys, and `ObjectView` handed its grid a fraction of them:
 * `table: { editable: true }` type-checked and did nothing. The relayed half is
 * pinned from the renderer's side
 * (`plugin-view/src/__tests__/ObjectView.tableSlotRelay-10976.test.tsx`); the
 * withheld set, and the zod twin's by-name refusal of every member of it, are
 * pinned by `object-view-slot-key-lists.test.ts`. What only THIS file can say
 * is what an author's `tsc` answers: the `@ts-expect-error` lines below are the
 * assertion, and `pnpm --filter @object-ui/types type-check` (whose
 * `tsconfig.test.json` compiles this file) fails when one of them stops being
 * an error — an unused directive is itself an error.
 *
 * The slot is a `Pick` with NO string index signature, so an unknown member of
 * a fresh literal is refused by excess-property checking (TS2353). That is what
 * makes deletion from the key list loud here, where on a `BaseSchema` carrier
 * it would be silent.
 */

import { describe, it, expect } from 'vitest';
import type { ObjectViewSchema } from '../objectql';

describe('objectui#10976 — a withheld `table` key does not type-check', () => {
  it('one key per withheld reason is a compile error on an `object-view` literal', () => {
    const views: ObjectViewSchema[] = [
      // `ObjectGrid` has no read of these two, the card's named pair.
      // @ts-expect-error — `emptyState` is withheld from the table slot.
      { type: 'object-view', objectName: 'task', table: { emptyState: { title: 'Nothing here' } } },
      // @ts-expect-error — `showFilters` is withheld from the table slot.
      { type: 'object-view', objectName: 'task', table: { showFilters: true } },
      // The view owns its record source and its row click.
      // @ts-expect-error — `data` is withheld from the table slot.
      { type: 'object-view', objectName: 'task', table: { data: { provider: 'value', items: [] } } },
      // @ts-expect-error — `onNavigate` is withheld from the table slot.
      { type: 'object-view', objectName: 'task', table: { onNavigate: () => undefined } },
      // A node-level `BaseSchema` key: the view's grid is no schema node.
      // @ts-expect-error — `hidden` is withheld from the table slot.
      { type: 'object-view', objectName: 'task', table: { hidden: true } },
      // A legacy alias of a relayed key.
      // @ts-expect-error — `batchActions` is withheld; write `bulkActions`.
      { type: 'object-view', objectName: 'task', table: { batchActions: ['archive'] } },
    ];
    expect(views).toHaveLength(6);
  });

  it('LIT CONTROL: the keys the view hands its grid type-check on the same literal shape', () => {
    // Green before and after this card for the keys read by name (`columns`,
    // `pagination`); the relayed ones were typed before too — what changed is
    // that they now reach the grid. A withheld-key directive above that went
    // unused would be reported by the same compile that accepts these.
    const view: ObjectViewSchema = {
      type: 'object-view',
      objectName: 'task',
      table: {
        columns: ['subject', 'stage'],
        pagination: { pageSize: 25 },
        editable: true,
        singleClickEdit: true,
        frozenColumns: 1,
        rowHeight: 'short',
        bulkActions: ['archive'],
        showSearch: false,
      },
    };
    expect(view.table?.editable).toBe(true);
  });
});
