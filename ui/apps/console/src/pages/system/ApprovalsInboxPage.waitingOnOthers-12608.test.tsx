// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Approvals Inbox — the empty "pending" tab says who else is waiting
 * (objectui#12608).
 *
 * A caller with nothing pending read "You're all caught up" while the
 * environment held 53 pending requests, and nothing on the page said they were
 * waiting on someone else. When the caller's pending list is empty the page now
 * makes ONE count query (`listRequests` paged with `limit`, so the server
 * answers `total`) and, for a non-zero total, adds one muted line:
 * "N requests are waiting on other approvers · Browse all requests".
 *
 * Pinned here: the line for a non-zero count, nothing for zero, and nothing
 * when the count read fails.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const APP = 'com.objectstack.account';

const { approvalsApiStub, ADAPTER, AUTH, I18N } = vi.hoisted(() => {
  const approvalsApiStub = {
    listRequests: vi.fn(async (_params?: Record<string, unknown>): Promise<{ data: unknown[]; total?: number }> => ({ data: [] })),
    getRequest: vi.fn(async () => ({ data: undefined })),
    listActions: vi.fn(async () => ({ data: [] })),
    approve: vi.fn(async () => ({ data: undefined, finalized: true })),
    reject: vi.fn(async () => ({ data: undefined, finalized: true })),
  };
  const ADAPTER = { find: vi.fn(async () => ({ data: [] })) };
  const AUTH = { user: { id: 'u_1', email: 'approver@example.com' } };
  // Interpolates `{{count}}` into the inline default, as i18next would.
  const I18N = {
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{count\}\}/g, String(options?.count ?? '')),
    language: 'en',
  };
  return { approvalsApiStub, ADAPTER, AUTH, I18N };
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

/** The caller's own pending list is empty; the environment count is `total`. */
function stubEnvironment(total: number | Error) {
  approvalsApiStub.listRequests.mockImplementation(async (params?: Record<string, unknown>) => {
    const isCountQuery = params?.status === 'pending' && params?.limit != null && params?.approverId == null;
    if (!isCountQuery) return { data: [] };
    if (total instanceof Error) throw total;
    return { data: [], total };
  });
}

function renderInbox() {
  return render(
    <MemoryRouter initialEntries={[`/apps/${APP}/system/approvals`]}>
      <Routes>
        <Route path="/apps/:appName/system/approvals" element={<ApprovalsInboxPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function countQueries() {
  return approvalsApiStub.listRequests.mock.calls.filter(
    ([params]) => params?.status === 'pending' && params?.limit != null && params?.approverId == null,
  );
}

beforeEach(() => {
  for (const fn of Object.values(approvalsApiStub)) fn.mockReset();
});
afterEach(cleanup);

describe('Approvals Inbox — the empty pending tab names who else is waiting (objectui#12608)', () => {
  it('renders the "waiting on other approvers" line for a non-zero environment count', async () => {
    stubEnvironment(53);
    renderInbox();

    const line = await screen.findByTestId('approvals-inbox-waiting-on-others');
    expect(line).toHaveTextContent('53 requests are waiting on other approvers · Browse all requests');
    expect(line).toHaveClass('text-muted-foreground');
    // ONE count query, paged so the server answers `total`.
    expect(countQueries()).toHaveLength(1);
    expect(countQueries()[0][0]).toMatchObject({ status: 'pending', limit: 1 });
    // "Browse all requests" is drawn once, inside the line.
    expect(screen.getAllByRole('button', { name: 'Browse all requests' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Browse all requests' }));
    await waitFor(() =>
      expect(approvalsApiStub.listRequests).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, offset: 0 })),
    );
  });

  it('renders nothing extra for a zero environment count', async () => {
    stubEnvironment(0);
    renderInbox();

    await waitFor(() => expect(countQueries()).toHaveLength(1));
    // Let the count answer land before asserting the absence.
    await screen.findByText("You're all caught up — nothing is waiting on you.");
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('approvals-inbox-waiting-on-others')).toBeNull();
    expect(screen.getByRole('button', { name: 'Browse all requests' })).toBeInTheDocument();
  });

  it('renders nothing extra when the count read fails', async () => {
    stubEnvironment(new Error('403'));
    renderInbox();

    await waitFor(() => expect(countQueries()).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('approvals-inbox-waiting-on-others')).toBeNull();
  });
});
