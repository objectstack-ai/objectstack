// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Approvals Inbox — a bulk run that settles after the user left and came back
 * reloads the inbox they came back to (objectstack#37548).
 *
 * A run that settles after its inbox unmounted touches none of the gone
 * page's state (objectstack#37328). Before this, it also told nobody else: a
 * fresh inbox the user had opened meanwhile kept the rows it read before the
 * run's decisions landed, and its badge kept the old count, until a manual
 * refresh. Now a settled run tells every inbox mounted then to reload its
 * list and badge, once. CONTROL: with no inbox mounted when the run settles,
 * nothing is re-read; and a run that settles in the inbox it started on
 * reloads that inbox once, as it did.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within, fireEvent, act } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';

const APP = 'com.objectstack.account';
const INBOX = `/apps/${APP}/system/approvals`;
const ELSEWHERE = `/apps/${APP}/elsewhere`;

const { approvalsApiStub, ADAPTER, AUTH, I18N, rows, decided } = vi.hoisted(() => {
  const rows = Array.from({ length: 6 }, (_, i) => ({
    id: `req_${i + 1}`,
    record_id: `inv_${i + 1}`,
    record_title: `Bulk Invoice ${i + 1}`,
    process_name: 'invoice_approval',
    process_label: 'Invoice Approval',
    object_name: 'showcase_invoice',
    object_label: 'Invoice',
    status: 'pending',
    pending_approvers: ['u_1'],
    submitter_id: 'u_2',
    submitter_name: 'Sam Submitter',
    submitted_at: `2026-08-${String(29 - i).padStart(2, '0')}T00:00:00.000Z`,
  }));
  /** Requests the run decided: the server no longer lists them as pending. */
  const decided = new Set<string>();
  const approvalsApiStub = {
    listRequests: vi.fn(async () => ({ data: rows.filter((r) => !decided.has(r.id)) })),
    getRequest: vi.fn(async (id: string) => ({ data: rows.find((r) => r.id === id) })),
    listActions: vi.fn(async () => ({ data: [] })),
    approve: vi.fn(async () => ({ data: rows[0], finalized: true })),
    reject: vi.fn(async () => ({ data: rows[0], finalized: true })),
  };
  // STABLE singletons: a fresh object per render re-runs the page's load
  // effect forever and the table never leaves its skeleton.
  const ADAPTER = {
    find: vi.fn(async (_object: string, params?: Record<string, unknown>) => {
      const ids = (params?.$filter as { id?: { $in?: string[] } } | undefined)?.id?.$in ?? [];
      return { data: ids.map((id) => ({ id })) };
    }),
  };
  const AUTH = { user: { id: 'u_1', email: 'approver@example.com' } };
  const I18N = {
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
        options && name in options ? String(options[name]) : whole),
    language: 'en',
  };
  return { approvalsApiStub, ADAPTER, AUTH, I18N, rows, decided };
});

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', async (importOriginal) => {
  const real = await importOriginal<Record<string, any>>();
  return { ...real, toast: Object.assign((...args: unknown[]) => real.toast(...args), real.toast, toasts) };
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

// Imported after the mocks so the page picks them up.
import { ApprovalsInboxPage } from './ApprovalsInboxPage';

const refused = () => Object.assign(new Error('INVALID_STATE: already decided'), {
  code: 'INVALID_STATE',
  status: 409,
  details: { code: 'INVALID_STATE', error: 'already decided' },
});
/** Rows 1–5 are refused, row 6 is approved: more failures than the toast lists. */
const FAILING = new Set(['req_1', 'req_2', 'req_3', 'req_4', 'req_5']);

/** The router's navigate and every location it reached, read from outside the page. */
const router: { navigate?: NavigateFunction; locations: Array<{ pathname: string; key: string; state: unknown }> } = {
  locations: [],
};
function RouterProbe() {
  const navigate = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    router.navigate = navigate;
    router.locations.push({ pathname: loc.pathname, key: loc.key, state: loc.state });
  }, [navigate, loc]);
  return null;
}

/**
 * Render the inbox, select every row and confirm a bulk approve whose calls
 * wait on the returned `settle` — the run is in flight until it is called.
 */
