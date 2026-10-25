/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5102 — the canonical `table` keys take effect.
 *
 * `ObjectViewSchema.table` is documented as "inherits from ObjectGridSchema",
 * but `ObjectView` does not spread it: it forwards a hand-written whitelist of
 * keys. That whitelist carried only the DEPRECATED half of four pairs, and
 * dropped every canonical successor:
 *
 *   forwarded (legacy)   | canonical successor on ObjectGridSchema | forwarded?
 *   ---------------------|-----------------------------------------|-----------
 *   pageSize             | pagination: PaginationConfig            | NO
 *   selectable           | selection:  SelectionConfig             | NO
 *   defaultFilters       | filter                                  | NO
 *   defaultSort          | sort                                    | NO
 *
 * ⚠️ objectui#5861 RETIRED the fourth pair's legacy half. `defaultSort` is an
 * ADR-0049 tombstone — `@objectstack/spec` 17.3.0 refuses it by name on
 * `object-grid` — and every reader dropped it together: ObjectView no longer
 * forwards it on the grid path, no longer lowers it on the non-grid fetch or
 * into the delegated `renderListView` sort, and ObjectGrid no longer reads it.
 * The cells below that pinned it as a WORKING alias were flipped, not deleted:
 * each now asserts the key is inert on its path, beside a canonical `sort`
 * control on the same path. The other three pairs are untouched.
 *
 * ⚠️ objectui#12030 RETIRED the third pair's legacy half the same way.
 * `@objectstack/spec` 18 tombstones `object-grid.defaultFilters`
 * (objectstack#11509), refusing it by name, and `ObjectView` stopped reading
 * `table.defaultFilters` on all three paths (the grid hand-off, the non-grid
 * fetch, the delegated `renderListView` schema), as `ObjectGrid` stopped
 * reading its own. The cells that pinned it as a working alias were flipped
 * the objectui#5861 way: each asserts the key is inert on its path, beside a
 * canonical `filter` control on the same path.
 *
 * So an author writing the shape the type recommends — `table: { pagination:
 * { pageSize: 25 } }` — got a view that compiled, read correctly, and did
 * NOTHING. There was no failure signal anywhere: the key is declared on
 * `ObjectGridSchema`, `ObjectGrid` reads it, and only this forwarding hop lost
 * it. That silent-success shape is the defect, not the missing feature.
 *
 * Maintainer ruling of 2026-08-18 (verbatim 「同意」): extend the whitelist so
 * the canonical keys take effect, keeping the legacy spellings as WORKING
 * aliases. Both halves are pinned here — a fix that quietly retired the legacy
 * spelling would break every view authored against today's docs.
 *
 * PRECEDENCE, when an author writes both: the canonical key wins. Where
 * `ObjectView` itself resolves the pair (the non-grid fetch, and the delegated
 * `renderListView` schema) that choice is encoded in this file's `||` chains
 * and pinned below. On the grid path `ObjectView` forwards BOTH slots of the
 * pagination and selection pairs and `ObjectGrid` arbitrates canonical-first
 * (`schema.pagination?.pageSize ?? schema.pageSize`; `if (schema.selection
 * ?.type) … else if (schema.selectable !== undefined)`). Synthesising a
 * `pagination` object out of a legacy `pageSize` would flip `ObjectGrid`'s
 * `paginationEnabled` (`schema.pagination !== undefined ? true : …`) for every
 * view that only ever wrote the legacy key.
 *
 * objectui#11880 item 5: the FILTER pair is the exception on the grid path.
 * `ObjectView` resolves it itself and hands the winner in `filter` alone,
 * never writing `defaultFilters`: `ObjectGrid`'s export and page reset read
 * `filter` only, so a value in the legacy slot narrowed the rows but not the
 * download. The precedence is unchanged (the canonical key wins unless it
 * lowers to nothing), and `ObjectView.gridFilterHandoff-11880.test.tsx` reads
 * it through the real grid.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ObjectView } from '../ObjectView';
import type { ObjectViewSchema } from '@object-ui/types';

vi.mock('@object-ui/react', async (importOriginal) => {
  const React = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema }: any) => <div data-testid="schema-renderer">{schema?.type}</div>,
    SchemaRendererContext: React.createContext(null),
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});

