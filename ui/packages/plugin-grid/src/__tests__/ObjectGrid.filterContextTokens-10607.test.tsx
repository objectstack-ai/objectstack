/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10607 — a directly authored `object-grid` node resolves the spec's
 * context tokens (`{current_user_id}`, `{current_org_id}`) in its OWN filter,
 * through `@object-ui/core`'s ONE shared `resolveFilterPlaceholders`, against
 * the session scope the host provides (`FilterScopeProvider` /
 * `useFilterScope`).
 *
 * Before this change `plugin-grid` had zero reads of that resolver, so
 * `filter: [['owner', '=', '{current_user_id}']]` on an `object-grid` authored
 * straight into a page — not reached through `object-view`, which resolves the
 * filters it hands on (objectui#10506) — went out on `$filter` as the literal
 * token.
 *
 * The node's own filter is `filter`. Its deprecated alias `defaultFilters` was
 * resolved in the same call until objectui#12030 retired it: `@objectstack/spec`
 * 18 refuses the key by name, and the grid no longer reads it.
 *
 * The grid keys its fetch on the filter it lowers, so the resolved value must
 * keep its reference while nothing it was computed from has changed: a copy
 * minted on every render would refetch on every render. The stability cells
 * below count `find()` calls across re-renders that change nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider, FilterScopeProvider } from '@object-ui/react';
import { resolveFilterPlaceholders } from '@object-ui/core';
import type { DataSource, ObjectGridSchema } from '@object-ui/types';
import type { ViewFilterRule } from '@objectstack/spec/ui';
// Registers `object-grid`.
import '../index';

const USER = 'usr_42';
const ORG = 'org_7';

/**
 * The authored `filter` is the `ViewFilterRule` array: objectui#6152 round 8 respelled this
 * file's fixtures from the AST tuple array (`[['owner', '=', '{current_user_id}']]`), which
 * the `object-grid` row refuses. `ObjectGrid` lowers the rule to the AST node the
 * assertions read off `$filter`, so the operator arrives as the rule's `equals`.
 */
const MINE: ViewFilterRule[] = [{ field: 'owner', operator: 'equals', value: '{current_user_id}' }];

function makeAdapter() {
  return {
    find: vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'Acme', owner: USER }], total: 1 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'task',
      fields: { id: { type: 'text' }, name: { type: 'text' }, owner: { type: 'text' }, org: { type: 'text' } },
    }),
  };
}

type Adapter = ReturnType<typeof makeAdapter>;

/** Held constant, so a re-render that rebuilds the node rebuilds only its filter. */
const COLUMNS = ['name'];

/** A directly authored `object-grid` node — no `object-view` above it. */
function gridNode(over: Partial<ObjectGridSchema>): ObjectGridSchema {
  return { type: 'object-grid', objectName: 'task', columns: COLUMNS, ...over };
}

function ui(adapter: Adapter, node: ObjectGridSchema, user: string | null = USER, org: string | null = ORG) {
  return (
    <FilterScopeProvider currentUserId={user} currentOrgId={org}>
      <SchemaRendererProvider dataSource={adapter as unknown as DataSource}>
        <SchemaRenderer schema={node} />
      </SchemaRendererProvider>
    </FilterScopeProvider>
  );
}

/** The `$filter` of the Nth `find()` the grid issued. */
async function queriedFilter(find: Adapter['find'], call = 0) {
  await waitFor(() => expect(find.mock.calls.length).toBeGreaterThan(call));
  return (find.mock.calls[call] as unknown as [string, { $filter?: unknown }])[1]?.$filter;
}

