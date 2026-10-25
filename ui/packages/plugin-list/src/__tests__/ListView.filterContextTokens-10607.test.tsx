/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10607 — a directly authored `list-view` node resolves the spec's
 * context tokens (`{current_user_id}`, `{current_org_id}`) in its OWN filter,
 * through `@object-ui/core`'s ONE shared `resolveFilterPlaceholders`, against
 * the session scope the host provides (`FilterScopeProvider` /
 * `useFilterScope`).
 *
 * Before this change `plugin-list` had zero reads of that resolver, so
 * `filter: [['owner', '=', '{current_user_id}']]` on a `list-view` authored
 * straight into a page went out on `$filter` as the literal token, and the
 * child view it renders was handed the literal too.
 *
 * The list keys its fetch on the filter, so the resolved value must keep its
 * reference while nothing it was computed from has changed: a copy minted on
 * every render would refetch on every render. The stability cells below count
 * `find()` calls across re-renders that change nothing.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import { ComponentRegistry, resolveFilterPlaceholders } from '@object-ui/core';
import { SchemaRendererProvider, FilterScopeProvider } from '@object-ui/react';
import type { DataSource, ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';

const USER = 'usr_42';
const ORG = 'org_7';

const MINE = [['owner', '=', '{current_user_id}']];

/** Held constant, so a re-render that rebuilds the node rebuilds only its filter. */
const COLUMNS = ['name'];

let gridSchemas: Array<{ filter?: unknown }> = [];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [{ id: '1', name: 'Acme', owner: USER }], total: 1 })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text' }, owner: { type: 'text' }, org: { type: 'text' } },
    })),
  };
}

type DS = ReturnType<typeof makeDataSource>;

/** A directly authored `list-view` node — no `object-view` above it. */
function listNode(over: Record<string, unknown>): ListViewSchema {
  return { type: 'list-view', objectName: 'task', columns: COLUMNS, ...over } as unknown as ListViewSchema;
}

function ui(ds: DS, schema: ListViewSchema, user: string | null = USER, org: string | null = ORG) {
  return (
    <FilterScopeProvider currentUserId={user} currentOrgId={org}>
      <SchemaRendererProvider dataSource={ds as unknown as DataSource}>
        <ListView schema={schema} dataSource={ds as unknown as DataSource} />
      </SchemaRendererProvider>
    </FilterScopeProvider>
  );
}

/** The `$filter` of the Nth `find()` the list issued. */
async function queriedFilter(find: DS['find'], call = 0) {
  await waitFor(() => expect(find.mock.calls.length).toBeGreaterThan(call));
  return (find.mock.calls[call] as unknown as [string, { $filter?: unknown }])[1]?.$filter;
}

