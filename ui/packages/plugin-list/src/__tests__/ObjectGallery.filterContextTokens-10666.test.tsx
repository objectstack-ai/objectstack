/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10666 — a directly authored `object-gallery` node resolves the
 * spec's context tokens (`{current_user_id}`, `{current_org_id}`) in its OWN
 * filter, through `@object-ui/core`'s ONE shared `resolveFilterPlaceholders`,
 * against the session scope the host provides (`FilterScopeProvider` /
 * `useFilterScope`). This is the objectui#10607 class on a third host:
 * `object-grid` and `list-view` were closed by objectui#10607, and a gallery
 * rendered as a `list-view` child already received a resolved filter, but a
 * gallery authored straight into a page sent the literal token on `$filter`.
 *
 * Rendered through the real `SchemaRenderer` and this package's own
 * registrations, over a data source that records every `find()`. The
 * `list-view` cells are the lit control: the same filter, the same scope, the
 * same harness, on a node that already resolves (objectui#10607). Its child
 * view is stubbed, so the control reads only the list's own query.
 *
 * The gallery keys its fetch on the filter, so the resolved value must keep
 * its reference while nothing it was computed from has changed: a copy minted
 * on every render would refetch on every render. The stability cells count
 * `find()` calls across re-renders that change nothing.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererProvider, FilterScopeProvider } from '@object-ui/react';
import type { DataSource } from '@object-ui/types';
// Registers `list-view` and `object-gallery` (the package's own registrations).
import '../index';

const USER = 'usr_42';
const ORG = 'org_7';

const MINE = [['owner', '=', '{current_user_id}']];

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

/** A directly authored `object-gallery` node — no `list-view` or `object-view` above it. */
function galleryNode(over: Record<string, unknown>) {
  return { type: 'object-gallery', objectName: 'task', gallery: { titleField: 'name' }, ...over };
}

/** The lit control: a directly authored `list-view` node over the same object. */
function listNode(over: Record<string, unknown>) {
  return { type: 'list-view', data: { provider: 'object', object: 'task' }, columns: ['name'], ...over };
}

function ui(ds: DS, schema: Record<string, unknown>, user: string | null = USER, org: string | null = ORG) {
  return (
    <FilterScopeProvider currentUserId={user} currentOrgId={org}>
      <SchemaRendererProvider dataSource={ds as unknown as DataSource}>
        <SchemaRenderer schema={schema as never} />
      </SchemaRendererProvider>
    </FilterScopeProvider>
  );
}

/** The `$filter` of the Nth `find()` the node issued. */
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
  ComponentRegistry.register('object-grid', () => <div data-testid="grid-stub" />);
});
afterAll(() => {
  if (prevObjectGrid) ComponentRegistry.register('object-grid', prevObjectGrid);
  else ComponentRegistry.unregister('object-grid');
});

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  // Best-effort metadata probes are not what these cases are about.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  warn.mockRestore();
});

describe('object-gallery — the node’s own filter reaches the query resolved (objectui#10666)', () => {
  it('LIT CONTROL: a directly authored list-view sends the signed-in user id for {current_user_id}', async () => {
    const ds = makeDataSource();
    render(ui(ds, listNode({ filter: MINE })));
    expect(await queriedFilter(ds.find)).toEqual([['owner', '=', USER]]);
  });

  it('sends the signed-in user id for {current_user_id}, not the literal token', async () => {
    const ds = makeDataSource();
    render(ui(ds, galleryNode({ filter: MINE })));
    expect(await queriedFilter(ds.find)).toEqual([['owner', '=', USER]]);
  });

  it('sends the active organization id for {current_org_id}', async () => {
    const ds = makeDataSource();
    render(ui(ds, galleryNode({ filter: [['org', '=', '{current_org_id}']] })));
    expect(await queriedFilter(ds.find)).toEqual([['org', '=', ORG]]);
  });

  it('CONTROL: a token-free filter reaches the query unchanged', async () => {
    const ds = makeDataSource();
    render(ui(ds, galleryNode({ filter: [['owner', '=', 'usr_literal']] })));
    expect(await queriedFilter(ds.find)).toEqual([['owner', '=', 'usr_literal']]);
  });

  it('keeps the token literal with no user in scope, and the shared resolver names it (no fallback)', async () => {
    const ds = makeDataSource();
    render(ui(ds, galleryNode({ filter: MINE }), null, null));
    expect(await queriedFilter(ds.find)).toEqual([['owner', '=', '{current_user_id}']]);
    expect(warn.mock.calls.some((c: unknown[]) => String(c[0]).includes('{current_user_id}'))).toBe(true);
  });

  it('re-queries with the new id when the signed-in user changes', async () => {
    const ds = makeDataSource();
    const schema = galleryNode({ filter: MINE });
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

describe('object-gallery — the resolved filter is held, so an equal filter does not refetch (objectui#10666)', () => {
  it('issues exactly one query, and none further across re-renders with the SAME node', async () => {
    const ds = makeDataSource();
    const schema = galleryNode({ filter: MINE });
    const { rerender } = render(ui(ds, schema));
    await queriedFilter(ds.find);
    await settle();
    expect(ds.find).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        rerender(ui(ds, schema));
      });
      await settle();
    }
    expect(ds.find).toHaveBeenCalledTimes(1);
  });

  it('issues no further query across re-renders that rebuild an EQUAL token filter', async () => {
    // A host that writes the node inline hands a fresh, structurally equal
    // filter on every render; the hold compares by structure.
    const ds = makeDataSource();
    const fresh = () => galleryNode({ filter: MINE.map((rule) => [...rule]) });
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
});
