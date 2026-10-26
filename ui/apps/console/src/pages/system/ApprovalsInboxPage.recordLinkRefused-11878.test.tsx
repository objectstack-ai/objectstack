// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Approvals Inbox — no record link for an approver whose read of the object is
 * REFUSED (403), and nothing else changes (objectui#11878).
 *
 * ## The defect, as measured
 *
 * An approver with no object-level read on the approval's target was still
 * offered the record link. The readability probe's list read came back
 * `403 PERMISSION_DENIED`, the probe swallowed that as "unknown" and kept the
 * link (the deliberate fail-open), and the link landed on the record page's
 * catch-all: "Record not found — The record you are looking for does not
 * exist or may have been deleted." The ruling (ruling C on
 * objectstack-ai/objectstack#7497, Q5) reads that refusal as "cannot read" for
 * the link, exactly as objectui#5211 reads an answer that leaves the id out.
 *
 * ## One page, every probe answer side by side
 *
 * Each object below gets one kind of answer, so a single render shows every
 * verdict the probe can give and a cross-wired one reds its neighbour:
 *
 * - `showcase_invoice` answers 200: one id in the row set (the control — link
 *   kept), one left out (objectui#5211 — no link, unchanged);
 * - `showcase_contract` refuses the read with the error the real adapter
 *   throws for the measured 403 (`httpStatus` + `PERMISSION_DENIED`, as
 *   `recordReadability.refused-11878.test.ts` derives through the real client)
 *   — no link on the row;
 * - `showcase_project` fails with a 5xx and `showcase_task` with a transport
 *   error — both keep the link (fail-open, unchanged).
 *
 * The ruling moves the link and nothing else, so the refused rows are also
 * pinned to keep what they had: the snapshot title, the decision path, and —
 * for a row with no title — the reference text it always showed rather than
 * objectui#8631's cause-free label, which stays on the row-set answer alone.
 *
 * No build artifact sits between the edit and this test: the root Vitest config
 * aliases every `@object-ui` specifier at that package's source directory, and
 * the page and probe under test are this app's own source.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const APP = 'com.objectstack.account';

/** A title-less refused target; `formatIdentity` shows it as `R3fus3…QQQQ`. */
const ID_REFUSED_BARE = 'R3fus3dBar3QQQQQ';

const { adapterFind, approvalsApiStub, ADAPTER, AUTH, I18N } = vi.hoisted(() => {
  const base = {
    process_name: 'doc_approval',
    process_label: 'Document Approval',
    status: 'pending',
    pending_approvers: ['u_1'],
    submitter_id: 'u_2',
    submitter_name: 'Sam Submitter',
    submitted_at: '2026-10-08T00:00:00.000Z',
  };
  const rows = [
    { ...base, id: 'req_readable', object_name: 'showcase_invoice', object_label: 'Invoice', record_id: 'inv_readable', record_title: 'Readable Invoice' },
    { ...base, id: 'req_hidden', object_name: 'showcase_invoice', object_label: 'Invoice', record_id: 'inv_hidden', record_title: 'Hidden Invoice' },
    { ...base, id: 'req_refused', object_name: 'showcase_contract', object_label: 'Contract', record_id: 'ctr_refused', record_title: 'Refused Contract' },
    // No snapshot title: the reference slot falls back to the record id.
    { ...base, id: 'req_refused_bare', object_name: 'showcase_contract', object_label: 'Contract', record_id: 'R3fus3dBar3QQQQQ', submitter_name: 'Bea Bare' },
    { ...base, id: 'req_failing', object_name: 'showcase_project', object_label: 'Project', record_id: 'prj_failing', record_title: 'Failing Project' },
    { ...base, id: 'req_offline', object_name: 'showcase_task', object_label: 'Task', record_id: 'tsk_offline', record_title: 'Offline Task' },
  ];

  /**
   * What `@objectstack/client` throws for a non-2xx answer, reduced to the two
   * fields it stamps from the response (measured on the live 403).
   */
  const httpError = (status: number, code: string, message: string) =>
    Object.assign(new Error(message), { httpStatus: status, code });

  const adapterFind = vi.fn(async (object: string, params?: Record<string, unknown>) => {
    const ids = (params?.$filter as { id?: { $in?: string[] } } | undefined)?.id?.$in ?? [];
    switch (object) {
      case 'showcase_invoice':
        return { data: ids.filter((id) => id !== 'inv_hidden').map((id) => ({ id })) };
      case 'showcase_contract':
        throw httpError(403, 'PERMISSION_DENIED', 'You do not have permission to perform this action.');
      case 'showcase_project':
        throw httpError(500, 'INTERNAL_ERROR', 'Internal server error');
      case 'showcase_task':
        throw new TypeError('Failed to fetch');
      default:
        return { data: [] };
    }
  });

  const approvalsApiStub = {
    listRequests: vi.fn(async () => ({ data: rows })),
    getRequest: vi.fn(async (id: string) => ({ data: rows.find((r) => r.id === id) })),
    listActions: vi.fn(async () => ({ data: [] })),
    approve: vi.fn(async () => ({ data: rows[0], finalized: true })),
    reject: vi.fn(async () => ({ data: rows[0], finalized: true })),
  };

  // STABLE singletons — a fresh object per render re-runs the page's load
  // effect (and the probe's) forever and the table never leaves its skeleton.
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
import { en } from '@object-ui/i18n';

/** objectui#8631's cause-free copy, read from this repo's catalogue. */
const UNRESOLVABLE = en.approvalsInbox.recordUnresolvable;

function renderInbox() {
  return render(
    <MemoryRouter initialEntries={[`/apps/${APP}/system/approvals`]}>
      <Routes>
        <Route path="/apps/:appName/system/approvals" element={<ApprovalsInboxPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The desktop table row holding `text` (the mobile card renders no links). */
function rowFor(text: string): HTMLElement {
  const found = screen.getAllByRole('row').find((r) => within(r).queryAllByText(text).length > 0);
  if (!found) throw new Error(`no row for ${text}`);
  return found;
}

/**
 * Render, then wait until the probe has answered for every object: the rows
 * are up (the readable link is the first thing a loaded table shows) and the
 * row-set answer has landed (the hidden invoice's link is gone). Waiting only
 * for a link's ABSENCE passes vacuously on a loading skeleton.
 */
async function renderAnswered(): Promise<void> {
  renderInbox();
  await screen.findByRole('link', { name: /Readable Invoice/ });
  await waitFor(() => expect(adapterFind).toHaveBeenCalledTimes(4));
  await waitFor(() =>
    expect(screen.queryByRole('link', { name: /Hidden Invoice/ })).not.toBeInTheDocument(),
  );
}

beforeEach(() => {
  adapterFind.mockClear();
  for (const fn of Object.values(approvalsApiStub)) fn.mockClear();
});
afterEach(cleanup);

describe('Approvals Inbox — a refused probe withholds the record link (objectui#11878)', () => {
  it('renders no record link on a row whose object read the server refuses (403)', async () => {
    await renderAnswered();

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /Refused Contract/ })).not.toBeInTheDocument(),
    );
    expect(within(rowFor('Refused Contract')).queryByRole('link')).not.toBeInTheDocument();
    // Only the link goes: the title from the request's own snapshot stays.
    expect(within(rowFor('Refused Contract')).getAllByText('Refused Contract').length).toBeGreaterThan(0);
  });

  it('CONTROL — a row the probe answers with rows keeps its link and its href', async () => {
    await renderAnswered();

    const link = screen.getByRole('link', { name: /Readable Invoice/ });
    expect(link).toHaveAttribute('href', `/apps/${APP}/showcase_invoice/record/inv_readable`);
  });

  it('leaves objectui#5211 as it was — an id outside the row set (200, no row) has no link', async () => {
    await renderAnswered();

    expect(within(rowFor('Hidden Invoice')).queryByRole('link')).not.toBeInTheDocument();
    expect(within(rowFor('Hidden Invoice')).getAllByText('Hidden Invoice').length).toBeGreaterThan(0);
  });

  it('keeps the link when the probe fails with a 5xx or a transport error (fail-open)', async () => {
    await renderAnswered();

    // Both objects were really asked, and both failed — still a link each.
    expect(adapterFind).toHaveBeenCalledWith('showcase_project', expect.anything());
    expect(adapterFind).toHaveBeenCalledWith('showcase_task', expect.anything());
    expect(screen.getByRole('link', { name: /Failing Project/ })).toHaveAttribute(
      'href',
      `/apps/${APP}/showcase_project/record/prj_failing`,
    );
    expect(screen.getByRole('link', { name: /Offline Task/ })).toHaveAttribute(
      'href',
      `/apps/${APP}/showcase_task/record/tsk_offline`,
    );
  });

  // The drawer case ("withholds the link in the drawer too — not one click
  // deeper") retired with the inbox side sheet (objectui#12484). A request now
  // opens on its served page, whose refused-target state is pinned by
  // `approvalRequestsDataSource.servedPageReferenceStates-12489.test.tsx`
  // ("refused (sheet: recordLinkRefused-11878)"), in `apps/console/src/services/`.

  it('keeps a title-less refused row’s reference text — the cause-free label stays on the row-set answer', async () => {
    await renderAnswered();

    const row = rowFor('Bea Bare');
    await waitFor(() => expect(within(row).queryByRole('link')).not.toBeInTheDocument());
    // What the row showed before this change, minus the link: the reference
    // text (the record id as `formatIdentity` prints it)…
    expect(row.textContent).toContain(ID_REFUSED_BARE.slice(0, 6));
    // …and NOT objectui#8631's label, which the ruling leaves where it was.
    expect(within(row).queryAllByText(UNRESOLVABLE)).toHaveLength(0);
  });

  it('still lets the approver decide a row whose link the refusal withheld', async () => {
    await renderAnswered();
    await waitFor(() =>
      expect(within(rowFor('Refused Contract')).queryByRole('link')).not.toBeInTheDocument(),
    );

    // One synchronous query-and-click, as `ApprovalsInboxPage.recordLink.test.tsx`
    // does it, so a re-render between the two cannot detach the target.
    fireEvent.click(within(rowFor('Refused Contract')).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));

    await waitFor(() =>
      expect(approvalsApiStub.approve).toHaveBeenCalledWith('req_refused', { actor_id: 'u_1' }),
    );
  });
});
