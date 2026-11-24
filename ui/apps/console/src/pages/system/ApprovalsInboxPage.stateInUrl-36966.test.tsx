// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Approvals Inbox — the tab, the filters, the search and the sort survive a
 * request's page and Back (objectstack#36966).
 *
 * All of it lived in component state, so the queue's remount on Back reset it:
 * the inbox came back on "My Pending" with every filter cleared. It now rides
 * the address (`approvalsInboxUrlState.ts`), written with REPLACE.
 *
 * Pinned here, on the real page under a memory router with a stub request
 * page: the round trip (set → open a row → Back → restored), a reload of the
 * written address, the history it writes (one entry, not one per change),
 * values the address carries that the inbox does not offer, the tab change's
 * reset, and the `?request=` deep link.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';

const APP = 'com.objectstack.account';
const INBOX = `/apps/${APP}/system/approvals`;

const { approvalsApiStub, ADAPTER, AUTH, I18N, ROWS } = vi.hoisted(() => {
  const row = (id: string, status: string, process: string, object: string, title: string, at: string) => ({
    id,
    process_name: `flow:${process.toLowerCase().replace(/ /g, '_')}`,
    process_label: process,
    object_name: object,
    object_label: object === 'invoice' ? 'Invoice' : 'Expense',
    record_id: `${id}_rec`,
    record_title: title,
    status,
    pending_approvers: status === 'pending' ? ['u_1'] : [],
    submitter_id: 'u_2',
    submitter_name: 'Sam Submitter',
    submitted_at: at,
    updated_at: at,
  });
  const ROWS = [
    row('req_1', 'pending', 'Invoice Approval', 'invoice', 'INV-1001', '2026-11-04T09:00:00.000Z'),
    row('req_2', 'recalled', 'Expense Approval', 'expense', 'EXP-2002', '2026-11-03T09:00:00.000Z'),
    row('req_3', 'approved', 'Invoice Approval', 'invoice', 'INV-3003', '2026-11-02T09:00:00.000Z'),
    row('req_4', 'recalled', 'Invoice Approval', 'invoice', 'INV-4004', '2026-11-01T09:00:00.000Z'),
  ];
  const approvalsApiStub = {
    listRequests: vi.fn(async (params?: Record<string, unknown>): Promise<{ data: unknown[]; total?: number }> => {
      if (params?.approverId) return { data: ROWS.filter((r) => r.status === 'pending') };
      // objectui#12608's environment count: nothing waits on anyone else here.
      if (params?.limit === 1) return { data: [], total: 0 };
      const q = typeof params?.q === 'string' ? params.q.toLowerCase() : '';
      const data = ROWS.filter((r) => (!params?.status || r.status === params.status)
        && (!q || r.record_title.toLowerCase().includes(q)));
      return { data, total: data.length };
    }),
    getRequest: vi.fn(async () => ({ data: undefined })),
    listActions: vi.fn(async () => ({ data: [] })),
    approve: vi.fn(async () => ({ data: undefined, finalized: true })),
    reject: vi.fn(async () => ({ data: undefined, finalized: true })),
  };
  const ADAPTER = { find: vi.fn(async () => ({ data: [] })) };
  const AUTH = { user: { id: 'u_1', email: 'approver@example.com' } };
  const I18N = {
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_, k) => String(options?.[k] ?? '')),
    language: 'en',
  };
  return { approvalsApiStub, ADAPTER, AUTH, I18N, ROWS };
});

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => I18N,
}));

vi.mock('@object-ui/auth', async (importOriginal) => {
  const authFetch = vi.fn(async () => new Response('{}', { status: 200 }));
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useAuth: () => AUTH,
    createAuthenticatedFetch: () => authFetch,
    TokenStorage: { get: () => null },
  };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
  DeclaredActionsBar: () => null,
  isViaOverrideRow: () => false,
}));

vi.mock('../../services/approvalsApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  approvalsApi: approvalsApiStub,
}));

import { ApprovalsInboxPage } from './ApprovalsInboxPage';

/** The request page, reduced to what a round trip needs: where it is, and Back. */
function RequestPageStub() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <output data-testid="request-page">{location.pathname}</output>
      <button type="button" onClick={() => navigate(-1)}>probe-back</button>
    </div>
  );
}

