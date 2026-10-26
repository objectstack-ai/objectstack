/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The console record page's DECLARED header actions — a `visible` CEL gated on
 * a **relation field** (objectstack#8500).
 *
 * ## What this file pins, and why here
 *
 * "Only the record's manager sees this button" is the most common thing an
 * author asks a `record_header` action's `visible` to express, and it is
 * written against a lookup field:
 *
 * ```yaml
 * visible: os.user.id == record.manager
 * ```
 *
 * That predicate has to reach ONE verdict regardless of how the surface
 * happened to deliver the record. The record page's detail fetch expands the
 * relations it can, so `manager` arrives at the renderer either as the bare
 * foreign key the server stores (`'u1'`) or as the whole expanded row
 * (`{ id: 'u1', … }`) — a display decision no predicate author participates in.
 * Evaluated as delivered, the same predicate is true in one payload shape and a
 * clean, silent false in the other, on the author's OWN record.
 *
 * `toPredicateRecord` (objectui#3501) is what collapses an expanded relation
 * back to its id, and `page:header` applies it through `evalRowPredicate`'s
 * `fields` option. But that normalization is only as live as the field
 * definitions the surface hands it: `page:header` reads them off
 * `RecordContext.objectSchema`, which the CONSOLE record page supplies
 * (`RecordDetailView` passes `objectSchema={objectDef}`). Nothing between the
 * two is pinned anywhere — a host that stopped threading the object def, or a
 * synthesizer that stopped routing header actions through `page:header`, would
 * silently restore the two-verdicts-one-predicate behaviour with every
 * component-level test still green. That seam is what this file covers: the
 * component-level guarantee already has
 * `packages/components/src/__tests__/page-header-lookup-predicate.test.tsx`;
 * this is the same guarantee asserted END TO END on the console page the
 * reports come from.
 *
 * ## The other half: a faulting predicate is fail-CLOSED and LOUD
 *
 * `record.manager.id` is the spelling authors reach for second, and it is not
 * supported by construction — the relation binds as its id, so `.id` on it
 * faults. The standing 2026-08-06 ruling on objectui#4051 / objectstack#5149 is
 * that a predicate fault may be resolved fail-open OR fail-closed, but never
 * SILENTLY. This surface resolves it fail-closed (never a button whose
 * precondition could not be checked) and says so once per predicate, naming the
 * action. Both properties are asserted on substance below — the button is gone
 * AND the warning names the action — because either one alone is the failure
 * mode: a silent hide is the objectui#4051 defect, and a warning in front of a
 * still-rendered button is the fail-open one.
 *
 * The warning is warn-ONCE per `(label, source)` pair for the process
 * (`warnEvalError` in `@object-ui/core`), so every fault case below uses a
 * distinct action name — sharing one would make the second assertion pass or
 * fail on test ORDER rather than on behaviour.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
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

// Orthogonal chrome — same posture as RecordDetailView.userActionPredicates.test.
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

/** The canonical spelling — the one that also works server-side and in a list. */
const CANONICAL = 'os.user.id == record.manager';

const FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
  manager: { type: 'lookup', label: 'Manager', reference: 'sys_user' },
};

/** The record as the detail fetch delivers it when it did NOT expand `manager`. */
const BARE = { id: RECORD_ID, name: 'Scratched housing', manager: 'u1' };
/** …and as it delivers it when it DID — the same record, one display decision apart. */
const EXPANDED = { id: RECORD_ID, name: 'Scratched housing', manager: { id: 'u1', name: 'Ada' } };

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

/** A declared `record_header` action, gated on `visible`. */
const headerAction = (name: string, visible: unknown) => ({
  name,
  label: name,
  type: 'api',
  target: '/api/v1/noop',
  locations: ['record_header'],
  visible,
});

/**
 * Mount the real console record page inside the shell's `ExpressionProvider` —
 * the wiring `AppContent` uses, and what binds `os.user` for the header's
 * predicate scope — then WAIT for the record read, so a "button is gone"
 * assertion can never pass merely because the predicate's input had not
 * arrived yet.
 */
async function mountRecordPage(
  record: Record<string, unknown>,
  actions: any[],
  sessionUserId: string,
) {
  const objects = [
    { name: OBJECT_NAME, label: 'Defect', managedBy: 'platform', fields: FIELDS, actions },
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

/** The `page:header` action toolbar — the host of every header CTA. */
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

beforeEach(() => {
  cleanup();
  // Unrelated chrome (approvals, favourites, the record-explain probe) reaches
  // for the platform API; in jsdom that is a real socket. Answer locally so the
  // only asynchrony here is the record read.
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

describe('console record header — a relation field in a declared action `visible` (objectstack#8500)', () => {
  // -------------------------------------------------------------------------
  // One predicate, one verdict — whichever shape the payload delivered.
  // -------------------------------------------------------------------------

  it('shows the action to the manager when the payload carries the BARE foreign key', async () => {
    await mountRecordPage(BARE, [headerAction('OnlyManager', CANONICAL)], 'u1');

    expect(headerCtaLabels()).toContain('OnlyManager');
  });

  it('hides it from a non-manager on the same bare payload', async () => {
    await mountRecordPage(BARE, [headerAction('OnlyManager', CANONICAL)], 'u2');

    const labels = headerCtaLabels();
    expect(labels).not.toContain('OnlyManager');
    // The companion assertion: the header itself still rendered, so "no button"
    // cannot be "no toolbar".
    expect(labels).toContain('Edit');
  });

  /**
   * The card's own repro. The detail fetch EXPANDED `manager`, so without the
   * relation normalization this is `'u1' == { id: 'u1', … }` — a clean, silent
   * false on the manager's own record, with no working spelling left.
   */
  it('shows the action to the manager when the payload carries the EXPANDED relation', async () => {
    await mountRecordPage(EXPANDED, [headerAction('OnlyManager', CANONICAL)], 'u1');

    expect(headerCtaLabels()).toContain('OnlyManager');
  });

  it('hides it from a non-manager on the same expanded payload', async () => {
    await mountRecordPage(EXPANDED, [headerAction('OnlyManager', CANONICAL)], 'u2');

    const labels = headerCtaLabels();
    expect(labels).not.toContain('OnlyManager');
    expect(labels).toContain('Edit');
  });

  /**
   * The `{ dialect, source }` envelope is what `@objectstack/spec`'s
   * `ExpressionInputSchema` normalizes every authored string into, so it — not
   * the bare string — is the shape a served action actually carries.
   */
  it('reaches the same verdict through the canonical `{ dialect, source }` envelope', async () => {
    await mountRecordPage(
      EXPANDED,
      [headerAction('OnlyManager', { dialect: 'cel', source: CANONICAL })],
      'u1',
    );

    expect(headerCtaLabels()).toContain('OnlyManager');
  });

  /**
   * An empty lookup is a genuine `false`, not a fault: the canonical spelling
   * must stay quiet and simply not match. (`record.manager.id` is what faults
   * on this record — see the block below.)
   */
  it('treats an EMPTY lookup as a clean false, with no fault warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mountRecordPage(
      { id: RECORD_ID, name: 'Scratched housing', manager: null },
      [headerAction('OnlyManager', CANONICAL)],
      'u1',
    );

    expect(headerCtaLabels()).not.toContain('OnlyManager');
    expect(
      warn.mock.calls.filter((c) => String(c[0]).includes('OnlyManager')),
    ).toHaveLength(0);
    warn.mockRestore();
  });

  // -------------------------------------------------------------------------
  // A fault is fail-CLOSED and named — never silent (the 2026-08-06 ruling).
  // Distinct action names per case: the warning is warn-once per (label,
  // source), so a shared name would decide these by test order.
  // -------------------------------------------------------------------------

  it('fails CLOSED and names the action when `record.<relation>.id` faults', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mountRecordPage(
      EXPANDED,
      [headerAction('DotIdExpanded', 'os.user.id == record.manager.id')],
      'u1',
    );

    // Fail-CLOSED: the button is gone even though the session user IS the
    // manager — a precondition that could not be checked is not a pass.
    expect(headerCtaLabels()).not.toContain('DotIdExpanded');
    expect(headerCtaLabels()).toContain('Edit');
    // …and NOT silently: one warning, naming the action and quoting the
    // predicate, so the author can find it without reading the renderer.
    const faults = warn.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes('DotIdExpanded'));
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain('record.manager.id');
    warn.mockRestore();
  });

  it('does the same on a bare-key payload — the fault is the spelling, not the shape', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mountRecordPage(
      BARE,
      [headerAction('DotIdBare', 'os.user.id  == record.manager.id')],
      'u1',
    );

    expect(headerCtaLabels()).not.toContain('DotIdBare');
    expect(
      warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('DotIdBare')),
    ).toHaveLength(1);
    warn.mockRestore();
  });
});
