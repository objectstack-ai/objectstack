/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4869 — `ObjectView`'s non-grid fetch lowers its sort through the
 * shared sink, so the authored spelling stops reaching `$orderby` raw.
 *
 * ## Not an observation — a live `400 INVALID_SORT`
 *
 * The card that opened this was filed observation-class ("no user can hit
 * wrong behaviour today"). That framing was measured FALSE and the maintainer
 * ruling of 2026-08-22 re-grades it a bug. The defect:
 *
 * `table.defaultSort` is declared a SINGLE `{ field, order }` object
 * (`ObjectGridSchema.defaultSort`, `packages/types/src/objectql.ts`), and this
 * effect handed it to `$orderby` verbatim. `QueryParams['$orderby']` declares
 * four shapes, one of which is `Record<field, direction>` — so the adapter's
 * serializer reads that object as a MAP and folds it with `Object.entries`:
 *
 *     { field: 'created', order: 'asc' }   ->   wire sort=`field,order`
 *
 * Two columns that do not exist. That map branch is not in dispute and is
 * pinned in its own home (`data-objectstack/src/orderby-serialization.test.ts`
 * pins `{ name: 'asc', age: 'desc' }` -> `name,-age`); the bug is that a
 * SortConfig ever arrived in that slot. The server rejects an unreadable sort
 * rather than ignoring it, `ObjectView`'s catch swallows the 400, and a
 * calendar / kanban / gallery whose only sort was `table.defaultSort` rendered
 * EMPTY — while the SAME metadata sorted correctly as a grid, because
 * `ObjectGrid` lowers the pair (`schemaSort ?? (schema.defaultSort ?
 * [schema.defaultSort] : undefined)`).
 *
 * So the discriminating assertion in this file is on the KEYS of the `$orderby`
 * map: before the fix they were the literal strings `field` and `order`, which
 * is precisely the payload the server answered `400 INVALID_SORT` for. A test
 * of the sink alone cannot see that — the sink already worked; the read site
 * did not call it.
 *
 * ## What was ruled, and what was NOT
 *
 * Option A: lower the legacy member of the pair AT THE READ SITE, then route
 * the whole chain through `convertSortToQueryParams`. Option B — widening the
 * shared sink to accept a bare `{ field, order }` — was REJECTED on the merits:
 * the sink's input slot legitimately also carries `$orderby`'s own
 * `Record<field, direction>` map, in which `{ field: 'desc' }` is a perfectly
 * legal ordering by a column literally named `field`, so a widened sink would
 * have to GUESS. The last test in this file guards that rejection: the sink
 * must still refuse the bare object.
 *
 * The ADR-0049 enforce-or-remove retirement of `table.defaultSort` (the "C
 * half") was deliberately NOT folded in here; it was its own card.
 *
 * ## objectui#5861 — the C half landed, and flipped this file's legacy pins
 *
 * `@objectstack/spec` 17.3.0 turned `ObjectGridProps.defaultSort` into a
 * retired-key tombstone the protocol refuses by name, and objectui#5861
 * removed every renderer read of it at once — including the lowering this
 * file pinned. So the cells that asserted the lowered value (`{ created:
 * 'asc' }`) now assert the key is INERT: no `$orderby` at all. That is still a
 * discriminating assertion against the original defect — the map-shaped
 * `field`/`order` payload cannot come back either — and each flipped cell
 * sits beside a canonical `table.sort` control on the same read site, so
 * "defaultSort no longer sorts" cannot be satisfied by sorting having broken
 * outright. The sink-strictness guard is unchanged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { convertSortToQueryParams, resetRetiredSortSpellingReports } from '@object-ui/core';
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
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: () => <div data-testid="object-grid" />,
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

/**
 * Render the REAL `ObjectView` on a NON-grid path and return the `$orderby` its
 * own fetch sent. `defaultViewType` is anything but `grid`: the grid path
 * delegates its fetch to `ObjectGrid` and never reaches this effect.
 */
async function orderbyFor(schema: Partial<ObjectViewSchema>): Promise<any> {
  const ds = mockDataSource();
  render(
    <ObjectView
      schema={{
        type: 'object-view',
        objectName: 'task',
        defaultViewType: 'calendar',
        ...schema,
      } as ObjectViewSchema}
      dataSource={ds as any}
    />,
  );
  await waitFor(() => expect(ds.find).toHaveBeenCalled());
  return ds.find.mock.calls[0][1].$orderby;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the retired table.defaultSort reaches $orderby in NO shape (objectui#5861)', () => {
  it('sends no $orderby at all — neither the map-shaped `field`/`order` payload nor a lowered column', async () => {
    // Flipped from `sends the field as a COLUMN`, which asserted `{ created:
    // 'asc' }` — objectui#4869's lowering. Before THAT fix this read the two
    // non-existent columns `field` and `order`; after objectui#5861 the key is
    // not read at all, so the query carries no ordering.
    const $orderby = await orderbyFor({
      table: { defaultSort: { field: 'created', order: 'asc' } } as any,
    });
    expect($orderby).toBeUndefined();

    // CONTROL, same read site, same run: the canonical spelling still sorts.
    expect(await orderbyFor({ table: { sort: [{ field: 'created', order: 'asc' }] } as any }))
      .toEqual({ created: 'asc' });
  });

  it('a descending legacy default is inert too — the direction is not what decides it', async () => {
    // Flipped from `carries a descending legacy default through as `desc``.
    expect(await orderbyFor({ table: { defaultSort: { field: 'created', order: 'desc' } } as any }))
      .toBeUndefined();
    // CONTROL — canonical `desc` on the same read site.
    expect(await orderbyFor({ table: { sort: [{ field: 'created', order: 'desc' }] } as any }))
      .toEqual({ created: 'desc' });
  });
});

describe('every other member of the chain reaches $orderby normalized too', () => {
  it('REFUSES the retired string form of table.sort, and says so (objectui#8221)', async () => {
    // `ObjectGridSchema.sort` was `string | SortConfig[]`; decision batch #77
    // retired the string arm, so the shared sink now refuses it instead of
    // lowering it. The type no longer admits it either — `as any` is how a
    // JSON document or a stored metadata row still reaches this read site.
    resetRetiredSortSpellingReports();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await orderbyFor({ table: { sort: 'name desc' } as any })).toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
      const message = String(errorSpy.mock.calls[0][0]);
      // The diagnostic names the array form — a refusal with no prescription
      // just moves the author's problem.
      expect(message).toContain("[{ field: 'name', order: 'desc' }]");
      expect(message).toContain('"name desc"');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('REFUSES a bare field string too — every retired spelling, not just the two-word one', async () => {
    resetRetiredSortSpellingReports();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await orderbyFor({ table: { sort: 'name' } as any })).toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }

    // CONTROL — the array arm of the SAME key on the SAME read site still
    // reaches `$orderby`, so the two refusals above are about the spelling and
    // not a read site that stopped reading `table.sort`.
    expect(await orderbyFor({ table: { sort: [{ field: 'name', order: 'desc' }] } as any }))
      .toEqual({ name: 'desc' });
  });

  it('lowers the canonical SortConfig[] form of table.sort', async () => {
    expect(await orderbyFor({ table: { sort: [{ field: 'name', order: 'desc' }] } as any }))
      .toEqual({ name: 'desc' });
  });

  it('lowers a multi-key named view sort, keeping key order', async () => {
    expect(await orderbyFor({
      listViews: {
        won: {
          label: 'Won',
          type: 'calendar',
          sort: [{ field: 'status', order: 'asc' }, { field: 'name', order: 'desc' }],
        },
      },
      defaultListView: 'won',
    } as any)).toEqual({ status: 'asc', name: 'desc' });
  });

  it('sends NO $orderby when nothing orderable was authored', async () => {
    // The sink returns `undefined`, never `{}` — an empty object is truthy and
    // means "no ordering" only by accident of the serializer.
    expect(await orderbyFor({ table: { title: 'Tasks' } as any })).toBeUndefined();
  });
});

describe('precedence among the sort sources that are still read', () => {
  it('a canonical table.sort decides alone — a retired table.defaultSort beside it has no say', async () => {
    expect(await orderbyFor({
      table: {
        sort: [{ field: 'name', order: 'desc' }],
        defaultSort: { field: 'created', order: 'asc' },
      } as any,
    })).toEqual({ name: 'desc' });
  });

  it('keeps a named view sort ahead of the table segment', async () => {
    expect(await orderbyFor({
      listViews: {
        won: { label: 'Won', type: 'calendar', sort: [{ field: 'name', order: 'desc' }] },
      },
      defaultListView: 'won',
      table: { sort: [{ field: 'created', order: 'asc' }], defaultSort: { field: 'created', order: 'asc' } } as any,
    } as any)).toEqual({ name: 'desc' });
  });
});

describe('the census the card asked for: no spelling regressed on the way in', () => {
  it("carries a `views` prop sort through to the sink, DESCENDING — objectui#5293", async () => {
    // This assertion is the fix. It replaces a pin that asserted
    // `{ name: 'asc' }` for a `direction: 'desc'` fixture — green not because
    // anything worked but because NOTHING read the key, which is exactly the
    // silent wrong answer objectui#5293 was filed about. `ObjectViewProps`
    // now declares `sort?: Array<{ field, order }>`, the one spelling every
    // consumer and the shared sink already read, so the authored direction
    // survives to `$orderby` instead of being dropped on the way in.
    const ds = mockDataSource();
    render(
      <ObjectView
        schema={{ type: 'object-view', objectName: 'task' } as ObjectViewSchema}
        views={[{ id: 'v1', label: 'V1', type: 'calendar', sort: [{ field: 'name', order: 'desc' }] }]}
        dataSource={ds as any}
      />,
    );
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(ds.find.mock.calls[0][1].$orderby).toEqual({ name: 'desc' });
  });

  it('the old `direction` spelling is refused by the declaration, not silently dropped', async () => {
    // The other half of objectui#5293, and the reason the break is worth
    // shipping: a host that still writes the retired spelling must FAIL, and
    // fail at the type boundary rather than by rendering an ascending list.
    // The `@ts-expect-error` IS the assertion — it turns red if the excess
    // property is ever admitted again, which is precisely what a tolerant
    // dual-read (`direction ?? order`) would do. ⛔ objectui#4869 ruled that
    // tolerance layer out; this line is the guard that keeps it out.
    const ds = mockDataSource();
    render(
      <ObjectView
        schema={{ type: 'object-view', objectName: 'task' } as ObjectViewSchema}
        // @ts-expect-error — `direction` is not a key of the sort entry (objectui#5293)
        views={[{ id: 'v1', label: 'V1', type: 'calendar', sort: [{ field: 'name', direction: 'desc' }] }]}
        dataSource={ds as any}
      />,
    );
    // Runtime behaviour of the retired spelling is unchanged and deliberately
    // still asserted: it orders ascending. That is what makes the type error
    // the ONLY failure signal a host gets, and why the changeset names the
    // old key so the break is searchable.
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(ds.find.mock.calls[0][1].$orderby).toEqual({ name: 'asc' });
  });

  it('keeps the sink STRICT — option B was rejected, so a bare SortConfig is still refused', async () => {
    // The guard on where the fix lives. If a later change "simplifies" this by
    // teaching the sink about a bare `{ field, order }`, this turns red: that
    // is the widening the 2026-08-22 ruling rejected, because the same slot
    // legitimately carries `$orderby`'s own map, in which `{ field: 'desc' }`
    // orders by a column literally named `field`.
    expect(convertSortToQueryParams({ field: 'created', order: 'asc' } as any)).toBeUndefined();
    expect(convertSortToQueryParams({ field: 'desc' } as any)).toBeUndefined();

    // ...and the read site no longer closes that gap for the retired key
    // (objectui#5861): on the very same input it sends nothing, rather than
    // lowering the legacy spelling into the canonical one.
    expect(await orderbyFor({ table: { defaultSort: { field: 'created', order: 'asc' } } as any }))
      .toBeUndefined();
  });
});