/** Where the router is. */
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LocationProbe />
      <Routes>
        <Route path="/apps/:appName/system/approvals" element={<ApprovalsInboxPage />} />
        <Route path="/apps/:appName/sys_approval_request/record/:recordId" element={<RequestPageStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId('where').textContent ?? '';

/** The titles of the table's rows, in order. */
function rowTitles(): string[] {
  const table = screen.queryByRole('table');
  if (!table) return [];
  return within(table).getAllByRole('row').slice(1)
    .map((tr) => ROWS.find((r) => tr.textContent?.includes(r.record_title))?.record_title ?? '?');
}

function trigger(text: string | RegExp): HTMLElement {
  const el = screen.getAllByRole('combobox').find((c) =>
    typeof text === 'string' ? c.textContent?.includes(text) : text.test(c.textContent ?? ''));
  if (!el) throw new Error(`no select showing ${String(text)}`);
  return el;
}

/** Pick an option the way a reviewer does. */
async function choose(current: string, option: string): Promise<void> {
  fireEvent.pointerDown(trigger(current), { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

function selectedTab(): string | undefined {
  return screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')?.textContent ?? undefined;
}

beforeAll(() => {
  // Radix Select drives its trigger off pointer events, which happy-dom does
  // not implement — the same shim the components-side Select tests install.
  class MockPointerEvent extends Event {
    button: number;
    ctrlKey: boolean;
    pointerType: string;
    constructor(type: string, props: PointerEventInit = {}) {
      super(type, props);
      this.button = props.button ?? 0;
      this.ctrlKey = props.ctrlKey ?? false;
      this.pointerType = props.pointerType ?? 'mouse';
    }
  }
  Object.assign(window, { PointerEvent: MockPointerEvent });
  Object.assign(HTMLElement.prototype, {
    hasPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    scrollIntoView: vi.fn(),
  });
});

beforeEach(() => {
  for (const fn of Object.values(approvalsApiStub)) fn.mockClear();
});
afterEach(cleanup);

describe('Approvals Inbox — the reading state survives a request page and Back (objectstack#36966)', () => {
  it('All + Recalled + object + sort + search → open a row → Back: the same tab, filters, search, sort and rows', async () => {
    renderAt(INBOX);
    await screen.findAllByText('INV-1001');

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'All' }), { button: 0 });
    await waitFor(() => expect(rowTitles()).toEqual(['INV-1001', 'EXP-2002', 'INV-3003', 'INV-4004']));
    await choose('All statuses', 'Recalled');
    await waitFor(() => expect(rowTitles()).toEqual(['EXP-2002', 'INV-4004']));
    await choose('All objects', 'Invoice');
    await choose('Newest first', 'Oldest first');
    // A search both recalled requests match, so the object select stays drawn.
    fireEvent.change(screen.getByPlaceholderText('Search record, process, requester…'), { target: { value: '00' } });
    await waitFor(() => expect(approvalsApiStub.listRequests).toHaveBeenCalledWith(
      expect.objectContaining({ q: '00', status: 'recalled' })));
    await waitFor(() => expect(rowTitles()).toEqual(['INV-4004']));

    fireEvent.click(screen.getAllByRole('row').find((r) => r.textContent?.includes('INV-4004'))!);
    expect(await screen.findByTestId('request-page')).toHaveTextContent(`/apps/${APP}/sys_approval_request/record/req_4`);

    fireEvent.click(screen.getByRole('button', { name: 'probe-back' }));
    await waitFor(() => expect(rowTitles()).toEqual(['INV-4004']));
    expect(selectedTab()).toBe('All');
    expect(trigger('Recalled')).toBeInTheDocument();
    expect(trigger('Invoice')).toBeInTheDocument();
    expect(trigger('Oldest first')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search record, process, requester…')).toHaveValue('00');
    const params = new URL(where(), 'http://x').searchParams;
    expect(Object.fromEntries(params)).toEqual({
      scope: 'all', status: 'recalled', object: 'invoice', sort: 'oldest', q: '00',
    });
  });

  it('a reload of the written address (a fresh mount) opens the same inbox, without waiting on a debounce', async () => {
    renderAt(`${INBOX}?scope=all&status=recalled&q=exp`);
    await waitFor(() => expect(rowTitles()).toEqual(['EXP-2002']));
    // The first server read already carries the address's query and status.
    const reads = approvalsApiStub.listRequests.mock.calls.map(([p]) => p).filter((p) => p?.limit === 50);
    expect(reads[0]).toMatchObject({ q: 'exp', status: 'recalled' });
    expect(selectedTab()).toBe('All');
  });

  it('a search typed and opened within the debounce still comes back on Back', async () => {
    renderAt(`${INBOX}?scope=all`);
    await waitFor(() => expect(rowTitles()).toHaveLength(4));
    fireEvent.change(screen.getByPlaceholderText('Search record, process, requester…'), { target: { value: 'zzz' } });
    // Opened at once: the debounced write has not landed yet.
    fireEvent.click(screen.getAllByRole('row').find((r) => r.textContent?.includes('INV-3003'))!);
    await screen.findByTestId('request-page');
    fireEvent.click(screen.getByRole('button', { name: 'probe-back' }));
    await waitFor(() => expect(screen.getByPlaceholderText('Search record, process, requester…')).toHaveValue('zzz'));
    expect(new URL(where(), 'http://x').searchParams.get('q')).toBe('zzz');
  });

  it('writes REPLACE: filter changes leave one history entry, so Back leaves the inbox', async () => {
    render(
      <MemoryRouter initialEntries={[`/apps/${APP}/home`, INBOX]} initialIndex={1}>
        <LocationProbe />
        <Routes>
          <Route path="/apps/:appName/home" element={<div>home-page</div>} />
          <Route path="/apps/:appName/system/approvals" element={<><ApprovalsInboxPage /><BackProbe /></>} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findAllByText('INV-1001');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'All' }), { button: 0 });
    await waitFor(() => expect(rowTitles()).toHaveLength(4));
    await choose('All statuses', 'Approved');
    await waitFor(() => expect(rowTitles()).toEqual(['INV-3003']));
    expect(where()).toBe(`${INBOX}?scope=all&status=approved`);

    fireEvent.click(screen.getByRole('button', { name: 'inbox-back' }));
    expect(await screen.findByText('home-page')).toBeInTheDocument();
  });

  it('values the inbox does not offer read as the defaults', async () => {
    renderAt(`${INBOX}?scope=bogus&status=approved&sort=sideways`);
    await screen.findAllByText('INV-1001');
    // An unknown tab is "My Pending"; a status there would hide rows behind a
    // control the tab does not draw, so it is not applied.
    expect(selectedTab()).toMatch(/^My Pending/);
    expect(rowTitles()).toEqual(['INV-1001']);
    expect(trigger('Newest first')).toBeInTheDocument();

    cleanup();
    renderAt(`${INBOX}?scope=all&status=withdrawn`);
    await waitFor(() => expect(rowTitles()).toHaveLength(4));
    expect(trigger('All statuses')).toBeInTheDocument();
    const reads = approvalsApiStub.listRequests.mock.calls.map(([p]) => p).filter((p) => p?.limit === 50);
    expect(reads.every((p) => p?.status === undefined)).toBe(true);
  });

  it('a process or object no row carries reads as "all" and leaves the address; one a row carries is kept', async () => {
    renderAt(`${INBOX}?scope=all&object=gone_object&process=Expense%20Approval`);
    await waitFor(() => expect(new URL(where(), 'http://x').searchParams.get('object')).toBeNull());
    expect(new URL(where(), 'http://x').searchParams.get('process')).toBe('Expense Approval');
    await waitFor(() => expect(rowTitles()).toEqual(['EXP-2002']));
  });

  it('changing tab clears the filters, search and sort from the address and keeps every other param', async () => {
    renderAt(`${INBOX}?scope=all&status=recalled&object=invoice&sort=oldest&q=inv&keep=1`);
    await waitFor(() => expect(rowTitles()).toEqual(['INV-4004']));
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Submitted by me' }), { button: 0 });
    await waitFor(() => expect(where()).toBe(`${INBOX}?scope=submitted&keep=1`));
    expect(screen.getByPlaceholderText('Search record, process, requester…')).toHaveValue('');
    fireEvent.mouseDown(screen.getByRole('tab', { name: /^My Pending/ }), { button: 0 });
    await waitFor(() => expect(where()).toBe(`${INBOX}?keep=1`));
  });

  it('the ?request= deep link still opens the request, whatever inbox state rides beside it', async () => {
    renderAt(`${INBOX}?request=req_2&scope=all&status=recalled`);
    expect(await screen.findByTestId('request-page')).toHaveTextContent(`/apps/${APP}/sys_approval_request/record/req_2`);
    // The deep link replaced itself: it drew no queue and read no list.
    expect(approvalsApiStub.listRequests).not.toHaveBeenCalled();
  });
});

function BackProbe() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>inbox-back</button>;
}
