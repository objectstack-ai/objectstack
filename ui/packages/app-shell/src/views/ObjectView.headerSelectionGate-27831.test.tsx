/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27831 — a single-record action in a list's header is drawn the
 * way a launch of it would end.
 *
 * The showcase's Tasks → "Reassign…" (`type: 'flow'`, placed at `list_item` and
 * `list_toolbar`) was drawn enabled with nothing selected, and said "select a
 * row first" only after a click; on a list whose rows draw no checkbox it could
 * never work at all.
 *
 * The header asks the action runner for the early refusal its `execute` gives
 * before any dialog (`ActionRunner.launchRefusal`, which asks the dispatch
 * handler's `refuseBeforeInput` — `@object-ui/core`'s
 * `resolveServerActionRecordId`). It holds no rule of its own:
 *
 * - a refusal for the current selection draws the action disabled, with that
 *   refusal, in the session's language, as its reason;
 * - no refusal leaves the action as it was;
 * - a refusal where the list says its rows cannot be selected
 *   (`selectionAvailable: false`, published by the grid) leaves the action
 *   out: no selection can ever lift it.
 *
 * Everything here is the real chain: the real `ObjectView`, the real grid
 * publishing its selection into the runner context, the real `action:bar` →
 * `action:button`, the real console action runtime and its handlers.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { toast } from 'sonner';
import { createI18n, I18nProvider } from '@object-ui/i18n';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  // Stable identities — `ListView` names `perms` in its fetch dependencies.
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
  useAuth: () => ({ user: { id: 'u1', name: 'Member' }, activeOrganization: { id: 'org1', name: 'Acme' } }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  // The handlers' authenticated fetch, routed to the stubbed global.
  createAuthenticatedFetch: () => (url: string, init?: RequestInit) => fetch(url, init),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRealtimeSubscription: () => ({ lastMessage: null }),
  useConflictResolution: () => ({ hasConflicts: false, resolveAllConflicts: () => {} }),
}));

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => ({ save: vi.fn(async () => ({})), get: vi.fn(async () => null) }),
}));

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';
import { ConsoleToaster } from '../chrome/ConsoleToaster';

/** The showcase's Reassign…, as `examples/app-showcase` declares it. */
const REASSIGN = {
  name: 'showcase_bulk_reassign',
  label: 'Reassign…',
  icon: 'users',
  objectName: 'showcase_task',
  type: 'flow',
  target: 'showcase_reassign_wizard',
  locations: ['list_item', 'list_toolbar'],
  refreshAfter: true,
};

/** CONTROL: an object-level header action — declared at `list_toolbar` alone. */
const EXPORT_TASKS = {
  name: 'showcase_export_tasks',
  label: 'Export Tasks',
  objectName: 'showcase_task',
  type: 'script',
  locations: ['list_toolbar'],
};

const REASSIGN_URL = '/api/v1/actions/showcase_task/showcase_bulk_reassign';
const EXPORT_URL = '/api/v1/actions/showcase_task/showcase_export_tasks';

const LIST_VIEWS = {
  all: { name: 'all', label: 'All', type: 'grid', columns: ['name'], selection: { type: 'multiple' } },
  // A list whose rows draw no checkbox: the selection's own explicit off.
  unselectable: { name: 'unselectable', label: 'Unselectable', type: 'grid', columns: ['name'], selection: { type: 'none' } },
};

const OBJECTS = [
  {
    name: 'showcase_task',
    label: 'Task',
    pluralLabel: 'Tasks',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
    actions: [REASSIGN, EXPORT_TASKS],
    listViews: LIST_VIEWS,
  },
];

const TASKS = [
  { id: 'task_1', name: 'Draft the brief' },
  { id: 'task_2', name: 'Review the brief' },
  { id: 'task_3', name: 'Ship the brief' },
];

