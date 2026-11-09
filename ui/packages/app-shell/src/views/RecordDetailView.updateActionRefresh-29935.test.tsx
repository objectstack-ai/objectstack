/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29935 — after a successful declared `operation: 'update'` the
 * record page shows what the route wrote, with no `refreshAfter: true`.
 *
 * The spec materializes `refreshAfter: false` on an action authored without
 * it, and that parsed shape is what the Console is served. The runner hands an
 * update action to the page's registered `script` dispatch, whose refresh read
 * `refreshAfter !== false`: the route answered 200, the toast said "Ticket
 * resolved.", and the page kept the old status and the Resolve button whose
 * `visible` predicate was now false. A declared update's success is now a
 * record change.
 *
 * Where it reaches: the record-scoped `notifyDataChanged` the page sends
 * re-reads this record, and every list reader of the object
 * (`useDataInvalidation(objectName)` with no record id — the hook `ListView`
 * and `ObjectView` refetch on) refetches with its own filter, so the record
 * leaves a list it no longer matches. The drawer is this same view mounted
 * `embedded` beside its list.
 *
 * CONTROL: a non-update `script` action served with the same
 * `refreshAfter: false` still sends no re-read.
 *
 * Harness: the `RecordDetailView.apiNewTabUrl-26747` mount — the real record
 * page, header and runner, and the real console server-action handler, with
 * only the authenticated fetch answered here.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const authFetchSpy = vi.fn();
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: null, activeOrganization: null }),
  createAuthenticatedFetch: () => authFetchSpy,
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { toast } from 'sonner';
import { I18nProvider } from '@object-ui/i18n';
import { MetadataCtx, useDataInvalidation } from '@object-ui/react';
import { RecordDetailView } from './RecordDetailView';
import { FavoritesProvider } from '../context/FavoritesProvider';

const OBJECT_NAME = 'support_desk_ticket';
const RECORD_ID = 'tkt_1';
const OTHER_ID = 'tkt_2';
const RECORD_PATH = `/apps/support_desk/${OBJECT_NAME}/record/${RECORD_ID}`;
const ACTION_URL = `/api/v1/actions/${OBJECT_NAME}/resolve_ticket`;

const FIELDS = {
  id: { type: 'text', label: 'Id' },
  subject: { type: 'text', label: 'Subject' },
  status: {
    type: 'select',
    label: 'Status',
    options: [
      { value: 'open', label: 'Open' },
      { value: 'resolved', label: 'Resolved' },
      { value: 'closed', label: 'Closed' },
    ],
  },
};

/**
 * The tutorial's action as the Console is served it: parsed, so
 * `type: 'script'` and `refreshAfter: false` are materialized although the
 * author wrote neither.
 */
const resolveTicket = {
  name: 'resolve_ticket',
  label: 'Resolve',
  objectName: OBJECT_NAME,
  type: 'script',
  operation: 'update',
  patch: { status: 'resolved' },
  locations: ['record_header'],
  visible: 'record.status != "resolved" && record.status != "closed"',
  successMessage: 'Ticket resolved.',
  refreshAfter: false,
};

/** CONTROL: a server-side script action that writes nothing the page reads. */
const notifyOwner = {
  name: 'notify_owner',
  label: 'Notify owner',
  objectName: OBJECT_NAME,
  type: 'script',
  locations: ['record_header'],
  successMessage: 'Owner notified.',
  refreshAfter: false,
};

/** The stored rows; the action route writes here, the reads read here. */
let rows: Array<Record<string, unknown>>;

