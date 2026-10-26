// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#25888 — a related list's "View all" carries the list's OWN
 * `filter` as well as its relationship, so the full list shows the rows the
 * list showed.
 *
 * The defect: the destination kept the relationship (`record_id`) and dropped
 * the list's `filter` (`object_name`). For most objects that only widens the
 * list. For `sys_approval_request` it emptied it: the request read gate admits
 * a record reader only on a read pinning BOTH fields, so a reader who saw two
 * requests on the record's Approvals list saw none on "View all".
 *
 * Every case mounts what a record page mounts, as the objectui#12741 suite
 * beside this one does: the real `RelatedRecordActionsBridge` under a router,
 * around the `{ type, properties }` node through the real `SchemaRenderer`,
 * `@object-ui/plugin-detail`'s registration and the real `RelatedList`. The
 * oracle for the destination is the READ side of the same URL family
 * (`parseUrlFilterTriples`, what `ObjectDataPage` parses), so the pin does not
 * restate how a filter is spelled.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import '@testing-library/jest-dom';
import {
  FilterScopeProvider,
  MetadataCtx,
  RecordContextProvider,
  SchemaRenderer,
  type MetadataContextValue,
} from '@object-ui/react';
import { PermissionProvider } from '@object-ui/permissions';
// Registers `record:related_list`. Module scope on purpose (AGENTS.md, test discipline).
import '@object-ui/plugin-detail';

import { RelatedRecordActionsBridge } from '../RelatedRecordActionsBridge';
import { parseUrlFilterTriples } from '../drillUrlFilters';

/** Desktop, pinned (objectui#8399): under 768px a table related list is a card gallery. */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

afterEach(() => cleanup());

const APP = 'clm';
const PARENT_ROUTE = `/apps/${APP}/contract/record/C-1`;

/**
 * The repro's shape: a polymorphic child that points at its parent by
 * `object_name` + `record_id`, listed on the parent's record page by
 * `relationshipField: 'record_id'` plus a `filter` pinning `object_name`.
 */
const REQUEST = {
  name: 'approval_request',
  label: 'Approval Request',
  fields: {
    name: { type: 'text', label: 'Name' },
    object_name: { type: 'text', label: 'Object' },
    record_id: { type: 'text', label: 'Record' },
    owner: { type: 'text', label: 'Owner' },
    status: { type: 'text', label: 'Status' },
  },
};

const ROWS = [
  { id: 'r1', name: 'First approval', object_name: 'contract', record_id: 'C-1' },
  { id: 'r2', name: 'Second approval', object_name: 'contract', record_id: 'C-1' },
];

/** The list's own scope, authored the way the spec declares it (`ViewFilterRule[]`). */
const PINS_OBJECT = [{ field: 'object_name', operator: 'equals', value: 'contract' }];

const metadata: MetadataContextValue = {
  apps: [],
  objects: [REQUEST],
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: (async () => REQUEST) as unknown as MetadataContextValue['getItem'],
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};

function RouterLocation() {
  const location = useLocation();
  return <output data-testid="router-location">{`${location.pathname}${location.search}`}</output>;
}

/** The role-based provider, letting `viewer` read the child with the named fields denied. */
const denying = (fields: string[]) => (node: React.ReactElement) => (
  <PermissionProvider
    roles={[]}
    userRoles={['viewer']}
    permissions={
      [
        {
          object: 'approval_request',
          roles: { viewer: { actions: ['read'], fieldPermissions: fields.map((field) => ({ field, read: false })) } },
        },
      ] as never
    }
  >
    {node}
  </PermissionProvider>
);

