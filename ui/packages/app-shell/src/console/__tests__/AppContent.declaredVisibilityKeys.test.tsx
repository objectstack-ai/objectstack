/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6514 — the console's global record-form modal gates on the keys
 * `@objectstack/spec` DECLARES, and no longer on the one it refuses.
 *
 * The SECOND call site of the pair this card rules on; the first is
 * `views/RecordFormPage.declaredVisibilityKeys.test.tsx`, whose header carries
 * the full rationale. Both are pinned because both were wrong in the same way
 * and a shared helper is only trustworthy if each site is shown to use it: a
 * fix applied to one and forgotten at the other reproduces the original defect
 * on whichever surface was missed, and the two surfaces render the SAME
 * object's fields — page mode and modal mode are supposed to agree.
 *
 * Both directions are asserted per key for the reason the card names:
 * `visible` -> `hidden` is an INVERSION, and an inversion read backwards
 * produces no error — only a field that silently disappears, or one that
 * silently LEAKS to a user who must not see it. Hiding cases alone would pass
 * against logic that hides everything.
 *
 *   - `hidden: true` -> absent          | `hidden: false` / absent -> present
 *   - `visibleWhen`, either way -> present: since objectstack#35249 the
 *     predicate is judged by the form, where the record is bound, and the
 *     list reads `hidden` alone. `hidden: true` still wins over a TRUE
 *     predicate (the AND below).
 *   - a field-level `visible` decides NOTHING, either way
 *
 * Measured: every absence case and both dead-key cases are RED before the fix;
 * the complements are green before the fix (nothing hid them then) and are the
 * half that goes red under an inverted implementation.
 *
 * Fenced boundary: no `current_user` binding is added at field level. The roots
 * this evaluator carries were settled by objectui#6493 and are untouched here.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import React from 'react';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { registerAllFields } from '@object-ui/fields';

registerAllFields();

const { modalSchemas, drawn } = vi.hoisted(() => ({
  modalSchemas: [] as any[],
  // `drawn.on` ⇒ the REAL `ModalForm` draws the schema AppContent hands it
  // (objectstack#35249's drawn-level rows); off ⇒ the probe stands in.
  drawn: { on: false },
}));

/** The probe: the global modal's schema is where the filtered field list lands. */
vi.mock('@object-ui/plugin-form', async (importOriginal) => {
  const real = await importOriginal<Record<string, any>>();
  return {
    ...real,
    ModalForm: (props: any) => {
      modalSchemas.push(props.schema);
      return drawn.on ? <real.ModalForm {...props} /> : <div data-testid="modal-form" />;
    },
  };
});

vi.mock('@object-ui/plugin-designer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-designer')>()),
  CreateAppPage: () => <div data-testid="create-app-page" />,
  EditAppPage: () => <div data-testid="edit-app-page" />,
  DashboardDesignPage: () => <div data-testid="dashboard-design-page" />,
}));

vi.mock('../../layout/ConsoleLayout', () => ({
  ConsoleLayout: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="console-layout">{children}</div>
  ),
}));
vi.mock('../../chrome/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../chrome/KeyboardShortcutsDialog', () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock('../../chrome/OnboardingWalkthrough', () => ({ OnboardingWalkthrough: () => null }));
vi.mock('../../views/ObjectView', () => ({ ObjectView: () => <div data-testid="object-view" /> }));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
  useObjectLabel: () => ({ objectLabel: ({ label }: { label?: string }) => label }),
}));

/** A measured protocol-17 session face. `role` is the scalar; positions carry the grants. */
const session = vi.hoisted(() => ({
  user: { id: 'u2', name: 'Bo', email: 'bo@example.com', role: 'user', positions: ['sales_clerk'] } as Record<string, unknown>,
}));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    get user() { return session.user; },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: { id: 'org_1', name: 'Acme' },
  }),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

const dataSourceStub = {
  onConnectionStateChange: () => () => {},
  getConnectionState: () => 'connected',
};
vi.mock('../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => dataSourceStub,
}));

/** The served shape: `ExpressionInputSchema` normalises authored strings into this. */
const cel = (source: string) => ({ dialect: 'cel', source });
const ALWAYS = cel("current_user.role == 'user'");
const NEVER = cel("current_user.role == 'nobody_6514'");

/** The same matrix the page-mode suite carries — the two surfaces must agree. */
const CONTACTS = {
  name: 'contacts',
  label: 'Contacts',
  fields: {
    name: { type: 'text' },
    archived_note: { type: 'text', hidden: true },
    plain_note: { type: 'text', hidden: false },
    never_shown: { type: 'text', visibleWhen: NEVER },
    always_shown: { type: 'text', visibleWhen: ALWAYS },
    commission: { type: 'currency', visibleWhen: cel("'sales_manager' in current_user.positions") },
    hidden_but_predicated: { type: 'text', hidden: true, visibleWhen: ALWAYS },
    record_gated: { type: 'text', visibleWhen: cel('has(record.stage) && record.stage == "closed_lost"') },
    legacy_predicate: { type: 'text', visible: NEVER },
    legacy_literal: { type: 'text', visible: false },
  },
};

