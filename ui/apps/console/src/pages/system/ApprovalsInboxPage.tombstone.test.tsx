// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Approvals Inbox — a DEAD record reference renders as a tombstone, never as
 * the bare record id (objectui#7108).
 *
 * ## The ruling
 *
 * Maintainer ruling 2026-08-31 (总监席第 5 场决裁批 #5) point 2, kept in the
 * language it was ruled in: 历史终态审批单保留 + 墓碑呈现：审计行不动；呈现层把
 * 死引用渲染为「关联记录已删除」墓碑，不再退化为裸记录 id。
 *
 * ## What each case measures, and why a weaker pin would pass on worse code
 *
 * A pin asserting only "the row does not show a raw record id" passes on a row
 * that renders NOTHING — and an empty row is worse than the bare id, because
 * the approver loses the fact that an approval exists. So the cases below pin
 * the tombstone's PRESENCE, its TEXT, and that the rest of the row (flow,
 * submitter, status, submitted-at) still renders.
 *
 * A second discriminator, against the caricature that makes every reference
 * answer the same thing: a LIVE reference must still render its business
 * identifier and its link.
 *
 * And the non-regression axis, aimed at the plausible WRONG fix rather than at
 * the bug's shape: treating any failed lookup as a deletion would report a
 * deletion to a viewer whose only problem is permissions (objectstack#7345's
 * case). The fixture makes that failure mode visible — `rec_hidden` and
 * `rec_deleted` are BOTH absent from the readability probe's answer, exactly as
 * the platform's read path fuses them (existence non-disclosure) — and pins
 * that only the row the SERVER marked `record_deleted` gets a tombstone.
 *
 * ## Fixture notes
 *
 * The stubbed `listRequests` answers every tab with the same rows, as this
 * file's siblings do; the "All" tab is selected because that is where a
 * `cancelled` row actually lives (objectstack#13568 clears the approver index,
 * so a cancelled request leaves "My Pending" by construction).
 *
 * `queryAllByText` / `within(row)` throughout, never a bare `queryByText`: an
 * inbox renders each request twice (desktop table + mobile card), so the
 * tombstone string is present more than once and a bare query THROWS on the
 * multiple match rather than reporting a miss.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import {
  APPROVAL_CANCEL_REASON_LABELS,
  APPROVAL_STATUS_LABELS,
} from '@objectstack/spec/contracts';

const APP = 'com.objectstack.account';

/** The copy under test, taken from the CONTRACT — never re-typed here. */
const TOMBSTONE = APPROVAL_CANCEL_REASON_LABELS.record_deleted;

/**
 * Opaque record ids, each with a distinct 6-char prefix. `formatIdentity`
 * truncates anything over 14 characters to `<first 6>…<last 4>`, so asserting
 * on the PREFIX catches both the full id and the truncated form the row would
 * actually have rendered.
 */
const ID_LIVE = 'LiveRec0rdAAAAA';
const ID_DELETED = '9SEmly8kQx2vJ7Z';
const ID_DELETED_BARE = 'K3pQr7WzLm4Nb8T';
const ID_HIDDEN = 'H1dd3nRec0rdXYZ';

const { adapterFind, approvalsApiStub, ADAPTER, AUTH, I18N } = vi.hoisted(() => {
  const base = {
    process_name: 'leave_approval',
    process_label: 'Leave Approval',
    object_name: 'showcase_leave_request',
    object_label: 'Leave Request',
    submitted_at: '2026-09-01T00:00:00.000Z',
    created_at: '2026-09-01T00:00:00.000Z',
  };
  const rows = [
    {
      ...base,
      id: 'req_live',
      record_id: 'LiveRec0rdAAAAA',
      record_title: 'LR-00006',
      status: 'approved',
      submitter_id: 'u_live',
      submitter_name: 'Liv Live',
    },
    {
      ...base,
      id: 'req_dead',
      record_id: '9SEmly8kQx2vJ7Z',
      // The snapshot kept a business identifier; the RECORD is gone.
      record_title: 'LR-00007',
      status: 'cancelled',
      cancel_reason: 'record_deleted',
      submitter_id: 'u_dead',
      submitter_name: 'Dana Deleter',
      completed_at: '2026-09-02T00:00:00.000Z',
    },
    {
      ...base,
      id: 'req_dead_bare',
      record_id: 'K3pQr7WzLm4Nb8T',
      // No snapshot title at all — THE case the card reports: the row used to
      // degrade to the bare record id right here.
      status: 'cancelled',
      cancel_reason: 'record_deleted',
      submitter_id: 'u_bare',
      submitter_name: 'Barry Bare',
    },
    {
      ...base,
      id: 'req_hidden',
      record_id: 'H1dd3nRec0rdXYZ',
      record_title: 'LR-00009',
      // Terminal, never cancelled ⇒ no `cancel_reason` exists for it. Its
      // record is unreadable to this viewer for a reason the API does not
      // disclose. NOT a deletion this console may assert.
      status: 'approved',
      submitter_id: 'u_hidden',
      submitter_name: 'Hana Hidden',
    },
  ];

  /**
   * The platform's read path, reduced to the property that matters here: a
   * deleted record and a record this principal may not see are BOTH simply
   * absent from an `id in (…)` list read. The probe cannot tell them apart —
   * by design, not by omission.
   */
  const adapterFind = vi.fn(async (_object: string, params?: Record<string, unknown>) => {
    const ids = (params?.$filter as { id?: { $in?: string[] } } | undefined)?.id?.$in ?? [];
    const gone = new Set(['9SEmly8kQx2vJ7Z', 'K3pQr7WzLm4Nb8T', 'H1dd3nRec0rdXYZ']);
    return { data: ids.filter((id) => !gone.has(id)).map((id) => ({ id })) };
  });

  const approvalsApiStub = {
    listRequests: vi.fn(async () => ({ data: rows, total: rows.length })),
    getRequest: vi.fn(async (id: string) => ({ data: rows.find((r) => r.id === id) })),
    listActions: vi.fn(async () => ({ data: [] })),
    approve: vi.fn(async () => ({ data: rows[0], finalized: true })),
    reject: vi.fn(async () => ({ data: rows[0], finalized: true })),
  };

  // STABLE singletons — a fresh object per render re-runs the page's load
  // effect forever and the table never leaves its skeleton.
  const ADAPTER = { find: adapterFind };
  const AUTH = { user: { id: 'u_1', email: 'approver@example.com' } };
  const I18N = {
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
    language: 'en',
  };

  return { adapterFind, approvalsApiStub, ADAPTER, AUTH, I18N };
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
import { isDeletedRecordReference } from './deadRecordReference';

function renderInbox() {
  return render(
    <MemoryRouter initialEntries={[`/apps/${APP}/system/approvals`]}>
      <Routes>
        <Route path="/apps/:appName/system/approvals" element={<ApprovalsInboxPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Land on "All" — the tab a `cancelled` request actually appears in. */
async function renderAllTab(): Promise<void> {
  renderInbox();
  fireEvent.click(await screen.findByRole('tab', { name: 'All' }));
  // `findAllByText`: each request renders twice (desktop table + mobile card),
  // and the singular query THROWS on the second match instead of waiting.
  await screen.findAllByText('Liv Live');
}

/** The desktop table row holding `text` (the mobile card renders no table rows). */
function rowFor(text: string): HTMLElement {
  const found = screen.getAllByRole('row').find((r) => within(r).queryAllByText(text).length > 0);
  if (!found) throw new Error(`no row for ${text}`);
  return found;
}

beforeEach(() => {
  adapterFind.mockClear();
  for (const fn of Object.values(approvalsApiStub)) fn.mockClear();
});
afterEach(cleanup);

describe('isDeletedRecordReference (objectui#7108)', () => {
  it('answers true only for the status AND cause the platform writes together', () => {
    expect(isDeletedRecordReference({ status: 'cancelled', cancel_reason: 'record_deleted' })).toBe(true);
  });

  it('refuses every near miss — a status alone, a cause alone, and nothing at all', () => {
    // `cancelled` is a reason CLASS: a future platform cause extends the
    // vocabulary rather than minting a status, so the status alone must not
    // start rendering "deleted".
    expect(isDeletedRecordReference({ status: 'cancelled' })).toBe(false);
    expect(isDeletedRecordReference({ status: 'cancelled', cancel_reason: null })).toBe(false);
    // The contract declares the cause present ONLY on `cancelled` rows, so a
    // value anywhere else is a row this console does not understand.
    expect(isDeletedRecordReference({ status: 'approved', cancel_reason: 'record_deleted' })).toBe(false);
    expect(isDeletedRecordReference({ status: 'rejected' })).toBe(false);
    expect(isDeletedRecordReference(null)).toBe(false);
    expect(isDeletedRecordReference(undefined)).toBe(false);
  });
});

describe('Approvals Inbox — dead record reference tombstone (objectui#7108)', () => {
  it('renders the tombstone, in the platform’s own words, for a record the server says was deleted', async () => {
    await renderAllTab();

    const row = rowFor('Dana Deleter');
    // PRESENCE and TEXT, not merely "no id": the text is asserted to BE the
    // contract's label, so a hand-written English string in this repo reds it.
    expect(within(row).getAllByText(TOMBSTONE).length).toBeGreaterThan(0);
    expect(TOMBSTONE).toBe('Related record deleted');
  });

  it('never shows the bare record id — not as text, not as a tooltip, not with a snapshot title and not without one', async () => {
    await renderAllTab();

    // With a snapshot title…
    const withTitle = rowFor('Dana Deleter');
    expect(withTitle.innerHTML).not.toContain('9SEmly');
    // …and without one, which is the degradation the card reports.
    const bare = rowFor('Barry Bare');
    expect(bare.innerHTML).not.toContain('K3pQr7');
    expect(within(bare).getAllByText(TOMBSTONE).length).toBeGreaterThan(0);

    // The whole page, both viewports: the id is nowhere.
    expect(document.body.innerHTML).not.toContain('9SEmly');
    expect(document.body.innerHTML).not.toContain('K3pQr7');
  });

  /**
   * ⭐ The discriminating case. A suite that only asserted "no raw record id"
   * would pass on a row rendering NOTHING — strictly worse than the bug, since
   * the approver would lose the fact that an approval exists. Ablating
   * `DeadRecordReference` to render `null` reds the tombstone-presence cases
   * above; this one holds the other half, that the surrounding row survives.
   */
  it('keeps the rest of the row — an empty row would be worse than the id it replaced', async () => {
    await renderAllTab();

    const row = rowFor('Dana Deleter');
    // The flow, the requester, the decision state and the age all survive: the
    // approver can still see THAT an approval happened and what became of it.
    expect(within(row).getAllByText('Leave Approval').length).toBeGreaterThan(0);
    expect(within(row).getAllByText('Dana Deleter').length).toBeGreaterThan(0);
    expect(within(row).getAllByText(APPROVAL_STATUS_LABELS.cancelled).length).toBeGreaterThan(0);
    expect(within(row).getAllByText('Leave Request').length).toBeGreaterThan(0);
    // The snapshot's business identifier is not swallowed — it moves to the
    // meta line, where it reads as history rather than as an address.
    expect(within(row).getAllByText(/LR-00007/).length).toBeGreaterThan(0);
    // And the status chip names the state instead of echoing the wire token.
    expect(within(row).queryByText('cancelled')).toBeNull();
  });

  /**
   * A CHARACTERIZATION pin, stated as one on purpose: it passes on the tree
   * BEFORE this change too, because objectui#5211's probe already withholds the
   * link once it answers (a deleted record is absent from its read like any
   * other unreadable one). What this change adds is that the link never appears
   * at all, rather than disappearing a tick later — measured by the ablation,
   * not asserted here, because pinning the pre-probe paint would be pinning a
   * render tick. Kept because "the tombstone must not re-introduce a link" is
   * the thing that must keep being true.
   */
  it('offers no link into a record that is gone', async () => {
    await renderAllTab();

    expect(within(rowFor('Dana Deleter')).queryByRole('link')).toBeNull();
    expect(within(rowFor('Barry Bare')).queryByRole('link')).toBeNull();
  });

  it('leaves a LIVE reference alone — business identifier and link both intact', async () => {
    await renderAllTab();

    const link = await screen.findByRole('link', { name: /LR-00006/ });
    expect(link).toHaveAttribute(
      'href',
      `/apps/${APP}/showcase_leave_request/record/${ID_LIVE}`,
    );
    // The tombstone did not leak onto a healthy row.
    expect(within(rowFor('Liv Live')).queryAllByText(TOMBSTONE)).toHaveLength(0);
  });

  it('does NOT claim a deletion for a reference that fails to resolve for some other reason', async () => {
    await renderAllTab();
    await waitFor(() => expect(adapterFind).toHaveBeenCalled());

    // The probe was asked about the hidden record and the deleted ones in the
    // SAME read, and answered the same way for all of them…
    const asked = adapterFind.mock.calls[0]?.[1] as { $filter?: { id?: { $in?: string[] } } };
    expect(asked?.$filter?.id?.$in).toEqual(
      expect.arrayContaining([ID_DELETED, ID_DELETED_BARE, ID_HIDDEN]),
    );

    // …yet only the rows the SERVER marked `record_deleted` are tombstoned.
    const hidden = rowFor('Hana Hidden');
    expect(within(hidden).queryAllByText(TOMBSTONE)).toHaveLength(0);
    // Today's behaviour for that row is untouched (objectui#5211): the payload
    // snapshot's title still shows, the link is suppressed, and nothing tells
    // the viewer their permissions problem is a deletion.
    expect(within(hidden).getAllByText('LR-00009').length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(within(rowFor('Hana Hidden')).queryByRole('link')).toBeNull(),
    );
  });

  // The drawer case ("tombstones the same reference in the drawer — not one
  // click deeper") retired with the inbox side sheet (objectui#12484). A request
  // now opens on its served page, whose deleted state is pinned by
  // `approvalRequestsDataSource.servedPageReferenceStates-12489.test.tsx`
  // ("deleted (sheet: tombstone)": the tombstone, no link, and the bare id
  // nowhere on the page, the H1 included), in `apps/console/src/services/`.
});
