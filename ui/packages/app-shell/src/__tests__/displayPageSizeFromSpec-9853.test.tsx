/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9853, ruling 5824040487 — the display default is declared ONCE, in
 * the protocol, and every paged surface reads it; the fetch batches of the
 * unpaged surfaces are a different quantity and do not follow it (structure B:
 * "page size" means one page only where there is a pager).
 *
 * ## Why this file lives in `app-shell`
 *
 * The surfaces sit in three packages — `ObjectGrid` in `plugin-grid`,
 * `ListView` in `plugin-list`, `ObjectKanban` in `plugin-kanban` — and the
 * point of the pin is ONE assertion across all of them, so that a surface
 * keeping a default of its own shows up as the odd one out. `app-shell` is the
 * package that already depends on all three, so the real components are
 * mounted here with no new dependency edge anywhere (the same reason
 * `rowClickModifierPayloadForward-9462.test.tsx` lives here).
 *
 * ## Why the spec's default is STOOD IN FOR
 *
 * Reading the real default cannot tell "reads the spec" from "hardcodes the
 * number the spec says today". So the default is replaced with a number the
 * spec has never shipped, and every expectation reads it back from the spec
 * module the renderers import. The stand-in records that its factory ran and
 * what the REAL default is, so the first row proves the substitution is live.
 * With the stand-in in force the paged surfaces must move with it and the
 * fetch batches must not — which is exactly the split the ruling makes.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const { STUB_DISPLAY_DEFAULT, probe } = vi.hoisted(() => ({
  /** Deliberately nothing the spec has shipped, and neither fetch batch. */
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

import { PaginationConfigSchema } from '@objectstack/spec/ui';
import { ObjectGrid } from '@object-ui/plugin-grid';
import { ListView } from '@object-ui/plugin-list';
import { ObjectKanban } from '@object-ui/plugin-kanban';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

/** The protocol's answer, read the way the renderers read it. */
const SPEC_DISPLAY_DEFAULT: number = PaginationConfigSchema.parse({}).pageSize;

/**
 * The fetch batch of every unpaged list view and of the board. Spelled by
 * value: the ruling keeps the value, and what it asks is that neither moves
 * with the display default.
 */
const FETCH_BATCH = 100;

const OBJECT = 'duly_task';
const OBJECT_FIELDS = {
  id: { type: 'text', label: 'Id' },
  subject: { type: 'text', label: 'Subject' },
  unit: { type: 'text', label: 'Unit' },
  status: { type: 'select', label: 'Status', options: [{ label: 'Todo', value: 'todo' }] },
};

/** More rows than any number here, every row its own group. */
const ROW_COUNT = 240;
interface Row { id: string; subject: string; unit: string; status: string }
const ROWS: Row[] = Array.from({ length: ROW_COUNT }, (_, i) => ({
  id: `r-${i}`,
  subject: `Task ${String(i).padStart(3, '0')}`,
  unit: `Unit ${String(i).padStart(3, '0')}`,
  status: 'todo',
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

/** Pages `find` by `$top` / `$skip` and answers the group header query. */
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
type Ds = ReturnType<typeof makeDataSource>;

const mount = (node: React.ReactElement, ds?: Ds) =>
  render(
    <SchemaRendererProvider dataSource={ds as any}>
      <ActionProvider>{node}</ActionProvider>
    </SchemaRendererProvider>,
  );

const bodyRows = (container: HTMLElement) => Array.from(container.querySelectorAll('tbody tr'));
const groupRows = () => [...document.querySelectorAll('[data-testid^="group-row-"]')];
const tops = (ds: Ds) => ds.calls.map((p) => p.$top);
/** The `$top` of every per-group row query (a row query carries a group `$filter`). */
const groupRowTops = (ds: Ds) =>
  [...new Set(ds.calls.filter((p) => p.$filter && !Array.isArray(p.$filter)).map((p) => p.$top))];

afterEach(() => cleanup());

describe('one display default from the spec across grid, list and board; fetch batches apart (objectui#9853)', () => {
  it('the spec stand-in is live: the renderers\' spec module answers it, and it is not the real default', () => {
    expect(probe.factoryRan).toBe(true);
    expect(SPEC_DISPLAY_DEFAULT).toBe(STUB_DISPLAY_DEFAULT);
    expect(probe.realDefault).not.toBe(STUB_DISPLAY_DEFAULT);
    expect(FETCH_BATCH).not.toBe(SPEC_DISPLAY_DEFAULT);
  });

  it('every paged surface shows the spec default when nothing is declared', async () => {
    const gridSchema = { type: 'object-grid', objectName: OBJECT, columns: ['subject'] };

    // The grid that fetches its own rows: the page on screen and its `$top`.
    const flatDs = makeDataSource();
    const flat = mount(<ObjectGrid schema={gridSchema as any} dataSource={flatDs as any} />, flatDs);
    await waitFor(() => expect(bodyRows(flat.container).length).toBeGreaterThan(0));
    const gridServerPaged = bodyRows(flat.container).length;
    const gridServerTop = tops(flatDs).at(-1);
    cleanup();

    // The grid over inline rows.
    const inline = mount(
      <ObjectGrid schema={{ ...gridSchema, data: { provider: 'value', items: ROWS } } as any} />,
    );
    await waitFor(() => expect(bodyRows(inline.container).length).toBeGreaterThan(0));
    const gridInline = bodyRows(inline.container).length;
    cleanup();

    // The server-grouped grid: a page of groups, and each open group's page.
    const groupedDs = makeDataSource();
    mount(
      <ObjectGrid
        schema={{ ...gridSchema, grouping: { fields: [{ field: 'unit' }] } } as any}
        dataSource={groupedDs as any}
      />,
      groupedDs,
    );
    await waitFor(() => expect(groupRows().length).toBeGreaterThan(0));
    await waitFor(() => expect(groupRowTops(groupedDs).length).toBeGreaterThan(0));
    const groupsShown = groupRows().length;
    const groupRowTop = groupRowTops(groupedDs);
    cleanup();

    // The paged list: `ListView` pages its grid view on the server and hands
    // the real grid the window and the pager.
    const listDs = makeDataSource();
    const list = mount(
      <ListView
        schema={{ type: 'list-view', objectName: OBJECT, viewType: 'grid', columns: ['subject'] } as any}
        dataSource={listDs as any}
      />,
      listDs,
    );
    await waitFor(() => expect(bodyRows(list.container).length).toBeGreaterThan(0));
    const listPaged = bodyRows(list.container).length;
    const listTop = tops(listDs);

    expect({ gridServerPaged, gridServerTop, gridInline, groupsShown, groupRowTop, listPaged, listTop }).toEqual({
      gridServerPaged: SPEC_DISPLAY_DEFAULT,
      gridServerTop: SPEC_DISPLAY_DEFAULT,
      gridInline: SPEC_DISPLAY_DEFAULT,
      groupsShown: SPEC_DISPLAY_DEFAULT,
      groupRowTop: [SPEC_DISPLAY_DEFAULT],
      listPaged: SPEC_DISPLAY_DEFAULT,
      listTop: [SPEC_DISPLAY_DEFAULT],
    });
  });

  it('the unpaged list and the board keep their fetch batch, which does not move with the page size', async () => {
    // An unpaged list view: no pager, so its one window is the batch.
    const listDs = makeDataSource();
    mount(
      <ListView
        schema={{ type: 'list-view', objectName: OBJECT, viewType: 'kanban', columns: ['subject'], kanban: { groupByField: 'status' } } as any}
        dataSource={listDs as any}
      />,
      listDs,
    );
    await waitFor(() => expect(listDs.find).toHaveBeenCalled());
    const listUnpagedTop = tops(listDs);
    cleanup();

    // The board on its own: `limit` undeclared, its default fetch batch.
    const boardDs = makeDataSource();
    mount(
      <ObjectKanban
        schema={{ type: 'object-kanban', objectName: OBJECT, groupBy: 'status' } as any}
        dataSource={boardDs as any}
      />,
      boardDs,
    );
    await waitFor(() => expect(boardDs.find).toHaveBeenCalled());
    const boardTop = tops(boardDs);

    expect({ listUnpagedTop, boardTop }).toEqual({ listUnpagedTop: [FETCH_BATCH], boardTop: [FETCH_BATCH] });
    expect([...listUnpagedTop, ...boardTop]).not.toContain(SPEC_DISPLAY_DEFAULT);
  });
});
