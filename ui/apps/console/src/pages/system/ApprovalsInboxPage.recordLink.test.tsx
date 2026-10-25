// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Approvals Inbox — the record link is offered only to a viewer who can open it
 * (objectui#5211).
 *
 * ## The defect
 *
 * Approver routing goes by position; record visibility is a separate gate, and
 * nothing reconciles the two. An approver routed a request about a record they
 * cannot read was still offered the row's record chip, which landed on the
 * record page's "Record not found — … does not exist or may have been deleted".
 * Per the maintainer's ruling (2026-08-19) the link is suppressed for exactly
 * those rows.
 *
 * ## What each case is measuring
 *
 * - the unreadable row renders **no link** (and still renders the title, which
 *   comes from the request's payload snapshot);
 * - the readable row is untouched — link, and the same href as before;
 * - the whole page costs **one** readability read for two rows of one object —
 *   the batching the ruling made the deciding criterion;
 * - the **decision path is untouched**: one case pins inline approve WITHOUT
 *   involving the probe (so it holds on the pre-change tree too — that is what
 *   makes it a pin), and one shows that a row whose link was suppressed is still
 *   decidable, which is the thing that already worked and must keep working.
 *
 * ⛔ Nothing here asserts anything about the server answering `404` rather than
 * `403` for the by-id read. That is the server's deliberate choice and is out of
 * scope in both directions; the probe issues a list read, never a by-id one.
 *
 * No build artifact sits between the edit and this test: the root Vitest config
 * aliases every `@object-ui` specifier at that package's `src` directory, and
 * the page and probe under test are this app's own source. (Writing that path
 * with a glob segment would close this comment — the sequence is a block-comment
 * terminator, and the parse error it produces points at a line far below.)
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const APP = 'com.objectstack.account';

const { adapterFind, approvalsApiStub, rows, ADAPTER, AUTH, I18N } = vi.hoisted(() => {
  const rows = [
    {
      id: 'req_readable',
      process_name: 'invoice_approval',
      process_label: 'Invoice Approval',
      object_name: 'showcase_invoice',
      object_label: 'Invoice',
      record_id: 'inv_readable',
      record_title: 'Readable Invoice',
      status: 'pending',
      pending_approvers: ['u_1'],
      submitter_id: 'u_2',
      submitter_name: 'Sam Submitter',
      submitted_at: '2026-08-19T00:00:00.000Z',
    },
    {
      id: 'req_hidden',
      process_name: 'invoice_approval',
      process_label: 'Invoice Approval',
      object_name: 'showcase_invoice',
      object_label: 'Invoice',
      record_id: 'inv_hidden',
      record_title: 'Hidden Invoice',
      status: 'pending',
      pending_approvers: ['u_1'],
      submitter_id: 'u_2',
      submitter_name: 'Sam Submitter',
      submitted_at: '2026-08-19T00:00:00.000Z',
    },
  ];

  /**
   * The server's own behaviour, reduced: a record the principal's grant filters
   * out never appears in the row set, so an `id in (…)` read simply comes back
   * without it. `inv_hidden` is that record.
   */
  const adapterFind = vi.fn(async (_object: string, params?: Record<string, unknown>) => {
    const ids = (params?.$filter as { id?: { $in?: string[] } } | undefined)?.id?.$in ?? [];
    return { data: ids.filter((id) => id !== 'inv_hidden').map((id) => ({ id })) };
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

/** The desktop table row holding `title` (the mobile card renders no links). */
function rowFor(title: string): HTMLElement {
  const found = screen.getAllByRole('row').find((r) => within(r).queryByText(title));
  if (!found) throw new Error(`no row for ${title}`);
  return found;
}

/**
 * Approve the row holding `title`, through the row button and its confirmation.
 *
 * Query and click in ONE synchronous step, with `fireEvent`. That form is a
 * leftover from when the page declared `RecordCell` / `InlineActions` INSIDE its
 * component body: every re-render was a fresh component type, React replaced
 * those DOM nodes, and a multi-tick `userEvent` interaction lost the rest of its
 * pointer sequence to a detached node — the click silently did nothing and the
 * confirmation never opened. objectui#5348 hoisted those cells to module scope
 * and `ApprovalsInboxPage.cellIdentity.test.tsx` pins that a pointer sequence
 * spanning a re-render now lands. The `fireEvent` form stays here on purpose:
 * these cases are objectui#5211's pins, not the place to re-measure #5348's
 * symptom.
 */
async function approveFromRow(title: string): Promise<void> {
  fireEvent.click(within(rowFor(title)).getByRole('button', { name: 'Approve' }));
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
}

beforeEach(() => {
  adapterFind.mockClear();
  for (const fn of Object.values(approvalsApiStub)) fn.mockClear();
});
afterEach(cleanup);

describe('Approvals Inbox — record link readability (objectui#5211)', () => {
  it('suppresses the record link on a row whose target this viewer cannot read', async () => {
    renderInbox();

    // The readable row is untouched: still a link, still the same href.
    const link = await screen.findByRole('link', { name: /Readable Invoice/ });
    expect(link).toHaveAttribute('href', `/apps/${APP}/showcase_invoice/record/inv_readable`);

    // The unreadable one loses the link once the probe has answered…
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /Hidden Invoice/ })).not.toBeInTheDocument(),
    );
    // …and only the link. The title still shows — it comes from the request's
    // payload snapshot, which is what the approver decides from.
    expect(screen.getAllByText('Hidden Invoice').length).toBeGreaterThan(0);
    expect(within(rowFor('Hidden Invoice')).queryByRole('link')).not.toBeInTheDocument();
  });

  it('costs ONE readability read for a page of rows sharing an object', async () => {
    renderInbox();
    await screen.findByRole('link', { name: /Readable Invoice/ });
    await waitFor(() => expect(adapterFind).toHaveBeenCalled());

    // Two rows, one object => one batched list read. Not one per row.
    expect(adapterFind).toHaveBeenCalledTimes(1);
    expect(adapterFind).toHaveBeenCalledWith('showcase_invoice', {
      $filter: { id: { $in: ['inv_readable', 'inv_hidden'] } },
      $select: ['id'],
      $top: 2,
    });
  });

  /**
   * A PIN, deliberately independent of the readability probe: it must pass on
   * the tree BEFORE this change as well as after, which is what makes it
   * evidence that the decision path was left alone rather than evidence that
   * the change works. (It is stated separately from the case below because a
   * pin coupled to the new behaviour proves nothing about the old.)
   */
  it('pins the inline decision path — approve still fires for the row it is clicked on', async () => {
    renderInbox();
    // Rows are up (desktop table + mobile card each render one per request).
    await screen.findAllByRole('button', { name: 'Approve' });

    await approveFromRow('Readable Invoice');

    await waitFor(() =>
      expect(approvalsApiStub.approve).toHaveBeenCalledWith('req_readable', { actor_id: 'u_1' }),
    );
  });

  it('still lets the approver decide a row whose link was suppressed', async () => {
    renderInbox();
    // Wait for the rows FIRST. Waiting only for the link's absence passes
    // vacuously while the page is still a loading skeleton — measured: on the
    // pre-change tree this case went green for that reason alone.
    await screen.findByRole('link', { name: /Readable Invoice/ });
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /Hidden Invoice/ })).not.toBeInTheDocument(),
    );

    await approveFromRow('Hidden Invoice');

    await waitFor(() =>
      expect(approvalsApiStub.approve).toHaveBeenCalledWith('req_hidden', { actor_id: 'u_1' }),
    );
  });

  it('keeps every link when the probe cannot answer (fail open)', async () => {
    adapterFind.mockImplementationOnce(async () => { throw new Error('NETWORK'); });
    renderInbox();

    await screen.findByRole('link', { name: /Readable Invoice/ });
    await waitFor(() => expect(adapterFind).toHaveBeenCalled());
    // Unknown is not "unreadable": a failed probe must never withhold a link
    // from someone who could have used it.
    expect(await screen.findByRole('link', { name: /Hidden Invoice/ })).toBeInTheDocument();
    expect(rows).toHaveLength(2);
  });
});
