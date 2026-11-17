// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Approvals Inbox — the desktop row's inline Approve / Reject are shown by
 * default, each with its word (objectstack#34587).
 *
 * The buttons sat in a wrapper classed `opacity-0 group-hover:opacity-100
 * focus-within:opacity-100`: until the pointer rested on a row, or keyboard
 * focus reached it, the inbox showed no way to decide from the list, and the
 * buttons were bare icons with only an `aria-label`. Now:
 *
 * 1. Every actionable row shows Approve and Reject without hovering, each with
 *    a visible word that is also its accessible name.
 * 2. A request whose step collects decision outputs (#2829) keeps both buttons
 *    disabled, and hovering shows why: the reason is the buttons' `title` and
 *    the wrapper's, so the tooltip appears even where a disabled button
 *    swallows pointer events.
 *
 * jsdom applies no stylesheet, so "visible without hovering" is read from the
 * classes that hid them.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const APP = 'com.objectstack.account';
const HINT = 'This approval collects decision outputs — open it to decide.';

const { approvalsApiStub, ADAPTER, AUTH, I18N } = vi.hoisted(() => {
  const base = {
    process_name: 'invoice_approval',
    process_label: 'Invoice Approval',
    object_name: 'showcase_invoice',
    object_label: 'Invoice',
    status: 'pending',
    pending_approvers: ['u_1'],
    submitter_id: 'u_2',
    submitter_name: 'Sam Submitter',
    submitted_at: '2026-08-19T00:00:00.000Z',
  };
  const rows = [
    { ...base, id: 'req_quick', record_id: 'inv_quick', record_title: 'Quick Invoice' },
    {
      ...base,
      id: 'req_outputs',
      record_id: 'inv_outputs',
      record_title: 'Outputs Invoice',
      // #2829: the step collects a decision output, so it is decided only on
      // the request's page.
      decision_outputs: ['approved_amount'],
    },
  ];

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

async function renderInbox() {
  render(
    <MemoryRouter initialEntries={[`/apps/${APP}/system/approvals`]}>
      <Routes>
        <Route path="/apps/:appName/system/approvals" element={<ApprovalsInboxPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByRole('link', { name: 'Outputs Invoice' })).toBeInTheDocument());
  const box = screen.getByTestId('approvals-inbox-table-scroller');
  return (title: string) => {
    const row = within(box).getByRole('link', { name: title }).closest('tr') as HTMLElement;
    const cell = row.lastElementChild as HTMLElement;
    return {
      row,
      cell,
      approve: within(cell).getByRole('button', { name: 'Approve' }),
      reject: within(cell).getByRole('button', { name: 'Reject' }),
    };
  };
}

/** Every class that would keep an element hidden until hover or focus. */
function hidingClasses(el: Element | null): string[] {
  const out: string[] = [];
  for (let n = el; n && n.tagName !== 'TR'; n = n.parentElement) {
    for (const c of Array.from(n.classList)) {
      if (c === 'opacity-0' || c === 'invisible' || c === 'hidden' || c.startsWith('group-hover:')) out.push(c);
    }
  }
  return out;
}

beforeEach(() => {
  for (const fn of Object.values(approvalsApiStub)) fn.mockClear();
});
afterEach(cleanup);

describe('Approvals Inbox — inline Approve / Reject shown by default (objectstack#34587)', () => {
  it('acceptance 1: every pending row shows Approve and Reject with their words, nothing gated on hover', async () => {
    const rowFor = await renderInbox();
    for (const title of ['Quick Invoice', 'Outputs Invoice']) {
      const { approve, reject } = rowFor(title);
      for (const [button, word] of [[approve, 'Approve'], [reject, 'Reject']] as const) {
        // The word is on screen, not only in an aria-label, and is the name.
        expect(button).toHaveTextContent(word);
        expect(button).toHaveAccessibleName(word);
        // Nothing between the button and its row hides it until hover/focus.
        expect(hidingClasses(button)).toEqual([]);
      }
    }
  });

  it('CONTROL: a quick-decidable row keeps enabled buttons with no disabled-reason tooltip', async () => {
    const rowFor = await renderInbox();
    const { approve, reject } = rowFor('Quick Invoice');
    expect(approve).toBeEnabled();
    expect(reject).toBeEnabled();
    expect(approve).not.toHaveAttribute('title');
    expect(reject).not.toHaveAttribute('title');
    expect(approve.parentElement).not.toHaveAttribute('title');
  });

  it('acceptance 2: a row whose step collects decision outputs keeps both disabled, and hovering says why', async () => {
    const rowFor = await renderInbox();
    const { approve, reject } = rowFor('Outputs Invoice');
    expect(approve).toBeDisabled();
    expect(reject).toBeDisabled();
    // The reason: each button's own title (its accessible description) …
    expect(approve).toHaveAttribute('title', HINT);
    expect(reject).toHaveAttribute('title', HINT);
    expect(approve).toHaveAccessibleDescription(HINT);
    // … and the wrapper's, which still takes the hover when a disabled
    // button does not.
    expect(approve.parentElement).toHaveAttribute('title', HINT);
    expect(approve.parentElement).toBe(reject.parentElement);
  });

  it('the Actions column fits its two labelled buttons instead of a fixed 80 px', async () => {
    const rowFor = await renderInbox();
    const { cell } = rowFor('Quick Invoice');
    const header = screen.getByRole('columnheader', { name: 'Actions' });
    for (const el of [header, cell]) {
      expect(el).not.toHaveClass('w-20');
      expect(el).toHaveClass('w-px', 'whitespace-nowrap');
    }
  });
});
