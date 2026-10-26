/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9853 — ONE display page size, read from the protocol, and a fetch
 * batch that is a different quantity (rulings 5749197629 and 5824040487,
 * structure B: "page size" means one page only where there is a pager).
 *
 * Before the rulings this component fell back to three page-size literals: a
 * page of rows in the client-paged table, a page of groups in the grouped
 * view, and a "server window" that sized both the `$top` of every fetch AND the
 * visible page of the server-paged table. Now:
 *
 *  1. every page this grid shows — the server-paged table, the table over
 *     inline rows, the page of groups, and a server-grouped leaf's page of
 *     rows — falls back to the default `@objectstack/spec` declares for
 *     `pagination.pageSize`, read from the spec rather than restated;
 *  2. the one fetch that is not a page — a window this grid groups in the
 *     browser — asks for the grid's own fetch batch, which does not follow
 *     that default;
 *  3. a declared `pageSize` is honoured as before, and a refused one keeps the
 *     loud warning (pinned row by row in
 *     `ObjectGrid.pageSizeNonPositive-9853.test.tsx`).
 *
 * ## Why the spec's default is STOOD IN FOR here
 *
 * A pin that reads the real default cannot tell "the grid reads the spec" from
 * "the grid hardcodes the number the spec happens to say today", and today
 * that number is also the fetch batch's. So this file replaces the declared
 * default with a number the spec has never shipped and that is none of the
 * selector's fixed steps, and every expectation reads it back from the spec
 * module the renderer imports. The stand-in records that its factory ran and
 * what the REAL default is, so the first row proves the substitution is live
 * rather than trusting it. The real value is pinned by the fixtures of
 * `groupedPagination.test.tsx` and `ObjectGrid.pageSizeNonPositive-9853.test.tsx`,
 * which read it unstubbed.
 *
 * Every display surface is read OFF THE SCREEN (rows or groups rendered), and
 * the fetch side off the WIRE (`$top` the data source received).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

const { STUB_DISPLAY_DEFAULT, probe } = vi.hoisted(() => ({
  /**
   * Deliberately nothing the spec has shipped, and not one of the grouped
   * size selector's fixed steps, so the selector row below discriminates.
   */
  STUB_DISPLAY_DEFAULT: 13,
  probe: { factoryRan: false, realDefault: undefined as unknown },
}));

vi.mock('@objectstack/spec/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@objectstack/spec/ui')>();
  probe.factoryRan = true;
  probe.realDefault = actual.PaginationConfigSchema.parse({}).pageSize;
  return {
    ...actual,
    PaginationConfigSchema: actual.PaginationConfigSchema.extend({
      pageSize: actual.PaginationConfigSchema.shape.pageSize.unwrap().default(STUB_DISPLAY_DEFAULT),
    }),
  };
});

/**
 * The permission policy, for the one row that needs a grouping key this
 * principal may not read. Unloaded by default, which filters nothing (the
 * grid defers until the policy answers), so every other row runs as if no
 * policy were installed.
 */
const { permsStub, permsState } = vi.hoisted(() => {
  const permsState: { isLoaded: boolean; readable: string[] } = { isLoaded: false, readable: [] };
  return {
    permsState,
    permsStub: {
      get isLoaded() { return permsState.isLoaded; },
      checkField: (_object: string, field: string, action: string) =>
        action === 'read' ? permsState.readable.includes(field) : true,
      check: () => ({ allowed: true }),
      getFieldPermissions: () => [],
      getRowFilter: () => undefined,
      getObjectApiOperations: () => undefined,
      roles: [],
      userId: null,
      systemPermissions: undefined,
      hasCapabilities: () => true,
      can: () => true,
      cannot: () => false,
    },
  };
});

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => permsStub as any };
});

import { PaginationConfigSchema } from '@objectstack/spec/ui';
import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

/** The protocol's answer, read the way the renderer reads it. */
const SPEC_DISPLAY_DEFAULT: number = PaginationConfigSchema.parse({}).pageSize;

/**
 * The grid's fetch batch for a window it groups in the browser. Pinned by
 * value because the ruling keeps the value; what the ruling asks is that it is
 * NOT the display default, which the stand-in above makes observable.
 */
const FETCH_BATCH = 50;

const OBJECT = 'duly_task';
const OBJECT_FIELDS = {
  id: { type: 'text', label: 'Id' },
  subject: { type: 'text', label: 'Subject' },
  unit: { type: 'text', label: 'Unit' },
};

/** More rows than any number here, every row its own group. */
const ROW_COUNT = 80;
interface Row { id: string; subject: string; unit: string }
const ROWS: Row[] = Array.from({ length: ROW_COUNT }, (_, i) => ({
  id: `r-${i}`,
  subject: `Task ${String(i).padStart(3, '0')}`,
  unit: `Unit ${String(i).padStart(3, '0')}`,
}));