function mount({
  properties = {},
  wrap = (node: React.ReactElement) => node,
}: {
  properties?: Record<string, unknown>;
  wrap?: (node: React.ReactElement) => React.ReactElement;
} = {}) {
  const dataSource = {
    find: vi.fn(async () => ROWS),
    getObjectSchema: vi.fn(async () => REQUEST),
  };
  const doc = {
    type: 'record:related_list',
    properties: {
      objectName: 'approval_request',
      relationshipField: 'record_id',
      columns: ['name'],
      ...properties,
    },
  };
  render(
    <MetadataCtx.Provider value={metadata}>
      <MemoryRouter initialEntries={[PARENT_ROUTE]}>
        {wrap(
          <RelatedRecordActionsBridge
            appName={APP}
            objects={[REQUEST]}
            dataSource={dataSource}
            parentObjectName="contract"
            parentRecordId="C-1"
            parentTitle="MSA"
            parentRecord={{ id: 'C-1', name: 'MSA' }}
          >
            <RecordContextProvider objectName="contract" recordId="C-1" dataSource={dataSource as never}>
              <SchemaRenderer schema={doc as never} />
            </RecordContextProvider>
          </RelatedRecordActionsBridge>,
        )}
        <RouterLocation />
      </MemoryRouter>
    </MetadataCtx.Provider>,
  );
  return dataSource;
}

const viewAll = () => screen.queryByRole('button', { name: /view all/i });
const location = () => screen.getByTestId('router-location').textContent ?? '';
/** Every row painted: each "no link" read below is taken on a list that drew its records. */
const waitForRows = async () => {
  await screen.findByText('First approval');
  await screen.findByText('Second approval');
};
/** Click "View all" and read the destination back the way `ObjectDataPage` reads it. */
const followViewAll = () => {
  const link = viewAll();
  expect(link).toBeInTheDocument();
  fireEvent.click(link!);
  const [path, search] = location().split('?');
  expect(path).toBe(`/apps/${APP}/approval_request/data`);
  return parseUrlFilterTriples(new URLSearchParams(search));
};
/** Order-free comparison: the list route ANDs its triples, so order says nothing. */
const sorted = (triples: unknown[][]) => [...triples].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

describe('objectstack#25888 — "View all" carries the related list’s own filter', () => {
  it('the repro: a list scoped by `object_name` on a `record_id` relationship opens a list scoped by BOTH', async () => {
    mount({ properties: { filter: PINS_OBJECT } });
    await waitForRows();
    expect(sorted(followViewAll())).toEqual(
      sorted([
        ['record_id', '=', 'C-1'],
        ['object_name', '=', 'contract'],
      ]),
    );
  });

  it('CONTROL: with no `filter` the destination carries the relationship alone, as before', async () => {
    mount();
    await waitForRows();
    expect(followViewAll()).toEqual([['record_id', '=', 'C-1']]);
  });

  it('a placeholder in the filter is written RESOLVED, against the scope the list read its rows with', async () => {
    mount({
      properties: { filter: [{ field: 'owner', operator: 'equals', value: '{current_user_id}' }] },
      wrap: (node) => <FilterScopeProvider currentUserId="usr_7">{node}</FilterScopeProvider>,
    });
    await waitForRows();
    expect(sorted(followViewAll())).toEqual(
      sorted([
        ['record_id', '=', 'C-1'],
        ['owner', '=', 'usr_7'],
      ]),
    );
  });

  it('a range and an is-null condition travel too: the route has a spelling for each', async () => {
    mount({
      properties: {
        filter: [
          ['name', '>=', 'A'],
          ['status', 'is_null', true],
        ],
      },
    });
    await waitForRows();
    expect(sorted(followViewAll())).toEqual(
      sorted([
        ['record_id', '=', 'C-1'],
        ['name', '>=', 'A'],
        ['status', 'is_null', true],
      ]),
    );
  });

  it('a filter with an `or` draws no link: the route cannot say it, and dropping it would widen the list', async () => {
    mount({
      properties: {
        filter: ['or', ['status', '=', 'pending'], ['status', '=', 'approved']],
      },
    });
    await waitForRows();
    expect(viewAll()).toBeNull();
  });

  it('a filter on a field the viewer cannot read draws no link: `ObjectDataPage` would drop that condition', async () => {
    mount({ properties: { filter: PINS_OBJECT }, wrap: denying(['object_name']) });
    await waitForRows();
    expect(viewAll()).toBeNull();
  });

  it('CONTROL: under the same provider, denying a field the filter does not name, the link draws and carries both', async () => {
    mount({ properties: { filter: PINS_OBJECT }, wrap: denying(['owner']) });
    await waitForRows();
    expect(sorted(followViewAll())).toEqual(
      sorted([
        ['record_id', '=', 'C-1'],
        ['object_name', '=', 'contract'],
      ]),
    );
  });
});