const ZERO_ROW_REFUSAL = 'This action runs on a single record — select a row first.';
const MULTI_ROW_REFUSAL = 'This action runs on a single record — select exactly one row.';
/** `actions.selectRowFirst` in the zh pack (pinned in `@object-ui/i18n`'s own suite). */
const ZERO_ROW_REFUSAL_ZH = '此操作针对单条记录，请先选择一行。';

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(async (url: unknown) => {
    const body = String(url).includes('/api/v1/actions/')
      ? { success: true, data: {} }
      : { data: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  act(() => { toast.dismiss(); });
  cleanup();
  vi.unstubAllGlobals();
});

function mountTasks(viewName: keyof typeof LIST_VIEWS, language = 'en') {
  const i18n = createI18n({ defaultLanguage: language, detectBrowserLanguage: false });
  const dataSource = {
    find: vi.fn(async () => ({ data: TASKS, total: TASKS.length })),
    findOne: vi.fn(async () => null),
    getObjectSchema: vi.fn(async (name: string) => OBJECTS.find((o) => o.name === name) ?? null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as never;
  return render(
    <I18nProvider instance={i18n}>
      <ConsoleToaster />
      <ExpressionProvider user={{ id: 'u1', name: 'Member' }}>
        <MemoryRouter initialEntries={[`/apps/showcase/showcase_task/view/${viewName}`]}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName/view/:viewId"
              element={<ObjectView dataSource={dataSource} objects={OBJECTS} onEdit={() => {}} />}
            />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>
    </I18nProvider>,
  );
}

const callsTo = (url: string) => fetchSpy.mock.calls.filter(([u]) => String(u).includes(url));

/** The page header, once its toolbar has drawn the control action. */
async function header(): Promise<HTMLElement> {
  const el = await screen.findByTestId('page-header', undefined, { timeout: 5000 });
  await within(el).findByRole('button', { name: /Export Tasks/ }, { timeout: 5000 });
  return el;
}

/** The grid's rows, once drawn. */
async function rowsDrawn(): Promise<void> {
  await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThanOrEqual(TASKS.length), { timeout: 5000 });
}

/** Tick the first `n` row checkboxes once the grid has drawn them. */
async function tickRows(n: number): Promise<void> {
  const boxes = await waitFor(() => {
    const found = Array.from(document.querySelectorAll('tbody [role="checkbox"]')) as HTMLElement[];
    expect(found).toHaveLength(TASKS.length);
    return found;
  }, { timeout: 5000 });
  for (const box of boxes.slice(0, n)) {
    await act(async () => { fireEvent.click(box); });
  }
}

const reassignIn = (el: HTMLElement) => within(el).queryByRole('button', { name: /Reassign/ });

/** The text of the description a control points `aria-describedby` at. */
function reasonOf(button: HTMLElement): string {
  const ids = (button.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
}

describe('objectstack#27831 — a record-scoped header action follows the row selection', () => {
  it('0 rows: drawn disabled, the early refusal as its reason, and a click sends nothing', async () => {
    mountTasks('all');
    const el = await header();
    await tickRows(0);

    const button = await waitFor(() => {
      const found = reassignIn(el);
      expect(found).toBeDisabled();
      return found!;
    }, { timeout: 5000 });
    expect(reasonOf(button)).toBe(ZERO_ROW_REFUSAL);
    // The tooltip trigger is the wrapper a disabled button needs to be hovered.
    expect(button.closest('[data-disabled-reason]')).not.toBeNull();

    fireEvent.click(button);
    expect(callsTo(REASSIGN_URL)).toHaveLength(0);
  });

  it('1 row: enabled, and a click dispatches it for that row', async () => {
    mountTasks('all');
    const el = await header();
    await tickRows(1);

    const button = await waitFor(() => {
      const found = reassignIn(el);
      expect(found).toBeEnabled();
      return found!;
    }, { timeout: 5000 });
    expect(button.closest('[data-disabled-reason]')).toBeNull();

    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(callsTo(REASSIGN_URL)).toHaveLength(1), { timeout: 5000 });
    expect(JSON.parse(String((callsTo(REASSIGN_URL)[0][1] as RequestInit).body)).recordId).toBe('task_1');
  });

  it('2 rows: drawn disabled again, with the "exactly one row" refusal as its reason', async () => {
    mountTasks('all');
    const el = await header();
    await tickRows(2);

    const button = await waitFor(() => {
      const found = reassignIn(el);
      expect(found).toBeDisabled();
      expect(reasonOf(found!)).toBe(MULTI_ROW_REFUSAL);
      return found!;
    }, { timeout: 5000 });

    fireEvent.click(button);
    expect(callsTo(REASSIGN_URL)).toHaveLength(0);
  });

  it('the reason is in the session\'s language, from the refusal\'s own pack key', async () => {
    mountTasks('all', 'zh');
    const el = await header();
    await tickRows(0);

    await waitFor(() => {
      const found = reassignIn(el);
      expect(found).toBeDisabled();
      expect(reasonOf(found!)).toBe(ZERO_ROW_REFUSAL_ZH);
    }, { timeout: 5000 });
  });

  it('a list whose rows cannot be selected: the record-scoped action is not drawn', async () => {
    mountTasks('unselectable');
    const el = await header();
    await rowsDrawn();
    expect(document.querySelectorAll('tbody [role="checkbox"]')).toHaveLength(0);

    await waitFor(() => expect(reassignIn(el)).toBeNull(), { timeout: 5000 });
  });

  it('CONTROL — an object-level header action is unaffected: enabled with 0 rows, and it dispatches', async () => {
    mountTasks('all');
    const el = await header();
    await tickRows(0);

    const button = within(el).getByRole('button', { name: /Export Tasks/ });
    expect(button).toBeEnabled();
    expect(button.closest('[data-disabled-reason]')).toBeNull();
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(callsTo(EXPORT_URL)).toHaveLength(1), { timeout: 5000 });
  });

  it('CONTROL — an object-level header action is drawn on a list whose rows cannot be selected', async () => {
    mountTasks('unselectable');
    const el = await header();
    await rowsDrawn();

    expect(within(el).getByRole('button', { name: /Export Tasks/ })).toBeEnabled();
  });
});
