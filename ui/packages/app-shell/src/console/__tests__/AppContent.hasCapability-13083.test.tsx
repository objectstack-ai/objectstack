/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13083 — an object field whose `visibleWhen` names
 * `current_user.hasCapability(NAME)` is answered in the console's global
 * record-form modal.
 *
 * The modal-mode twin of `views/RecordFormPage.hasCapability-13083.test.tsx`,
 * whose header carries the rationale: `AppContent` builds the modal's
 * field-list evaluator by hand (it sits ABOVE the `ExpressionProvider` it
 * mounts), and it passed `permissions` but not `systemPermissions`, so every
 * `hasCapability` field gate faulted and failed OPEN here while page nodes
 * answered (objectui#13006).
 *
 * The real `AppContent` is mounted under a real `MePermissionsProvider`; the
 * probe is the `ModalForm` schema, where the filtered field list lands — the
 * same probe `AppContent.declaredVisibilityKeys.test.tsx` reads.
 *
 * Reverse verification (direction predicted before running): drop the
 * `systemPermissions` hand-off in `AppContent`, and the NON-HOLDER arm goes red
 * (shown by the fail-open fault), and the HOLDER arm goes red through its
 * silence assertion. The NOT-LOADED control stays green either way.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
// The reporter's dedupe `Set` is module state: reset it so every arm's
// "nothing reported" is a reading, not a leftover from an earlier arm.
import { __resetVisibilityPredicateWarnings } from '../../../../react/src/utils/visibilityDiagnostic';

const { modalSchemas } = vi.hoisted(() => ({ modalSchemas: [] as Array<{ fields: string[] }> }));

/** The probe: the global modal's schema is where the filtered field list lands. */
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ModalForm: ({ schema }: { schema: { fields: string[] } }) => {
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

const USER = { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'user', positions: ['everyone'] };
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: USER,
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

const cel = (source: string) => ({ dialect: 'cel', source });
const PREDICATE = "current_user.hasCapability('manage_org_users')";

const ORG = {
  name: 'org_member',
  label: 'Members',
  fields: {
    name: { type: 'text' },
    roster_note: { type: 'text', visibleWhen: cel(PREDICATE) },
  },
};

const APPS = [{ name: 'crm', label: 'CRM', isDefault: true, navigation: [] }];

vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({
    apps: APPS,
    objects: [ORG],
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

function payload(systemPermissions: string[]): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: 'org_1',
    roles: [],
    permissionSets: ['member'],
    systemPermissions,
    objects: { org_member: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false } },
    fields: {},
  };
}

/** `?form=new` is the URL contract that opens the global record-form overlay. */
function createModal() {
  return (
    <MemoryRouter initialEntries={['/apps/crm/org_member?form=new']}>
      <Routes>
        <Route path="/apps/:appName/*" element={<AppContent />} />
      </Routes>
    </MemoryRouter>
  );
}

const withPermissions = (caps: string[]) => (
  <MePermissionsProvider initialPermissions={payload(caps)}>{createModal()}</MePermissionsProvider>
);

const lastFields = (): string[] => modalSchemas[modalSchemas.length - 1].fields;

let warnings: string[];
beforeEach(() => {
  warnings = [];
  __resetVisibilityPredicateWarnings();
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void warnings.push(a.join(' ')));
  modalSchemas.length = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('console record-form modal: a field gated on current_user.hasCapability (objectui#13083)', () => {
  it('HOLDER: shown, with nothing reported', async () => {
    render(withPermissions(['setup.access', 'manage_org_users']));
    await waitFor(() => expect(modalSchemas.length).toBeGreaterThan(0));
    expect(lastFields()).toContain('name');
    expect(lastFields()).toContain('roster_note');
    expect(warnings.filter((w) => w.includes('hasCapability'))).toEqual([]);
  });

  it('NON-HOLDER: hidden, with nothing reported — a verdict, not a fault', async () => {
    render(withPermissions(['setup.access']));
    await waitFor(() => expect(modalSchemas.length).toBeGreaterThan(0));
    expect(lastFields()).toContain('name');
    expect(lastFields()).not.toContain('roster_note');
    expect(warnings.filter((w) => w.includes('hasCapability'))).toEqual([]);
  });

  it('CONTROL — NOT LOADED: the predicate still FAULTS loudly, never a silent answer', async () => {
    render(createModal());
    await waitFor(() => expect(modalSchemas.length).toBeGreaterThan(0));
    // Fail-open field gate on a fault (the shipped field policy): shown, and
    // the fault is reported naming the predicate.
    expect(lastFields()).toContain('roster_note');
    expect(warnings.some((w) => w.includes(PREDICATE))).toBe(true);
  });
});
