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
import { render, screen, cleanup, waitFor, within, fireEvent, act } from '@testing-library/react';
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
    // Interpolates like i18next, so a line built from values shows them.
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
        options && name in options ? String(options[name]) : whole),
    language: 'en',
  };

  return { approvalsApiStub, ADAPTER, AUTH, I18N };
});

// objectstack#36463: the inline decision's failure toast is read off sonner.
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
  toasts.error.mockClear();
  toasts.success.mockClear();
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

// objectstack#36463 — a decide refusal the server marked for the end user
// (`userMessage`, the decider's language) is the inline Approve's failure
// toast, ahead of the page's generic "not allowed" line; an unmarked refusal
// keeps that line. `approvalsApi.call` parks the body on `err.details`.
describe('Approvals Inbox — a marked decide refusal is shown as written (objectstack#36463)', () => {
  const MARKED = '此请求由您提交，而其审批步骤不允许提交人批准自己的请求，因此您不能批准它。';
  const refusal = (userMessage?: string) => Object.assign(
    new Error("FORBIDDEN: 'u_1' submitted this request, and its approval step sets excludeSubmitter, so they cannot approve it."),
    {
      code: 'FORBIDDEN',
      status: 403,
      details: { code: 'FORBIDDEN', error: 'refused', ...(userMessage !== undefined ? { userMessage } : {}) },
    },
  );

  async function approveQuickFailingWith(err: Error) {
    approvalsApiStub.approve.mockRejectedValueOnce(err);
    const rowFor = await renderInbox();
    fireEvent.click(rowFor('Quick Invoice').approve);
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(1));
    return toasts.error.mock.calls[0][0];
  }

  it('the marked text is the toast', async () => {
    expect(await approveQuickFailingWith(refusal(MARKED))).toBe(MARKED);
  });

  it('CONTROL: an unmarked refusal keeps the generic line', async () => {
    expect(await approveQuickFailingWith(refusal())).toBe('You are not allowed to perform this action.');
  });
});

