// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12741 — a related list's "View all" opens the child object's list
 * page, scoped to this parent on the list's own relationship (ENFORCE, the
 * objectui half of objectstack-ai/objectstack#23941).
 *
 * The spec declares `record:related_list.showViewAll` as
 * `z.boolean().default(true)`, "Show 'View All' link to see all related
 * records". The destination is the console's ADR-0055 bare data surface,
 * `/apps/:app/:object/data?filter[FIELD]=VALUE`, which is the route
 * `useOpenRecordList` already drills to. It is not anchored to a saved view,
 * so it shows every related record.
 *
 * Every case mounts what a record page mounts: the real
 * `RelatedRecordActionsBridge` under a router, around the `{ type, properties }`
 * node through the real `SchemaRenderer`, `@object-ui/plugin-detail`'s
 * registration, the real `RelatedList` and the real data table. The oracle for
 * the destination is the READ side of the same URL family
 * (`parseUrlFilterTriples`, what `ObjectDataPage` parses), so the pin does not
 * restate how a filter is spelled.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import '@testing-library/jest-dom';
import { MetadataCtx, RecordContextProvider, SchemaRenderer, type MetadataContextValue } from '@object-ui/react';
import { PermissionProvider } from '@object-ui/permissions';
// Registers `record:related_list` — the block a record page draws a related
// list with. Module scope on purpose (AGENTS.md, test discipline).
import '@object-ui/plugin-detail';

import { RelatedRecordActionsBridge } from '../RelatedRecordActionsBridge';
import { parseUrlFilterTriples } from '../drillUrlFilters';

/** Desktop, pinned (objectui#8399): under 768px a table related list is a card gallery. */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

afterEach(() => cleanup());

const APP = 'demo';
const PARENT_ROUTE = `/apps/${APP}/project/record/P-1`;

const childOf = (projectField: Record<string, unknown>) => ({
  name: 'task',
  label: 'Task',
  fields: { name: { type: 'text', label: 'Name' }, project: projectField },
});
const SINGLE = childOf({ type: 'lookup', reference: 'project', label: 'Project' });
const MULTI = childOf({ type: 'lookup', reference: 'project', label: 'Projects', multiple: true });

/** Two rows, under the spec's default `limit` of 5: every row fits on the list. */
const ROWS = [
  { id: 't1', name: 'Write spec', project: 'P-1' },
  { id: 't2', name: 'Review spec', project: 'P-1' },
];

const metadataFor = (child: ReturnType<typeof childOf>): MetadataContextValue => ({
  apps: [],
  objects: [child],
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: (async () => child) as unknown as MetadataContextValue['getItem'],
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
});

/** The router's own location: where a click took us. */
function RouterLocation() {
  const location = useLocation();
  return <output data-testid="router-location">{`${location.pathname}${location.search}`}</output>;
}

/** The role-based provider, letting `viewer` read `task` with the named fields denied. */
const denying = (fields: string[]) => (node: React.ReactElement) => (
  <PermissionProvider
    roles={[]}
    userRoles={['viewer']}
    permissions={
      [
        {
          object: 'task',
          roles: { viewer: { actions: ['read'], fieldPermissions: fields.map((field) => ({ field, read: false })) } },
        },
      ] as never
    }
  >
    {node}
  </PermissionProvider>
);

function mount({
  child = SINGLE,
  properties = {},
  wrap = (node: React.ReactElement) => node,
}: {
  child?: ReturnType<typeof childOf>;
  properties?: Record<string, unknown>;
  wrap?: (node: React.ReactElement) => React.ReactElement;
} = {}) {
  const dataSource = {
    find: vi.fn(async () => ROWS),
    getObjectSchema: vi.fn(async () => child),
  };
  const doc = {
    type: 'record:related_list',
    properties: { objectName: 'task', relationshipField: 'project', columns: ['name'], ...properties },
  };
  return render(
    <MetadataCtx.Provider value={metadataFor(child)}>
      <MemoryRouter initialEntries={[PARENT_ROUTE]}>
        {wrap(
          <RelatedRecordActionsBridge
            appName={APP}
            objects={[child]}
            dataSource={dataSource}
            parentObjectName="project"
            parentRecordId="P-1"
            parentTitle="Launch"
            parentRecord={{ id: 'P-1', name: 'Launch' }}
          >
            <RecordContextProvider objectName="project" recordId="P-1" dataSource={dataSource as never}>
              <SchemaRenderer schema={doc as never} />
            </RecordContextProvider>
          </RelatedRecordActionsBridge>,
        )}
        <RouterLocation />
      </MemoryRouter>
    </MetadataCtx.Provider>,
  );
}

const viewAll = () => screen.queryByRole('button', { name: /view all/i });
const location = () => screen.getByTestId('router-location').textContent ?? '';
/** Every row painted: each "no link" read below is taken on a list that drew its records. */
const waitForRows = async () => {
  await screen.findByText('Write spec');
  await screen.findByText('Review spec');
};

describe('objectui#12741 — "View all" opens this parent’s children on the list route', () => {
  it('with `showViewAll` absent (the spec default) the link draws even when every row fits, and opens the scoped list', async () => {
    mount();
    await waitForRows();
    const link = viewAll();
    expect(link).toBeInTheDocument();
    expect(location()).toBe(PARENT_ROUTE);
    fireEvent.click(link!);
    const [path, search] = location().split('?');
    // The bare data surface — not the object route, which stacks the default
    // view's own filter on top and could hide related records.
    expect(path).toBe(`/apps/${APP}/task/data`);
    // Read back the way `ObjectDataPage` reads it: exactly one condition, the
    // list's relationship, equal to this parent.
    expect(parseUrlFilterTriples(new URLSearchParams(search))).toEqual([['project', '=', 'P-1']]);
  });

  it('`showViewAll: false` draws no link', async () => {
    mount({ properties: { showViewAll: false } });
    await waitForRows();
    expect(viewAll()).toBeNull();
  });

  it('a `multiple: true` relationship draws no link: the list route’s filter has no membership operator', async () => {
    mount({ child: MULTI });
    await waitForRows();
    expect(viewAll()).toBeNull();
  });

  it('a relationship field the viewer cannot read draws no link: the list route would drop the condition', async () => {
    mount({ wrap: denying(['project']) });
    await waitForRows();
    expect(viewAll()).toBeNull();
  });

  it('CONTROL: under the same provider, denying a field the relationship does not use, the link still draws', async () => {
    mount({ wrap: denying(['name_secret']) });
    await waitForRows();
    expect(viewAll()).toBeInTheDocument();
  });
});
