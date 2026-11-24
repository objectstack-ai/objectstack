// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Approvals Inbox — the status filter offers every status a row can show,
 * Cancelled included (objectstack#36960).
 *
 * The select on the paginated tabs ("Submitted by me", "All") listed five
 * statuses by hand. `cancelled` — the terminal state the platform writes when
 * it voids a request (objectstack#13568) — was missing, although its rows show
 * in the same list with their own badge and the server answers
 * `?status=cancelled`. The options now come from the contract's
 * `APPROVAL_STATUSES`.
 *
 * What this file pins, through the real page AND the real `approvalsApi`:
 *   - the option list is exactly "All statuses" plus one entry per
 *     `APPROVAL_STATUSES` value, labelled the way the badges are;
 *   - choosing Cancelled sends `status=cancelled` on the wire;
 *   - choosing an existing status (Rejected) still sends its own token — the
 *     control that keeps the Cancelled case from passing on a select that
 *     sends nothing, or the same thing for every option.
 *
 * The siblings stub `approvalsApi` and read the arguments the page handed it.
 * This file keeps it real and stubs the authenticated fetch underneath, so the
 * assertion is the request URL the server would receive, not an argument
 * object that a later serialisation step could still drop.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { APPROVAL_STATUSES } from '@objectstack/spec/contracts';

const APP = 'com.objectstack.account';

const { authFetch, ADAPTER, AUTH, I18N } = vi.hoisted(() => {
  const base = {
    process_name: 'leave_approval',
    process_label: 'Leave Approval',
    object_name: 'showcase_leave_request',
    object_label: 'Leave Request',
    submitted_at: '2026-09-01T00:00:00.000Z',
    created_at: '2026-09-01T00:00:00.000Z',
  };
  const rows = [
    { ...base, id: 'req_ok', record_id: 'rec_ok', record_title: 'LR-00001', status: 'approved', submitter_id: 'u_a', submitter_name: 'Ada Approved' },
    { ...base, id: 'req_void', record_id: 'rec_void', record_title: 'LR-00002', status: 'cancelled', cancel_reason: 'record_deleted', submitter_id: 'u_c', submitter_name: 'Cyd Cancelled' },
  ];

  // Every request the page makes goes through here. The request list answers
  // the rows; anything else answers an empty body, as the siblings' stub does.
  const authFetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/approvals/requests?')
      ? { data: rows, total: rows.length }
      : {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  // STABLE singletons: a mocked hook that returns a fresh object per render
  // re-runs the page's load effect forever (see the sibling suites).
  const ADAPTER = { find: vi.fn(async () => ({ data: [] })) };
  const AUTH = { user: { id: 'u_1', email: 'approver@example.com' } };
  const I18N = {
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
    language: 'en',
  };

  return { authFetch, ADAPTER, AUTH, I18N };
});

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => I18N,
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => AUTH,
  createAuthenticatedFetch: () => authFetch,
  TokenStorage: { get: () => null },
}));

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
  DeclaredActionsBar: () => null,
  isViaOverrideRow: () => false,
}));

// `../../services/approvalsApi` stays REAL: the URL it builds is the observable.

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

/** The `status` query value of every request-list call made so far. */
function listStatuses(): Array<string | null> {
  return authFetch.mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.includes('/approvals/requests?'))
    .map((url) => new URL(url, 'http://inbox.test').searchParams.get('status'));
}

/** Land on "All", where cancelled rows live, and open the status select. */
async function openStatusSelectOnAllTab(): Promise<void> {
  renderInbox();
  const allTab = await screen.findByRole('tab', { name: /^All/ });
  fireEvent.mouseDown(allTab);
  fireEvent.click(allTab);
  // Each request renders twice (desktop table + mobile card): `findAll`.
  await screen.findAllByText('Cyd Cancelled');
  const trigger = (await screen.findAllByRole('combobox'))
    .find((el) => el.textContent?.includes('All statuses'));
  expect(trigger, 'the status select is drawn on the All tab').toBeTruthy();
  fireEvent.pointerDown(trigger!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await screen.findByRole('option', { name: 'All statuses' });
}

/** Choose `label` and wait for the list request that carries `token`. */
async function choose(label: string, token: string): Promise<void> {
  fireEvent.click(screen.getByRole('option', { name: label }));
  await waitFor(() => expect(listStatuses()).toContain(token));
}

beforeAll(() => {
  // Radix Select drives its trigger off pointer events, which the DOM shim
  // does not implement — the same shim the sibling sort-select pins install.
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
  authFetch.mockClear();
});
afterEach(cleanup);

describe('Approvals Inbox — the status filter offers every contract status (objectstack#36960)', () => {
  it('lists "All statuses" and one option per APPROVAL_STATUSES value, Cancelled included', async () => {
    await openStatusSelectOnAllTab();
    const names = screen.getAllByRole('option').map((o) => o.textContent);
    expect(names).toHaveLength(1 + APPROVAL_STATUSES.length);
    expect(names).toEqual([
      'All statuses',
      'Pending',
      'Approved',
      'Rejected',
      'Recalled',
      'Returned for revision',
      'Cancelled',
    ]);
  });

  it('choosing Cancelled asks the server for status=cancelled', async () => {
    await openStatusSelectOnAllTab();
    expect(listStatuses()).not.toContain('cancelled');
    await choose('Cancelled', 'cancelled');
  });

  it('control: choosing an existing status (Rejected) still sends its own token', async () => {
    await openStatusSelectOnAllTab();
    expect(listStatuses()).not.toContain('rejected');
    await choose('Rejected', 'rejected');
    expect(listStatuses()).not.toContain('cancelled');
  });
});
