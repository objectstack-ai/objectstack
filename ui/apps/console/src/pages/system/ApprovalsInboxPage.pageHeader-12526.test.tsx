// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Approvals Inbox — the page is named by the console's one page header, the one
 * an object list and a dashboard draw (objectui#12526).
 *
 * The inbox drew its own `h1` (a large icon and title), a subtitle line beneath
 * it and a Refresh button. It now renders `ConsolePageHeader`, the console
 * page header `@object-ui/app-shell` exports: icon chip, title, the subtitle
 * beside the title, Refresh among the actions, in one row.
 *
 * What this file pins, through the real page and the real header:
 *   - `page-header` holds the page's one `h1` ("Approvals Inbox"), the
 *     subtitle in the title's row, an icon in the chip, and Refresh;
 *   - Refresh in the header still reloads the requests;
 *   - the header spans the page above the padded body, not inside it.
 *
 * jsdom applies no stylesheet, so structure is what is asserted; the one-row
 * shape and its `sm` breakpoint are app-shell's `PageHeader.oneRow-12423` pins.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const APP = 'com.objectstack.account';

const { approvalsApiStub, ADAPTER, AUTH, I18N } = vi.hoisted(() => {
  const approvalsApiStub = {
    listRequests: vi.fn(async () => ({ data: [] })),
    getRequest: vi.fn(async () => ({ data: undefined })),
    listActions: vi.fn(async () => ({ data: [] })),
    approve: vi.fn(async () => ({ data: undefined, finalized: true })),
    reject: vi.fn(async () => ({ data: undefined, finalized: true })),
  };

  // STABLE singletons: a mocked hook that returns a fresh object per render
  // re-runs the page's load effect forever (see the sibling suites).
  const ADAPTER = { find: vi.fn(async () => ({ data: [] })) };
  const AUTH = { user: { id: 'u_1', email: 'approver@example.com' } };
  const I18N = {
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
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

// `ConsolePageHeader` stays REAL: the header under test is the package's.
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

function renderInbox() {
  return render(
    <MemoryRouter initialEntries={[`/apps/${APP}/system/approvals`]}>
      <Routes>
        <Route path="/apps/:appName/system/approvals" element={<ApprovalsInboxPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(approvalsApiStub)) fn.mockClear();
});
afterEach(cleanup);

describe('Approvals Inbox — the console page header (objectui#12526)', () => {
  it('`page-header` holds the one h1, the subtitle in its row, an icon chip and Refresh', async () => {
    const { container } = renderInbox();
    const header = screen.getByTestId('page-header');

    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(header.contains(h1s[0])).toBe(true);
    expect(h1s[0].textContent).toBe('Approvals Inbox');

    const line = within(header).getByText('Review and act on approval requests.');
    expect(line.tagName).toBe('P');
    expect(line.parentElement).toBe(h1s[0].parentElement);

    const chipIcon = h1s[0].parentElement!.querySelector('svg');
    expect(chipIcon).not.toBeNull();

    expect(within(header).getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    // Refresh is drawn once: the header's, not a second copy in the body.
    expect(screen.getAllByRole('button', { name: 'Refresh' })).toHaveLength(1);
    await waitFor(() => expect(approvalsApiStub.listRequests).toHaveBeenCalled());
  });

  it('Refresh in the header reloads the requests', async () => {
    renderInbox();
    const refresh = within(screen.getByTestId('page-header')).getByRole('button', { name: 'Refresh' });
    await waitFor(() => expect(refresh).not.toBeDisabled());
    const before = approvalsApiStub.listRequests.mock.calls.length;
    fireEvent.click(refresh);
    await waitFor(() => expect(approvalsApiStub.listRequests.mock.calls.length).toBeGreaterThan(before));
  });

  it('the header spans the page above the padded body, not inside it', async () => {
    renderInbox();
    const header = screen.getByTestId('page-header');
    const body = header.nextElementSibling as HTMLElement | null;
    expect(body).not.toBeNull();
    expect(body!.className.split(' ')).toEqual(expect.arrayContaining(['p-4', 'max-w-6xl']));
    expect(header.closest('.max-w-6xl')).toBeNull();
    await waitFor(() => expect(approvalsApiStub.listRequests).toHaveBeenCalled());
  });
});