/**
 * objectstack#35249 — an object whose conditional fields read the RECORD, with
 * total (`has()`-guarded) predicates: the shape that answered a clean FALSE
 * when the list judged them with no record.
 */
const LOST = cel(
  '(has(record.stage) && record.stage == "closed_lost") || (has(record.requested_status) && record.requested_status == "closed_lost")',
);
const WON = cel(
  '(has(record.stage) && record.stage == "closed_won") || (has(record.requested_status) && record.requested_status == "closed_won")',
);
const DEAL = {
  name: 'deal',
  label: 'Deal',
  fieldGroups: [
    { key: 'basics', label: 'Basics' },
    { key: 'outcome', label: 'Outcome' },
  ],
  fields: {
    title: { type: 'text', label: 'Title', group: 'basics' },
    stage: {
      type: 'select',
      label: 'Stage',
      group: 'basics',
      options: [
        { label: 'Open', value: 'open' },
        { label: 'Closed Lost', value: 'closed_lost' },
        { label: 'Closed Won', value: 'closed_won' },
      ],
    },
    loss_reason: { type: 'text', label: 'Loss Reason', group: 'outcome', visibleWhen: LOST },
    win_reason: { type: 'text', label: 'Win Reason', group: 'outcome', visibleWhen: WON },
    loss_memo: { type: 'text', label: 'Loss Memo', group: 'outcome', hidden: true, visibleWhen: LOST },
    next_step: { type: 'text', label: 'Next Step', group: 'outcome' },
  },
};
const LOST_DEAL = { id: 'd1', title: 'Stark Expansion', stage: 'closed_lost', loss_reason: 'Price', next_step: 'Debrief' };

// The real edit dialog reads the record's approvals (its lock) over `fetch`.
// Installed once for the whole file, so no read issued after a test body
// returns can reach a socket; handed back in `afterAll`.
vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  const body = url.includes('/approvals/records/')
    ? { success: true, data: { locked: false } }
    : url.includes('/approvals/requests')
      ? { data: [] }
      : {};
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}));
afterAll(() => vi.unstubAllGlobals());

const APPS = [{ name: 'crm', label: 'CRM', isDefault: true, navigation: [] }];

vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({
    apps: APPS,
    objects: [CONTACTS, DEAL],
    loading: false,
    ensureType: undefined,
    error: null,
    refresh: vi.fn(async () => {}),
  }),
}));

const actionRunnerStub = { registerHandler: vi.fn(), getContext: () => ({}) };
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useActionRunner: () => ({ execute: vi.fn(), runner: actionRunnerStub }),
  useGlobalUndo: () => {},
  useMutationInvalidationBridge: () => {},
}));

// AppContent reaches the console's dynamic `@objectstack/lint` imports; their
// first load is paid here, at collection, never inside a case's clock
// (`check:test-source-alias`).
import '@objectstack/lint';
import { AppContent } from '../AppContent';

/** `?form=new` is the URL contract that opens the global record-form overlay. */
function renderCreateModal() {
  return render(
    <MemoryRouter initialEntries={['/apps/crm/contacts?form=new']}>
      <Routes>
        <Route path="/apps/:appName/*" element={<AppContent />} />
      </Routes>
    </MemoryRouter>,
  );
}

const lastFields = (): string[] => modalSchemas[modalSchemas.length - 1].fields;

beforeEach(() => {
  vi.clearAllMocks();
  modalSchemas.length = 0;
  drawn.on = false;
  for (const k of ['getObjectSchema', 'findOne', 'create', 'update']) delete (dataSourceStub as any)[k];
  session.user = { id: 'u2', name: 'Bo', email: 'bo@example.com', role: 'user', positions: ['sales_clerk'] };
});
afterEach(cleanup);

describe('objectui#6514 — the console record-form modal honours the static `hidden` key, both directions', () => {
  it('WITHHOLDS a field declared `hidden: true`', async () => {
    renderCreateModal();
    await waitFor(() => expect(modalSchemas.length).toBeGreaterThan(0));

    // RED before the fix: the modal read `visible`, absent here, so the field
    // an author had explicitly hidden was rendered.
    expect(lastFields()).not.toContain('archived_note');
    // Control — an implementation that empties the list must not pass.
    expect(lastFields()).toContain('name');
  });

  it('SHOWS a field declared `hidden: false`, and one with no `hidden` at all', async () => {
    renderCreateModal();
    await waitFor(() => expect(modalSchemas.length).toBeGreaterThan(0));

    // The complement — the half that goes RED against an inverted read.
    expect(lastFields()).toContain('plain_note');
    expect(lastFields()).toContain('name');
  });
});

