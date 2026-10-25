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
 *   - a FALSE `visibleWhen` -> absent   | a TRUE `visibleWhen` -> present
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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { modalSchemas } = vi.hoisted(() => ({ modalSchemas: [] as any[] }));

/** The probe: the global modal's schema is where the filtered field list lands. */
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ModalForm: ({ schema }: any) => {
    modalSchemas.push(schema);
    return <div data-testid="modal-form" />;
  },
}));

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
    legacy_predicate: { type: 'text', visible: NEVER },
    legacy_literal: { type: 'text', visible: false },
  },
};

const APPS = [{ name: 'crm', label: 'CRM', isDefault: true, navigation: [] }];

vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({
    apps: APPS,
    objects: [CONTACTS],
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

describe('objectui#6514 — the console record-form modal honours `visibleWhen`, both directions', () => {
  it('WITHHOLDS a field whose `visibleWhen` is FALSE', async () => {
    renderCreateModal();
    await waitFor(() => expect(modalSchemas.length).toBeGreaterThan(0));

    expect(lastFields()).not.toContain('never_shown');
    expect(lastFields()).toContain('name');
  });

  it('SHOWS a field whose `visibleWhen` is TRUE', async () => {
    renderCreateModal();
    await waitFor(() => expect(modalSchemas.length).toBeGreaterThan(0));

    expect(lastFields()).toContain('always_shown');
  });

  it('decides the same predicate per user — excluded, then admitted', async () => {
    renderCreateModal();
    await waitFor(() => expect(modalSchemas.length).toBeGreaterThan(0));
    expect(lastFields()).not.toContain('commission');

    cleanup();
    modalSchemas.length = 0;
    session.user = { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'user', positions: ['sales_manager'] };
    renderCreateModal();
    await waitFor(() => expect(modalSchemas.length).toBeGreaterThan(0));
    expect(lastFields()).toContain('commission');
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