/**
 * The grid the view delegates to, replaced by a probe that records the schema
 * it was handed. What reaches this object IS the forwarding whitelist.
 */
const gridSchemas: any[] = [];
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: ({ schema }: any) => {
    gridSchemas.push(schema);
    return <div data-testid="object-grid" />;
  },
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

const mockDataSource = () => ({
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
});

/** Render on the grid path and return the schema ObjectGrid was handed. */
function forwardedGridSchema(schema: Partial<ObjectViewSchema>): any {
  gridSchemas.length = 0;
  render(
    <ObjectView
      schema={{ type: 'object-view', objectName: 'task', ...schema } as ObjectViewSchema}
      dataSource={mockDataSource() as any}
    />,
  );
  return gridSchemas[0];
}

/** Render on a NON-grid path (ObjectView fetches for itself) and return `find`. */
function nonGridFind(schema: Partial<ObjectViewSchema>) {
  const ds = mockDataSource();
  render(
    <ObjectView
      schema={{
        type: 'object-view',
        objectName: 'task',
        // Anything but `grid` — the grid path delegates its fetch to ObjectGrid.
        defaultViewType: 'calendar',
        ...schema,
      } as ObjectViewSchema}
      dataSource={ds as any}
    />,
  );
  return ds.find;
}

async function queryParams(find: ReturnType<typeof vi.fn>) {
  await waitFor(() => expect(find).toHaveBeenCalled());
  return find.mock.calls[0][1];
}

/** Render through the delegated `renderListView` slot and return its schema. */
function delegatedSchema(schema: Partial<ObjectViewSchema>): any {
  const seen: any[] = [];
  render(
    <ObjectView
      schema={{ type: 'object-view', objectName: 'task', ...schema } as ObjectViewSchema}
      dataSource={mockDataSource() as any}
      renderListView={({ schema: s }: any) => { seen.push(s); return <div data-testid="delegated" />; }}
    />,
  );
  return seen[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  gridSchemas.length = 0;
});

describe('grid path: the canonical table keys reach ObjectGrid', () => {
  // Each of these four was `undefined` on the forwarded schema before
  // objectui#5102 — the value the author wrote never left ObjectView.
  it('forwards table.pagination', () => {
    const grid = forwardedGridSchema({ table: { pagination: { pageSize: 25 } } as any });
    expect(grid.pagination).toEqual({ pageSize: 25 });
  });

  it('forwards table.pagination.pageSizeOptions along with it', () => {
    const grid = forwardedGridSchema({
      table: { pagination: { pageSize: 25, pageSizeOptions: [25, 50] } } as any,
    });
    expect(grid.pagination).toEqual({ pageSize: 25, pageSizeOptions: [25, 50] });
  });

  it('forwards table.selection', () => {
    const grid = forwardedGridSchema({ table: { selection: { type: 'multiple' } } as any });
    expect(grid.selection).toEqual({ type: 'multiple' });
  });

  it('forwards table.filter', () => {
    const grid = forwardedGridSchema({ table: { filter: [['stage', '=', 'won']] } as any });
    expect(grid.filter).toEqual([['stage', '=', 'won']]);
  });

  it('forwards table.sort', () => {
    const grid = forwardedGridSchema({ table: { sort: [{ field: 'name', order: 'desc' }] } as any });
    expect(grid.sort).toEqual([{ field: 'name', order: 'desc' }]);
  });

  it('forwards table.sort VERBATIM — even the retired string form (objectui#8221)', () => {
    // `ObjectGridSchema.sort` is `SortConfig[]` since decision batch #77; the
    // string arm is retired. This delegation is nonetheless VALUE-AGNOSTIC and
    // stays that way on purpose: a stored metadata row still reaches it
    // carrying the old spelling, and the place that judges the value is the
    // shared sink downstream (`ObjectView.sortSink.test.tsx` pins the refusal
    // and its diagnostic). Coercing or dropping it here would put a second
    // opinion about the sort dialect in the delegation path — the fourth
    // dialect this whole chain exists to avoid.
    const grid = forwardedGridSchema({ table: { sort: 'name desc' } as any });
    expect(grid.sort).toBe('name desc');
  });
});

