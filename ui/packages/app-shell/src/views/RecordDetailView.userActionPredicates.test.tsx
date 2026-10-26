/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4213 — the CONSOLE record header honors `userActions.*` in its
 * PREDICATE form, not only its boolean one.
 *
 * The asymmetry this file pins is the card's own repro. `userActions:
 * { delete: false }` — the BOOLEAN form — already reached both surfaces,
 * because it flows through the affordance resolver
 * (`resolveRecordHeaderActionGates` → `resolveEffectiveCrudAffordances`). The
 * per-record OBJECT form — `edit: { visibleWhen: … }` — reached only the list
 * row: `synthSystemActions` gated on `objectAffordances.edit ∧
 * recordWriteAllowed` and never parsed, let alone evaluated, the predicate. So
 * an author narrowing the edit entry by record status narrowed the list only,
 * and left the record page offering a button that opens a form the server will
 * reject.
 *
 * This is the third and last surface of that convergence:
 *
 *   • row kebab            — `plugin-grid` `isBuiltinRowActionVisible` (#2614)
 *   • `DetailView` header  — `plugin-detail` (#4419 / PR #4515)
 *   • console record page  — HERE (`app-shell` `RecordDetailView`)
 *
 * ## Which evaluator, and why this shape
 *
 * The same helper family as the other two, so one authored predicate gets one
 * answer platform-wide:
 *
 *   • `userActionPredicates()` from `@object-ui/core` — THE parser for the
 *     boolean/object form. A bare boolean yields NO predicates, which is what
 *     keeps the boolean form the affordance resolver's channel alone rather
 *     than growing a second definition of it here.
 *   • `useRowPredicate()` from `@object-ui/react` — the canonical CEL
 *     evaluation. `plugin-grid`'s `evalRowActionVisibility` documents itself as
 *     mirroring `useRowPredicate(pred, row, { fallback: false, warnOnError:
 *     true, label, fields })` exactly, boolean short-circuit included, and is
 *     hook-free only because a row loop evaluates a variable number of actions
 *     inside one `useMemo`.
 *
 * Posture carried over from PR #4515: `visibleWhen` counts as declared by
 * `!= null` (so `visibleWhen: false` HIDES rather than reading as ungated —
 * the objectui#3492 invariant) and fails CLOSED; `disabledWhen` is `!= null`
 * gated too and fails SOFT.
 *
 * ## Radix caution (carried from PR #4515)
 *
 * Every assertion about the primary Edit CTA runs BEFORE any overflow menu is
 * opened: Radix `aria-hidden`s the rest of the page while a menu is open, so a
 * role query would find nothing and a `not.toBeDisabled()` would pass on a
 * null instead of on the button.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

// Orthogonal chrome — same posture as RecordDetailView.headerRefresh.test.
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { MetadataCtx } from '@object-ui/react';
import { RecordDetailView } from './RecordDetailView';

const OBJECT_NAME = 'qms_defect';
const RECORD_ID = 'DEF-1';

/** The card's own predicate, verbatim from the issue body. */
const EDIT_VISIBLE_WHEN = 'record.status == "pending" || record.status == "in_progress"';

/** The card's own record: `status: 'reported'` ⇒ the predicate judges FALSE. */
const REPORTED = { id: RECORD_ID, name: 'Scratched housing', status: 'reported' };
/** …and the control the predicate ADMITS. */
const PENDING = { id: RECORD_ID, name: 'Scratched housing', status: 'pending' };

const FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
  status: { type: 'text', label: 'Status' },
  owner: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
};

function objectDef(userActions?: unknown) {
  return {
    name: OBJECT_NAME,
    label: 'Defect',
    // The permissive bucket — edit + delete both default open, so the ONLY
    // thing moving in this file is the predicate conjunct.
    managedBy: 'platform',
    fields: FIELDS,
    ...(userActions === undefined ? {} : { userActions }),
  };
}

function makeDataSource(record: Record<string, unknown>) {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => record),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

function makeMetadata(objects: any[]) {
  return {
    objects,
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
  } as any;
}

/**
 * Mount the real console record page and WAIT for the record read to land, so
 * an "Edit is gone" assertion can never pass merely because the record (and
 * therefore the predicate's input) had not arrived yet.
 */
async function mountRecordPage(
  record: Record<string, unknown>,
  userActions?: unknown,
  objectOverrides: Record<string, unknown> = {},
) {
  const objects = [{ ...objectDef(userActions), ...objectOverrides }];
  const dataSource = makeDataSource(record);
  const view = render(
    <MemoryRouter initialEntries={[`/apps/qms/${OBJECT_NAME}/${RECORD_ID}`]}>
      <MetadataCtx.Provider value={makeMetadata(objects)}>
        <RecordDetailView
          dataSource={dataSource}
          objects={objects}
          onEdit={() => {}}
          objectNameOverride={OBJECT_NAME}
          recordIdOverride={RECORD_ID}
        />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(dataSource.findOne).toHaveBeenCalled());
  await waitFor(() => expect(headerToolbar()).toBeTruthy());
  return { ...view, dataSource };
}

/** The `page:header` action toolbar — the host of every synth system action. */
function headerToolbar(): HTMLElement | null {
  return document.querySelector('[role="toolbar"]');
}

/** Every inline CTA the header currently renders, by visible label. */
function headerCtaLabels(): string[] {
  const bar = headerToolbar();
  if (!bar) return [];
  return Array.from(bar.querySelectorAll('button'))
    .map((b) => (b.textContent ?? '').trim())
    .filter(Boolean);
}

/** The header's primary Edit CTA (`sys_edit` renders inline, not in the ⋯). */
function headerEditButton(): HTMLButtonElement | null {
  const bar = headerToolbar();
  if (!bar) return null;
  return (
    (Array.from(bar.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim().toLowerCase() === 'edit',
    ) as HTMLButtonElement | undefined) ?? null
  );
}

/** Open the header's ⋯ overflow and return its rendered item labels. */
async function openHeaderOverflow(): Promise<string[]> {
  const trigger = screen.getByRole('button', { name: /more actions/i });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
  return screen.getAllByRole('menuitem').map((el) => (el.textContent ?? '').trim());
}

beforeEach(() => {
  cleanup();
  // Unrelated chrome (approvals, favourites, the record-explain probe) reaches
  // for the platform API; in jsdom that is a real socket. Answer locally so the
  // only asynchrony here is the record read. `useRecordEditable` fails OPEN on
  // this shape, which keeps `recordWriteAllowed` / `recordDeleteAllowed` true —
  // the predicate conjunct is then the only variable.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// RED — the card's repro. Pre-fix every assertion in this block fails.
// ---------------------------------------------------------------------------
describe('console record header — `userActions` predicates (objectui#4213)', () => {
  it('hides the header Edit on a record its `edit.visibleWhen` excludes', async () => {
    await mountRecordPage(REPORTED, { edit: { visibleWhen: EDIT_VISIBLE_WHEN } });

    // Asserted BEFORE any overflow opens (Radix aria-hidden trap).
    expect(headerEditButton()).toBeNull();
    // The companion: the toolbar itself still rendered, so "no Edit" cannot be
    // "no header".
    expect(await openHeaderOverflow()).toContain('Share');
  });

  it('hides the header Delete on a record its `delete.visibleWhen` excludes', async () => {
    await mountRecordPage(REPORTED, {
      delete: { visibleWhen: 'record.status != "reported"' },
    });

    expect(await openHeaderOverflow()).not.toContain('Delete');
  });

  it('renders the header Edit DISABLED when `edit.disabledWhen` holds', async () => {
    await mountRecordPage(REPORTED, {
      edit: { disabledWhen: 'record.status == "reported"' },
    });

    const edit = headerEditButton();
    expect(edit).toBeInTheDocument();
    expect(edit).toBeDisabled();
  });

  it('greys the header Delete when `delete.disabledWhen` holds', async () => {
    await mountRecordPage(REPORTED, {
      delete: { disabledWhen: 'record.status == "reported"' },
    });

    const items = screen.queryAllByRole('menuitem');
    expect(items).toHaveLength(0); // menu not open yet
    await openHeaderOverflow();
    const del = screen
      .getAllByRole('menuitem')
      .find((el) => (el.textContent ?? '').trim() === 'Delete')!;
    expect(del).toBeTruthy();
    expect(del).toHaveAttribute('data-disabled');
  });

  /**
   * `visibleWhen: false` is a DECLARED gate that excludes every record — the
   * `!= null` rule, not truthiness (the objectui#3492 invariant).
   */
  it('treats a literal `visibleWhen: false` as declared, not ungated', async () => {
    await mountRecordPage(PENDING, { edit: { visibleWhen: false } });

    expect(headerEditButton()).toBeNull();
  });

  it('accepts the canonical `{ dialect, source }` envelope', async () => {
    await mountRecordPage(REPORTED, {
      edit: { visibleWhen: { dialect: 'cel', source: EDIT_VISIBLE_WHEN } },
    });

    expect(headerEditButton()).toBeNull();
  });

  /**
   * A faulting predicate fails CLOSED for `visibleWhen` (never a button whose
   * precondition is unknown) — the posture every other surface applies. RED:
   * pre-fix nothing was evaluated, so nothing could fault.
   */
  it('fails CLOSED on an unevaluable `visibleWhen`', async () => {
    await mountRecordPage(PENDING, { edit: { visibleWhen: 'record.@@@ bad' } });

    expect(headerEditButton()).toBeNull();
  });

  /**
   * Half must-not-change, half RED: `sys_share` is the non-CRUD control that
   * stays put on BOTH sides, while the two CRUD entries beside it disappear
   * only after the fix.
   */
  it('subtracts only the CRUD entries — `sys_share` is untouched', async () => {
    await mountRecordPage(REPORTED, {
      edit: { visibleWhen: EDIT_VISIBLE_WHEN },
      delete: { visibleWhen: 'record.status != "reported"' },
    });

    expect(headerEditButton()).toBeNull();
    const items = await openHeaderOverflow();
    expect(items).toContain('Share');
    expect(items).not.toContain('Delete');
  });
});

// ---------------------------------------------------------------------------
// MUST-NOT-CHANGE — green on BOTH sides of the fix.
// ---------------------------------------------------------------------------
describe('console record header — the gates that must not move (objectui#4213)', () => {
  it('keeps the header Edit on a record its `edit.visibleWhen` admits', async () => {
    await mountRecordPage(PENDING, { edit: { visibleWhen: EDIT_VISIBLE_WHEN } });

    const edit = headerEditButton();
    expect(edit).toBeInTheDocument();
    expect(edit).not.toBeDisabled();
  });

  it('leaves an object with NO `userActions` completely ungated', async () => {
    await mountRecordPage(REPORTED, undefined);

    expect(headerEditButton()).not.toBeDisabled();
    expect(await openHeaderOverflow()).toContain('Delete');
  });

  /**
   * The card's own 定位线索: the BOOLEAN form already reached this surface, and
   * it must keep reaching it through the affordance resolver — not through a
   * second definition grown here. `userActionPredicates(false)` is `undefined`,
   * so the predicate conjunct is a no-op and `resolveRecordHeaderActionGates`
   * is what hides Delete.
   */
  it('still hides Delete for the BOOLEAN `delete: false` (the card 定位线索)', async () => {
    await mountRecordPage(PENDING, { delete: false });

    expect(await openHeaderOverflow()).not.toContain('Delete');
  });

  it('still hides Edit for the BOOLEAN `edit: false`', async () => {
    await mountRecordPage(PENDING, { edit: false });

    expect(headerEditButton()).toBeNull();
  });

  /**
   * The predicate is a FOURTH conjunct — it can never RESURRECT a button the
   * object's bucket closed. `engine-owned` shuts edit + delete regardless of
   * how loudly the predicate holds.
   */
  it('never resurrects a button the affordance gate closed', async () => {
    await mountRecordPage(
      PENDING,
      { edit: { visibleWhen: 'true' }, delete: { visibleWhen: 'true' } },
      { managedBy: 'engine-owned' },
    );

    expect(headerEditButton()).toBeNull();
    expect(await openHeaderOverflow()).not.toContain('Delete');
  });

  /**
   * …and SOFT for `disabledWhen`: an unevaluable predicate must not grey a
   * button forever.
   */
  it('fails SOFT on an unevaluable `disabledWhen`', async () => {
    await mountRecordPage(PENDING, { edit: { disabledWhen: 'record.@@@ bad' } });

    expect(headerEditButton()).not.toBeDisabled();
  });

  /**
   * `disabledWhen: ''` reads as "no condition", not as "disable" — the `!= null`
   * gate lives OUTSIDE the evaluation.
   */
  it('reads an empty `disabledWhen` as no condition', async () => {
    await mountRecordPage(REPORTED, { edit: { disabledWhen: '' } });

    expect(headerEditButton()).not.toBeDisabled();
  });
});

/**
 * `sys_edit` already carried a `disabled` key before #4213 — `approvalLocked`
 * (framework#3794). The predicate composes ONTO that key with OR rather than
 * opening a second one: an approval lock and a declared predicate are
 * independent reasons for "off", and neither may cancel the other.
 *
 * `approval_status: 'pending'` is the record-field fallback source of
 * `approvalLocked` (objectui#2618) — it is the same `approvalLocked` boolean
 * either way. That fallback stands in only on a backend with NO approvals
 * route (objectui#12220): an approvals read that answers, even empty, decides
 * the lock by itself. So this block answers the approvals list route 404, and
 * the last case pins the answered side against the header Edit.
 */
describe('console record header — approvalLocked composition (objectui#4213)', () => {
  const LOCKED = { ...REPORTED, approval_status: 'pending' };

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/approvals/requests?')
          ? new Response(JSON.stringify({ code: 'NOT_FOUND' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          })
          : new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
  });

  it('keeps approvalLocked disabling Edit with NO predicate declared', async () => {
    // The pre-#4213 behavior, byte-identical: `disabled: approvalLocked`.
    await mountRecordPage(LOCKED, undefined);

    expect(headerEditButton()).toBeDisabled();
  });

  it('keeps approvalLocked disabling Edit when the predicate does NOT disable', async () => {
    // `approvalLocked || false` — the lock still wins on its own.
    await mountRecordPage(LOCKED, { edit: { disabledWhen: 'record.status == "closed"' } });

    expect(headerEditButton()).toBeDisabled();
  });

  it('disables Edit when the predicate holds and there is no approval lock', async () => {
    // `false || predicate` — the new half of the same key.
    await mountRecordPage(REPORTED, { edit: { disabledWhen: 'record.status == "reported"' } });

    expect(headerEditButton()).toBeDisabled();
  });

  it('disables Edit when BOTH hold', async () => {
    await mountRecordPage(LOCKED, { edit: { disabledWhen: 'record.status == "reported"' } });

    expect(headerEditButton()).toBeDisabled();
  });

  it('leaves Edit enabled when NEITHER holds', async () => {
    await mountRecordPage(REPORTED, { edit: { disabledWhen: 'record.status == "closed"' } });

    expect(headerEditButton()).not.toBeDisabled();
  });

  /**
   * `visibleWhen` still outranks the disabled channel: a record the object
   * excludes has no Edit entry to grey at all, lock or no lock.
   */
  it('hides rather than greys when `visibleWhen` also excludes the record', async () => {
    await mountRecordPage(LOCKED, {
      edit: { visibleWhen: EDIT_VISIBLE_WHEN, disabledWhen: 'record.status == "reported"' },
    });

    expect(headerEditButton()).toBeNull();
  });

  /**
   * objectui#12220 — the same `pending` record on a composition without the
   * approvals service, whose list route answers `200 { data: [] }`. The column
   * locks only until the read answers; once it has, nothing is running and the
   * header Edit is live. Waiting for the enabled state is the measurement: the
   * pre-read render is disabled by the column, so an Edit that never left that
   * state times out here.
   */
  it('enables Edit on a `pending` record once the approvals read answers 200 empty (objectui#12220)', async () => {
    const approvalsListGets: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/approvals/requests?')) approvalsListGets.push(String(url));
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    await mountRecordPage(LOCKED, undefined);

    await waitFor(() => expect(headerEditButton()).not.toBeDisabled());
    expect(approvalsListGets.length).toBeGreaterThan(0);
  });
});
