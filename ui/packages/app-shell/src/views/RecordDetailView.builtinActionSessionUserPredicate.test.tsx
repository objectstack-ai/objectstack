/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#8499 — the console record header's BUILT-IN Edit honors an
 * `edit.visibleWhen` written against the SESSION USER and a RELATION field.
 *
 * The card's verbatim declaration, both actions same-shape:
 *
 *   userActions: {
 *     edit:   { visibleWhen: 'os.user.id != record.executor' },
 *     delete: { visibleWhen: 'os.user.id != record.executor' },
 *   }
 *
 * ## Why this file exists when two neighbours already look like it
 *
 * The wiring itself landed before this card was dispatched — PR #4524
 * (objectui#4213) threaded `editVisible` / `deleteVisible` into
 * `synthSystemActions`, and PR #4515 did the same for `plugin-detail`. What
 * neither of the two existing pins covers is the card's own predicate SHAPE,
 * and they miss it from opposite sides:
 *
 *   • `RecordDetailView.userActionPredicates.test.tsx` (#4213) drives the
 *     BUILT-IN path, but only with self-contained `record.status` string
 *     compares. It mounts no `ExpressionProvider`, so `os.user` is bound
 *     NOWHERE in it — a predicate reading the session user has never been
 *     evaluated on this path.
 *   • `RecordDetailView.headerActionLookupPredicate.test.tsx` (#4641 /
 *     objectstack#8500) drives `os.user.id` against a relation field, but only
 *     through DECLARED `record_header` actions — a different consumption seam
 *     (`visible` on an authored action), deliberately not the built-in one.
 *
 * The card sits exactly on the intersection, which is why it could be reported
 * against a build that already carried the fix: `os.user` + relation + the
 * built-in Edit is the one combination no test asserted.
 *
 * ## "The button is gone" is NOT, by itself, evidence
 *
 * `visibleWhen` fails CLOSED. So an unbound `os.user`, a faulting compare, or
 * a relation that bound to the wrong side all HIDE the button — landing on the
 * same DOM as a correct evaluation, for the opposite reason. A pin that only
 * asserted absence would stay green if the predicate stopped being evaluated
 * at all.
 *
 * Every case here is therefore a discriminating PAIR on one declaration:
 *
 *   the executor themself  ⇒ Edit ABSENT   (`os.user.id != record.executor` is false)
 *   any other session user ⇒ Edit PRESENT  (…and true)
 *
 * Only a genuinely-evaluated predicate can produce both. The "present" half is
 * what a fail-closed fault cannot fake, so it carries the proof — plus an
 * explicit assertion that no fault warning was emitted under the built-in
 * label.
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

// Orthogonal chrome — same posture as the two neighbouring predicate files.
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
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'qms_defect';
const RECORD_ID = 'DEF-1';

/** The card's predicate, verbatim from the issue body. */
const NOT_THE_EXECUTOR = 'os.user.id != record.executor';

/** The executor of the record under test, and a colleague who is not. */
const EXECUTOR = 'u-exec';
const COLLEAGUE = 'u-other';

const FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
  status: { type: 'text', label: 'Status' },
  executor: { type: 'lookup', label: 'Executor', reference: 'sys_user' },
};

/** The record as the detail fetch delivers it when it did NOT expand `executor`. */
const BARE = { id: RECORD_ID, name: 'Scratched housing', status: 'reported', executor: EXECUTOR };
/** …and as it delivers it when it DID — the same record, one display decision apart. */
const EXPANDED = {
  id: RECORD_ID,
  name: 'Scratched housing',
  status: 'reported',
  executor: { id: EXECUTOR, name: 'Executor' },
};

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
 * Mount the real console record page inside the shell's `ExpressionProvider` —
 * the wiring `AppContent` uses, and what binds `os.user` for the header's
 * predicate scope — then WAIT for the record read, so a "button is gone"
 * assertion can never pass merely because the predicate's input (the record)
 * had not arrived yet.
 */
async function mountRecordPage(
  record: Record<string, unknown>,
  userActions: unknown,
  sessionUserId: string,
) {
  const objects = [
    {
      name: OBJECT_NAME,
      label: 'Defect',
      // The permissive bucket — edit + delete both default open, so the only
      // thing moving in this file is the predicate conjunct.
      managedBy: 'platform',
      fields: FIELDS,
      userActions,
    },
  ];
  const dataSource = makeDataSource(record);
  const view = render(
    <MemoryRouter initialEntries={[`/apps/qms/${OBJECT_NAME}/${RECORD_ID}`]}>
      <MetadataCtx.Provider value={makeMetadata(objects)}>
        <ExpressionProvider
          user={{ id: sessionUserId, name: 'Session user' }}
          app={{ name: 'qms' }}
          data={{}}
          features={{}}
        >
          <RecordDetailView
            dataSource={dataSource}
            objects={objects}
            onEdit={() => {}}
            objectNameOverride={OBJECT_NAME}
            recordIdOverride={RECORD_ID}
          />
        </ExpressionProvider>
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(dataSource.findOne).toHaveBeenCalled());
  await waitFor(() => expect(headerToolbar()).toBeTruthy());
  return view;
}

/** The card's own declaration — one predicate, applied to both CRUD entries. */
const CARD_DECLARATION = {
  edit: { visibleWhen: NOT_THE_EXECUTOR },
  delete: { visibleWhen: NOT_THE_EXECUTOR },
};

/** The `page:header` action toolbar — the host of every synth system action. */
function headerToolbar(): HTMLElement | null {
  return document.querySelector('[role="toolbar"]');
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
// The card's repro, as a discriminating pair — on BOTH relation payload shapes.
// ---------------------------------------------------------------------------
describe('console record header — built-in Edit under a session-user predicate (objectstack#8499)', () => {
  it('hides the built-in Edit from the executor themself (BARE foreign key)', async () => {
    await mountRecordPage(BARE, CARD_DECLARATION, EXECUTOR);

    // Asserted BEFORE any overflow opens (Radix aria-hidden trap).
    expect(headerEditButton()).toBeNull();
    // The companion: the toolbar itself still rendered, so "no Edit" cannot be
    // "no header".
    expect(await openHeaderOverflow()).toContain('Share');
  });

  it('keeps it for a colleague on the same record — the half a fault cannot fake', async () => {
    await mountRecordPage(BARE, CARD_DECLARATION, COLLEAGUE);

    expect(headerEditButton()).toBeInTheDocument();
    expect(headerEditButton()).not.toBeDisabled();
  });

  it('hides it from the executor when the payload EXPANDED the relation', async () => {
    await mountRecordPage(EXPANDED, CARD_DECLARATION, EXECUTOR);

    expect(headerEditButton()).toBeNull();
  });

  it('keeps it for a colleague on that same expanded payload', async () => {
    await mountRecordPage(EXPANDED, CARD_DECLARATION, COLLEAGUE);

    expect(headerEditButton()).toBeInTheDocument();
  });

  /**
   * `$expand` is a display decision made by the detail fetch, not a statement
   * about the record — so it must not change the verdict. This is what the
   * `fields: predicateFields` argument buys: the relation binds as the stored
   * foreign key on both payload shapes.
   */
  it('reaches the SAME verdict whichever shape the relation arrived in', async () => {
    await mountRecordPage(BARE, CARD_DECLARATION, EXECUTOR);
    const onBare = headerEditButton();
    cleanup();
    await mountRecordPage(EXPANDED, CARD_DECLARATION, EXECUTOR);
    const onExpanded = headerEditButton();

    expect(onBare).toBeNull();
    expect(onExpanded).toBeNull();
  });

  /**
   * A relation compare against the session user is an ORDINARY predicate, not
   * a fault that happens to fail closed the right way. If this warns, the two
   * "absent" cases above are passing for the wrong reason.
   */
  it('evaluates without faulting — no warning under the built-in edit label', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mountRecordPage(BARE, CARD_DECLARATION, EXECUTOR);

    expect(headerEditButton()).toBeNull();
    expect(
      warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('builtin:edit:visibleWhen')),
    ).toHaveLength(0);
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// The card's A/B: one declaration, two actions, ONE verdict. The reported
// symptom was `delete` converging while `edit` did not.
// ---------------------------------------------------------------------------
describe('console record header — `edit` and `delete` converge on one declaration (objectstack#8499)', () => {
  it('hides BOTH from the executor in a single mount', async () => {
    await mountRecordPage(BARE, CARD_DECLARATION, EXECUTOR);

    expect(headerEditButton()).toBeNull();
    const items = await openHeaderOverflow();
    expect(items).not.toContain('Delete');
    // Non-CRUD chrome is untouched — the predicate subtracts, it does not
    // empty the header.
    expect(items).toContain('Share');
  });

  it('keeps BOTH for a colleague in a single mount', async () => {
    await mountRecordPage(BARE, CARD_DECLARATION, COLLEAGUE);

    expect(headerEditButton()).toBeInTheDocument();
    expect(await openHeaderOverflow()).toContain('Delete');
  });
});