describe('grid path: the legacy spellings still work', () => {
  it('still forwards table.pageSize', () => {
    expect(forwardedGridSchema({ table: { pageSize: 25 } as any }).pageSize).toBe(25);
  });

  it('still forwards table.selectable', () => {
    expect(forwardedGridSchema({ table: { selectable: true } as any }).selectable).toBe(true);
  });

  it('no longer reads a retired table.defaultFilters — and does not rescue it into `filter` (objectui#12030)', () => {
    // Flipped from `still honours table.defaultFilters, handed over in
    // `filter`. Neither slot carries it.
    const grid = forwardedGridSchema({ table: { defaultFilters: { status: 'active' } } as any });
    expect(grid.filter).toBeUndefined();
    expect(grid.defaultFilters).toBeUndefined();
    // CONTROL, same path: the canonical spelling still arrives.
    expect(forwardedGridSchema({ table: { filter: [['status', '=', 'active']] } as any }).filter)
      .toEqual([['status', '=', 'active']]);
  });

  it('no longer forwards a retired table.defaultSort — and does not rescue it into `sort` (objectui#5861)', () => {
    // Flipped from `still forwards table.defaultSort`. Neither slot carries it:
    // re-emitting the value into the canonical `sort` would be the tolerant
    // alias the retirement exists to end, just moved one hop.
    const grid = forwardedGridSchema({ table: { defaultSort: { field: 'name', order: 'asc' } } as any });
    expect(grid.defaultSort).toBeUndefined();
    expect(grid.sort).toBeUndefined();
    // CONTROL, same path: the canonical spelling still arrives.
    expect(forwardedGridSchema({ table: { sort: [{ field: 'name', order: 'asc' }] } as any }).sort)
      .toEqual([{ field: 'name', order: 'asc' }]);
  });

  it('leaves a canonical slot empty when only the legacy key is written', () => {
    // The alias must not be re-emitted into the canonical slot: `ObjectGrid`
    // keys `paginationEnabled` off `schema.pagination !== undefined`, so a
    // synthesised `pagination` would turn pagination on for legacy authors.
    const grid = forwardedGridSchema({
      table: { pageSize: 25, selectable: true, defaultFilters: { a: 1 }, defaultSort: { field: 'n', order: 'asc' } } as any,
    });
    expect(grid.pagination).toBeUndefined();
    expect(grid.selection).toBeUndefined();
    expect(grid.sort).toBeUndefined();
    // objectui#12030 — the retired filter alias is not read, so nothing
    // reaches the one filter slot the node carries either.
    expect(grid.filter).toBeUndefined();
    expect(grid.defaultFilters).toBeUndefined();
  });
});

describe('grid path: both spellings written', () => {
  // ObjectView forwards both slots of the pagination and selection pairs and
  // ObjectGrid arbitrates canonical-first (see the file header). The filter
  // pair is resolved here instead (objectui#11880 item 5): the canonical value
  // arrives in `filter` and no `defaultFilters` is written.
  it('puts each canonical value in its slot; the paging aliases ride theirs, the filter alias is not written', () => {
    const grid = forwardedGridSchema({
      table: {
        pagination: { pageSize: 25 },
        pageSize: 10,
        selection: { type: 'multiple' },
        selectable: false,
        filter: [['stage', '=', 'won']],
        defaultFilters: { stage: 'lost' },
        sort: [{ field: 'name', order: 'desc' }],
        defaultSort: { field: 'created', order: 'asc' },
      } as any,
    });
    expect(grid.pagination).toEqual({ pageSize: 25 });
    expect(grid.pageSize).toBe(10);
    expect(grid.selection).toEqual({ type: 'multiple' });
    expect(grid.selectable).toBe(false);
    expect(grid.filter).toEqual([['stage', '=', 'won']]);
    expect(grid.defaultFilters).toBeUndefined();
    expect(grid.sort).toEqual([{ field: 'name', order: 'desc' }]);
    // objectui#5861 — the sort pair has no legacy slot any more: the retired
    // `defaultSort` is dropped, not forwarded beside the canonical value.
    expect(grid.defaultSort).toBeUndefined();
  });
});