/** The `FilterCondition` subset the compiled group queries use. */
function matches(row: Record<string, unknown>, cond: unknown): boolean {
  if (cond === undefined || cond === null) return true;
  return Object.entries(cond as Record<string, unknown>).every(([key, value]) => {
    if (key === '$and') return (value as unknown[]).every((c) => matches(row, c));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const op = value as Record<string, unknown>;
      if ('$eq' in op) return row[key] === op.$eq;
      if ('$null' in op) return op.$null ? row[key] == null : row[key] != null;
      throw new Error(`double: unsupported operator ${JSON.stringify(op)}`);
    }
    return row[key] === value;
  });
}

/**
 * A data source that pages `find` by `$top` / `$skip` and answers the group
 * header query over the whole store, the two faces a grouped grid reads.
 */
const makeDataSource = () => {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    queryGroupHeaders: vi.fn(async (_object: string, query: { where?: unknown; groupBy?: string[]; aggregations?: Array<{ function: string; alias: string }> }) => {
      const groupBy = query.groupBy ?? [];
      const buckets = new Map<string, Row[]>();
      for (const row of ROWS.filter((r) => matches(r as any, query.where))) {
        const key = JSON.stringify(groupBy.map((f) => (row as any)[f] ?? null));
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key)!.push(row);
      }
      return [...buckets.entries()].map(([key, members]) => {
        const values = JSON.parse(key) as unknown[];
        const out: Record<string, unknown> = Object.fromEntries(groupBy.map((f, i) => [f, values[i]]));
        for (const agg of query.aggregations ?? []) {
          out[agg.alias] = agg.function === 'count' ? members.length : null;
        }
        return out as { count: number };
      });
    }),
    find: vi.fn(async (_object: string, params: Record<string, unknown>) => {
      calls.push(params);
      const where = Array.isArray(params.$filter) ? undefined : params.$filter;
      const matching = ROWS.filter((r) => matches(r as any, where));
      const skip = (params.$skip as number | undefined) ?? 0;
      const top = (params.$top as number | undefined) ?? matching.length;
      return { data: matching.slice(skip, skip + top), total: matching.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: OBJECT_FIELDS })),
  };
};

const renderGrid = (schema: Record<string, unknown>, dataSource?: unknown) =>
  render(
    <ActionProvider>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <ObjectGrid schema={schema as any} {...(dataSource ? { dataSource: dataSource as any } : {})} />
    </ActionProvider>,
  );

const fetchedSchema = (extra: Record<string, unknown> = {}) => ({
  type: 'object-grid',
  objectName: OBJECT,
  columns: ['subject'],
  ...extra,
});
const groupedSchema = (extra: Record<string, unknown> = {}) =>
  fetchedSchema({ grouping: { fields: [{ field: 'unit' }] }, ...extra });
const inlineSchema = (extra: Record<string, unknown> = {}) => ({
  type: 'object-grid',
  objectName: OBJECT,
  columns: [{ field: 'subject', label: 'Subject' }],
  data: { provider: 'value', items: ROWS },
  ...extra,
});

const bodyRows = (container: HTMLElement) => Array.from(container.querySelectorAll('tbody tr'));
const groupRows = () => [...document.querySelectorAll('[data-testid^="group-row-"]')];
/** The `$top` of every per-group row query (a row query carries a group `$filter`). */
const groupRowTops = (calls: Array<Record<string, unknown>>) =>
  calls.filter((p) => p.$filter && !Array.isArray(p.$filter)).map((p) => p.$top);

