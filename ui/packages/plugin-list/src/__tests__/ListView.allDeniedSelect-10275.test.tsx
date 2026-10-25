/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10275 — an authored column list that field-level security EMPTIES
 * still projects; it never widens the request to the whole record.
 *
 * `ListView`'s `$select` builder drops the authored columns the principal
 * cannot read. It used to ask "is anything LEFT?" and, when nothing was, return
 * no projection at all — so the request carried no `$select` key and asked the
 * server for every field, the denied ones included. That is the reading
 * objectui#7215 measured and fixed on `$expand`: an emptied list read as "no
 * restriction".
 *
 * The emptiness question is now asked of the AUTHORED columns, the same rule
 * `hasAuthoredColumns` applies to what the grid draws. An authored list that
 * FLS empties projects to `id` plus every other FLS-gated route the builder
 * already has — the `$expand` roots, the view bindings, the grid's grouping
 * fields and the row predicates' operands. That is the shape `ObjectGrid`
 * (`ensureId([])` keeps `['id']`) and `RelatedList` (objectui#10186) send.
 *
 * Unchanged, and pinned here as controls: a partially-denied list, a list with
 * no authored columns (no projection, as before), and an unanswered policy
 * (nothing filtered, as before).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

/**
 * Same stub as `ListView.speculativeFls-7216.test.tsx`: swapped by IDENTITY
 * when the policy answers, because the fetch effect names `perms` in its
 * dependency list and identity is what rebuilds the projection.
 */
const { holder, makePerms } = vi.hoisted(() => {
  const makePerms = (isLoaded: boolean, readable: string[]) => ({
    isLoaded,
    checkField: (_object: string, field: string, action: string) =>
      action === 'read' ? readable.includes(field) : true,
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
  });
  return { holder: { current: makePerms(true, []) }, makePerms };
});

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => holder.current as any };
});

import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';

const OBJECT = 'duly_employee';

const objectDef = {
  name: OBJECT,
  label: 'Employee',
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text', label: 'Subject' },
    salary: { name: 'salary', type: 'currency', label: 'Salary' },
    industry: { name: 'industry', type: 'text', label: 'Industry' },
    status: { name: 'status', type: 'select', label: 'Status' },
    region: { name: 'region', type: 'text', label: 'Region' },
    priority: { name: 'priority', type: 'select', label: 'Priority' },
  },
};

/**
 * The same object with a DECLARED row action whose predicates read `region`
 * (readable) and `priority` (denied) — an authored surface, read by
 * `listViewPredicates` as `objectActions`. Only the predicate pin mounts it, so
 * every other pin's projection is exact.
 */
const objectDefWithActions = {
  ...objectDef,
  actions: [
    {
      name: 'escalate',
      label: 'Escalate',
      locations: ['list_item'],
      visible: "record.region == 'EU'",
      disabled: "record.priority == 'low'",
    },
  ],
};

/** Everything the principal may read. `salary`, `industry`, `priority` are denied. */
const READABLE = ['id', 'subject', 'status', 'region'];

/** Both authored columns are denied. */
const ALL_DENIED = ['salary', 'industry'];

const makeDataSource = (def: Record<string, unknown> = objectDef) =>
  ({
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (name: string) => (name === OBJECT ? def : null)),
  }) as any;

const listSchema = (schemaExtra: Record<string, unknown>): any => ({
  type: 'list-view',
  objectName: OBJECT,
  viewType: 'grid',
  ...schemaExtra,
});

/** Mount a list view and return the params of the LAST request it sent. */
async function paramsFor(
  schemaExtra: Record<string, unknown>,
  def: Record<string, unknown> = objectDef,
): Promise<Record<string, unknown>> {
  const dataSource = makeDataSource(def);
  const schema = listSchema(schemaExtra);
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={schema} dataSource={dataSource} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
  return (dataSource.find.mock.calls.at(-1)?.[1] ?? {}) as Record<string, unknown>;
}

const hasSelect = (params: Record<string, unknown>) =>
  Object.prototype.hasOwnProperty.call(params, '$select');

