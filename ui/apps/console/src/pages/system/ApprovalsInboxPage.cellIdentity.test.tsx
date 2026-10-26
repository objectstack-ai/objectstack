// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Approvals Inbox — the row cells survive a re-render instead of being
 * remounted (objectui#5348).
 *
 * ## The defect
 *
 * `RequestCell`, `RecordCell` and `InlineActions` were declared INSIDE
 * `ApprovalsInboxPage`'s own body. React identifies a component by the identity
 * of its function, so every render produced three brand-new component *types*
 * and React unmounted and remounted each row's subtree rather than updating it.
 * The page re-renders on a 60s interval (the `now` clock at the top of the
 * page) whether or not anybody is touching it, so this fired on a timer rather
 * than at some rare edge.
 *
 * ## What these cases assert — and what they deliberately do NOT
 *
 * ⛔ Nothing here asserts where the three functions are *declared*. A placement
 * assertion ("they sit at module scope now") stays green for a refactor that
 * moves these three and introduces a fourth inline component beside them, and
 * it says nothing about whether a remount actually stopped. These cases assert
 * the observable consequence instead:
 *
 *  1. **Identity** — the DOM nodes the three cells rendered are the SAME node
 *     objects after a re-render. A remount cannot pass this: React drops the
 *     old subtree and builds fresh elements, so every node is a new object.
 *     Asserted for all three cells in one pass, so fixing one and leaving
 *     another inline fails.
 *  2. **Subtree state** — focus inside a row survives the clock tick. That is
 *     the "remounting discards transient state" half of the card, and it is
 *     what a real user loses.
 *  3. **The measured symptom** — an Approve click whose pointer sequence spans
 *     a re-render still opens the confirmation. This is the swallowed click
 *     objectui#5211 hit and worked around at the call site; here it is made
 *     deterministic by landing the minute tick BETWEEN the press and the
 *     release rather than hoping the scheduler puts one there.
 *
 * Case 1 is the mechanism and case 3 is the symptom. Both are kept because
 * neither implies the other: the mechanism can be repaired for one cell and
 * left broken for another, and a symptom that reproduces only under a specific
 * tick interleaving is not evidence about the other two cells.
 *
 * ## Why a test rather than the lint rule
 *
 * `react-hooks/static-components` exists for exactly this class and is `error`
 * in this repo (via `reactHooks.configs.recommended.rules`, spread in
 * `eslint.config.js`). It does not cover this page. Measured on `origin/main`:
 * an arrow-form inner component injected into `ApprovalsInboxPage` and used in
 * JSX produces **zero** reports, while the same shape in a ten-line file
 * produces two — the rule's analysis bails out on this component. So these
 * cases are the only guard this page has.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const APP = 'com.objectstack.account';

/** The page's own clock interval. Advancing by this forces exactly one tick. */
const MINUTE = 60_000;

const { approvalsApiStub, ADAPTER, AUTH, I18N } = vi.hoisted(() => {
  const rows = [
    {
      id: 'req_1',
      process_name: 'invoice_approval',
      process_label: 'Invoice Approval',
      object_name: 'showcase_invoice',
      object_label: 'Invoice',
      record_id: 'inv_1',
      record_title: 'Acme Invoice',
      status: 'pending',
      pending_approvers: ['u_1'],
      submitter_id: 'u_2',
      submitter_name: 'Sam Submitter',
      submitted_at: '2026-08-19T00:00:00.000Z',
    },
  ];

  const approvalsApiStub = {
    listRequests: vi.fn(async () => ({ data: rows })),
    getRequest: vi.fn(async (id: string) => ({ data: rows.find((r) => r.id === id) })),
    listActions: vi.fn(async () => ({ data: [] })),
    approve: vi.fn(async () => ({ data: rows[0], finalized: true })),
    reject: vi.fn(async () => ({ data: rows[0], finalized: true })),
  };

  // STABLE singletons — a mocked hook handing back a fresh object per render
  // re-runs the page's load effect forever and the table never leaves its
  // skeleton (the lesson `ApprovalsInboxPage.recordLink.test.tsx` records).
  const ADAPTER = { find: vi.fn(async (_o: string, params?: Record<string, unknown>) => {
    const ids = (params?.$filter as { id?: { $in?: string[] } } | undefined)?.id?.$in ?? [];
    return { data: ids.map((id) => ({ id })) };
  }) };
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

function renderInbox() {
  return render(
    <MemoryRouter initialEntries={[`/apps/${APP}/system/approvals`]}>
      <Routes>
        <Route path="/apps/:appName/system/approvals" element={<ApprovalsInboxPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The desktop table row holding the request — the only one rendering actions. */
function row(): HTMLElement {
  const found = screen
    .getAllByRole('row')
    .find((r) => within(r).queryByRole('button', { name: 'Approve' }));
  if (!found) throw new Error('no actionable row');
  return found;
}

/**
 * One node per cell under test, re-queried from scratch each call. Querying
 * (rather than holding a reference) is what makes the comparison meaningful:
 * both sides are "whatever is on screen now", so equal object identity can only
 * mean React kept the node.
 */
function cellNodes() {
  const r = row();
  return {
    // RequestCell — the process label it renders.
    request: within(r).getByText('Invoice Approval'),
    // RecordCell — the record link it renders (the title alone matches both
    // the anchor and the span inside it).
    record: within(r).getByRole('link', { name: /Acme Invoice/ }),
    // InlineActions — its quick-approve button.
    actions: within(r).getByRole('button', { name: 'Approve' }),
  };
}

/** Advance the page's own clock by exactly one tick, flushing React. */
async function tickMinuteClock(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(MINUTE);
  });
}

beforeEach(() => {
  // `shouldAdvanceTime` keeps real time flowing under the fake clock, so the
  // page's promises/`findBy*` still settle while `advanceTimersByTime` can
  // still jump the 60s interval on demand.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  ADAPTER.find.mockClear();
  for (const fn of Object.values(approvalsApiStub)) fn.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Approvals Inbox — row cells are not remounted per render (objectui#5348)', () => {
  it('keeps the same DOM nodes for all three row cells across a minute-clock tick', async () => {
    renderInbox();
    await screen.findAllByRole('button', { name: 'Approve' });

    const before = cellNodes();
    await tickMinuteClock();
    const after = cellNodes();

    // Same node objects — an update, not an unmount/remount. Reported per cell
    // so a partial fix names the cell it missed.
    expect(after.request === before.request).toBe(true);
    expect(after.record === before.record).toBe(true);
    expect(after.actions === before.actions).toBe(true);

    // And the old nodes were never detached from the document.
    expect(before.request).toBeInTheDocument();
    expect(before.record).toBeInTheDocument();
    expect(before.actions).toBeInTheDocument();
  });

  it('keeps focus inside a row across a minute-clock tick', async () => {
    renderInbox();
    await screen.findAllByRole('button', { name: 'Approve' });

    const approve = cellNodes().actions;
    approve.focus();
    expect(document.activeElement).toBe(approve);

    await tickMinuteClock();

    // A remount moves focus to <body>; an update leaves it where the user put it.
    expect(document.activeElement).toBe(cellNodes().actions);
    expect(document.activeElement).toBe(approve);
  });

  it('opens the confirmation for an Approve click whose pointer sequence spans a re-render', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderInbox();
    await screen.findAllByRole('button', { name: 'Approve' });

    const approve = cellNodes().actions;

    // Press… then let the page's own clock re-render underneath the pointer…
    await user.pointer({ target: approve, keys: '[MouseLeft>]' });
    await tickMinuteClock();
    // …then release. On the remounting page the captured node is detached by
    // now, React's delegated listener never sees the click, and nothing happens
    // — the swallowed click objectui#5211 measured.
    await user.pointer({ target: approve, keys: '[/MouseLeft]' });

    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));

    await waitFor(() =>
      expect(approvalsApiStub.approve).toHaveBeenCalledWith('req_1', { actor_id: 'u_1' }),
    );
  });
});
