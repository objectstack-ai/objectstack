// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11270 — the negative half: the child object's OWN list view does
 * not show a `record_related`-only action.
 *
 * `record_related` places an action on the rows of a related list inside a
 * parent record, and nowhere else (objectstack-ai/objectstack#20937, triage
 * `5919625056`). `list_item` is the location that places an action on the
 * object's rows everywhere it is listed. So the object list page's row menu
 * reads `list_item` and must keep ignoring `record_related`, while a
 * `list_item` action still reaches it — the control, over the SAME render, so
 * the absence cannot be a dead relay's.
 *
 * The positive half (the related-list rows inside a record show it) is
 * `__tests__/RelatedRecordActionsBridge.recordRelated-11270.test.tsx`.
 *
 * What is read: the `rowActionDefs` this page composes onto the list schema it
 * hands `ListView` — the one channel the object list's row menu is fed
 * through. `ListView` is replaced by a probe that records its `schema`; the
 * page and plugin-view's `ObjectView` (which calls `renderListView`) are real.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/** The member of the list schema this file reads. */
interface ListSchemaProbe {
  rowActionDefs?: ReadonlyArray<{ name: string }>;
}

/** The last list schema the page handed `ListView`. */
let listSchema: ListSchemaProbe | null = null;

vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: ({ schema }: { schema: ListSchemaProbe }) => {
    listSchema = schema;
    return null;
  },
}));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  // Stable identities, as the sibling ObjectView suites keep them.
  const perms = {
    check: () => ({ allowed: true }),
    checkField: () => true,
    getFieldPermissions: () => [],
    getRowFilter: () => undefined,
    getObjectApiOperations: () => undefined,
    roles: [],
    isLoaded: false,
    hasCapabilities: () => true,
    can: () => true,
    cannot: () => false,
  };
  const fieldPerms = { canRead: () => true, canWrite: () => true, permissions: [] };
  return { ...actual, usePermissions: () => perms, useFieldPermissions: () => fieldPerms };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRealtimeSubscription: () => ({ lastMessage: null }),
  useConflictResolution: () => ({ hasConflicts: false, resolveAllConflicts: () => {} }),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'task';

/** The same child actions the positive half places on related-list rows. */
const ACTIONS = [
  { name: 'send_reminder', label: 'Send Reminder', type: 'api', target: '/api/remind', locations: ['list_item'] },
  { name: 'log_time', label: 'Log Time', type: 'form', target: 'task.edit', locations: ['record_related'] },
  { name: 'archive', label: 'Archive', type: 'api', target: '/api/archive', locations: ['list_item', 'record_related'] },
];

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Task',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
    actions: ACTIONS,
    listViews: { all: { label: 'All', type: 'grid', columns: ['name'] } },
  },
];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

afterEach(() => {
  cleanup();
  listSchema = null;
});

describe('objectui#11270 — the child object’s own list view does not place `record_related`', () => {
  it('its row actions carry the `list_item` actions and not the `record_related`-only one', async () => {
    render(
      <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
        <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}/view/all`]}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName/view/:viewId"
              element={<ObjectView dataSource={makeDataSource()} objects={OBJECTS} onEdit={() => {}} />}
            />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>,
    );
    await waitFor(() => expect(listSchema).not.toBeNull());
    const names = (listSchema!.rowActionDefs ?? []).map((a) => a.name);
    // Control: the relay is alive, and `archive` (both locations) reaches the
    // list through its `list_item` half.
    expect(names).toEqual(['send_reminder', 'archive']);
    expect(names).not.toContain('log_time');
  });
});