// A bulk approve that partly fails names each failed row WITH its reason —
// the refusal's own text (`userMessage` first, through the same reader the
// inline Approve uses above), else the page's generic line. When more rows
// fail than the toast lists, its "Show all" action opens a dialog listing
// every one.
describe('Approvals Inbox — a partly failed bulk approve says why each row failed', () => {
  const MARKED = '此请求由您提交，而其审批步骤不允许提交人批准自己的请求，因此您不能批准它。';
  const markedRefusal = () => Object.assign(new Error('FORBIDDEN: submitter cannot approve'), {
    code: 'FORBIDDEN',
    status: 403,
    details: { code: 'FORBIDDEN', error: 'refused', userMessage: MARKED },
  });
  const decidedRefusal = () => Object.assign(new Error('INVALID_STATE: already decided'), {
    code: 'INVALID_STATE',
    status: 409,
    details: { code: 'INVALID_STATE', error: 'already decided' },
  });
  const ALREADY_DECIDED = 'This request was already decided. Refresh the list.';

  const row = (n: number) => ({
    id: `req_${n}`,
    record_id: `inv_${n}`,
    record_title: `Bulk Invoice ${n}`,
    process_name: 'invoice_approval',
    process_label: 'Invoice Approval',
    object_name: 'showcase_invoice',
    object_label: 'Invoice',
    status: 'pending',
    pending_approvers: ['u_1'],
    submitter_id: 'u_2',
    submitter_name: 'Sam Submitter',
    // Newest first is the inbox's order: row 1 is the newest, so it lists first.
    submitted_at: `2026-08-${String(30 - n).padStart(2, '0')}T00:00:00.000Z`,
  });

  let originalList: ReturnType<typeof approvalsApiStub.listRequests.getMockImplementation>;
  beforeEach(() => { originalList = approvalsApiStub.listRequests.getMockImplementation(); });
  afterEach(() => {
    approvalsApiStub.listRequests.mockImplementation(originalList!);
    approvalsApiStub.approve.mockReset();
    approvalsApiStub.approve.mockImplementation(async () => ({ data: row(0), finalized: true }) as any);
  });

  /** Render `count` actionable rows, select them all, confirm a bulk approve. */
  async function bulkApprove(count: number, fail: Record<string, () => Error>) {
    const rows = Array.from({ length: count }, (_, i) => row(i + 1));
    approvalsApiStub.listRequests.mockImplementation(async () => ({ data: rows }) as any);
    approvalsApiStub.approve.mockImplementation((async (id: string) => {
      if (fail[id]) throw fail[id]();
      return { data: rows.find(r => r.id === id), finalized: true };
    }) as any);
    render(
      <MemoryRouter initialEntries={[`/apps/${APP}/system/approvals`]}>
        <Routes>
          <Route path="/apps/:appName/system/approvals" element={<ApprovalsInboxPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const box = await screen.findByTestId('approvals-inbox-table-scroller');
    for (const r of rows) {
      const link = await within(box).findByRole('link', { name: r.record_title });
      const tr = link.closest('tr') as HTMLElement;
      fireEvent.click(within(tr).getByRole('checkbox', { name: 'Select request' }));
    }
    fireEvent.click(screen.getByRole('button', { name: `Approve ${count}` }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: `Approve ${count}` }));
    await waitFor(() => expect(approvalsApiStub.approve).toHaveBeenCalledTimes(count));
  }

  it('one refused row: the toast names that row with its marked reason', async () => {
    await bulkApprove(2, { req_2: markedRefusal });
    await waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(1));
    const [title, options] = toasts.error.mock.calls[0] as [string, Record<string, any>];
    expect(title).toBe('1 succeeded, 1 failed');
    // The failed row, and why — the server's marked text, not a bare title.
    expect(options.description).toBe(`Bulk Invoice 2: ${MARKED}`);
    expect(toasts.success).not.toHaveBeenCalled();
    // Everything fits in the toast: no overflow action.
    expect(options.action).toBeUndefined();
  });

  it('CONTROL: every row succeeds — a success toast and no failure feedback', async () => {
    await bulkApprove(3, {});
    await waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1));
    expect(toasts.error).not.toHaveBeenCalled();
    expect(screen.queryByTestId('approvals-bulk-failures')).toBeNull();
  });

  it('more failures than the toast lists: "Show all" reaches every row and its reason', async () => {
    await bulkApprove(6, {
      req_1: markedRefusal, req_2: decidedRefusal, req_3: decidedRefusal,
      req_4: markedRefusal, req_5: decidedRefusal,
    });
    await waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(1));
    const [title, options] = toasts.error.mock.calls[0] as [string, Record<string, any>];
    expect(title).toBe('1 succeeded, 5 failed');
    // The toast lists the first three, each with its reason …
    expect(options.description).toBe([
      `Bulk Invoice 1: ${MARKED}`,
      `Bulk Invoice 2: ${ALREADY_DECIDED}`,
      `Bulk Invoice 3: ${ALREADY_DECIDED}`,
    ].join('\n'));
    expect(options.action.label).toBe('Show all (5)');
    // The toast stays until dismissed, so its action cannot time out.
    expect(options.duration).toBe(Infinity);
    act(() => options.action.onClick());
    const list = await screen.findByTestId('approvals-bulk-failures');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    const expected: Array<[string, string]> = [
      ['Bulk Invoice 1', MARKED], ['Bulk Invoice 2', ALREADY_DECIDED], ['Bulk Invoice 3', ALREADY_DECIDED],
      ['Bulk Invoice 4', MARKED], ['Bulk Invoice 5', ALREADY_DECIDED],
    ];
    for (const [title, reason] of expected) {
      const item = items.find(li => li.textContent?.startsWith(title));
      expect(item, title).toBeDefined();
      expect(item).toHaveTextContent(reason);
    }
    expect(within(list).queryByText('Bulk Invoice 6')).toBeNull();
  });
});
