/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13310 — the `/data` page's auto-derived filter bar offers
 * single-value relation fields (`lookup` / `master_detail` / `user`), so
 * Organization -> Members -> "View all" can be filtered by User.
 *
 * "View all" opens `/apps/:app/:object/data`, which anchors no declared view
 * (objectui#12741), so the only filter bar there is the one
 * `ObjectDataPage` derives from the object definition. Before this change it
 * derived picklist-like fields only; a membership row could be narrowed by
 * role but never by the member.
 *
 * Harness: the real `ObjectDataPage`, with `ListView` replaced by a stand-in
 * that does what `ListView` does with the bar — it hands `schema.userFilters`,
 * the page's restored `uf_*` selections and its selection callback to the REAL
 * `UserFilters`, and records the conditions `UserFilters` emits (the conditions
 * `ListView` ANDs into the list query). The value picker is the real
 * `LookupValuePicker`, reading the data source from `SchemaRendererProvider`
 * exactly as it does in the console, where `ConsoleShell` provides it.
 *
 * Direction, written before the run: with the relation types dropped from the
 * generated set, the relation cases (the lookup and user chips, the id
 * condition, the `uf_*` round trip and the members ordering) go RED; the
 * picklist-only control and the multi-value exclusion stay GREEN.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { SchemaRendererProvider } from '@object-ui/react';

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
    useFieldPermissions: () => ({
      canRead: (field: string) => field !== 'secret_owner',
      canWrite: () => true,
      permissions: [],
    }),
  };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

/** Every condition list the stand-in `ListView` received from `UserFilters`. */
let emitted: unknown[][] = [];

vi.mock('@object-ui/plugin-list', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/plugin-list')>();
  const UserFilters = actual.UserFilters;
  return {
    ...actual,
    ListView: ({
      schema,
      userFilterSelections,
      onUserFilterSelectionsChange,
    }: {
      schema: { objectName: string; userFilters?: React.ComponentProps<typeof UserFilters>['config'] };
      userFilterSelections?: Record<string, string[]>;
      onUserFilterSelectionsChange?: (s: Record<string, Array<string | number | boolean>>) => void;
    }) => {
      const objectDef = OBJECTS.find((o) => o.name === schema.objectName);
      if (!schema.userFilters) return <div data-testid="no-user-filters" />;
      return (
        <UserFilters
          config={schema.userFilters}
          objectDef={objectDef}
          data={[]}
          onFilterChange={(conditions: unknown[]) => { emitted.push(conditions); }}
          maxVisible={3}
          initialSelections={userFilterSelections}
          onSelectionsChange={onUserFilterSelectionsChange}
        />
      );
    },
  };
});
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));
vi.mock('./CreateViewDialog', () => ({ CreateViewDialog: () => null }));
vi.mock('./metadata-admin/useMetadata', () => ({ useMetadataClient: () => ({}) }));

import { ObjectDataPage, deriveDataPageUserFilterFields } from './ObjectDataPage';
import { ExpressionProvider } from '../providers/ExpressionProvider';

/** `sys_member` as the platform declares it: two lookups and one picklist. */
const MEMBER = {
  name: 'sys_member',
  label: 'Member',
  fields: {
    id: { type: 'text', label: 'Member ID' },
    display_title: { type: 'formula', label: 'Title' },
    created_at: { type: 'datetime', label: 'Created At' },
    organization_id: { type: 'lookup', reference: 'sys_organization', label: 'Organization' },
    user_id: { type: 'lookup', reference: 'sys_user', label: 'User' },
    role: { type: 'select', label: 'Role', options: [{ value: 'member', label: 'Member' }] },
  },
};

/** A `user`-typed field, a multi-value relation, an unreadable one, and a hidden one. */
const TASK = {
  name: 'demo_task',
  label: 'Task',
  fields: {
    name: { type: 'text', label: 'Name' },
    assignee: { type: 'user', reference: 'sys_user', label: 'Assignee' },
    watchers: { type: 'user', reference: 'sys_user', multiple: true, label: 'Watchers' },
    related_tags: { type: 'lookup', reference: 'demo_tag', multiple: true, label: 'Tags' },
    secret_owner: { type: 'lookup', reference: 'sys_user', label: 'Secret owner' },
    org: { type: 'lookup', reference: 'sys_organization', hidden: true, label: 'Org' },
    vault: { type: 'lookup', reference: 'demo_vault', label: 'Vault' },
  },
};

/** Picklists only — the control: the bar it always rendered. */
const TICKET = {
  name: 'demo_ticket',
  label: 'Ticket',
  fields: {
    title: { type: 'text', label: 'Title' },
    status: { type: 'select', label: 'Status', options: [{ value: 'open', label: 'Open' }] },
    priority: { type: 'radio', label: 'Priority', options: [{ value: 'p1', label: 'P1' }] },
    urgent: { type: 'boolean', label: 'Urgent' },
  },
};

