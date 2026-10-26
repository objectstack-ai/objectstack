/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10506 — the registered `object-view` node resolves the spec's
 * context tokens (`{current_user_id}`, `{current_org_id}`) in the filters it
 * hands on, through `@object-ui/core`'s ONE shared `resolveFilterPlaceholders`,
 * with the session scope the host provides (`FilterScopeProvider`, which the
 * console shell mounts from the signed-in user and the active organization).
 *
 * Before this change `ObjectView` had zero reads of that resolver, so a
 * per-user named view — `{ field: 'owner', operator: 'equals', value:
 * '{current_user_id}' }` — reached the query with the literal token, while the
 * same view under the app-shell host was resolved.
 *
 * An authored filter leaves this component through three doors, and each has
 * a describe block below: the non-grid `find()` this component issues itself,
 * the `object-grid` schema it hands `ObjectGrid`, and the `list-view` schema it
 * hands a host's `renderListView`. The two delegated doors also pin that the
 * resolved value keeps its reference while nothing changed: `ObjectGrid` and
 * `ListView` both key their fetch on the filter's identity, so a copy minted
 * on every render would refetch on every render.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { FilterScopeProvider } from '@object-ui/react';
import { resolveFilterPlaceholders } from '@object-ui/core';
import { ObjectView } from '../ObjectView';
import type { ObjectViewSchema } from '@object-ui/types';

const { gridSchemas } = vi.hoisted(() => ({ gridSchemas: [] as any[] }));

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
  ObjectGrid: ({ schema }: any) => {
    gridSchemas.push(schema);
    return <div data-testid="object-grid" />;
  },
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

const USER = 'usr_42';
const ORG = 'org_7';

const MINE = [{ field: 'owner', operator: 'equals', value: '{current_user_id}' }];

function makeAdapter() {
  return {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
  };
}

/** An `object-view` node whose active view is the named view `mine`. */
function namedView(type: 'calendar' | 'grid', filter: any[]): ObjectViewSchema {
  return {
    type: 'object-view',
    objectName: 'task',
    defaultListView: 'mine',
    // `columns` since objectui#7928: the named view is the protocol's record.
    listViews: { mine: { label: 'Mine', type, columns: ['name'], filter } },
  } as ObjectViewSchema;
}

function Scoped({ user = USER, org = ORG, children }: { user?: string | null; org?: string | null; children: React.ReactNode }) {
  return (
    <FilterScopeProvider currentUserId={user} currentOrgId={org}>
      {children}
    </FilterScopeProvider>
  );
}

