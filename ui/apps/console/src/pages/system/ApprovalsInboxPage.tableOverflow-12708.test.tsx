// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Approvals Inbox — a table wider than its panel says that it scrolls
 * (objectui#12708).
 *
 * At 1024 px the inbox's own table (Request, Record, Requester, Status,
 * Submitted, the inline Approve / Reject cell) is wider than its card: a long
 * record title holds the Record column open and the columns after it run past
 * the card's right edge, with nothing to say the table continues. The table
 * now sits in the shared overflow box (`HorizontalOverflowBox`): a shadow while
 * columns remain to the right, none at the right end, and its scrollbar on
 * hover. Since objectui#12816 that shadow is the pinned Approve / Reject
 * cells' seam (`ApprovalsInboxPage.pinnedActions-12816.test.tsx`).
 *
 * jsdom lays nothing out, so the box's scroll geometry is stubbed, as the
 * box's own pins in `@object-ui/components` stub it.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const APP = 'com.objectstack.account';

const { adapterFind, approvalsApiStub, ADAPTER, AUTH, I18N } = vi.hoisted(() => {
  const rows = [
    {
      id: 'req_readable',
      process_name: 'invoice_approval',
      process_label: 'Invoice Approval',
      object_name: 'showcase_invoice',
      object_label: 'Invoice',
      record_id: 'inv_readable',
      record_title: 'Readable Invoice',
      status: 'pending',
      pending_approvers: ['u_1'],
      submitter_id: 'u_2',
      submitter_name: 'Sam Submitter',
      submitted_at: '2026-08-19T00:00:00.000Z',
    },
    {
      id: 'req_hidden',
      process_name: 'invoice_approval',
      process_label: 'Invoice Approval',
      object_name: 'showcase_invoice',
      object_label: 'Invoice',
      record_id: 'inv_hidden',
      record_title: 'Hidden Invoice',
      status: 'pending',
      pending_approvers: ['u_1'],
      submitter_id: 'u_2',
      submitter_name: 'Sam Submitter',
      submitted_at: '2026-08-19T00:00:00.000Z',
    },
  ];

  /**
   * The server's own behaviour, reduced: a record the principal's grant filters
   * out never appears in the row set, so an `id in (…)` read simply comes back
   * without it. `inv_hidden` is that record.
   */
  const adapterFind = vi.fn(async (_object: string, params?: Record<string, unknown>) => {
    const ids = (params?.$filter as { id?: { $in?: string[] } } | undefined)?.id?.$in ?? [];
    return { data: ids.filter((id) => id !== 'inv_hidden').map((id) => ({ id })) };
  });

  const approvalsApiStub = {
    listRequests: vi.fn(async () => ({ data: rows })),
    getRequest: vi.fn(async (id: string) => ({ data: rows.find((r) => r.id === id) })),
    listActions: vi.fn(async () => ({ data: [] })),
    approve: vi.fn(async () => ({ data: rows[0], finalized: true })),
    reject: vi.fn(async () => ({ data: rows[0], finalized: true })),
  };

  // STABLE singletons. A mocked hook that returns a fresh object per render
  // gives every render a new `user` / `adapter` identity, which re-runs the
  // page's load effect (and the probe's) forever — the page never leaves its
  // loading skeleton and every query below times out on an empty table.
  const ADAPTER = { find: adapterFind };
  const AUTH = { user: { id: 'u_1', email: 'approver@example.com' } };
  const I18N = {
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
    language: 'en',
  };

  return { adapterFind, approvalsApiStub, rows, ADAPTER, AUTH, I18N };
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

// `buildApproverIdentities` stays REAL — the "can this approver act" pin is only
// worth anything if the identity resolution under it is the shipped one.
vi.mock('../../services/approvalsApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  approvalsApi: approvalsApiStub,
}));

// Imported after the mocks so the page picks them up.
import { ApprovalsInboxPage } from './ApprovalsInboxPage';

function renderInbox() {
  return render(
    <MemoryRouter initialEntries={[`/apps/${APP}/system/approvals`]}>
      <Routes>
        <Route path="/apps/:appName/system/approvals" element={<ApprovalsInboxPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function setGeometry(box: HTMLElement, g: { scrollLeft: number; scrollWidth: number; clientWidth: number }) {
  Object.defineProperty(box, 'scrollWidth', { configurable: true, value: g.scrollWidth });
  Object.defineProperty(box, 'clientWidth', { configurable: true, value: g.clientWidth });
  box.scrollLeft = g.scrollLeft;
  act(() => { fireEvent.scroll(box); });
}

beforeEach(() => {
  for (const fn of Object.values(approvalsApiStub)) fn.mockClear();
  adapterFind.mockClear();
});
afterEach(cleanup);

describe('Approvals Inbox — the wide table shows that it scrolls (objectui#12708)', () => {
  it('the table is inside the shared overflow box, which owns the horizontal scroll', async () => {
    renderInbox();
    await waitFor(() => expect(screen.getAllByText('Readable Invoice').length).toBeGreaterThan(0));
    const box = screen.getByTestId('approvals-inbox-table-scroller');
    const table = box.querySelector('table');
    expect(table).not.toBeNull();
    expect(table!.textContent).toContain('Submitted');
    expect(box).toHaveClass('overflow-x-auto');
    // The table's own wrapper no longer scrolls: the box is the one scroller.
    expect(table!.parentElement).toHaveClass('overflow-visible');
  });

  // objectui#12816 pins the Approve / Reject column right, so the cue moved
  // from the box's edge overlay to the pinned cells' seam (`seam="pinned"`):
  // the box says it can scroll further right, and no edge overlay is drawn.
  it('marks the box while the table is wider than it, and not at the right end', async () => {
    renderInbox();
    await waitFor(() => expect(screen.getAllByText('Readable Invoice').length).toBeGreaterThan(0));
    const box = screen.getByTestId('approvals-inbox-table-scroller');
    expect(box).not.toHaveAttribute('data-overflow-right');

    setGeometry(box, { scrollLeft: 0, scrollWidth: 1071, clientWidth: 718 });
    expect(box).toHaveAttribute('data-overflow-right', 'true');
    expect(screen.queryByTestId('horizontal-overflow-shadow')).toBeNull();

    setGeometry(box, { scrollLeft: 1071 - 718, scrollWidth: 1071, clientWidth: 718 });
    expect(box).not.toHaveAttribute('data-overflow-right');
  });
});