const OBJECTS = [MEMBER, TASK, TICKET];

const USERS = [
  { id: 'u_ada', name: 'Ada Lovelace' },
  { id: 'u_bob', name: 'Bob Builder' },
];

/** A member row per user, the rows the Members "View all" page lists. */
const MEMBER_ROWS = [{ id: 'm1', user_id: 'u_ada', role: 'member' }];

function makeDataSource() {
  return {
    find: vi.fn(async (object: string, params: { $filter?: { id?: { $in?: string[] } } } = {}) => {
      // The related object the caller may not read answers as the server
      // does: a refusal, never rows.
      if (object === 'demo_vault') throw new Error('Forbidden');
      if (object === 'sys_user') {
        const ids: string[] | undefined = params?.$filter?.id?.$in;
        const rows = ids ? USERS.filter((u) => ids.includes(u.id)) : USERS;
        return { data: rows, total: rows.length };
      }
      return { data: [], total: 0 };
    }),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  };
}

/** The router location, so a test can read the `uf_*` params the page wrote. */
const probe = { search: '' };
function LocationProbe() {
  const { search } = useLocation();
  React.useEffect(() => {
    probe.search = search;
  }, [search]);
  return null;
}

function renderDataPage(objectName: string, search = '') {
  // `ObjectDataPage` restores `uf_*` from `window.location` once at mount,
  // which is what a reload hands it.
  window.history.replaceState(null, '', `/${search}`);
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource as never}>
      <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
        <MemoryRouter initialEntries={[`/apps/demo/${objectName}/data${search}`]}>
          <LocationProbe />
          <Routes>
            <Route
              path="/apps/:appName/:objectName/data"
              element={<ObjectDataPage dataSource={dataSource} objects={OBJECTS} />}
            />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>
    </SchemaRendererProvider>,
  );
  return dataSource;
}

/** The field keys the generated bar renders, in bar order (overflow included). */
function barFields(): string[] {
  return Array.from(document.querySelectorAll('[data-testid^="filter-badge-"]')).map((el) =>
    (el.getAttribute('data-testid') ?? '').slice('filter-badge-'.length),
  );
}

/** The last `in` condition the bar emitted for `field`, or `undefined`. */
function lastConditionOn(field: string): unknown[] | undefined {
  for (let i = emitted.length - 1; i >= 0; i--) {
    const hit = (emitted[i] as unknown[][]).find((c) => c[0] === field);
    if (hit) return hit;
  }
  return undefined;
}

/** Rows the list query keeps under `[field, 'in', ids]` — the id predicate. */
function rowsKept(rows: Array<Record<string, unknown>>, condition: unknown[] | undefined) {
  if (!condition) return rows;
  const [field, op, ids] = condition as [string, string, unknown[]];
  expect(op).toBe('in');
  return rows.filter((r) => ids.includes(r[field]));
}

/** Open the `field` chip and pick the related record labelled `label`. */
async function pick(field: string, label: string) {
  // Each popover is opened only when it is not open already: a click on an
  // open trigger would close it.
  if (!screen.queryByTestId(`lookup-picker-${field}`)) {
    fireEvent.click(screen.getByTestId(`filter-badge-${field}`));
  }
  if (!screen.queryByTestId(`lookup-options-${field}`)) {
    fireEvent.click(screen.getByTestId(`lookup-picker-${field}`));
  }
  const options = await screen.findByTestId(`lookup-options-${field}`);
  const option = await within(options).findByText(label);
  fireEvent.click(option.closest('label')!.querySelector('button, input')!);
}

