// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Approvals Inbox — the Approve / Reject column is pinned right and a long
 * record title truncates (objectui#12816).
 *
 * Measured at 1024 px (HotCRM, three account approvals titled like
 * "ACC-000011 - Contoso Pharmaceuticals and Life Sciences Group"): the table
 * was 1074 px wide in a 718 px box. The titles are `nowrap`, and an
 * auto-layout table sizes a column by its content's minimum width, so the
 * Record column took 473 px and pushed the inline Approve / Reject column
 * past the card's right edge.
 *
 * - The Record cells are `max-w-0`: the title no longer sizes its column, so
 *   it truncates, its full text in `title`. The header keeps a floor.
 * - The Approve / Reject cells are pinned right in the header and every row,
 *   with the shared seam shadow (`PINNED_RIGHT_SEAM_SHADOW_CLASSES`), inside
 *   the overflow box's `seam="pinned"` mode.
 *
 * jsdom lays nothing out, so the 718 px box is stubbed geometry and these pins
 * read the classes that do the layout; the real-browser readings are on the
 * pull request.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act, within } from '@testing-library/react';
import { PINNED_RIGHT_SEAM_SHADOW_CLASSES } from '@object-ui/components';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const APP = 'com.objectstack.account';

const { adapterFind, approvalsApiStub, ADAPTER, AUTH, I18N } = vi.hoisted(() => {
  // The card's own measured title: 60 characters.
  const LONG_TITLE = 'ACC-000011 - Contoso Pharmaceuticals and Life Sciences Group';
  const rows = [
    {
      id: 'req_long',
      process_name: 'invoice_approval',
      process_label: 'Invoice Approval',
      object_name: 'showcase_invoice',
      object_label: 'Invoice',
      record_id: 'acc_long',
      record_title: LONG_TITLE,
      status: 'pending',
      pending_approvers: ['u_1'],
      submitter_id: 'u_2',
      submitter_name: 'Sam Submitter',
      submitted_at: '2026-08-19T00:00:00.000Z',
    },
    {
      id: 'req_short',
      process_name: 'invoice_approval',
      process_label: 'Invoice Approval',
      object_name: 'showcase_invoice',
      object_label: 'Invoice',
      record_id: 'acc_short',
      record_title: 'Short Co',
      status: 'pending',
      pending_approvers: ['u_1'],
      submitter_id: 'u_2',
      submitter_name: 'Sam Submitter',
      submitted_at: '2026-08-19T00:00:00.000Z',
    },
  ];

  // Both records are readable, so both titles are links.
  const adapterFind = vi.fn(async (_object: string, params?: Record<string, unknown>) => {
    const ids = (params?.$filter as { id?: { $in?: string[] } } | undefined)?.id?.$in ?? [];
    return { data: ids.map((id) => ({ id })) };
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

const LONG = 'ACC-000011 - Contoso Pharmaceuticals and Life Sciences Group';

beforeEach(() => {
  for (const fn of Object.values(approvalsApiStub)) fn.mockClear();
  adapterFind.mockClear();
});
afterEach(cleanup);

async function renderAt718() {
  renderInbox();
  await waitFor(() => expect(screen.getByRole('link', { name: LONG })).toBeInTheDocument());
  const box = screen.getByTestId('approvals-inbox-table-scroller');
  setGeometry(box, { scrollLeft: 0, scrollWidth: 762, clientWidth: 718 });
  return box;
}

function expectPinnedRight(cell: Element) {
  expect(cell).toHaveClass('sticky', 'right-0', 'z-10', 'bg-card');
  expect(cell).toHaveClass(...PINNED_RIGHT_SEAM_SHADOW_CLASSES.split(' '));
}

describe('Approvals Inbox — pinned Approve / Reject, truncating Record (objectui#12816)', () => {
  it('pins the Approve / Reject column right, in the header and in every row, with the seam shadow', async () => {
    const box = await renderAt718();
    // `seam="pinned"`: the pinned cells draw the shadow, so the box's own
    // edge overlay stays off while it marks that it can scroll further right.
    expect(box).toHaveAttribute('data-overflow-right', 'true');
    expect(screen.queryByTestId('horizontal-overflow-shadow')).toBeNull();

    const header = within(box).getByRole('columnheader', { name: 'Actions' });
    expectPinnedRight(header);
    expect(header).toBe(header.parentElement!.lastElementChild);

    const rows = within(box).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const cell = row.lastElementChild!;
      expectPinnedRight(cell);
      expect(within(cell as HTMLElement).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
      expect(within(cell as HTMLElement).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    }
  });

  it('truncates a 60-character record title instead of letting it size the column', async () => {
    const box = await renderAt718();
    expect(LONG).toHaveLength(60);
    const link = screen.getByRole('link', { name: LONG });
    // The link is still the whole title, and carries it in full.
    expect(link).toHaveAttribute('title', LONG);
    expect(link).toHaveTextContent(LONG);
    expect(link.querySelector('span')).toHaveClass('truncate');
    // The cell takes the title's unbreakable width out of the table's column
    // sizing, so the table does not widen for it; the header keeps a floor.
    expect(link.closest('td')).toHaveClass('max-w-0');
    expect(within(box).getByRole('columnheader', { name: 'Record' })).toHaveClass('w-[30%]', 'min-w-40');
  });

  it('CONTROL: a short title renders as before, and the other columns keep their widths', async () => {
    const box = await renderAt718();
    const link = screen.getByRole('link', { name: 'Short Co' });
    expect(link).toHaveAttribute('title', 'Short Co');
    expect(link).toHaveAttribute('href', `/apps/${APP}/showcase_invoice/record/acc_short`);
    expect(within(box).getByRole('columnheader', { name: 'Request' })).toHaveClass('w-[22%]');
    expect(within(box).getByRole('columnheader', { name: 'Requester' })).toHaveClass('w-[16%]');
    expect(within(box).getByRole('columnheader', { name: 'Status' })).toHaveClass('w-[110px]');
    expect(within(box).getByRole('columnheader', { name: 'Submitted' })).toHaveClass('w-[132px]');
    for (const name of ['Request', 'Requester', 'Status', 'Submitted']) {
      expect(within(box).getByRole('columnheader', { name })).not.toHaveClass('sticky');
    }
  });

  it('the keyboard-focused row keeps its ring across the pinned cell', async () => {
    const box = await renderAt718();
    const [first, second] = within(box).getAllByRole('row').slice(1);
    act(() => { fireEvent.keyDown(window, { key: 'j' }); });
    await waitFor(() => expect(first).toHaveClass('ring-2'));
    expect(first.lastElementChild!.className).toContain('shadow-[inset_0_2px_0_var(--color-ring)');
    expect(second.lastElementChild!.className).not.toContain('shadow-[');
  });
});