/** The `$filter` of the Nth `find()` this component issued. */
async function queriedFilter(find: ReturnType<typeof vi.fn>, call = 0) {
  await waitFor(() => expect(find.mock.calls.length).toBeGreaterThan(call));
  return find.mock.calls[call][1]?.$filter;
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  gridSchemas.length = 0;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe('named view filter → the non-grid query this component issues (objectui#10506)', () => {
  it('queries with the signed-in user id, not the literal {current_user_id}', async () => {
    const ds = makeAdapter();
    render(<Scoped><ObjectView schema={namedView('calendar', MINE)} dataSource={ds as any} /></Scoped>);
    expect(await queriedFilter(ds.find)).toEqual([['owner', 'equals', USER]]);
  });

  it('queries with the active organization id for {current_org_id}', async () => {
    const ds = makeAdapter();
    const schema = namedView('calendar', [{ field: 'org', operator: 'equals', value: '{current_org_id}' }]);
    render(<Scoped><ObjectView schema={schema} dataSource={ds as any} /></Scoped>);
    expect(await queriedFilter(ds.find)).toEqual([['org', 'equals', ORG]]);
  });

  it('CONTROL: a literal value passes through unchanged', async () => {
    const ds = makeAdapter();
    const schema = namedView('calendar', [{ field: 'owner', operator: 'equals', value: 'usr_literal' }]);
    render(<Scoped><ObjectView schema={schema} dataSource={ds as any} /></Scoped>);
    expect(await queriedFilter(ds.find)).toEqual([['owner', 'equals', 'usr_literal']]);
  });

  it('keeps a Date comparand a Date on its way to find() (the resolver returns non-plain objects as leaves)', async () => {
    // The spec admits `Date` as a comparand. Before `@object-ui/core`'s walks
    // treated a non-plain object as a leaf, routing this filter through the
    // shared resolver rebuilt the Date from its (zero) own keys into `{}`.
    const ds = makeAdapter();
    const due = new Date('2026-01-01T00:00:00Z');
    const schema = namedView('calendar', [['due', '>=', due], ['owner', '=', '{current_user_id}']]);
    render(<Scoped><ObjectView schema={schema} dataSource={ds as any} /></Scoped>);
    const filter = await queriedFilter(ds.find);
    const leaf = Array.isArray(filter?.[0]) ? filter[0][2] : filter?.[2];
    expect(leaf).toBeInstanceOf(Date);
    expect((leaf as Date).getTime()).toBe(due.getTime());
    expect(JSON.stringify(filter)).toContain(USER);
  });

  it('keeps an unresolvable token literal with no scope mounted, and the shared resolver names it', async () => {
    // The resolver's own rule, not a fallback invented here: a known token with
    // no value in scope is left intact (the query matches nothing rather than
    // silently widening) and the resolver warns once, naming the token.
    const ds = makeAdapter();
    render(<ObjectView schema={namedView('calendar', MINE)} dataSource={ds as any} />);
    expect(await queriedFilter(ds.find)).toEqual([['owner', 'equals', '{current_user_id}']]);
    expect(warn.mock.calls.some((c: unknown[]) => String(c[0]).includes('{current_user_id}'))).toBe(true);
  });

  it('re-queries with the new id when the signed-in user changes', async () => {
    const ds = makeAdapter();
    const schema = namedView('calendar', MINE);
    const { rerender } = render(<Scoped><ObjectView schema={schema} dataSource={ds as any} /></Scoped>);
    expect(await queriedFilter(ds.find, 0)).toEqual([['owner', 'equals', USER]]);

    await act(async () => {
      rerender(<Scoped user="usr_99"><ObjectView schema={schema} dataSource={ds as any} /></Scoped>);
    });
    expect(await queriedFilter(ds.find, 1)).toEqual([['owner', 'equals', 'usr_99']]);
  });

  it('issues ONE query across parent re-renders that rebuild an equal token filter (no churn from resolving)', async () => {
    // A host that writes its `views` inline hands a fresh filter object on every
    // render (objectui#6460). Resolving must not turn that into a fresh
    // resolved copy per render, or every parent render would re-query.
    const ds = makeAdapter();
    const schema = { type: 'object-view', objectName: 'task', defaultViewType: 'calendar' } as ObjectViewSchema;
    const ui = (tick: number) => (
      <Scoped>
        <div data-tick={tick}>
          <ObjectView
            schema={schema}
            dataSource={ds as any}
            views={[{ id: 'mine', label: 'Mine', type: 'calendar' as const, filter: [...MINE.map((r) => ({ ...r }))] }]}
          />
        </div>
      </Scoped>
    );
    const { rerender } = render(ui(0));
    expect(await queriedFilter(ds.find)).toEqual([['owner', 'equals', USER]]);
    for (let tick = 1; tick <= 3; tick++) {
      await act(async () => {
        rerender(ui(tick));
        await new Promise((r) => setTimeout(r, 20));
      });
    }
    expect(ds.find).toHaveBeenCalledTimes(1);
  });
});

describe('named view / table filter → the `object-grid` schema handed to ObjectGrid (objectui#10506)', () => {
  it('hands ObjectGrid the resolved named-view filter', async () => {
    const ds = makeAdapter();
    render(<Scoped><ObjectView schema={namedView('grid', MINE)} dataSource={ds as any} /></Scoped>);
    await waitFor(() => expect(gridSchemas.length).toBeGreaterThan(0));
    // objectui#11880 item 5: in `filter`, the one filter slot the grid node carries.
    expect(gridSchemas.at(-1).filter).toEqual([{ field: 'owner', operator: 'equals', value: USER }]);
    expect(gridSchemas.at(-1).defaultFilters).toBeUndefined();
  });

  it('hands ObjectGrid the resolved canonical table.filter', async () => {
    const ds = makeAdapter();
    const schema = {
      type: 'object-view',
      objectName: 'task',
      table: { filter: [['owner', '=', '{current_user_id}']] },
    } as unknown as ObjectViewSchema;
    render(<Scoped><ObjectView schema={schema} dataSource={ds as any} /></Scoped>);
    await waitFor(() => expect(gridSchemas.length).toBeGreaterThan(0));
    expect(gridSchemas.at(-1).filter).toEqual([['owner', '=', USER]]);
  });

  it('keeps the resolved filter’s reference across re-renders that change nothing', async () => {
    // `ObjectGrid` keys its fetch on `schema.filter` BY IDENTITY, so a resolved
    // copy minted per render would refetch per render.
    const ds = makeAdapter();
    const schema = {
      type: 'object-view',
      objectName: 'task',
      table: { filter: [['owner', '=', '{current_user_id}']] },
    } as unknown as ObjectViewSchema;
    const { rerender } = render(<Scoped><ObjectView schema={schema} dataSource={ds as any} /></Scoped>);
    await waitFor(() => expect(gridSchemas.length).toBeGreaterThan(0));
    const first = gridSchemas.at(-1).filter;
    await act(async () => {
      rerender(<Scoped><ObjectView schema={schema} dataSource={ds as any} /></Scoped>);
    });
    await act(async () => {
      rerender(<Scoped><ObjectView schema={{ ...schema }} dataSource={ds as any} /></Scoped>);
    });
    expect(gridSchemas.length).toBeGreaterThan(1);
    expect(first).toEqual([['owner', '=', USER]]);
    expect(gridSchemas.at(-1).filter).toBe(first);
  });
});

describe('named view / table filter → the `list-view` schema handed to renderListView (objectui#10506)', () => {
  function renderDelegated(schema: ObjectViewSchema) {
    const seen: any[] = [];
    const ds = makeAdapter();
    const renderListView = ({ schema: s }: any) => {
      seen.push(s);
      return <div data-testid="delegated" />;
    };
    const ui = (s: ObjectViewSchema) => (
      <Scoped><ObjectView schema={s} dataSource={ds as any} renderListView={renderListView} /></Scoped>
    );
    const utils = render(ui(schema));
    return { seen, rerender: (s: ObjectViewSchema) => utils.rerender(ui(s)) };
  }

  it('hands the delegated slot the resolved named-view filter', () => {
    const { seen } = renderDelegated(namedView('grid', MINE));
    expect(seen.at(-1)?.filter).toEqual([{ field: 'owner', operator: 'equals', value: USER }]);
  });

  it('hands the delegated slot a resolved object table.filter', () => {
    // Was `table.defaultFilters` until objectui#12030 retired that key; the
    // same object source rides the canonical `table.filter`.
    const { seen } = renderDelegated({
      type: 'object-view',
      objectName: 'task',
      table: { filter: { owner: '{current_user_id}', org: '{current_org_id}' } },
    } as unknown as ObjectViewSchema);
    expect(seen.at(-1)?.filter).toEqual({ owner: USER, org: ORG });
  });

  it('hands over a fixed point of the shared resolver, so the app-shell host’s second pass changes nothing', () => {
    // The app-shell host renders through this component and resolves
    // `viewDef.filter ?? listSchema.filter` again in its own `renderListView`.
    // A resolved id no longer matches the whole-token pattern, so the second
    // pass is a no-op even under a different scope.
    const { seen } = renderDelegated(namedView('grid', MINE));
    const handed = seen.at(-1)?.filter;
    expect(resolveFilterPlaceholders(handed, { currentUserId: 'someone_else', onUnresolved: null })).toEqual(handed);
  });

  it('keeps the resolved filter’s reference across re-renders that change nothing', () => {
    // `ListView` keys its fetch on `schema.filter` BY IDENTITY, and the Studio
    // host spreads this slot straight into it.
    const schema = namedView('grid', MINE);
    const { seen, rerender } = renderDelegated(schema);
    const first = seen.at(-1)?.filter;
    act(() => rerender(schema));
    act(() => rerender({ ...schema }));
    expect(seen.length).toBeGreaterThan(1);
    expect(first).toEqual([{ field: 'owner', operator: 'equals', value: USER }]);
    expect(seen.at(-1)?.filter).toBe(first);
  });
});
