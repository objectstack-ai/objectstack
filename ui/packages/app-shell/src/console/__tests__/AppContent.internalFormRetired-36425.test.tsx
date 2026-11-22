/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#36425 — the console's New / Edit dialog no longer
 * loads the object's internal form view. It lays the record out by the
 * object's field groups and follows its fields' rules: the form view's
 * sections, tabs, `modalSize`, `buttons`, `layout` and `defaults` reach the
 * `ModalForm` no more, a create leaves out a `showOnCreate: false` field, and
 * an edit lists it.
 *
 * The `ModalForm` is a probe recording each schema it is handed; one cell
 * renders the real one to show the field groups' headings on the dialog.
 * CONTROL: an object with no form view gets the same dialog.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import React from 'react';
import { render, cleanup, waitFor, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { registerAllFields } from '@object-ui/fields';

registerAllFields();

const probe = vi.hoisted(() => ({
  /** Every schema the global record-form modal was rendered with. */
  modalSchemas: [] as any[],
  /** Render the real `ModalForm` under the probe. */
  realModal: false,
  /** The real `ModalForm`, for cells that render a schema of their own. */
  RealModalForm: null as null | React.ComponentType<any>,
}));

vi.mock('@object-ui/plugin-form', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  const RealModalForm = actual.ModalForm;
  probe.RealModalForm = RealModalForm;
  return {
    ...actual,
    ModalForm: (props: any) => {
      probe.modalSchemas.push(props.schema);
      return probe.realModal ? <RealModalForm {...props} /> : <div data-testid="modal-form" />;
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

const FIELDS = {
  subject: { type: 'text', label: 'Subject', group: 'basics' },
  status: { type: 'text', label: 'Status', group: 'tracking' },
  account: { type: 'text', label: 'Account', group: 'basics' },
  internal_note: { type: 'text', label: 'Internal note', group: 'tracking', showOnCreate: false },
};
const FIELD_GROUPS = [
  { key: 'basics', label: 'Basics' },
  { key: 'tracking', label: 'Tracking' },
];

const AUTHORED = {
  name: 'crm_case',
  label: 'Case',
  fields: FIELDS,
  fieldGroups: FIELD_GROUPS,
  form: {
    type: 'tabbed',
    layout: 'horizontal',
    modalSize: 'sm',
    defaultTab: 'more',
    tabPosition: 'left',
    buttons: { submit: { label: 'File case' }, cancel: { show: false } },
    defaults: { status: 'new', account: 'acct-default' },
    sections: [
      { name: 'main', label: 'Form main section', fields: ['subject'] },
      { name: 'more', label: 'Form more section', fields: ['status', 'account'] },
    ],
    subforms: [{ childObject: 'crm_case_line', relationshipField: 'case' }],
  },
};
const PLAIN = { name: 'crm_note', label: 'Note', fields: FIELDS, fieldGroups: FIELD_GROUPS };
const OBJECTS = [AUTHORED, PLAIN];

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

// objectstack#27138 — an edit dialog reads the approvals state of the record it
// edits (`useRecordApprovals`). No approval runs in this file: the approvals
// routes answer empty from one double, installed for the whole file so no read
// can reach a socket after a test body returns, and handed back in `afterAll`.
vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
})));
afterAll(() => vi.unstubAllGlobals());

import { AppContent } from '../AppContent';

const lastModal = () => probe.modalSchemas[probe.modalSchemas.length - 1];

/** Open the record dialog at `url` and return the schema it was handed. */
async function openAt(url: string, objectName: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/apps/:appName/*" element={<AppContent />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(lastModal()?.open).toBe(true));
  expect(lastModal().objectName).toBe(objectName);
  return lastModal();
}

beforeEach(() => {
  probe.modalSchemas.length = 0;
  probe.realModal = false;
  vi.clearAllMocks();
});
afterEach(cleanup);

const FORM_STEERS = ['sections', 'contentLayout', 'defaultTab', 'tabPosition', 'modalSize', 'subforms'];

describe('#36425 — the New / Edit dialog reads no internal form view', () => {
  it('a create: no form sections, tabs, size or subforms, and the dialog\'s own chrome', async () => {
    const schema = await openAt('/apps/crm/crm_case?form=new', 'crm_case');
    for (const key of FORM_STEERS) expect(schema, key).not.toHaveProperty(key);
    expect(schema).toMatchObject({ showSubmit: true, submitText: 'Create', showCancel: true, layout: 'vertical' });
    expect(schema.initialValues).toBeUndefined();
  });

  it('a create leaves out a showOnCreate: false field', async () => {
    const schema = await openAt('/apps/crm/crm_case?form=new', 'crm_case');
    expect(schema.fields).toEqual(['subject', 'status', 'account']);
  });

  it('an edit lists the showOnCreate: false field, and keeps the dialog\'s own chrome', async () => {
    const schema = await openAt('/apps/crm/crm_case?form=r1', 'crm_case');
    expect(schema.mode).toBe('edit');
    expect(schema.fields).toEqual(['subject', 'status', 'account', 'internal_note']);
    for (const key of FORM_STEERS) expect(schema, key).not.toHaveProperty(key);
    expect(schema).toMatchObject({ submitText: 'Update', showCancel: true, layout: 'vertical' });
  });

  it('a parent pre-link still seeds the create, with no form view defaults under it', async () => {
    const schema = await openAt('/apps/crm/crm_note?form=new&formObject=crm_case&formLink=account:acct-parent', 'crm_case');
    expect(schema.initialValues).toStrictEqual({ account: 'acct-parent' });
  });

  it('the real dialog lays out by the field groups, never by the form view\'s sections', async () => {
    probe.realModal = true;
    await openAt('/apps/crm/crm_case?form=new', 'crm_case');
    const dialog = await screen.findByRole('dialog', undefined, { timeout: 5000 });
    await waitFor(() => expect(dialog.textContent).toContain('Basics'), { timeout: 5000 });
    expect(dialog.textContent).toContain('Tracking');
    expect(dialog.textContent).not.toContain('Form main section');
    expect(dialog.textContent).not.toContain('Internal note');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('CONTROL: an object with no form view gets the same dialog', async () => {
    const authored = await openAt('/apps/crm/crm_case?form=new', 'crm_case');
    cleanup();
    probe.modalSchemas.length = 0;
    const plain = await openAt('/apps/crm/crm_note?form=new', 'crm_note');
    const { objectName: _a, title: _ta, onSuccess: _sa, onCancel: _ca, onOpenChange: _oa, ...a } = authored;
    const { objectName: _b, title: _tb, onSuccess: _sb, onCancel: _cb, onOpenChange: _ob, ...b } = plain;
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect(a.fields).toEqual(b.fields);
  });
});