const sorted = (v: unknown) => [...(v as string[])].sort();

beforeEach(() => {
  vi.clearAllMocks();
  holder.current = makePerms(true, READABLE);
});
afterEach(() => cleanup());

describe('ListView — an FLS-emptied column list still projects (objectui#10275)', () => {
  // ── The finding ─────────────────────────────────────────────────────────
  it('sends `$select: [id]` when every authored column is denied', async () => {
    const params = await paramsFor({ columns: ALL_DENIED });
    expect(
      hasSelect(params),
      'an emptied column list must not be read as "no restriction": with no `$select` key '
        + 'the request asks for every field, the denied ones included',
    ).toBe(true);
    expect(params.$select).toEqual(['id']);
  });

  // ── The row predicates' operands ride along; a denied one does not ──────
  it('adds the readable operands of the row predicates, and not a denied one', async () => {
    const params = await paramsFor(
      {
        columns: ALL_DENIED,
        conditionalFormatting: [
          { condition: "record.status == 'open'", style: { backgroundColor: '#fee2e2' } },
        ],
      },
      objectDefWithActions,
    );
    expect(hasSelect(params)).toBe(true);
    expect(
      sorted(params.$select),
      '`status` (conditional formatting) and `region` (the action `visible`) are read per row',
    ).toEqual(['id', 'region', 'status']);
    expect(
      params.$select,
      '`priority` is the action `disabled` operand and is denied — the predicate gate must not '
        + 'add back a field the column gate removed',
    ).not.toContain('priority');
  });

  // ── The view bindings are the same FLS-gated route ──────────────────────
  it('keeps a readable view binding and drops a denied one', async () => {
    const readableBinding = await paramsFor({
      columns: ALL_DENIED,
      kanban: { groupByField: 'status' },
    });
    expect(sorted(readableBinding.$select)).toContain('status');

    cleanup();
    const deniedBinding = await paramsFor({
      columns: ALL_DENIED,
      kanban: { groupByField: 'industry' },
    });
    expect(hasSelect(deniedBinding)).toBe(true);
    expect(deniedBinding.$select).not.toContain('industry');
  });

  // ── Control: partially denied is unchanged ──────────────────────────────
  it('projects the surviving column when only some are denied (control)', async () => {
    const params = await paramsFor({ columns: ['subject', 'salary'] });
    expect(params.$select).toEqual(['id', 'subject']);
  });

  // ── Control: no authored columns still sends no projection ──────────────
  it('sends no `$select` when no column is authored (control)', async () => {
    const absent = await paramsFor({});
    expect(hasSelect(absent), 'no authored column list ⇒ no projection, as before').toBe(false);

    cleanup();
    const empty = await paramsFor({ columns: [] });
    expect(hasSelect(empty), 'an empty authored list reads as unauthored, as before').toBe(false);
  });

  // ── Control: an unanswered policy filters nothing ───────────────────────
  it('filters nothing while the permission answer has not loaded (control)', async () => {
    holder.current = makePerms(false, []);
    const params = await paramsFor({ columns: ALL_DENIED });
    expect(sorted(params.$select)).toEqual(['id', 'industry', 'salary']);
  });

  // ── The late answer narrows the request rather than widening it ─────────
  it('re-projects to `[id]` once the policy answers', async () => {
    holder.current = makePerms(false, []);
    const ds = makeDataSource();
    const schema = listSchema({ columns: ALL_DENIED });
    const { rerender } = render(
      <SchemaRendererProvider dataSource={ds}>
        <ListView schema={schema} dataSource={ds} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(ds.find).toHaveBeenCalled());

    holder.current = makePerms(true, READABLE);
    rerender(
      <SchemaRendererProvider dataSource={ds}>
        <ListView schema={schema} dataSource={ds} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => {
      const latest = (ds.find.mock.calls.at(-1)?.[1] ?? {}) as Record<string, unknown>;
      expect(hasSelect(latest)).toBe(true);
      expect(latest.$select).toEqual(['id']);
    });
  });
});
