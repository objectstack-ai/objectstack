/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35601 — a list opened from a record's related tab (「↗」)
 * knows the record it came from. The record rides on the record trail
 * (`?from=`, its last entry); the condition itself stays the ordinary
 * `filter[FIELD]=ID` the related list always sent. The page then:
 *
 *   - names the record in the condition's tag (「所属 X：record ×」), not its id;
 *   - draws a breadcrumb back to it (object / record / this list);
 *   - offers 「重置」, which puts the sourced condition back after the reader
 *     changed or removed it;
 *   - opens New as that record's child (the record form overlay, linked).
 *
 * Control: the same filter without a trail is an ordinary filtered list.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
// The page reaches `@objectstack/lint` through a dynamic import; its first load is paid at collection, not inside a case.
import '@objectstack/lint';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({
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
    }),
    useFieldPermissions: () => ({ canRead: () => true, canWrite: () => true, permissions: [] }),
  };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

// Heavy children, all orthogonal to the chip row under test and each dragging in
// a plugin bundle — the same posture as the sibling create-affordance test on
// this page.
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: () => null,
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));
vi.mock('./CreateViewDialog', () => ({ CreateViewDialog: () => null }));
vi.mock('./metadata-admin/useMetadata', () => ({ useMetadataClient: () => ({}) }));

import { ObjectDataPage, sourceRelationshipField } from './ObjectDataPage';
import { ExpressionProvider } from '../providers/ExpressionProvider';
import { RECORD_TRAIL_PARAM } from '../urlParams';

const h = React.createElement;

const OBJECTS = [
  {
    name: 'task',
    label: 'Task',
    pluralLabel: 'Tasks',
    managedBy: 'platform',
    fields: {
      id: { type: 'text', label: 'Id' },
      subject: { type: 'text', label: 'Subject' },
      project: { type: 'lookup', reference: 'project', label: 'Project' },
      status: { type: 'text', label: 'Status' },
    },
  },
  { name: 'project', label: 'Project', pluralLabel: 'Projects', managedBy: 'platform', fields: { name: { type: 'text', label: 'Name' } } },
];

const TRAIL = encodeURIComponent(JSON.stringify([{ o: 'project', i: 'P-1', t: 'Launch' }]));

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

function Probe() {
  const location = useLocation();
  return h('output', { 'data-testid': 'probe' }, `${location.pathname}${location.search}`);
}

function renderAt(search: string) {
  return render(
    h(ExpressionProvider, {
      user: { id: 'u1', name: 'Ada', profile: 'admin' },
      children: h(
        MemoryRouter,
        { initialEntries: [`/apps/demo/task/data?${search}`] },
        h(Routes, null, h(Route, {
          path: '/apps/:appName/:objectName/data',
          element: h(React.Fragment, null, h(ObjectDataPage, { dataSource: makeDataSource(), objects: OBJECTS }), h(Probe)),
        })),
      ),
    }),
  );
}

const params = () => new URLSearchParams((screen.getByTestId('probe').textContent ?? '').split('?')[1] ?? '');
const chipText = (field: string) =>
  document.querySelector(`[data-testid="object-data-remove-filter-${field}"]`)?.previousElementSibling?.textContent ?? null;
const reset = () => screen.getByTestId('object-data-reset-source') as HTMLButtonElement;

beforeEach(() => {
  cleanup();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('a list opened from a related tab knows its record (objectstack#35601)', () => {
  it('the condition tag names the record, and a breadcrumb leads back to it', () => {
    renderAt(`filter[project]=P-1&${RECORD_TRAIL_PARAM}=${TRAIL}`);
    expect(chipText('project')).toBe('Launch');
    const crumbs = screen.getByTestId('object-data-source-crumbs');
    expect(crumbs.textContent).toBe('Projects/Launch/Tasks');
    expect(screen.getByTestId('object-data-source-record').getAttribute('href')).toContain('/apps/demo/project/record/P-1');
    // Already on the sourced condition: nothing to reset.
    expect(reset().disabled).toBe(true);
  });

  it('「重置」 puts the sourced condition back after the reader changed the filters', () => {
    renderAt(`filter[project]=P-1&filter[status]=open&${RECORD_TRAIL_PARAM}=${TRAIL}`);
    fireEvent.click(screen.getByTestId('object-data-remove-filter-project'));
    expect(params().get('filter[project]')).toBeNull();
    // The trail outlives the removed condition, so the way back stays.
    expect(reset().disabled).toBe(false);
    fireEvent.click(reset());
    expect(params().get('filter[project]')).toBe('P-1');
    expect(params().get('filter[status]')).toBeNull();
    expect(params().get(RECORD_TRAIL_PARAM)).not.toBeNull();
    expect(reset().disabled).toBe(true);
  });

  it('New opens the record form as that record\'s child', () => {
    renderAt(`filter[project]=P-1&${RECORD_TRAIL_PARAM}=${TRAIL}`);
    fireEvent.click(document.querySelector('[data-testid="object-data-new-button"]')!);
    expect(params().get('form')).toBe('new');
    expect(params().get('formObject')).toBe('task');
    expect(params().get('formLink')).toBe('project:P-1');
  });

  it('CONTROL — the same filter without a trail: the id, no breadcrumb, no reset', () => {
    renderAt('filter[project]=P-1');
    expect(chipText('project')).toBe('= P-1');
    expect(screen.queryByTestId('object-data-source-crumbs')).toBeNull();
    expect(screen.queryByTestId('object-data-reset-source')).toBeNull();
  });
});

describe('sourceRelationshipField', () => {
  it('is the one single-valued relationship to the source object, and none when that is ambiguous', () => {
    const source = { o: 'project', i: 'P-1' };
    expect(sourceRelationshipField(OBJECTS[0], source)).toBe('project');
    expect(sourceRelationshipField({ fields: { a: { type: 'lookup', reference: 'project' }, b: { type: 'lookup', reference: 'project' } } }, source)).toBeUndefined();
    expect(sourceRelationshipField({ fields: { a: { type: 'lookup', reference: 'project', multiple: true } } }, source)).toBeUndefined();
  });
});
