// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Approvals Inbox — a bulk run that settles after the user left the inbox
 * (objectstack#37328).
 *
 * The inbox dismisses the sticky partial-failure toasts it raised when it
 * unmounts. A bulk approve still running when the user leaves settles later
 * and raises its toast then: that toast was never registered for dismissal,
 * and its "Show all (M)" action called the gone page's state setters, so the
 * button opened nothing.
 *
 * Now a run that settles after the page unmounted touches none of the gone
 * page's state (no reload of its list or badge count), and its toast's
 * "Show all" goes back to the inbox the run started on and opens that run's
 * failed rows there. CONTROL: a run that settles while the inbox is mounted
 * keeps opening the dialog in place, without a navigation.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';

const APP = 'com.objectstack.account';
const INBOX = `/apps/${APP}/system/approvals`;
const ELSEWHERE = `/apps/${APP}/elsewhere`;

const { approvalsApiStub, ADAPTER, AUTH, I18N, rows } = vi.hoisted(() => {
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
  const approvalsApiStub = {
    listRequests: vi.fn(async () => ({ data: rows })),
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
  return { approvalsApiStub, ADAPTER, AUTH, I18N, rows };
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
  router.navigate = useNavigate();
  const loc = useLocation();
  if (router.locations[router.locations.length - 1]?.key !== loc.key) {
    router.locations.push({ pathname: loc.pathname, key: loc.key, state: loc.state });
  }
  return null;
}

/**
 * Render the inbox, select every row and confirm a bulk approve whose calls
 * wait on the returned `settle` — the run is in flight until it is called.
 */
async function startHeldBulkApprove() {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  approvalsApiStub.approve.mockImplementation((async (id: string) => {
    await gate;
    if (FAILING.has(id)) throw refused();
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
  // The run is going: its first decision is waiting on the gate.
  await waitFor(() => expect(approvalsApiStub.approve).toHaveBeenCalledTimes(1));
  return {
    settle: async () => {
      await act(async () => { release(); });
      await waitFor(() => expect(approvalsApiStub.approve).toHaveBeenCalledTimes(6));
      await waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(1));
    },
  };
}

/** The settled run's toast options. */
function failureToast(): Record<string, any> {
  const [title, options] = toasts.error.mock.calls[0] as [string, Record<string, any>];
  expect(title).toBe('1 succeeded, 5 failed');
  expect(options.action.label).toBe('Show all (5)');
  return options;
}

async function expectFailureDialog() {
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByText('Not decided: 5')).toBeInTheDocument();
  const items = within(within(dialog).getByTestId('approvals-bulk-failures')).getAllByRole('listitem');
  expect(items.map((li) => li.firstElementChild?.textContent)).toEqual([
    'Bulk Invoice 1', 'Bulk Invoice 2', 'Bulk Invoice 3', 'Bulk Invoice 4', 'Bulk Invoice 5',
  ]);
}

beforeEach(() => {
  for (const fn of Object.values(approvalsApiStub)) fn.mockClear();
  toasts.error.mockClear();
  toasts.success.mockClear();
  router.navigate = undefined;
  router.locations = [];
});
afterEach(() => {
  cleanup();
  approvalsApiStub.approve.mockReset();
  approvalsApiStub.approve.mockImplementation(async () => ({ data: rows[0], finalized: true }) as any);
});

describe('Approvals Inbox — a bulk run that settles after leaving the inbox (objectstack#37328)', () => {
  it('its "Show all" goes back to the inbox and opens that run\'s failed rows; the gone page is not touched', async () => {
    const { settle } = await startHeldBulkApprove();
    // Leave the inbox while the run is still going.
    act(() => { router.navigate!(ELSEWHERE); });
    expect(await screen.findByTestId('elsewhere')).toBeInTheDocument();
    expect(screen.queryByTestId('approvals-inbox-table-scroller')).toBeNull();
    const listReadsWhileAway = approvalsApiStub.listRequests.mock.calls.length;

    await settle();

    // The gone page is not touched: neither its list nor its badge count is
    // re-read for a page nobody sees.
    expect(approvalsApiStub.listRequests).toHaveBeenCalledTimes(listReadsWhileAway);
    expect(screen.getByTestId('elsewhere')).toBeInTheDocument();

    // "Show all" brings the user back to the inbox the run started on, and
    // the inbox opens THAT run's failed rows.
    const options = failureToast();
    act(() => options.action.onClick());
    await screen.findByTestId('approvals-inbox-table-scroller');
    expect(router.locations.some((l) => l.pathname === INBOX && l.key !== router.locations[0].key)).toBe(true);
    await expectFailureDialog();
    // The hand-over is dropped from the history entry once read, so a reload
    // or Back does not open the dialog again.
    await waitFor(() => {
      const last = router.locations[router.locations.length - 1];
      expect(last.pathname).toBe(INBOX);
      expect((last.state as Record<string, unknown> | null)?.approvalsBulkFailures).toBeUndefined();
    });
  });

  it('CONTROL: a run that settles while the inbox is mounted opens the dialog in place, without navigating', async () => {
    const { settle } = await startHeldBulkApprove();
    const listReadsBefore = approvalsApiStub.listRequests.mock.calls.length;
    await settle();
    // The mounted page reloads its list after the run.
    await waitFor(() => expect(approvalsApiStub.listRequests.mock.calls.length).toBeGreaterThan(listReadsBefore));
    const visited = router.locations.length;
    act(() => failureToast().action.onClick());
    await expectFailureDialog();
    expect(router.locations).toHaveLength(visited);
  });
});