beforeEach(() => {
  emitted = [];
  probe.search = '';
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('objectui#13310 — the /data filter bar offers single-value relation fields', () => {
  it('(a) Members: the User lookup is in the bar and filters the rows by the picked user id', async () => {
    renderDataPage('sys_member');
    await waitFor(() => expect(barFields()).toContain('user_id'));
    expect(barFields()).toEqual(['role', 'organization_id', 'user_id']);

    await pick('user_id', 'Ada Lovelace');
    await waitFor(() => expect(lastConditionOn('user_id')).toEqual(['user_id', 'in', ['u_ada']]));
    // A member gives one row …
    expect(rowsKept(MEMBER_ROWS, lastConditionOn('user_id'))).toHaveLength(1);

    // … and a non-member gives none.
    fireEvent.click(screen.getByTestId('filter-clear-user_id'));
    await pick('user_id', 'Bob Builder');
    await waitFor(() => expect(lastConditionOn('user_id')).toEqual(['user_id', 'in', ['u_bob']]));
    expect(rowsKept(MEMBER_ROWS, lastConditionOn('user_id'))).toHaveLength(0);
  });

  it('(a) a `user`-typed field is in the bar and filters by the picked user id', async () => {
    renderDataPage('demo_task');
    await waitFor(() => expect(barFields()).toContain('assignee'));
    await pick('assignee', 'Ada Lovelace');
    await waitFor(() => expect(lastConditionOn('assignee')).toEqual(['assignee', 'in', ['u_ada']]));
  });

  it('(b) the picker queries the related object through the data source; an unreadable one offers no options', async () => {
    const dataSource = renderDataPage('demo_task');
    // The field is offered — matching `LookupValuePicker`, which scopes by
    // asking the caller's data source rather than by hiding the chip.
    await waitFor(() => expect(barFields()).toContain('vault'));
    fireEvent.click(screen.getByTestId('filter-badge-vault'));
    fireEvent.click(screen.getByTestId('lookup-picker-vault'));
    const options = await screen.findByTestId('lookup-options-vault');
    await waitFor(() => expect(dataSource.find).toHaveBeenCalledWith('demo_vault', expect.anything()));
    await waitFor(() => expect(options.querySelectorAll('label')).toHaveLength(0));
    expect(within(options).getByText('Forbidden')).toBeTruthy();
  });

  it('(c) control: an object with only picklist fields renders the bar it rendered before', async () => {
    renderDataPage('demo_ticket');
    await waitFor(() => expect(barFields().length).toBeGreaterThan(0));
    expect(barFields()).toEqual(['status', 'priority', 'urgent']);
    expect(document.querySelector('[data-testid^="filter-lookup-"]')).toBeNull();
  });

  it('(d) a multi-value relation, a hidden one and an unreadable one are not offered', async () => {
    renderDataPage('demo_task');
    await waitFor(() => expect(barFields()).toContain('assignee'));
    expect(barFields()).toEqual(['assignee', 'vault']);
  });

  it('(e) a relation filter round-trips through `uf_*` on reload; a stale id shows as the id', async () => {
    renderDataPage('sys_member');
    await waitFor(() => expect(barFields()).toContain('user_id'));
    await pick('user_id', 'Ada Lovelace');
    await waitFor(() => expect(new URLSearchParams(probe.search).get('uf_user_id')).toBe('u_ada'));
    const persisted = probe.search;
    cleanup();
    emitted = [];

    // Reload with the URL the page wrote.
    renderDataPage('sys_member', persisted);
    await waitFor(() => expect(lastConditionOn('user_id')).toEqual(['user_id', 'in', ['u_ada']]));
    fireEvent.click(screen.getByTestId('filter-badge-user_id'));
    await waitFor(() =>
      expect(screen.getByTestId('lookup-picker-user_id').textContent).toContain('Ada Lovelace'),
    );
    cleanup();
    emitted = [];

    // A stale id no longer resolves: the chip shows the id, not an error.
    renderDataPage('sys_member', '?uf_user_id=u_gone');
    await waitFor(() => expect(lastConditionOn('user_id')).toEqual(['user_id', 'in', ['u_gone']]));
    fireEvent.click(screen.getByTestId('filter-badge-user_id'));
    await waitFor(() => expect(screen.getByTestId('lookup-picker-user_id').textContent).toBe('u_gone'));
  });
});

describe('objectui#13310 — `deriveDataPageUserFilterFields` order and cap', () => {
  const all = () => true;

  it('picklists keep their slots: relations take only what the picklists leave under the cap', () => {
    const fields = {
      owner: { type: 'lookup', reference: 'sys_user' },
      a: { type: 'select' },
      b: { type: 'multiselect' },
      c: { type: 'radio' },
      d: { type: 'boolean' },
      e: { type: 'enum' },
    };
    expect(deriveDataPageUserFilterFields(fields, all).map((f) => f.field)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('relations follow the picklists in declaration order, under the same cap', () => {
    const fields = {
      account: { type: 'master_detail', reference: 'crm_account' },
      stage: { type: 'select' },
      owner: { type: 'user', reference: 'sys_user' },
      contact: { type: 'lookup', reference: 'crm_contact' },
      partner: { type: 'lookup', reference: 'crm_account' },
    };
    expect(deriveDataPageUserFilterFields(fields, all).map((f) => f.field)).toEqual([
      'stage',
      'account',
      'owner',
      'contact',
    ]);
  });

  it('no fields map derives no bar', () => {
    expect(deriveDataPageUserFilterFields(undefined, all)).toEqual([]);
  });
});
