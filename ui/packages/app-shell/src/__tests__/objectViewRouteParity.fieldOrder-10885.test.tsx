// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10885 member 4 — route 2 orders a named view's columns by its
 * `fieldOrder` exactly as the host delegation's `ListView` does.
 *
 * The protocol composes three members of a named list view (objectstack#15184
 * ruling B): `columns` projects, `hiddenFields` subtracts, `fieldOrder` orders
 * what survives. `ObjectGrid` reads none of the last two, so each route applies
 * them before the grid:
 *
 *   - the host delegation relays all three to `ListView`, whose
 *     `effectiveFields` applies them and hands the grid the result;
 *   - route 2 (the registered `object-view` renderer, which the Studio's view
 *     preview uses) applies them to the projection it hands `ObjectGrid`.
 *
 * The claim is parity, so every case below mounts BOTH routes of the same
 * `ObjectView` on the same named view and compares the two projections the
 * grid receives. Nothing is compared with a hand-written order.
 *
 * This file lives in `@object-ui/app-shell` because it needs both
 * `@object-ui/plugin-view` and `@object-ui/plugin-list`, and this is the
 * package that depends on both.
 *
 * Sinks: route 2 renders the `ObjectGrid` export, replaced below; `ListView`
 * renders the registry's `object-grid`, replaced for the file's duration.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ObjectView } from '@object-ui/plugin-view';
import { ListView } from '@object-ui/plugin-list';

/** The node each route handed its grid, in mount order. */
const routeTwoNodes: any[] = [];
const delegationNodes: any[] = [];

vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: ({ schema }: any) => {
    routeTwoNodes.push(schema);
    return <div data-testid="route-two-grid" />;
  },
}));

let previousGrid: any;
beforeAll(() => {
  previousGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', ({ schema }: any) => {
    delegationNodes.push(schema);
    return <div data-testid="delegation-grid" />;
  });
});
afterAll(() => {
  if (previousGrid) ComponentRegistry.register('object-grid', previousGrid);
  else ComponentRegistry.unregister('object-grid');
});
afterEach(() => {
  cleanup();
  routeTwoNodes.length = 0;
  delegationNodes.length = 0;
});

function createDataSource(): any {
  return {
    find: vi.fn(async () => ({ data: [{ id: 't1', a: 'A', b: 'B', c: 'C', d: 'D' }], total: 1 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: 'task',
      label: 'Task',
      fields: Object.fromEntries(['a', 'b', 'c', 'd'].map((f) => [f, { name: f, type: 'text', label: f.toUpperCase() }])),
    })),
  };
}

function objectView(view: Record<string, unknown>, delegate: boolean) {
  const ds = createDataSource();
  const renderListView = ({ schema, dataSource }: any) => <ListView schema={schema} dataSource={dataSource} />;
  return (
    <SchemaRendererProvider dataSource={ds}>
      <ObjectView
        schema={{ type: 'object-view', objectName: 'task', defaultListView: 'v1', listViews: { v1: { type: 'grid', ...view } } } as any}
        dataSource={ds}
        {...(delegate ? { renderListView } : {})}
      />
    </SchemaRendererProvider>
  );
}

/** The projection each route hands the grid for the same named view. */
async function bothRoutes(view: Record<string, unknown>): Promise<{ routeTwo: any; delegation: any }> {
  render(objectView(view, false));
  await waitFor(() => expect(routeTwoNodes.length).toBeGreaterThan(0));
  const routeTwo = routeTwoNodes[routeTwoNodes.length - 1];
  cleanup();
  render(objectView(view, true));
  await waitFor(() => expect(delegationNodes.length).toBeGreaterThan(0));
  const delegation = delegationNodes[delegationNodes.length - 1];
  return { routeTwo, delegation };
}

const identity = (c: unknown) => (typeof c === 'string' ? c : (c as { field?: string }).field);

describe('objectui#10885 — route 2 applies a named view\'s `fieldOrder` as `ListView` does', () => {
  it('LIT CONTROL: with no `fieldOrder`, both routes hand the grid the same projection', async () => {
    const { routeTwo, delegation } = await bothRoutes({ columns: ['a', 'b', 'c', 'd'] });
    expect(delegation.columns).toEqual(['a', 'b', 'c', 'd']);
    expect(routeTwo.columns).toEqual(delegation.columns);
  });

  it('fields `fieldOrder` does not name sort after the named ones, in their projected order', async () => {
    const { routeTwo, delegation } = await bothRoutes({ columns: ['a', 'b', 'c', 'd'], fieldOrder: ['c', 'a'] });
    // Non-vacuity: the delegation did reorder, so equality below is a reading.
    expect(delegation.columns).not.toEqual(['a', 'b', 'c', 'd']);
    expect(routeTwo.columns).toEqual(delegation.columns);
    // Route 2's names slot carries the same order.
    expect(routeTwo.fields).toEqual(routeTwo.columns.map(identity));
  });

  it('a name the projection does not carry orders nothing', async () => {
    const { routeTwo, delegation } = await bothRoutes({ columns: ['a', 'b', 'c'], fieldOrder: ['zz', 'c', 'yy'] });
    expect(delegation.columns).not.toEqual(['a', 'b', 'c']);
    expect(routeTwo.columns).toEqual(delegation.columns);
  });

  it('`hiddenFields` subtracts first, then `fieldOrder` orders what survives', async () => {
    const { routeTwo, delegation } = await bothRoutes({ columns: ['a', 'b', 'c', 'd'], hiddenFields: ['b'], fieldOrder: ['d', 'b', 'a'] });
    expect(delegation.columns).not.toContain('b');
    expect(delegation.columns[0]).toBe('d');
    expect(routeTwo.columns).toEqual(delegation.columns);
  });

  it('object-shaped columns keep their shape in the new order', async () => {
    const { routeTwo, delegation } = await bothRoutes({
      columns: [{ field: 'a', width: 120 }, { field: 'b' }, { field: 'c' }],
      fieldOrder: ['c', 'a'],
    });
    expect(delegation.columns.map(identity)).not.toEqual(['a', 'b', 'c']);
    expect(routeTwo.columns).toEqual(delegation.columns);
    expect(routeTwo.fields).toEqual(routeTwo.columns.map(identity));
  });

  it('with no projection, neither route invents one', async () => {
    const { routeTwo, delegation } = await bothRoutes({ fieldOrder: ['c', 'a'] });
    expect(delegation.columns).toBeUndefined();
    expect(routeTwo.columns).toEqual(delegation.columns);
    expect(routeTwo.fields).toBeUndefined();
  });
});
