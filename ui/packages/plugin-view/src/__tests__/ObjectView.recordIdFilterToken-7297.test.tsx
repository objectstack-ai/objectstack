/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7297 — an `object-view` on a record page resolves `{record_id}` in
 * its named view's filter to the mounted record (`RecordContextProvider`,
 * through `useFilterScope()`), and its held segments follow that record: the
 * hold keys on `recordId` like every other scope member, so moving to the next
 * record re-queries without a remount.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { FilterScopeProvider, RecordContextProvider } from '@object-ui/react';
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

/** A calendar view, so the filter leaves by the non-grid `find()` this component issues itself. */
const SCHEMA = {
  type: 'object-view',
  objectName: 'task',
  defaultListView: 'theirs',
  listViews: {
    theirs: {
      label: 'Their tasks',
      type: 'calendar',
      columns: ['name'],
      filter: [{ field: 'assignee', operator: 'equals', value: '{record_id}' }],
    },
  },
} as ObjectViewSchema;

function ui(ds: ReturnType<typeof makeAdapter>, recordId: string) {
  return (
    <FilterScopeProvider currentUserId="usr_viewer" currentOrgId="org_7">
      <RecordContextProvider objectName="person" recordId={recordId}>
        <ObjectView schema={SCHEMA} dataSource={ds as any} />
      </RecordContextProvider>
    </FilterScopeProvider>
  );
}

async function queriedFilter(find: ReturnType<typeof vi.fn>, call = 0) {
  await waitFor(() => expect(find.mock.calls.length).toBeGreaterThan(call));
  return find.mock.calls[call][1]?.$filter;
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe('object-view — {record_id} in a named view is the mounted record (objectui#7297)', () => {
  it('queries with the record in view, and again with the next one, without a remount', async () => {
    const ds = makeAdapter();
    const { rerender } = render(ui(ds, 'rec_ada'));
    expect(await queriedFilter(ds.find, 0)).toEqual([['assignee', 'equals', 'rec_ada']]);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const before = ds.find.mock.calls.length;
    await act(async () => {
      rerender(ui(ds, 'rec_grace'));
    });
    expect(await queriedFilter(ds.find, before)).toEqual([['assignee', 'equals', 'rec_grace']]);
  });
});
