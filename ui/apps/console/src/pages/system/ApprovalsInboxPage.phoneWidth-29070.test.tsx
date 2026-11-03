// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29070 — the approvals inbox at phone width.
 *
 * The run record drove the inbox in Chromium at 375×812 and 390×844 against
 * the showcase and CRM examples. Two things failed, and this file pins both
 * fixes; the geometry itself is pinned in `ui/e2e/approvals-inbox-phone.spec.ts`.
 *
 * 1. **Touch targets.** The tabs, search, filters and the phone cards'
 *    Approve / Reject measured 28–34 px and the inline confirmation's buttons
 *    40 px. Below 768 px (`useIsMobile`) each takes the 44 px height: Button's
 *    `lg` size, `h-11` where the control has no size. The search field keeps
 *    Input's own 16 px phone text, since a smaller focused field makes iOS
 *    zoom the page. A desktop keeps every size it had.
 * 2. **A long list at 4× CPU.** The inline confirmation's target row and its
 *    Reject reason lived on the page, so opening the dialog and every
 *    keystroke of the reason re-rendered every row (200 rows: ~1 s from tap to
 *    dialog, ~400 ms per keystroke). They now live in the dialog component,
 *    so neither re-renders a row. The probe here is the per-row
 *    `isDeletedRecordReference` read, which each face of each row calls when
 *    it renders.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const APP = 'account';

const { approvalsApiStub, ADAPTER, AUTH, I18N, MOBILE, rowReads } = vi.hoisted(() => {
  const base = {
    process_name: 'invoice_approval',
    process_label: 'Invoice Approval',
    object_name: 'showcase_invoice',
    object_label: 'Invoice',
    status: 'pending',
    pending_approvers: ['u_1'],
    submitted_at: '2026-10-20T00:00:00.000Z',
    submitter_id: 'u_2',
    submitter_name: 'Sam Submitter',
    viewer: { can_act: true, is_submitter: false, can_override: true },
  };
  const rows = Array.from({ length: 6 }, (_, i) => ({
    ...base,
    id: `req_${i}`,
    record_id: `inv_${i}`,
    record_title: `Invoice ${i}`,
  }));
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
  return { approvalsApiStub, ADAPTER, AUTH, I18N, MOBILE: { value: false }, rowReads: { count: 0 } };
});

vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useIsMobile: () => MOBILE.value,
}));

vi.mock('./deadRecordReference', async (importOriginal) => {
  const real = await importOriginal<typeof import('./deadRecordReference')>();
  return {
    ...real,
    isDeletedRecordReference: (...args: Parameters<typeof real.isDeletedRecordReference>) => {
      rowReads.count++;
      return real.isDeletedRecordReference(...args);
    },
  };
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

/** The phone card holding `title` (a card is not a table row). */
async function cardFor(title: string): Promise<HTMLElement> {
  await screen.findAllByText(title, undefined, { timeout: 8000 });
  const card = screen.getAllByText(title).map((el) => el.closest('.md\\:hidden > *')).find(Boolean);
  if (!card) throw new Error(`no card for ${title}`);
  return card as HTMLElement;
}

const classes = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/);

beforeEach(() => {
  for (const fn of Object.values(approvalsApiStub)) fn.mockClear();
  rowReads.count = 0;
});
afterEach(() => {
  cleanup();
  MOBILE.value = false;
});

describe('the inbox controls take 44 px below 768 px (objectstack#29070)', () => {
  it('phone: tabs, search, filters, card buttons and the confirmation buttons', async () => {
    MOBILE.value = true;
    renderInbox();
    const card = await cardFor('Invoice 0');
    for (const name of ['Approve', 'Reject']) {
      expect(classes(within(card).getByRole('button', { name }))).toContain('h-11');
    }
    for (const tab of screen.getAllByRole('tab')) {
      expect(classes(tab)).toEqual(expect.arrayContaining(['min-h-11', 'min-w-11']));
    }
    const search = screen.getByPlaceholderText('Search record, process, requester…');
    expect(classes(search)).toContain('h-11');
    // Input's own `text-base md:text-sm`: 16 px on a phone, so iOS does not zoom.
    expect(classes(search)).not.toContain('text-sm');
    for (const trigger of screen.getAllByRole('combobox')) expect(classes(trigger)).toContain('h-11');

    fireEvent.click(within(card).getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('alertdialog');
    for (const name of ['Cancel', 'Reject']) {
      expect(classes(within(dialog).getByRole('button', { name }))).toContain('h-11');
    }
  });

  it('desktop: every control keeps the size it had', async () => {
    renderInbox();
    await cardFor('Invoice 0');
    const search = screen.getByPlaceholderText('Search record, process, requester…');
    expect(classes(search)).toEqual(expect.arrayContaining(['h-8', 'text-sm']));
    for (const trigger of screen.getAllByRole('combobox')) expect(classes(trigger)).toContain('h-8');
    for (const tab of screen.getAllByRole('tab')) expect(classes(tab)).not.toContain('min-h-11');
    const row = screen.getAllByRole('row').find((r) => within(r).queryByText('Invoice 0'))!;
    fireEvent.click(within(row).getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(classes(within(dialog).getByRole('button', { name: 'Reject' }))).toContain('h-10');
  });
});

describe('the inline confirmation does not re-render the rows (objectstack#29070)', () => {
  it('opening Reject and typing the reason reads no row; the decision still carries the reason', async () => {
    MOBILE.value = true;
    renderInbox();
    const card = await cardFor('Invoice 3');
    // Not vacuous: the rows really do read the probe when they render.
    await waitFor(() => expect(rowReads.count).toBeGreaterThan(0));
    const before = rowReads.count;

    fireEvent.click(within(card).getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('alertdialog');
    const box = within(dialog).getByRole('textbox', { name: 'Comment (optional)' });
    for (const value of ['O', 'Ov', 'Ove', 'Over the cap']) fireEvent.change(box, { target: { value } });
    expect(box).toHaveValue('Over the cap');
    expect(rowReads.count, 'opening the confirmation or typing the reason re-rendered the rows').toBe(before);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(approvalsApiStub.reject).toHaveBeenCalledTimes(1));
    expect(approvalsApiStub.reject).toHaveBeenCalledWith('req_3', { actor_id: 'u_1', comment: 'Over the cap' });
  });

  it('the a key still opens the approve confirmation for the focused row', async () => {
    renderInbox();
    await cardFor('Invoice 0');
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'a' });
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Approve "{{title}}"?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(approvalsApiStub.approve).toHaveBeenCalledWith('req_0', { actor_id: 'u_1' }));
  });
});