describe('grid path: a named view still outranks the table segment', () => {
  // The FILTER segments ahead of `table` (`listViews` entry, then `activeView`)
  // ride `filter` since objectui#11880 item 5, the one filter slot the node
  // carries, so the view's filter must be the value in it: a `table.filter`
  // there would outrank the view the user is looking at.
  //
  // The SORT half moved in objectui#5270 — see the sort assertion below for
  // why, and `ObjectView.namedViewSortArity.test.tsx` for the two consumers
  // that made the old slot unreadable. What is pinned here either way is the
  // PRECEDENCE, which the move preserves: the view still outranks `table`.
  const namedView = {
    listViews: {
      won: {
        label: 'Won',
        filter: [['stage', '=', 'won']],
        sort: [{ field: 'name', order: 'desc' }],
      },
    },
    defaultListView: 'won',
  };

  it('keeps the named view filter in force over a table.filter', () => {
    const grid = forwardedGridSchema({
      ...namedView,
      table: { filter: [['stage', '=', 'lost']] } as any,
    } as any);
    expect(grid.filter).toEqual([['stage', '=', 'won']]);
    expect(grid.defaultFilters).toBeUndefined();
  });

  it('keeps the named view sort in force over a table.sort', () => {
    // objectui#5102 pinned this as `sort: undefined` +
    // `defaultSort: [{ field: 'name', order: 'desc' }]` and said in so many
    // words that the pin should be UPDATED, not deleted, by whoever fixed the
    // arity. Updated here: the array now rides the canonical slot — the only
    // one of the two whose declared type (`SortConfig[]`) can hold more than
    // one key — and the legacy slot carries the `table` segment alone. Precedence is what this block asserts and it is unchanged:
    // ObjectGrid resolves `schemaSort ?? defaultSort`, so the named view wins
    // over `table.sort` because it is what reaches the canonical slot.
    const grid = forwardedGridSchema({
      ...namedView,
      table: { sort: [{ field: 'created', order: 'asc' }] } as any,
    } as any);
    expect(grid.sort).toEqual([{ field: 'name', order: 'desc' }]);
    expect(grid.defaultSort).toBeUndefined();
  });

  it('keeps the named view sort in force, and a retired table.defaultSort beside it is not forwarded (objectui#5861)', () => {
    // This used to assert the `table` segment rode the legacy slot beside the
    // view's canonical one. The legacy slot is gone: the view sort still wins,
    // and the retired key reaches ObjectGrid in neither slot.
    const grid = forwardedGridSchema({
      ...namedView,
      table: { defaultSort: { field: 'created', order: 'asc' } } as any,
    } as any);
    expect(grid.sort).toEqual([{ field: 'name', order: 'desc' }]);
    expect(grid.defaultSort).toBeUndefined();
  });
});

