/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7297 — a directly authored `object-grid` on a record page resolves
 * `{record_id}` to the mounted record (`RecordContextProvider`, through
 * `useFilterScope()`), and its held filter follows that record: the hold keys
 * on `recordId` like every other scope member, so moving to the next record
 * re-queries without a remount. Outside a record context the token is left as
 * written and named in the resolver's warning.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider, FilterScopeProvider, RecordContextProvider } from '@object-ui/react';
import type { DataSource, ObjectGridSchema } from '@object-ui/types';

import '../index';

function makeAdapter() {
  return {
    find: vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'Write the brief', assignee: 'rec_ada' }], total: 1 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'task',
      fields: { id: { type: 'text' }, name: { type: 'text' }, assignee: { type: 'text' } },
    }),
  };
}

type Adapter = ReturnType<typeof makeAdapter>;

// The authored `filter` is the `ViewFilterRule` array (objectui#6152 round 8 respelled it
// from the AST tuple array `[['assignee', '=', '{record_id}']]`, which the row refuses);
// `ObjectGrid` lowers it to the AST node the assertions below read off `$filter`.
const NODE: ObjectGridSchema = {
  type: 'object-grid',
  objectName: 'task',
  columns: ['name'],
  filter: [{ field: 'assignee', operator: 'equals', value: '{record_id}' }],
};

function ui(adapter: Adapter, recordId?: string) {
  const grid = (
    <SchemaRendererProvider dataSource={adapter as unknown as DataSource}>
      <SchemaRenderer schema={NODE} />
    </SchemaRendererProvider>
  );
  return (
    <FilterScopeProvider currentUserId="usr_viewer" currentOrgId="org_7">
      {recordId === undefined ? grid : (
        <RecordContextProvider objectName="person" recordId={recordId}>{grid}</RecordContextProvider>
      )}
    </FilterScopeProvider>
  );
}

async function queriedFilter(find: Adapter['find'], call = 0) {
  await waitFor(() => expect(find.mock.calls.length).toBeGreaterThan(call));
  return (find.mock.calls[call] as unknown as [string, { $filter?: unknown }])[1]?.$filter;
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  warn.mockRestore();
});

describe('object-grid — {record_id} is the mounted record (objectui#7297)', () => {
  it('queries with the record in view, and again with the next one, without a remount', async () => {
    const adapter = makeAdapter();
    const { rerender } = render(ui(adapter, 'rec_ada'));
    expect(await queriedFilter(adapter.find, 0)).toEqual([['assignee', 'equals', 'rec_ada']]);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const before = adapter.find.mock.calls.length;
    await act(async () => {
      rerender(ui(adapter, 'rec_grace'));
    });
    expect(await queriedFilter(adapter.find, before)).toEqual([['assignee', 'equals', 'rec_grace']]);
  });

  it('with no record in context: left as written, and named in the warning', async () => {
    const adapter = makeAdapter();
    render(ui(adapter));
    expect(await queriedFilter(adapter.find, 0)).toEqual([['assignee', 'equals', '{record_id}']]);
    expect(
      warn.mock.calls.some((c: unknown[]) => String(c[0]).includes('"{record_id}"') && String(c[0]).includes('no record in context')),
    ).toBe(true);
  });
});