describe('objectstack#35249 — the console record-form modal lists a `visibleWhen` field for the FORM to judge', () => {
  it('lists a field whose `visibleWhen` reads the record, whatever the predicate answers without one', async () => {
    renderCreateModal();
    await waitFor(() => expect(modalSchemas.length).toBeGreaterThan(0));

    expect(lastFields()).toContain('record_gated');
    expect(lastFields()).toContain('name');
  });

  it('lists a field whose `visibleWhen` is FALSE or TRUE for the signed-in user alike', async () => {
    renderCreateModal();
    await waitFor(() => expect(modalSchemas.length).toBeGreaterThan(0));

    expect(lastFields()).toEqual(expect.arrayContaining(['never_shown', 'always_shown', 'commission']));
  });
});

describe('objectui#6514 — the two declared keys compose as AND, in the modal too', () => {
  it('keeps a `hidden: true` field withheld even when its `visibleWhen` is TRUE', async () => {
    renderCreateModal();
    await waitFor(() => expect(modalSchemas.length).toBeGreaterThan(0));

    expect(lastFields()).not.toContain('hidden_but_predicated');
    expect(lastFields()).toContain('always_shown');
  });
});

describe('objectui#6514 — the spec-refused `visible` read is DELETED at the modal site too', () => {
  it('ignores a field-level `visible` predicate that would have hidden the field', async () => {
    renderCreateModal();
    await waitFor(() => expect(modalSchemas.length).toBeGreaterThan(0));

    // RED before the fix: the field was ABSENT then, decided by a key the
    // schema refuses.
    expect(lastFields()).toContain('legacy_predicate');
  });

  it('ignores a field-level `visible: false` literal', async () => {
    renderCreateModal();
    await waitFor(() => expect(modalSchemas.length).toBeGreaterThan(0));

    expect(lastFields()).toContain('legacy_literal');
  });
});

describe('objectstack#35249 — the console record-form dialog draws the field a record predicate admits', () => {
  /** The real dialog over a data source that serves `deal` and the record. */
  function serveDeal() {
    drawn.on = true;
    Object.assign(dataSourceStub, {
      getObjectSchema: vi.fn(async () => structuredClone(DEAL)),
      findOne: vi.fn(async () => structuredClone(LOST_DEAL)),
      create: vi.fn(async (_o: string, d: Record<string, unknown>) => ({ id: 'd2', ...d })),
      update: vi.fn(async () => ({ id: 'd1' })),
    });
  }
  const renderDealDialog = (form: string) =>
    render(
      <MemoryRouter initialEntries={[`/apps/crm/deal?form=${form}`]}>
        <Routes>
          <Route path="/apps/:appName/*" element={<AppContent />} />
        </Routes>
      </MemoryRouter>,
    );
  const drawnField = (name: string) => document.body.querySelector(`[name="${name}"]`) != null;

  it('edit, dialog laid out from `fieldGroups`: the predicate that holds draws its field', async () => {
    serveDeal();
    renderDealDialog('d1');
    await waitFor(() => expect(drawnField('title')).toBe(true));
    await waitFor(() => expect(document.body.textContent).toContain('Outcome'));

    expect(drawnField('loss_reason'), 'visibleWhen holds for the record: drawn').toBe(true);
    expect(drawnField('win_reason'), 'CONTROL: visibleWhen is false for the record: hidden').toBe(false);
    expect(drawnField('loss_memo'), 'CONTROL: `hidden: true` wins over a predicate that holds').toBe(false);
    expect(drawnField('next_step'), 'CONTROL: no predicate: drawn').toBe(true);
  });

  it('create: the record-reading predicate is judged against the empty record and the dialog stays usable', async () => {
    serveDeal();
    renderDealDialog('new');
    await waitFor(() => expect(drawnField('title')).toBe(true));

    expect(drawnField('loss_reason'), 'no stage yet: the predicate is false').toBe(false);
    expect(drawnField('next_step')).toBe(true);
    // The renderer refuses a submit while a field's `visibleWhen` faults
    // (ADR-0137 D2). The predicate is total, so it answers FALSE without
    // faulting and the create goes through.
    fireEvent.change(document.body.querySelector('input[name="title"]') as HTMLInputElement, { target: { value: 'New deal' } });
    fireEvent.submit(document.body.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect((dataSourceStub as any).create).toHaveBeenCalledTimes(1));
    expect((dataSourceStub as any).create.mock.calls[0][1]).toMatchObject({ title: 'New deal' });
  });
});
