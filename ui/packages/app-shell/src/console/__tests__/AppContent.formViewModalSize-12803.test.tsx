/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12803 — an authored `FormView.modalSize` reaches the console's
 * create / edit modal.
 *
 * Measured from a real `AppContent` mount (the harness of
 * `AppContent.recordDialogInterimBound-12521`): the global record-form modal
 * records the schema it is handed and, where a cell reads the dialog itself,
 * renders the real `ModalForm`. On desktop the authored size wins over the
 * derived default; with nothing authored the schema is unchanged. This host
 * calls `deriveRecordFlowSurface` with no viewport, so the phone is
 * `ModalForm`'s full-screen sheet below `sm`; jsdom evaluates no media query,
 * so "below `sm`" is read as the classes that carry no responsive prefix.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, waitFor, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { registerAllFields } from '@object-ui/fields';
import { deriveRecordSurface } from '@object-ui/plugin-view';

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

/** Fourteen plain fields: a field-heavy object, which the derivation pages. */
const HEAVY_FIELDS = Object.fromEntries(
  Array.from({ length: 14 }, (_, i) => [`f${i}`, { type: 'text', label: `F${i}` }]),
);

/** A heavy object whose default form view authors `modalSize: 'lg'`. */
const SIZED = {
  name: 'crm_lead',
  label: 'Lead',
  fields: HEAVY_FIELDS,
  form: { type: 'modal', modalSize: 'lg' },
};
/** The same object with a default form view that authors no size. */
const PLAIN = {
  name: 'crm_contact',
  label: 'Contact',
  fields: HEAVY_FIELDS,
  form: { type: 'modal' },
};
const OBJECTS = [SIZED, PLAIN];

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

const lastModal = () => probe.modalSchemas[probe.modalSchemas.length - 1];

/** The rendered dialog, once its fields are drawn. */
async function dialogOnScreen(): Promise<HTMLElement> {
  await waitFor(() => {
    if (!document.body.querySelector('[role="dialog"] [name="f0"]')) throw new Error('form not drawn yet');
  }, { timeout: 5000 });
  return screen.getByRole('dialog');
}

const tokens = (el: HTMLElement) => el.className.split(/\s+/).filter(Boolean);
/** The classes that apply below `sm`: those with no responsive or state prefix. */
const belowSm = (el: HTMLElement) => tokens(el).filter((t) => !t.includes(':')).sort();

beforeEach(() => {
  probe.modalSchemas.length = 0;
  probe.realModal = false;
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('objectui#12803 — an authored FormView.modalSize sizes the console create / edit modal', () => {
  it('the objects are field-heavy: the derivation would size them itself', () => {
    expect(deriveRecordSurface(SIZED)).toBe('page');
    expect(deriveRecordSurface(PLAIN)).toBe('page');
  });

  it.each([
    ['create', '/apps/crm/crm_lead?form=new'],
    ['edit', '/apps/crm/crm_lead?form=r1'],
    ['child-create', '/apps/crm/crm_contact?form=new&formObject=crm_lead'],
  ] as const)('%s on desktop: the authored lg reaches the ModalForm schema', async (_flow, url) => {
    const schema = await openAt(url, 'crm_lead');
    expect(schema.modalSize).toBe('lg');
  });

  it('create on desktop: the real dialog opens at the lg bound, not the derived xl', async () => {
    probe.realModal = true;
    await openAt('/apps/crm/crm_lead?form=new', 'crm_lead');
    const dialog = await dialogOnScreen();
    expect(dialog.className).toContain('sm:max-w-2xl');
    expect(dialog.className).not.toContain('sm:max-w-5xl');
  });

  it.each([
    ['create', '/apps/crm/crm_contact?form=new'],
    ['edit', '/apps/crm/crm_contact?form=r1'],
  ] as const)('CONTROL %s: nothing authored hands the dialog no modalSize key', async (_flow, url) => {
    const schema = await openAt(url, 'crm_contact');
    expect('modalSize' in schema).toBe(false);
  });

  it('CONTROL: nothing authored, the real dialog keeps its own xl bound', async () => {
    probe.realModal = true;
    await openAt('/apps/crm/crm_contact?form=new', 'crm_contact');
    const dialog = await dialogOnScreen();
    expect(dialog.className).toContain('sm:max-w-5xl');
  });

  it('the phone sheet is unchanged: below sm the authored-lg dialog carries the classes the unsized one does', async () => {
    probe.realModal = true;
    await openAt('/apps/crm/crm_lead?form=new', 'crm_lead');
    const sized = belowSm(await dialogOnScreen());
    cleanup();
    probe.modalSchemas.length = 0;

    await openAt('/apps/crm/crm_contact?form=new', 'crm_contact');
    const unsized = belowSm(await dialogOnScreen());

    expect(sized).toEqual(unsized);
    expect(sized).toEqual(expect.arrayContaining(['fixed', 'inset-0', 'w-full', 'h-[100dvh]']));
    expect(sized.some((t) => t.startsWith('max-w-'))).toBe(false);
  });
});
