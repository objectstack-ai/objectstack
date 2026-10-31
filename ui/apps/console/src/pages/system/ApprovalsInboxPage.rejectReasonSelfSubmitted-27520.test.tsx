// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27520 row 12 — deciding from the queue.
 *
 * - **Reject takes an optional reason.** The row's Reject confirmation, and the
 *   bulk one, offer a comment box; what the approver types reaches the reject
 *   call as `comment`, the field the approvals REST door already accepts and
 *   records on the request's timeline. Left empty, the call carries no
 *   `comment` at all, as before.
 * - **A request the viewer submitted says so.** The row reads the server's own
 *   `viewer.is_submitter` (attached by the approvals list read) and marks the
 *   requester "You submitted this". Who may decide is unchanged: the marker
 *   informs, it gates nothing.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const APP = 'account';

const { approvalsApiStub, rows, ADAPTER, AUTH, I18N } = vi.hoisted(() => {
  const base = {
    process_name: 'invoice_approval',
    process_label: 'Invoice Approval',
    object_name: 'showcase_invoice',
    object_label: 'Invoice',
    status: 'pending',
    pending_approvers: ['u_1'],
    submitted_at: '2026-10-20T00:00:00.000Z',
  };
  const rows = [
    {
      ...base,
      id: 'req_other',
      record_id: 'inv_other',
      record_title: 'Someone Else Invoice',
      submitter_id: 'u_2',
      submitter_name: 'Sam Submitter',
      viewer: { can_act: true, is_submitter: false, can_override: true },
    },
    {
      ...base,
      id: 'req_mine',
      record_id: 'inv_mine',
      record_title: 'My Own Invoice',
      submitter_id: 'u_1',
      submitter_name: 'Ada Admin',
      viewer: { can_act: true, is_submitter: true, can_override: true },
    },
  ];

  const approvalsApiStub = {
    listRequests: vi.fn(async () => ({ data: rows })),
    getRequest: vi.fn(async (id: string) => ({ data: rows.find((r) => r.id === id) })),
    listActions: vi.fn(async () => ({ data: [] })),
    approve: vi.fn(async () => ({ data: rows[0], finalized: true })),
    reject: vi.fn(async () => ({ data: rows[0], finalized: true })),
  };

  // STABLE singletons: a fresh identity per render re-runs the load effect forever.
  const ADAPTER = {
    find: vi.fn(async (_object: string, params?: Record<string, unknown>) => {
      const ids = (params?.$filter as { id?: { $in?: string[] } } | undefined)?.id?.$in ?? [];
      return { data: ids.map((id) => ({ id })) };
    }),
  };
  const AUTH = { user: { id: 'u_1', email: 'ada@example.com' } };
  const I18N = {
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
    language: 'en',
  };

  return { approvalsApiStub, rows, ADAPTER, AUTH, I18N };
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

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

vi.mock('../../services/approvalsApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  approvalsApi: approvalsApiStub,
}));

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

/** The desktop table row holding `title`. */
async function rowFor(title: string): Promise<HTMLElement> {
  await screen.findAllByText(title, undefined, { timeout: 8000 });
  const found = screen.getAllByRole('row').find((r) => within(r).queryByText(title));
  if (!found) throw new Error(`no row for ${title}`);
  return found;
}

/** The mobile card holding `title` (a card is not a table row). */
function cardFor(title: string): HTMLElement {
  const card = screen.getAllByText(title).map((el) => el.closest('.md\\:hidden > *')).find(Boolean);
  if (!card) throw new Error(`no card for ${title}`);
  return card as HTMLElement;
}

beforeEach(() => {
  for (const fn of Object.values(approvalsApiStub)) fn.mockClear();
});
afterEach(cleanup);

describe('Reject from the queue takes an optional reason (objectstack#27520 row 12)', () => {
  it('the row confirmation sends what the approver typed as the comment', async () => {
    renderInbox();
    fireEvent.click(within(await rowFor('Someone Else Invoice')).getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Comment (optional)' }), {
      target: { value: '  Missing the signed PO.  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(approvalsApiStub.reject).toHaveBeenCalledTimes(1));
    expect(approvalsApiStub.reject).toHaveBeenCalledWith('req_other', { actor_id: 'u_1', comment: 'Missing the signed PO.' });
  });

  it('left empty, the reject carries no comment, and a reopened dialog starts empty', async () => {
    renderInbox();
    const row = await rowFor('Someone Else Invoice');
    fireEvent.click(within(row).getByRole('button', { name: 'Reject' }));
    let dialog = await screen.findByRole('alertdialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Comment (optional)' }), { target: { value: 'draft' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    fireEvent.click(within(await rowFor('Someone Else Invoice')).getByRole('button', { name: 'Reject' }));
    dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('textbox', { name: 'Comment (optional)' })).toHaveValue('');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(approvalsApiStub.reject).toHaveBeenCalledTimes(1));
    expect(approvalsApiStub.reject).toHaveBeenCalledWith('req_other', { actor_id: 'u_1' });
  });

  it('the bulk confirmation sends the same reason on every selected request', async () => {
    renderInbox();
    for (const title of ['Someone Else Invoice', 'My Own Invoice']) {
      fireEvent.click(within(await rowFor(title)).getByRole('checkbox', { name: 'Select request' }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Reject {{count}}' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Comment (optional)' }), {
      target: { value: 'Budget frozen this quarter.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject {{count}}' }));
    await waitFor(() => expect(approvalsApiStub.reject).toHaveBeenCalledTimes(2));
    expect(approvalsApiStub.reject).toHaveBeenCalledWith('req_other', { actor_id: 'u_1', comment: 'Budget frozen this quarter.' });
    expect(approvalsApiStub.reject).toHaveBeenCalledWith('req_mine', { actor_id: 'u_1', comment: 'Budget frozen this quarter.' });
  });
});

describe('A request the viewer submitted says so (objectstack#27520 row 12)', () => {
  it('marks the self-submitted row and card, and only those', async () => {
    renderInbox();
    expect(within(await rowFor('My Own Invoice')).getByText('You submitted this')).toBeInTheDocument();
    expect(within(await rowFor('Someone Else Invoice')).queryByText('You submitted this')).toBeNull();
    expect(within(cardFor('My Own Invoice')).getByText('You submitted this')).toBeInTheDocument();
    expect(within(cardFor('Someone Else Invoice')).queryByText('You submitted this')).toBeNull();
  });

  it('gates nothing: the self-submitted row stays decidable', async () => {
    renderInbox();
    const row = await rowFor('My Own Invoice');
    expect(within(row).getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(within(row).getByRole('button', { name: 'Reject' })).toBeEnabled();
  });

  it('is not repeated on the Submitted by me tab, where every row is the viewer\'s', async () => {
    renderInbox();
    await rowFor('My Own Invoice');
    // Radix tabs switch on pointer down / keyboard, not on a bare click.
    const tab = screen.getByRole('tab', { name: 'Submitted by me' });
    fireEvent.mouseDown(tab, { button: 0 });
    await waitFor(() => expect(tab).toHaveAttribute('aria-selected', 'true'));
    await rowFor('My Own Invoice');
    expect(screen.queryByText('You submitted this')).toBeNull();
  });

  it('reads the server flag, not the id: a row without viewer.is_submitter is not marked', async () => {
    const mine = rows[1] as { viewer?: unknown };
    const saved = mine.viewer;
    delete mine.viewer;
    try {
      renderInbox();
      await rowFor('My Own Invoice');
      expect(screen.queryByText('You submitted this')).toBeNull();
    } finally {
      mine.viewer = saved;
    }
  });
});
