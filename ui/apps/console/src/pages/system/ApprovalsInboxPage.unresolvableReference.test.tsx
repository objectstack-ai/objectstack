// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Approvals Inbox — a reference that neither resolves nor carries a snapshot
 * title renders a CAUSE-FREE affordance, never the opaque record id
 * (objectui#8631).
 *
 * ## The defect, and the fence around its fix
 *
 * objectui#7108 tombstones the class the platform FLAGS (`status: 'cancelled'`
 * + `cancel_reason: 'record_deleted'`). A terminal (`approved` / `rejected`)
 * row carries no such flag and never will — the upstream cancel path names
 * `status: 'pending'` in its `where` — so a terminal row whose record no longer
 * resolves kept degrading to the opaque record id.
 *
 * The triage ruling is a neutral affordance plus an explicit fence: ⛔ do not
 * distinguish "deleted" from "not visible", because that distinction is an
 * existence oracle the platform declines to answer everywhere else. So the
 * cases below pin BOTH halves — the affordance is present on every surface,
 * and it says nothing about the cause.
 *
 * ## What each case measures, and why a weaker pin would pass on worse code
 *
 * - "no raw id" alone passes on a row that renders NOTHING, which costs the
 *   approver the fact that an approval exists — strictly worse than the id. So
 *   presence, text and the survival of the rest of the row are all pinned.
 * - The negative control is the fence itself, pinned as a test rather than as a
 *   comment: the rendered TEXT carries neither a deletion word nor a
 *   permissions word, and the DOM carries the record id in neither form (the
 *   truncated one it displayed nor the full one it used to hang in a `title`
 *   attribute on every row). ⚠️ That control is `en`-only, deliberately and
 *   with the alternative refused — the case itself states exactly what the
 *   other nine packs are and are not checked for, so this paragraph is not
 *   the last word a reader gets on the fence's coverage.
 * - The discriminating fixture rows are the two this must NOT touch: a row
 *   whose snapshot kept a business identifier (objectui#5211 keeps showing it
 *   and only withholds the link) and a row the SERVER marked `record_deleted`
 *   (which keeps the platform's own stronger sentence). A widened predicate
 *   reds one of those two.
 *
 * ## Fixture notes
 *
 * The probe's answer FUSES the two causes exactly as the platform's read path
 * does: the deleted record and the merely-invisible ones are all simply absent
 * from the `id in (…)` read, and nothing in the answer separates them.
 *
 * `queryAllByText` / `within(row)` throughout, never a bare `queryByText`: the
 * inbox renders each request twice (desktop table + mobile card), so a bare
 * query THROWS on the multiple match rather than reporting a miss.
 *
 * No build artifact sits between the edit and this test: the root Vitest config
 * aliases every `@object-ui` specifier at that package's source directory, and
 * the page, the probe and the affordance under test are this app's own source.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { APPROVAL_CANCEL_REASON_LABELS } from '@objectstack/spec/contracts';

const APP = 'com.objectstack.account';

/** The tombstone copy — the platform's, taken from the CONTRACT. */
const TOMBSTONE = APPROVAL_CANCEL_REASON_LABELS.record_deleted;

/**
 * Opaque record ids, each with a distinct 6-char prefix. `formatIdentity`
 * truncates anything over 14 characters to `<first 6>…<last 4>`, so asserting
 * on the PREFIX catches the truncated form the row would have rendered and the
 * full form a `title` attribute would have carried.
 */
const ID_LIVE = 'LiveRec0rdAAAAA';
const ID_GONE_BARE = 'Un0penab1eZZZZZ';
const ID_GONE_TITLED = 'T1tl3dG0neYYYYY';
const ID_DELETED = 'D3l3tedBar3XXXX';

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
      id: 'req_gone_bare',
      record_id: 'Un0penab1eZZZZZ',
      // No snapshot title at all — THE case this card reports: terminal, no
      // server-published cause, and the slot fell through to the opaque id.
      status: 'approved',
      submitter_id: 'u_bare',
      submitter_name: 'Uma Unknown',
    },
    {
      ...base,
      id: 'req_gone_titled',
      record_id: 'T1tl3dG0neYYYYY',
      // Unresolvable too, but the snapshot kept a business identifier, so
      // objectui#5211's behaviour stands: the title shows, only the link goes.
      record_title: 'LR-00009',
      status: 'approved',
      submitter_id: 'u_titled',
      submitter_name: 'Tina Titled',
    },
    {
      ...base,
      id: 'req_deleted',
      record_id: 'D3l3tedBar3XXXX',
      // The SERVER said this one was deleted. It keeps objectui#7108's
      // tombstone — the stronger sentence, because it was asserted upstream.
      status: 'cancelled',
      cancel_reason: 'record_deleted',
      submitter_id: 'u_dead',
      submitter_name: 'Dana Deleter',
      completed_at: '2026-09-02T00:00:00.000Z',
    },
  ];

  /**
   * The platform's read path, reduced to the property that matters here: a
   * deleted record and a record this principal may not see are BOTH simply
   * absent from an `id in (…)` list read.
   */
  const adapterFind = vi.fn(async (_object: string, params?: Record<string, unknown>) => {
    const ids = (params?.$filter as { id?: { $in?: string[] } } | undefined)?.id?.$in ?? [];
    const gone = new Set(['Un0penab1eZZZZZ', 'T1tl3dG0neYYYYY', 'D3l3tedBar3XXXX']);
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
import { isUnresolvableRecordReference } from './unresolvableRecordReference';
import { en } from '@object-ui/i18n';

/**
 * The copy under test, read from THIS repo's catalogue rather than re-typed:
 * the console authors this sentence (there is no upstream option label for it —
 * see `unresolvableRecordReference`), so the `en` pack is its original and a
 * hand-typed copy here would be a second one.
 */
const COPY = en.approvalsInbox.recordUnresolvable;

function renderInbox() {
  return render(
    <MemoryRouter initialEntries={[`/apps/${APP}/system/approvals`]}>
      <Routes>
        <Route path="/apps/:appName/system/approvals" element={<ApprovalsInboxPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Land on "All" — the tab every status in the fixture appears in. */
async function renderAllTab(): Promise<void> {
  renderInbox();
  fireEvent.click(await screen.findByRole('tab', { name: 'All' }));
  await screen.findAllByText('Liv Live');
  // The affordance is driven by the probe, which answers a tick after paint.
  await waitFor(() => expect(adapterFind).toHaveBeenCalled());
}

/** The desktop table row holding `text` (the mobile card renders no table rows). */
function rowFor(text: string): HTMLElement {
  const found = screen.getAllByRole('row').find((r) => within(r).queryAllByText(text).length > 0);
  if (!found) throw new Error(`no row for ${text}`);
  return found;
}

/**
 * LEAF nodes whose whole text is `text` — an ancestor whose `textContent`
 * happens to match is not a second rendering of it, and the count is the
 * assertion this file makes about how many surfaces show a string.
 */
function leafNodes(text: string): HTMLElement[] {
  return screen.queryAllByText((_content, element) => {
    if (!element || element.children.length > 0) return false;
    return element.textContent?.replace(/\s+/g, ' ').trim() === text;
  });
}

/** Split those by surface: inside the desktop table, or outside it. */
function bySurface(text: string): { desktop: HTMLElement[]; other: HTMLElement[] } {
  const table = screen.getByRole('table');
  const nodes = leafNodes(text);
  return {
    desktop: nodes.filter((n) => table.contains(n)),
    other: nodes.filter((n) => !table.contains(n)),
  };
}

beforeEach(() => {
  adapterFind.mockClear();
  for (const fn of Object.values(approvalsApiStub)) fn.mockClear();
});
afterEach(cleanup);

describe('isUnresolvableRecordReference (objectui#8631)', () => {
  it('needs BOTH halves — an unreadable target AND no snapshot title', () => {
    expect(isUnresolvableRecordReference({ status: 'approved' }, true)).toBe(true);
    // A title means the row already reads as history; there is no degradation
    // to remove, and replacing it would delete information.
    expect(isUnresolvableRecordReference({ status: 'approved', record_title: 'LR-1' }, true)).toBe(false);
    // The probe fails open, so UNKNOWN keeps today's rendering: an unanswered
    // probe must never announce that a reachable record cannot be opened.
    expect(isUnresolvableRecordReference({ status: 'approved' }, false)).toBe(false);
    expect(isUnresolvableRecordReference(null, true)).toBe(false);
    expect(isUnresolvableRecordReference(undefined, true)).toBe(false);
  });

  it('yields to the class the SERVER flagged — the tombstone keeps precedence', () => {
    // objectui#7108's row is unreadable too (a deleted record is absent from
    // the probe's answer like any other), so without this the weaker sentence
    // would race the platform's own.
    expect(
      isUnresolvableRecordReference({ status: 'cancelled', cancel_reason: 'record_deleted' }, true),
    ).toBe(false);
    // …but a cancellation for any OTHER cause is not that class.
    expect(isUnresolvableRecordReference({ status: 'cancelled' }, true)).toBe(true);
  });

  it('is whitespace-hard about the title, which is a snapshot field', () => {
    expect(isUnresolvableRecordReference({ status: 'approved', record_title: '   ' }, true)).toBe(true);
    expect(isUnresolvableRecordReference({ status: 'approved', record_title: '' }, true)).toBe(true);
  });
});

describe('Approvals Inbox — unresolvable record reference (objectui#8631)', () => {
  it('renders the affordance on the desktop row and the mobile card, in this repo’s own copy', async () => {
    await renderAllTab();

    const row = rowFor('Uma Unknown');
    await waitFor(() => expect(within(row).queryAllByText(COPY).length).toBeGreaterThan(0));

    // Two surfaces render every request, and BOTH must have it: the mobile card
    // consulted no readability probe at all before this change, so a table-only
    // fix moved the dead end to another viewport rather than removing it.
    const { desktop, other } = bySurface(COPY);
    expect(desktop).toHaveLength(1);
    expect(other).toHaveLength(1);
  });

  it('shows the record id in NEITHER form — not truncated as text, not whole as a tooltip', async () => {
    await renderAllTab();

    const row = rowFor('Uma Unknown');
    await waitFor(() => expect(within(row).queryAllByText(COPY).length).toBeGreaterThan(0));
    expect(row.innerHTML).not.toContain('Un0pen');
    // Both viewports, and every attribute: the prefix catches the truncated
    // form and the full one alike.
    expect(document.body.innerHTML).not.toContain('Un0pen');

    // ⭐ The other half of "the raw record id": it used to hang in a `title`
    // attribute on EVERY row, readable ones included, where it was the full
    // untruncated id rather than the truncated one on screen.
    for (const id of [ID_LIVE, ID_GONE_BARE, ID_GONE_TITLED, ID_DELETED]) {
      expect(document.querySelectorAll(`[title="${id}"]`)).toHaveLength(0);
    }
  });

  /**
   * ⭐ THE FENCE, pinned as a test rather than as a comment. The copy may not
   * assert a deletion and may not assert a permissions problem — the platform
   * fuses the two on purpose and the console may not un-fuse them.
   */
  it('names neither cause — no deletion word, no permissions word', async () => {
    await renderAllTab();

    const row = rowFor('Uma Unknown');
    await waitFor(() => expect(within(row).queryAllByText(COPY).length).toBeGreaterThan(0));

    const text = row.textContent ?? '';
    expect(text).toMatch(COPY);
    expect(text).not.toMatch(/delet|removed|gone/i);
    expect(text).not.toMatch(/permission|access|not visible|no longer visible|forbidden/i);
    // And the `en` value carries neither cause — ⚠️ THE `en` VALUE ONLY.
    // `COPY` is `en.approvalsInbox.recordUnresolvable`, this file reads no
    // other pack, and the terms above are English: a cause word reintroduced
    // in `ru` or `ja` would NOT red here, and nothing else in this repo
    // re-derives it either. Said rather than left to read as live
    // (commandment #9).
    //
    // Scoping that was weighed and REFUSED, not skipped: a per-language
    // deletion / permissions word list is a second authored contract that
    // goes stale in silence and that a synonym or an inflection walks past,
    // so it would report coverage it does not have — which is the exact
    // defect this line was repaired for.
    //
    // The `en` half is still load-bearing, and it is the half a regression
    // arrives through: the inline `defaultValue` must match this value byte
    // for byte (`check:i18n-keys`), and the nine translations are made FROM
    // it, so a cause reintroduced at the source reds here before anyone can
    // translate it. What is unguarded is a translation drifting away from a
    // clean source — a translator's review, not a gate.
    expect(COPY).not.toMatch(/delet|permission|access/i);
  });

  it('keeps the rest of the row — an empty reference slot would be worse than the id', async () => {
    await renderAllTab();

    const row = rowFor('Uma Unknown');
    await waitFor(() => expect(within(row).queryAllByText(COPY).length).toBeGreaterThan(0));
    expect(within(row).getAllByText('Leave Approval').length).toBeGreaterThan(0);
    expect(within(row).getAllByText('Uma Unknown').length).toBeGreaterThan(0);
    expect(within(row).getAllByText('Leave Request').length).toBeGreaterThan(0);
    // Nothing to open, so nothing pretends to be openable.
    expect(within(row).queryByRole('link')).toBeNull();
  });

  it('leaves a LIVE reference alone — business identifier and link both intact', async () => {
    await renderAllTab();

    const link = await screen.findByRole('link', { name: /LR-00006/ });
    expect(link).toHaveAttribute(
      'href',
      `/apps/${APP}/showcase_leave_request/record/${ID_LIVE}`,
    );
    // The affordance did not leak onto a healthy row — and this is a DIFFERENT
    // row element from the positive case, not the same frame read twice.
    const live = rowFor('Liv Live');
    expect(live).not.toBe(rowFor('Uma Unknown'));
    expect(within(live).queryAllByText(COPY)).toHaveLength(0);
  });

  it('leaves an unresolvable row that KEPT its business identifier alone (objectui#5211)', async () => {
    await renderAllTab();

    const row = rowFor('Tina Titled');
    // The snapshot title still shows, the link is still suppressed, and the
    // affordance does NOT replace a perfectly readable identifier.
    expect(within(row).getAllByText('LR-00009').length).toBeGreaterThan(0);
    expect(within(row).queryAllByText(COPY)).toHaveLength(0);
    await waitFor(() => expect(within(rowFor('Tina Titled')).queryByRole('link')).toBeNull());
  });

  it('leaves the SERVER-flagged deletion saying what the server said (objectui#7108)', async () => {
    await renderAllTab();

    const row = rowFor('Dana Deleter');
    expect(within(row).getAllByText(TOMBSTONE).length).toBeGreaterThan(0);
    // ⭐ The case that catches a widened predicate: this row is unreadable to
    // the probe exactly like the others, and it must NOT take the weaker copy.
    expect(within(row).queryAllByText(COPY)).toHaveLength(0);
  });

  // The drawer case ("renders the same affordance in the drawer — not one
  // click deeper") retired with the inbox side sheet (objectui#12484). A
  // request now opens on its served page, whose unresolvable state is pinned by
  // `approvalRequestsDataSource.servedPageReferenceStates-12489.test.tsx`
  // ("unresolvable (sheet: unresolvableReference)": the cause-free text, no
  // link, and the id nowhere on the page, the H1 included), in
  // `apps/console/src/services/`.
});
