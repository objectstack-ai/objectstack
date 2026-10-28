/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27138 — the console's edit dialog reads the approvals record
 * lock of the record it edits, through the read and the rule the record page
 * uses (`useRecordApprovals`, `openApprovalOf`, `resolveApprovalLock`), and
 * hands it to `ModalForm` as `lockedBy: 'approval'`. The record's field
 * projection leaves that lock out, so without it the dialog offered fields
 * a save then refused.
 *
 * Measured from a real `AppContent` mount (the harness of
 * `AppContent.formViewModalSize-12803`), with the approvals routes served by a
 * fetch double:
 *   - a reader outside the slate: the list answers empty and the record lock
 *     answers `locked: true` → `lockedBy: 'approval'`;
 *   - a participant: the pending request's node locks (`lock_record` absent)
 *     → `'approval'`; it declares `lockRecord: false` → no lock;
 *   - CONTROL no approval running → no lock;
 *   - CONTROL a create dialog asks nothing and is not locked.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import React from 'react';
import { render, cleanup, waitFor, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { registerAllFields } from '@object-ui/fields';

registerAllFields();

const probe = vi.hoisted(() => ({
  /** Every set of props the global record-form modal was rendered with. */
  modalProps: [] as any[],
}));

vi.mock('@object-ui/plugin-form', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    ModalForm: (props: any) => {
      probe.modalProps.push(props);
      return <div data-testid="modal-form" />;
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
vi.mock('../../views/RecordFormPage', () => ({
  RecordFormPage: () => <div data-testid="record-form-page" />,
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'user' },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: null,
  }),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

const CONTRACT = {
  name: 'crm_contract',
  label: 'Contract',
  fields: { title: { type: 'text', label: 'Title' } },
  form: { type: 'modal' },
};
const OBJECTS = [CONTRACT];

const dataSourceStub = {
  onConnectionStateChange: () => () => {},
  getConnectionState: () => 'connected',
  getObjectSchema: vi.fn(async (name: string) => OBJECTS.find((o) => o.name === name)),
  findOne: vi.fn(async () => ({ id: 'r1' })),
  find: vi.fn(async () => ({ data: [] })),
  create: vi.fn(),
  update: vi.fn(),
};
vi.mock('../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => dataSourceStub,
}));

const APPS = [{ name: 'crm', label: 'CRM', isDefault: true, navigation: [] }];

// One value for the whole run: effects key on these members.
const METADATA = {
  apps: APPS,
  objects: OBJECTS,
  loading: false,
  ensureType: undefined,
  error: null,
  refresh: async () => {},
};
vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => METADATA,
}));

const ACTION_RUNNER = { execute: () => {}, runner: { registerHandler: () => {}, getContext: () => ({}) } };
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useActionRunner: () => ACTION_RUNNER,
  useGlobalUndo: () => {},
  useMutationInvalidationBridge: () => {},
}));

import { AppContent } from '../AppContent';
import { __resetRecordApprovalsStore } from '../../hooks/useRecordApprovals';

type Approvals = { requests: any[]; lock: boolean };

/** What the approvals routes answer; set per test. */
let served: Approvals = { requests: [], lock: false };

// Installed once for the whole file, so no read the dialog issues after a
// test body returns can reach a socket; handed back in `afterAll`.
const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  const body = url.includes('/approvals/records/')
    ? { success: true, data: { locked: served.lock } }
    : url.includes('/approvals/requests?')
      ? { data: served.requests }
      : url.includes('/approvals/requests/')
        ? { data: served.requests[0] }
        : {};
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
vi.stubGlobal('fetch', fetchSpy);
afterAll(() => vi.unstubAllGlobals());

function serveApprovals(approvals: Approvals) {
  served = approvals;
  return fetchSpy;
}

const approvalReads = (spy: typeof fetchSpy) =>
  spy.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('/approvals/'));

function openAt(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/apps/:appName/*" element={<AppContent />} />
      </Routes>
    </MemoryRouter>,
  );
}

const lastModal = () => probe.modalProps[probe.modalProps.length - 1];

const PENDING = { id: 'req1', object_name: 'crm_contract', record_id: 'r1', status: 'pending' };

beforeEach(() => {
  probe.modalProps.length = 0;
  __resetRecordApprovalsStore();
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('[#27138] the console edit dialog reads the approvals record lock', () => {
  it.each([
    ['a reader outside the slate (the record lock answers)', { requests: [], lock: true }],
    ['a participant whose pending node locks the record', { requests: [PENDING], lock: false }],
  ])('%s: the dialog is handed the approval lock', async (_label, approvals) => {
    const fetchSpy = serveApprovals(approvals);
    openAt('/apps/crm/crm_contract?form=r1');
    await waitFor(() => expect(lastModal()?.schema?.mode).toBe('edit'));
    await waitFor(() => expect(lastModal().lockedBy).toBe('approval'));
    expect(approvalReads(fetchSpy).some((u) => u.includes('object=crm_contract') && u.includes('recordId=r1'))).toBe(true);
  });

  it.each([
    ['a pending node that declares lockRecord: false', { requests: [{ ...PENDING, lock_record: false }], lock: false }],
    ['CONTROL — no approval running', { requests: [], lock: false }],
  ])('%s: the dialog is not locked', async (_label, approvals) => {
    const fetchSpy = serveApprovals(approvals);
    openAt('/apps/crm/crm_contract?form=r1');
    await waitFor(() => expect(lastModal()?.schema?.mode).toBe('edit'));
    await waitFor(() => expect(approvalReads(fetchSpy).length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    expect(lastModal().lockedBy).toBeUndefined();
  });

  it('CONTROL — a create dialog asks nothing and is not locked', async () => {
    const fetchSpy = serveApprovals({ requests: [], lock: true });
    openAt('/apps/crm/crm_contract?form=new');
    await waitFor(() => expect(lastModal()?.schema?.mode).toBe('create'));
    await new Promise((r) => setTimeout(r, 20));
    expect(lastModal().lockedBy).toBeUndefined();
    expect(approvalReads(fetchSpy)).toEqual([]);
  });
});
