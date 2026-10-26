/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8176 — the MEMBER shape of `object-kanban`'s `filter` is ObjectQL's,
 * and this board neither reads inside it nor rewrites it.
 *
 * ## Why this file exists
 *
 * objectui#8186 declared `filter` on the four `plugin-kanban` registrations
 * (`{ name: 'filter', type: 'array' }`), which is the DECLARATION half of
 * objectui#7712 and is pinned next door in `filterIsDeclaredInput-7712.test.ts`.
 * That file asserts the key is discoverable — the html tier accepts it, the
 * registry publishes it, and `ComponentPropsMap` does not reject it. It says
 * nothing whatever about what is INSIDE the array, and it cannot: its spec row
 * is a KEY verdict (`filter` is absent from `unrecognized_keys`), which is the
 * right assertion for a discoverability claim and the wrong one for a member
 * claim.
 *
 * The member direction is the one objectui#8068 built and objectui#8176 turned
 * on for this block. Its criterion: some file must constrain the member shape
 * the RENDERER READS, so that a registration declaring `array` while the code
 * reads members as something else goes red. This is that file.
 *
 * ## What the member contract actually is here, measured
 *
 * When this file was written, `@objectstack/spec`'s
 * `ComponentPropsMap['object-kanban'].filter` was `z.unknown().optional()`. The
 * installed row now types the AUTHORED value as the `ViewFilterRule` array
 * `[{ field, operator, value }]`, refusing the record and the array-of-arrays
 * forms, and `@object-ui/types` takes that member by reference (objectui#6152
 * round 8). That fixes what an author may write; it says nothing about what
 * the board does with a value once it reaches the node. What constrains that
 * is the wire: `ObjectKanban.tsx` passes the value it holds to
 * `dataSource.find` as `$filter`, verbatim, and nothing between the schema and
 * that call reads a member key. This block's entire obligation is therefore to
 * add nothing to the value and subtract nothing from it, whichever form
 * reaches it (a host composes the array-of-arrays form at runtime).
 *
 * A pass-through is a member claim, not the absence of one. Its negation is
 * concrete and this repo has shipped it TWICE:
 *
 *   - objectui#4034 — `ObjectMap` probed `schema.filter` for a `map` key and
 *     returned it as configuration. `'map' in filter` is TRUE for every ARRAY
 *     (`Array.prototype.map`), so authors writing the correct member shape were
 *     silently reconfigured.
 *   - objectui#7711 — `ObjectCalendar` did the same with a `calendar` key, one
 *     view over, and the same authored object still went to `$filter`: one key
 *     read twice with two incompatible meanings.
 *
 * Both were defects INSIDE the members of an array-armed input that every other
 * direction of the parity gate reads as green. The calendar twin of this file
 * (`plugin-calendar/src/__tests__/ObjectCalendar.filterIsNotAConfigSlot-7711.test.tsx`)
 * is the pin objectui#7711 left behind and is registered as
 * `object-calendar.filter`'s member pin. `object-kanban` had no equivalent,
 * which is the gap this file closes rather than a defect it fixes: the board is
 * correct today and these rows are what keep it correct.
 *
 * ## The rows, and what makes each a reading
 *
 *   1. IDENTITY — the array the author wrote is the array that reaches
 *      `$filter`, `toBe` and not merely `toEqual`. Identity is the assertion
 *      that catches a rewrite no deep-equal can see: a normalising pass that
 *      rebuilt equal members would satisfy `toEqual` and would mean this block
 *      HAD a member contract of its own after all.
 *   2. OPAQUE MEMBERS — a condition on a field literally named `columns`
 *      (this block's own configuration key) is still a filter. That is
 *      objectui#7711's core case transposed: the member is not offered to any
 *      configuration read, and the board renders from its declared `columns`.
 *   3. BOTH MEMBER FORMS — the triple-object form the query builders emit and
 *      the array-of-arrays form objectui#4034 measured on the map both survive
 *      identically, so the pass-through is not accidentally shape-specific.
 *   4. THE CONTROL — an absent `filter` reaches the wire as `undefined` rather
 *      than as a fabricated default. Without it, every `$filter` assertion above
 *      could be satisfied by a board that always forwards whatever it is given
 *      including nothing, and the reader could not tell a pass-through from a
 *      coincidence.
 *
 * Every row waits for a REAL `find` call before asserting, so "zero queries"
 * can never read as success here — the same non-vacuity discipline
 * `fetchGate.objectDef-6271.test.tsx` states next door.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-kanban`. Module scope, not a hook: the import IS the
// registration (AGENTS.md's test-discipline section).
import '../index';
// The board renders inside `KanbanRenderer`'s `React.lazy` boundary; importing
// the chunk at module scope bills the cold transform to the import phase
// instead of racing a `waitFor` budget (objectui#3010), same specifier as
// `index.tsx`'s factory so ESM's module cache resolves it immediately.
import '../KanbanImpl';

afterEach(cleanup);

const OBJECT = 'deal';

const DEAL_SCHEMA = {
  name: OBJECT,
  label: 'Deal',
  fields: {
    name: { type: 'text', label: 'Name' },
    status: { type: 'text', label: 'Status' },
    // A field whose NAME collides with this block's own configuration key, so
    // row 2 can put a legitimate condition on it.
    columns: { type: 'text', label: 'Columns' },
  },
};

const ROWS = [{ id: 'd1', name: 'Q3 renewal', status: 'open' }];

function makeAdapter(): Record<string, any> {
  return {
    find: vi.fn(async () => ({ data: ROWS })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => DEAL_SCHEMA),
  };
}

/** The declared board configuration, identical across every case below. */
const BOARD = {
  type: 'object-kanban',
  objectName: OBJECT,
  groupBy: 'status',
  columns: [{ id: 'open', title: 'Open' }],
};

function renderBoard(adapter: Record<string, any>, filter?: unknown) {
  return render(
    <SchemaRendererProvider dataSource={adapter as any}>
      <SchemaRenderer
        schema={(filter === undefined ? BOARD : { ...BOARD, filter }) as any}
      />
    </SchemaRendererProvider>,
  );
}

/** The query parameters of the most recent `find`, after waiting for one. */
async function lastFindParams(adapter: Record<string, any>): Promise<any> {
  await waitFor(() => expect(adapter.find).toHaveBeenCalled());
  const calls = adapter.find.mock.calls;
  return calls[calls.length - 1][1] ?? {};
}

describe('objectui#8176 — `object-kanban`\'s `filter` members reach `$filter` untouched', () => {
  it('forwards the authored array BY IDENTITY, not merely by value', async () => {
    const adapter = makeAdapter();
    const authoredFilter = [{ field: 'status', operator: 'eq', value: 'open' }];

    renderBoard(adapter, authoredFilter);
    const params = await lastFindParams(adapter);

    // `toBe`, deliberately. A normalising pass that rebuilt equal members would
    // satisfy `toEqual` while meaning this block reads its members after all —
    // which is the claim this pin exists to refuse.
    expect(params.$filter).toBe(authoredFilter);
    expect(adapter.find.mock.calls[0][0]).toBe(OBJECT);
  });

  it('treats a condition on a field named `columns` as a FILTER, never as configuration', async () => {
    // objectui#7711's core case, transposed to this block: one authored key
    // must not be read twice with two meanings. `columns` is `object-kanban`'s
    // own configuration key, so a probe that looked inside members for it would
    // have exactly the retired `filter.calendar` / `filter.map` shape.
    const adapter = makeAdapter();
    const authoredFilter = [{ field: 'columns', operator: 'eq', value: 'team' }];

    const { container } = renderBoard(adapter, authoredFilter);
    const params = await lastFindParams(adapter);

    expect(params.$filter).toBe(authoredFilter);
    // The configuration half: the board still reads its DECLARED `columns`, so
    // the filter member was never offered to a configuration read.
    await waitFor(() => expect(container.textContent).toContain('Open'));
  });

  it('passes the array-of-arrays member form through identically — the shape objectui#4034 measured', async () => {
    const adapter = makeAdapter();
    const authoredFilter = [['status', '=', 'open']];

    renderBoard(adapter, authoredFilter);
    const params = await lastFindParams(adapter);

    expect(params.$filter).toBe(authoredFilter);
  });

  it('CONTROL: an unauthored `filter` reaches the wire as `undefined`, not as a fabricated default', async () => {
    // Without this row the three above could all be satisfied by a board that
    // forwards whatever it holds — including a default it invented — and the
    // pass-through claim would not be distinguishable from a coincidence.
    const adapter = makeAdapter();

    renderBoard(adapter);
    const params = await lastFindParams(adapter);

    expect(params.$filter).toBeUndefined();
    // Non-vacuity for the line above: the call really happened and really
    // carried the row cap, so `undefined` is a verdict about `$filter` rather
    // than a read of an empty parameter object.
    expect(params.$top).toBeGreaterThan(0);
  });
});