describe('non-grid path: ObjectView resolves the pair itself, canonical first', () => {
  // Calendar / kanban / gallery / timeline fetch through ObjectView, so the
  // precedence chosen for this card is directly observable on the wire here.
  //
  // ⚠️ objectui#4869 REWROTE the three `$orderby` expectations below, and the
  // maintainer ruling of 2026-08-22 authorises exactly that. They used to pin
  // the AUTHORED value reaching `$orderby` VERBATIM — which for the legacy
  // `table.defaultSort` spelling was a live `400 INVALID_SORT`: a single
  // `{ field, order }` object is read by the adapter as an `$orderby` MAP, so
  // `Object.entries` folded it to the wire string `field,order`, two columns
  // that do not exist, and the view came back EMPTY. This read site now lowers
  // the whole chain through the shared sink (`convertSortToQueryParams`), so
  // the assertions moved to the LOWERED value — the same value, in the one
  // normalized shape every other object-bound block already sends.
  //
  // What objectui#5102 put here is NOT weakened by that: each expectation is
  // still an exact `toEqual` on a fully specified map. What changed is the
  // shape they arrive in, which is the defect objectui#4869 fixed. See
  // `ObjectView.sortSink.test.tsx` for the read-site evidence.
  //
  // ⚠️ objectui#5861 then RETIRED the legacy half of the sort pair: the two
  // cells below that pinned `table.defaultSort` as working now pin it inert —
  // no `$orderby` from it alone, and no effect beside a canonical `table.sort`.
  it('queries with a canonical table.filter', async () => {
    const params = await queryParams(nonGridFind({ table: { filter: [['stage', '=', 'won']] } as any }));
    expect(params.$filter).toEqual([['stage', '=', 'won']]);
  });

  it('lowers a ViewFilterRule[] table.filter through the shared sink', async () => {
    // Same treatment the retired `table.defaultFilters` got — the canonical key
    // reaches `$filter` as AST, not as bare rule objects (objectui#3431).
    const params = await queryParams(
      nonGridFind({ table: { filter: [{ field: 'stage', operator: 'eq', value: 'won' }] } as any }),
    );
    expect(params.$filter).toEqual([['stage', 'equals', 'won']]);
  });

  it('queries with table.filter alone when a retired table.defaultFilters is written beside it', async () => {
    const params = await queryParams(
      nonGridFind({
        table: { filter: [['stage', '=', 'won']], defaultFilters: { stage: 'lost' } } as any,
      }),
    );
    expect(params.$filter).toEqual([['stage', '=', 'won']]);
  });

  it('a retired table.defaultFilters alone filters NOTHING (objectui#12030)', async () => {
    // Flipped from `still queries with table.defaultFilters alone`, which
    // asserted `['status', '=', 'active']`. The canonical control is `queries
    // with a canonical table.filter` above, on this same path.
    const params = await queryParams(nonGridFind({ table: { defaultFilters: { status: 'active' } } as any }));
    expect(params.$filter).toBeUndefined();
  });

  it('orders by a canonical table.sort', async () => {
    const params = await queryParams(nonGridFind({ table: { sort: [{ field: 'name', order: 'desc' }] } as any }));
    expect(params.$orderby).toEqual({ name: 'desc' });
  });

  it('orders by table.sort alone when a retired table.defaultSort is written beside it', async () => {
    const params = await queryParams(
      nonGridFind({
        table: { sort: [{ field: 'name', order: 'desc' }], defaultSort: { field: 'created', order: 'asc' } } as any,
      }),
    );
    expect(params.$orderby).toEqual({ name: 'desc' });
  });

  it('a retired table.defaultSort alone orders NOTHING (objectui#5861)', async () => {
    // Flipped from `still orders by table.defaultSort alone`, which asserted
    // `{ created: 'asc' }`. The key is an ADR-0049 tombstone the protocol
    // refuses by name, so this read site no longer lowers it: the query goes
    // out unsorted. The canonical control is `orders by a canonical
    // table.sort` above, on this same path.
    const params = await queryParams(nonGridFind({ table: { defaultSort: { field: 'created', order: 'asc' } } as any }));
    expect(params.$orderby).toBeUndefined();
  });
});

describe('delegated renderListView: canonical first, filter and sort aliases retired', () => {
  it('hands over a canonical table.filter', () => {
    expect(delegatedSchema({ table: { filter: [['stage', '=', 'won']] } as any }).filter)
      .toEqual([['stage', '=', 'won']]);
  });

  it('hands over table.filter alone when a retired table.defaultFilters is written beside it', () => {
    const s = delegatedSchema({
      table: { filter: [['stage', '=', 'won']], defaultFilters: { stage: 'lost' } } as any,
    });
    expect(s.filter).toEqual([['stage', '=', 'won']]);
  });

  it('a retired table.defaultFilters alone hands over no filter (objectui#12030)', () => {
    // Flipped from `still hands over table.defaultFilters alone`. The canonical
    // control is `hands over a canonical table.filter` above.
    expect(delegatedSchema({ table: { defaultFilters: { status: 'active' } } as any }).filter)
      .toBeUndefined();
  });

  it('hands over a canonical table.sort, and a retired table.defaultSort beside it changes nothing', () => {
    const SORT = [{ field: 'name', order: 'desc' }];
    expect(delegatedSchema({ table: { sort: SORT } as any }).sort).toEqual(SORT);
    const s = delegatedSchema({
      table: { sort: SORT, defaultSort: { field: 'created', order: 'asc' } } as any,
    });
    expect(s.sort).toEqual(SORT);
  });

  it('hands over NO sort for a retired table.defaultSort alone (objectui#5861)', () => {
    // Flipped from `still hands over table.defaultSort alone — WRAPPED`, which
    // asserted `[{ field: 'created', order: 'asc' }]` (objectui#6235's wrap of
    // the legacy single entry into the `SortConfig[]` the slot declares). The
    // key is retired, so there is nothing to wrap: the delegated node gets no
    // `sort`, exactly as if none had been authored. Canonical control: the
    // cell above, on this same path.
    expect(delegatedSchema({ table: { defaultSort: { field: 'created', order: 'asc' } } as any }).sort)
      .toBeUndefined();
  });
});