function makeDataSource() {
  return {
    find: vi.fn(async (_object: string, query?: { $filter?: Record<string, unknown> }) => {
      const status = query?.$filter?.status;
      const data = rows.filter((r) => status === undefined || r.status === status).map((r) => ({ ...r }));
      return { data, total: data.length };
    }),
    findOne: vi.fn(async (_object: string, id: string) => ({ ...rows.find((r) => r.id === id)! })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

/**
 * A list reader of the object — the `useDataInvalidation(objectName)` a list
 * view refetches on — drawing the Open list.
 */
function OpenTicketsProbe({ dataSource }: { dataSource: any }) {
  const nonce = useDataInvalidation(OBJECT_NAME);
  const [ids, setIds] = React.useState<string[] | null>(null);
  React.useEffect(() => {
    let live = true;
    void dataSource.find(OBJECT_NAME, { $filter: { status: 'open' } }).then((res: { data: Array<{ id: string }> }) => {
      if (live) setIds(res.data.map((r) => r.id));
    });
    return () => { live = false; };
  }, [dataSource, nonce]);
  return <ul data-testid="open-list">{(ids ?? []).map((id) => <li key={id}>{id}</li>)}</ul>;
}

async function mount(actions: unknown[], mode: 'page' | 'drawer') {
  const objects = [
    { name: OBJECT_NAME, label: 'Ticket', managedBy: 'platform', fields: FIELDS, actions },
  ];
  const metadata = {
    objects,
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
  } as any;
  const dataSource = makeDataSource();
  const view = mode === 'page'
    ? (
      <Routes>
        <Route
          path="/apps/:appName/:objectName/record/:recordId"
          element={<RecordDetailView dataSource={dataSource} objects={objects} onEdit={() => {}} />}
        />
      </Routes>
    )
    : (
      <>
        <OpenTicketsProbe dataSource={dataSource} />
        <RecordDetailView
          dataSource={dataSource}
          objects={objects}
          onEdit={() => {}}
          objectNameOverride={OBJECT_NAME}
          recordIdOverride={RECORD_ID}
          embedded
        />
      </>
    );
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <MetadataCtx.Provider value={metadata}>
        <FavoritesProvider>
          <MemoryRouter initialEntries={[RECORD_PATH]}>{view}</MemoryRouter>
        </FavoritesProvider>
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
  await waitFor(() => expect(dataSource.findOne).toHaveBeenCalled());
  await waitFor(() => expect(document.querySelector('[role="toolbar"]')).toBeTruthy());
  return dataSource;
}

/** Every inline CTA the header currently renders, by visible label. */
function headerCtaLabels(): string[] {
  const bar = document.querySelector('[role="toolbar"]');
  if (!bar) return [];
  return Array.from(bar.querySelectorAll('button'))
    .map((b) => (b.textContent ?? '').trim())
    .filter(Boolean);
}

/**
 * The header path bar's current stage, as each rendering of it (wide and
 * narrow) names it to assistive tech.
 */
function currentStages(): string[] {
  return Array.from(document.querySelectorAll('[role="listitem"][aria-current="step"]'))
    .map((el) => el.getAttribute('aria-label') ?? '');
}

function actionPosts(): string[] {
  return authFetchSpy.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes('/api/v1/actions/'));
}

async function click(label: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: label }));
  });
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  rows = [
    { id: RECORD_ID, subject: 'Printer jam', status: 'open' },
    { id: OTHER_ID, subject: 'VPN down', status: 'open' },
  ];
  authFetchSpy.mockReset();
  authFetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
    // The action route: write the declared patch AS the route does, answer
    // the declarative update's envelope with the written record.
    if (String(url).endsWith(ACTION_URL) && init?.method === 'POST') {
      const row = rows.find((r) => r.id === RECORD_ID)!;
      row.status = 'resolved';
      return new Response(
        JSON.stringify({ success: true, data: { ok: true, action: 'resolve_ticket', objectName: OBJECT_NAME, recordId: RECORD_ID, result: { ...row } } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ success: true, data: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('objectstack#29935 — a declared update action reflects its write on the record page', () => {
  it('full page: after the 200 the page re-reads, the path bar reads Resolved and the Resolve button is gone', async () => {
    const dataSource = await mount([resolveTicket], 'page');
    expect(headerCtaLabels()).toContain('Resolve');
    await waitFor(() => expect(currentStages()).toContain('Open, current stage'));
    const readsBefore = dataSource.findOne.mock.calls.length;

    await click('Resolve');

    expect(actionPosts()).toEqual([expect.stringContaining(ACTION_URL)]);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Ticket resolved.', expect.anything()));
    await waitFor(() => expect(dataSource.findOne.mock.calls.length).toBeGreaterThan(readsBefore));
    await waitFor(() => expect(headerCtaLabels()).not.toContain('Resolve'));
    await waitFor(() => expect(currentStages()).toContain('Resolved, current stage'));
    expect(currentStages()).not.toContain('Open, current stage');
  });

  it('drawer: the same click re-reads the record and the Open list it came from drops it', async () => {
    const dataSource = await mount([resolveTicket], 'drawer');
    const openList = () => Array.from(screen.getByTestId('open-list').querySelectorAll('li')).map((li) => li.textContent);
    await waitFor(() => expect(openList()).toEqual([RECORD_ID, OTHER_ID]));
    await waitFor(() => expect(currentStages()).toContain('Open, current stage'));
    const readsBefore = dataSource.findOne.mock.calls.length;

    await click('Resolve');

    await waitFor(() => expect(dataSource.findOne.mock.calls.length).toBeGreaterThan(readsBefore));
    await waitFor(() => expect(headerCtaLabels()).not.toContain('Resolve'));
    await waitFor(() => expect(currentStages()).toContain('Resolved, current stage'));
    await waitFor(() => expect(openList()).toEqual([OTHER_ID]));
  });

  it('CONTROL: a non-update script action served with `refreshAfter: false` sends no re-read', async () => {
    const dataSource = await mount([notifyOwner], 'page');
    const readsBefore = dataSource.findOne.mock.calls.length;

    await click('Notify owner');

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Owner notified.', expect.anything()));
    expect(actionPosts()).toEqual([expect.stringContaining(`/api/v1/actions/${OBJECT_NAME}/notify_owner`)]);
    // Let any refetch the click could have scheduled land before counting.
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(dataSource.findOne.mock.calls.length).toBe(readsBefore);
  });
});
