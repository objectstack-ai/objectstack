/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#26843 — the console's New / Edit dialog hands the
 * selected form view's `buttons`, `layout`, `defaults`, `defaultTab` and
 * `tabPosition` to the `ModalForm`, instead of setting `showSubmit: true`, its
 * own labels and `layout: 'vertical'` over them.
 *
 * The `ModalForm` is a probe recording each schema it is handed; one cell
 * renders the real one to show the authored label on the dialog's button.
 * CONTROL: an object whose form view authors none of the keys keeps the
 * dialog's own labels, both buttons and the vertical layout.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  subject: { type: 'text', label: 'Subject' },
  status: { type: 'text', label: 'Status' },
  account: { type: 'text', label: 'Account' },
};

const AUTHORED = {
  name: 'crm_case',
  label: 'Case',
  fields: FIELDS,
  form: {
    type: 'tabbed',
    layout: 'horizontal',
    defaultTab: 'more',
    tabPosition: 'left',
    buttons: { submit: { label: 'File case' }, cancel: { show: false } },
    defaults: { status: 'new', account: 'acct-default' },
    sections: [
      { name: 'main', label: 'Main', fields: ['subject'] },
      { name: 'more', label: 'More', fields: ['status', 'account'] },
    ],
  },
};
const PLAIN = { name: 'crm_note', label: 'Note', fields: FIELDS, form: { type: 'simple' } };
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

describe('#26843 — the New dialog renders the form view\'s buttons, layout and defaults', () => {
  it('the authored submit label and hidden cancel reach the ModalForm', async () => {
    const schema = await openAt('/apps/crm/crm_case?form=new', 'crm_case');
    expect(schema).toMatchObject({ showSubmit: true, submitText: 'File case', showCancel: false });
  });

  it('the authored horizontal layout reaches the ModalForm', async () => {
    expect((await openAt('/apps/crm/crm_case?form=new', 'crm_case')).layout).toBe('horizontal');
  });

  it('defaults seed the create', async () => {
    expect((await openAt('/apps/crm/crm_case?form=new', 'crm_case')).initialValues)
      .toStrictEqual({ status: 'new', account: 'acct-default' });
  });

  it('a parent pre-link wins per field over the defaults, and the seed keeps its identity across renders', async () => {
    const schema = await openAt('/apps/crm/crm_note?form=new&formObject=crm_case&formLink=account:acct-parent', 'crm_case');
    expect(schema.initialValues).toStrictEqual({ status: 'new', account: 'acct-parent' });
    const seeds = new Set(probe.modalSchemas.filter((s) => s.open && s.objectName === 'crm_case').map((s) => s.initialValues));
    expect(seeds.size).toBe(1);
  });

  it('the tabbed form view\'s defaultTab and tabPosition reach the ModalForm', async () => {
    expect(await openAt('/apps/crm/crm_case?form=new', 'crm_case'))
      .toMatchObject({ contentLayout: 'tabbed', defaultTab: 'more', tabPosition: 'left' });
  });

  it('an edit keeps the buttons and layout and reads no defaults', async () => {
    const schema = await openAt('/apps/crm/crm_case?form=r1', 'crm_case');
    expect(schema).toMatchObject({ mode: 'edit', submitText: 'File case', showCancel: false, layout: 'horizontal' });
    expect(schema.initialValues).toBeUndefined();
  });

  it('the real dialog draws the authored label and no Cancel', async () => {
    probe.realModal = true;
    await openAt('/apps/crm/crm_case?form=new', 'crm_case');
    const dialog = await screen.findByRole('dialog', undefined, { timeout: 5000 });
    await waitFor(() => expect(dialog.querySelector('[data-testid="modal-form-footer"]')).not.toBeNull(), { timeout: 5000 });
    expect(screen.getByRole('button', { name: 'File case' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('CONTROL: a form view authoring none of them keeps the dialog\'s own chrome', async () => {
    const schema = await openAt('/apps/crm/crm_note?form=new', 'crm_note');
    expect(schema).toMatchObject({ showSubmit: true, submitText: 'Create', showCancel: true, layout: 'vertical' });
    expect(schema.initialValues).toBeUndefined();
    expect(schema.contentLayout).toBeUndefined();
  });
});