/** Let every pending effect and resolved promise land. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

let prevObjectGrid: ReturnType<typeof ComponentRegistry.get>;
beforeAll(() => {
  prevObjectGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', (props: { schema: { filter?: unknown } }) => {
    gridSchemas.push(props.schema);
    return <div data-testid="grid-stub" />;
  });
});
afterAll(() => {
  if (prevObjectGrid) ComponentRegistry.register('object-grid', prevObjectGrid);
  else ComponentRegistry.unregister('object-grid');
});

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  gridSchemas = [];
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  warn.mockRestore();
});

describe('list-view — the node’s own filter reaches the query resolved (objectui#10607)', () => {
  it('sends the signed-in user id for {current_user_id}, not the literal token', async () => {
    const ds = makeDataSource();
    render(ui(ds, listNode({ filter: MINE })));
    expect(await queriedFilter(ds.find)).toEqual([['owner', '=', USER]]);
  });

  it('sends the active organization id for {current_org_id}', async () => {
    const ds = makeDataSource();
    render(ui(ds, listNode({ filter: [['org', '=', '{current_org_id}']] })));
    expect(await queriedFilter(ds.find)).toEqual([['org', '=', ORG]]);
  });

  it('hands the child view the resolved filter too', async () => {
    const ds = makeDataSource();
    render(ui(ds, listNode({ filter: MINE })));
    await waitFor(() => expect(gridSchemas.length).toBeGreaterThan(0));
    expect(gridSchemas.at(-1)?.filter).toEqual([['owner', '=', USER]]);
  });

  it('CONTROL: a token-free filter reaches the query unchanged', async () => {
    const ds = makeDataSource();
    render(ui(ds, listNode({ filter: [['owner', '=', 'usr_literal']] })));
    expect(await queriedFilter(ds.find)).toEqual([['owner', '=', 'usr_literal']]);
  });

  it('keeps the token literal with no user in scope, and the shared resolver names it (no fallback)', async () => {
    const ds = makeDataSource();
    render(ui(ds, listNode({ filter: MINE }), null, null));
    expect(await queriedFilter(ds.find)).toEqual([['owner', '=', '{current_user_id}']]);
    expect(warn.mock.calls.some((c: unknown[]) => String(c[0]).includes('{current_user_id}'))).toBe(true);
  });

  it('re-queries with the new id when the signed-in user changes', async () => {
    const ds = makeDataSource();
    const schema = listNode({ filter: MINE });
    const { rerender } = render(ui(ds, schema));
    expect(await queriedFilter(ds.find, 0)).toEqual([['owner', '=', USER]]);
    await settle();
    const before = ds.find.mock.calls.length;
    await act(async () => {
      rerender(ui(ds, schema, 'usr_99'));
    });
    expect(await queriedFilter(ds.find, before)).toEqual([['owner', '=', 'usr_99']]);
  });
});

describe('list-view — the resolved filter is held, so an equal filter does not refetch (objectui#10607)', () => {
  it('issues no further query across re-renders with the SAME node', async () => {
    const ds = makeDataSource();
    const schema = listNode({ filter: MINE });
    const { rerender } = render(ui(ds, schema));
    await queriedFilter(ds.find);
    await settle();
    const settled = ds.find.mock.calls.length;
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        rerender(ui(ds, schema));
      });
      await settle();
    }
    expect(ds.find.mock.calls.length).toBe(settled);
  });

  it('issues no further query across re-renders that rebuild an EQUAL token filter', async () => {
    // A host that writes the node inline hands a fresh, structurally equal
    // filter on every render; the hold compares by structure.
    const ds = makeDataSource();
    const fresh = () => listNode({ filter: MINE.map((rule) => [...rule]) });
    const { rerender } = render(ui(ds, fresh()));
    expect(await queriedFilter(ds.find)).toEqual([['owner', '=', USER]]);
    await settle();
    const settled = ds.find.mock.calls.length;
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        rerender(ui(ds, fresh()));
      });
      await settle();
    }
    expect(ds.find.mock.calls.length).toBe(settled);
  });

  it('the object-view seam: a filter already resolved upstream is queried unchanged, and re-rendering does not re-query', async () => {
    // `object-view` hands a `list-view` host a filter it has already resolved
    // through the same resolver (objectui#10506). This list resolves it again:
    // a resolved id no longer matches the whole-token pattern, so the second
    // pass changes nothing, and nothing about it re-queries.
    const ds = makeDataSource();
    const handed = resolveFilterPlaceholders(MINE, { currentUserId: USER, currentOrgId: ORG });
    const schema = listNode({ filter: handed });
    const { rerender } = render(ui(ds, schema, 'someone_else'));
    expect(await queriedFilter(ds.find)).toEqual(handed);
    await settle();
    const settled = ds.find.mock.calls.length;
    await act(async () => {
      rerender(ui(ds, schema, 'someone_else'));
    });
    await settle();
    expect(ds.find.mock.calls.length).toBe(settled);
    expect(ds.find.mock.calls.every((c) => JSON.stringify((c as unknown as [string, { $filter?: unknown }])[1]?.$filter) === JSON.stringify(handed))).toBe(true);
  });
});