/** Render the inbox, select every row and confirm a bulk approve held until `settle`. */
async function startHeldBulkApprove() {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  approvalsApiStub.approve.mockImplementation((async (id: string) => {
    await gate;
    if (FAILING.has(id)) throw refused();
    decided.add(id);
    return { data: rows.find((r) => r.id === id), finalized: true };
  }) as any);
  render(
    <MemoryRouter initialEntries={[INBOX]}>
      <RouterProbe />
      <Routes>
        <Route path="/apps/:appName/system/approvals" element={<ApprovalsInboxPage />} />
        <Route path="/apps/:appName/elsewhere" element={<div data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
  const box = await screen.findByTestId('approvals-inbox-table-scroller');
  for (const r of rows) {
    const link = await within(box).findByRole('link', { name: r.record_title });
    fireEvent.click(within(link.closest('tr') as HTMLElement).getByRole('checkbox', { name: 'Select request' }));
  }
  fireEvent.click(await screen.findByRole('button', { name: 'Approve 6' }));
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Approve 6' }));
  await waitFor(() => expect(approvalsApiStub.approve).toHaveBeenCalledTimes(1));
  return {
    settle: async () => {
      await act(async () => { release(); });
      await waitFor(() => expect(approvalsApiStub.approve).toHaveBeenCalledTimes(6));
      await waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(1));
    },
  };
}

/** The pending tab's reads: its list and its badge each ask for the caller's pending requests. */
const pendingReads = () =>
  approvalsApiStub.listRequests.mock.calls.filter(([params]: any[]) =>
    params?.status === 'pending' && Array.isArray(params?.approverId)).length;

/** Let any late read land, so a count compared afterwards is final. */
async function quiet() {
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
}

/** The pending tab's badge count, or `null` when it shows none. */
function badgeCount(): string | null {
  const tab = screen.getByRole('tab', { name: /My Pending/ });
  return tab.querySelector('.ml-2')?.textContent ?? null;
}

beforeEach(() => {
  for (const fn of Object.values(approvalsApiStub)) fn.mockClear();
  toasts.error.mockClear();
  toasts.success.mockClear();
  decided.clear();
  router.navigate = undefined;
  router.locations = [];
});
afterEach(() => {
  cleanup();
  approvalsApiStub.approve.mockReset();
  approvalsApiStub.approve.mockImplementation(async () => ({ data: rows[0], finalized: true }) as any);
});

describe('Approvals Inbox — a late bulk run reloads the inbox mounted when it settles (objectstack#37548)', () => {
  it('leave, come back to a fresh inbox, let the run settle: the fresh inbox reloads its list and badge once', async () => {
    const { settle } = await startHeldBulkApprove();
    act(() => { router.navigate!(ELSEWHERE); });
    expect(await screen.findByTestId('elsewhere')).toBeInTheDocument();
    // Come back while the run is still going: a fresh inbox reads the rows
    // as they stand, none decided yet.
    act(() => { router.navigate!(INBOX); });
    const box = await screen.findByTestId('approvals-inbox-table-scroller');
    expect(await within(box).findByRole('link', { name: 'Bulk Invoice 6' })).toBeInTheDocument();
    await waitFor(() => expect(badgeCount()).toBe('6'));
    await quiet();
    const before = pendingReads();

    await settle();

    // The decided row leaves the fresh inbox's list and its badge count.
    await waitFor(() => expect(within(box).queryByRole('link', { name: 'Bulk Invoice 6' })).toBeNull());
    await waitFor(() => expect(badgeCount()).toBe('5'));
    await quiet();
    // Once: one list read and one badge read.
    expect(pendingReads() - before).toBe(2);
  });

  it('CONTROL: with no inbox mounted when the run settles, nothing is re-read', async () => {
    const { settle } = await startHeldBulkApprove();
    act(() => { router.navigate!(ELSEWHERE); });
    expect(await screen.findByTestId('elsewhere')).toBeInTheDocument();
    await quiet();
    const away = approvalsApiStub.listRequests.mock.calls.length;

    await settle();
    await quiet();

    expect(approvalsApiStub.listRequests).toHaveBeenCalledTimes(away);
  });

  it('CONTROL: a run that settles in the inbox it started on reloads that inbox once', async () => {
    const { settle } = await startHeldBulkApprove();
    await quiet();
    const before = pendingReads();

    await settle();

    const box = screen.getByTestId('approvals-inbox-table-scroller');
    await waitFor(() => expect(within(box).queryByRole('link', { name: 'Bulk Invoice 6' })).toBeNull());
    await quiet();
    expect(pendingReads() - before).toBe(2);
  });
});