let warnings: string[] = [];
beforeEach(() => {
  warnings = [];
  permsState.isLoaded = false;
  permsState.readable = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const paginationWarnings = () => warnings.filter((w) => w.includes('ObjectGrid pagination'));

describe('ObjectGrid — one display page size from the spec, and a distinct fetch batch (objectui#9853)', () => {
  it('the spec stand-in is live: the renderer\'s spec module answers it, and it is not the real default', () => {
    // Without these, every row below could pass against a grid that
    // hardcodes whatever number the real spec says today.
    expect(probe.factoryRan).toBe(true);
    expect(SPEC_DISPLAY_DEFAULT).toBe(STUB_DISPLAY_DEFAULT);
    expect(probe.realDefault).not.toBe(STUB_DISPLAY_DEFAULT);
    expect(FETCH_BATCH).not.toBe(SPEC_DISPLAY_DEFAULT);
  });

  it('every page the grid shows uses the spec default when nothing is declared', async () => {
    // Server-paged table: the page on screen, and the `$top` that fetched it.
    const flatDs = makeDataSource();
    const flat = renderGrid(fetchedSchema(), flatDs);
    await vi.waitFor(() => expect(bodyRows(flat.container).length).toBeGreaterThan(0));
    const serverPaged = bodyRows(flat.container).length;
    const serverTop = flatDs.calls.at(-1)?.$top;
    cleanup();

    // Client-paged table over inline rows.
    const inline = renderGrid(inlineSchema());
    await vi.waitFor(() => expect(bodyRows(inline.container).length).toBeGreaterThan(0));
    const clientPaged = bodyRows(inline.container).length;
    cleanup();

    // Server-grouped view: a page of groups, and each open group's own page
    // of rows (the group's pager turns it).
    const groupedDs = makeDataSource();
    renderGrid(groupedSchema(), groupedDs);
    await vi.waitFor(() => expect(groupRows().length).toBeGreaterThan(0));
    await vi.waitFor(() => expect(groupRowTops(groupedDs.calls).length).toBeGreaterThan(0));
    const groupsShown = groupRows().length;
    const groupRowTop = [...new Set(groupRowTops(groupedDs.calls))];

    // ONE assertion over every surface, so a surface that keeps a default of
    // its own shows up as the odd one out.
    expect({ serverPaged, serverTop, clientPaged, groupsShown, groupRowTop }).toEqual({
      serverPaged: SPEC_DISPLAY_DEFAULT,
      serverTop: SPEC_DISPLAY_DEFAULT,
      clientPaged: SPEC_DISPLAY_DEFAULT,
      groupsShown: SPEC_DISPLAY_DEFAULT,
      groupRowTop: [SPEC_DISPLAY_DEFAULT],
    });
    expect(paginationWarnings()).toHaveLength(0);
  });

  it('a window the grid groups in the browser FETCHES the batch, which no display path reads', async () => {
    // The one path left since objectui#7189 where this grid buckets a fetched
    // window: a grouping key this principal may not read, over a data source
    // that answers the header query, so the server cannot group for it.
    permsState.isLoaded = true;
    permsState.readable = ['id', 'subject'];
    const ds = makeDataSource();
    renderGrid(groupedSchema(), ds);
    await vi.waitFor(() => expect(groupRows().length).toBeGreaterThan(0));
    expect(ds.queryGroupHeaders).not.toHaveBeenCalled();
    // The batch left on the wire, and the groups on screen are still a page
    // of the display default: two quantities, two numbers.
    expect(ds.calls.map((p) => p.$top)).toContain(FETCH_BATCH);
    expect(ds.calls.map((p) => p.$top)).not.toContain(SPEC_DISPLAY_DEFAULT);
    expect(groupRows()).toHaveLength(SPEC_DISPLAY_DEFAULT);
  });

  it('the grouped pager\'s size selector shows the size in force', async () => {
    renderGrid(groupedSchema(), makeDataSource());
    await vi.waitFor(() => expect(groupRows().length).toBeGreaterThan(0));
    // The display default is not one of the selector's fixed steps; without
    // the active size merged in, the control would display a size that is not
    // the one on screen.
    // The selector is the shared `Select` (objectui#11865): its trigger shows
    // the size in force.
    const trigger = screen.getByRole('combobox');
    expect(trigger.textContent).toBe(String(SPEC_DISPLAY_DEFAULT));
  });

  it('CONTROL — a declared page size is honoured on every surface, and on the bucketed fetch as before', async () => {
    const declared = { pagination: { pageSize: 7 } };

    const flatDs = makeDataSource();
    const flat = renderGrid(fetchedSchema(declared), flatDs);
    await vi.waitFor(() => expect(bodyRows(flat.container).length).toBeGreaterThan(0));
    expect(bodyRows(flat.container)).toHaveLength(7);
    expect(flatDs.calls.map((p) => p.$top)).toContain(7);
    cleanup();

    const inline = renderGrid(inlineSchema(declared));
    await vi.waitFor(() => expect(bodyRows(inline.container).length).toBeGreaterThan(0));
    expect(bodyRows(inline.container)).toHaveLength(7);
    cleanup();

    const groupedDs = makeDataSource();
    renderGrid(groupedSchema(declared), groupedDs);
    await vi.waitFor(() => expect(groupRows().length).toBeGreaterThan(0));
    await vi.waitFor(() => expect(groupRowTops(groupedDs.calls).length).toBeGreaterThan(0));
    expect(groupRows()).toHaveLength(7);
    expect([...new Set(groupRowTops(groupedDs.calls))]).toEqual([7]);
    cleanup();

    permsState.isLoaded = true;
    permsState.readable = ['id', 'subject'];
    const bucketedDs = makeDataSource();
    renderGrid(groupedSchema(declared), bucketedDs);
    await vi.waitFor(() => expect(groupRows().length).toBeGreaterThan(0));
    expect(bucketedDs.calls.map((p) => p.$top)).toContain(7);
    expect(paginationWarnings()).toHaveLength(0);
  });

  it('CONTROL — a refused page size still warns, then falls back to the spec default', async () => {
    const ds = makeDataSource();
    const flat = renderGrid(fetchedSchema({ pagination: { pageSize: 0 } }), ds);
    await vi.waitFor(() => expect(bodyRows(flat.container).length).toBeGreaterThan(0));
    await vi.waitFor(() => expect(paginationWarnings().length).toBeGreaterThan(0));
    expect(bodyRows(flat.container)).toHaveLength(SPEC_DISPLAY_DEFAULT);
    expect(ds.calls.map((p) => p.$top)).not.toContain(0);
  });
});