/** Let every pending effect and resolved promise land. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  warn.mockRestore();
});

describe('object-grid — the node’s own filter reaches the query resolved (objectui#10607)', () => {
  it('sends the signed-in user id for {current_user_id}, not the literal token', async () => {
    const adapter = makeAdapter();
    render(ui(adapter, gridNode({ filter: MINE })));
    expect(await queriedFilter(adapter.find)).toEqual([['owner', 'equals', USER]]);
  });

  it('sends the active organization id for {current_org_id}', async () => {
    const adapter = makeAdapter();
    render(ui(adapter, gridNode({ filter: [{ field: 'org', operator: 'equals', value: '{current_org_id}' }] })));
    expect(await queriedFilter(adapter.find)).toEqual([['org', 'equals', ORG]]);
  });

  it('CONTROL: a token-free filter reaches the query unchanged', async () => {
    const adapter = makeAdapter();
    render(ui(adapter, gridNode({ filter: [{ field: 'owner', operator: 'equals', value: 'usr_literal' }] })));
    expect(await queriedFilter(adapter.find)).toEqual([['owner', 'equals', 'usr_literal']]);
  });

  it('keeps the token literal with no user in scope, and the shared resolver names it (no fallback)', async () => {
    const adapter = makeAdapter();
    render(ui(adapter, gridNode({ filter: MINE }), null, null));
    expect(await queriedFilter(adapter.find)).toEqual([['owner', 'equals', '{current_user_id}']]);
    expect(warn.mock.calls.some((c: unknown[]) => String(c[0]).includes('{current_user_id}'))).toBe(true);
  });

  it('re-queries with the new id when the signed-in user changes', async () => {
    const adapter = makeAdapter();
    const node = gridNode({ filter: MINE });
    const { rerender } = render(ui(adapter, node));
    expect(await queriedFilter(adapter.find, 0)).toEqual([['owner', 'equals', USER]]);
    await settle();
    const before = adapter.find.mock.calls.length;
    await act(async () => {
      rerender(ui(adapter, node, 'usr_99'));
    });
    expect(await queriedFilter(adapter.find, before)).toEqual([['owner', 'equals', 'usr_99']]);
  });
});

describe('object-grid — the resolved filter is held, so an equal filter does not refetch (objectui#10607)', () => {
  it('issues no further query across re-renders with the SAME node', async () => {
    const adapter = makeAdapter();
    const node = gridNode({ filter: MINE });
    const { rerender } = render(ui(adapter, node));
    await queriedFilter(adapter.find);
    await settle();
    const settled = adapter.find.mock.calls.length;
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        rerender(ui(adapter, node));
      });
      await settle();
    }
    expect(adapter.find.mock.calls.length).toBe(settled);
  });

  it('issues no further query across re-renders that rebuild an EQUAL token filter', async () => {
    // A host that writes the node inline hands a fresh, structurally equal
    // filter on every render; the hold compares by structure.
    const adapter = makeAdapter();
    const fresh = () => gridNode({ filter: MINE.map((rule) => ({ ...rule })) });
    const { rerender } = render(ui(adapter, fresh()));
    expect(await queriedFilter(adapter.find)).toEqual([['owner', 'equals', USER]]);
    await settle();
    const settled = adapter.find.mock.calls.length;
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        rerender(ui(adapter, fresh()));
      });
      await settle();
    }
    expect(adapter.find.mock.calls.length).toBe(settled);
  });

  it('the object-view seam: a filter already resolved upstream is queried once, unchanged (resolving twice is a no-op)', async () => {
    // `object-view` hands `object-grid` a filter it has already resolved
    // through the same resolver (objectui#10506). This grid resolves it again:
    // a resolved id no longer matches the whole-token pattern, so the second
    // pass changes nothing, and nothing about it re-queries.
    const adapter = makeAdapter();
    const handed = resolveFilterPlaceholders(MINE, { currentUserId: USER, currentOrgId: ORG });
    const node = gridNode({ filter: handed });
    const { rerender } = render(ui(adapter, node, 'someone_else'));
    // The handed rule arrives lowered, exactly as an unresolved one does above.
    expect(await queriedFilter(adapter.find)).toEqual([['owner', 'equals', USER]]);
    await settle();
    await act(async () => {
      rerender(ui(adapter, node, 'someone_else'));
    });
    await settle();
    expect(adapter.find).toHaveBeenCalledTimes(1);
  });
});
