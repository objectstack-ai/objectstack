/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12521 / objectui#12592 — the console's record dialog on a
 * field-heavy object opens bounded on desktop, as the installed
 * `@objectstack/spec` derives it.
 *
 * `deriveRecordFlowSurface` (installed `@objectstack/spec`, re-exported by
 * `@object-ui/plugin-view`, the import `AppContent` uses) answers a create /
 * edit / child task flow on an object with `RECORD_SURFACE_PAGE_THRESHOLD` or
 * more authorable fields with a bounded modal on desktop, `size: 'auto'`, and
 * keeps `size: 'full'` for a phone (objectstack-ai/objectstack#23734, letter B
 * of objectui#12521). `AppContent` calls it with no `viewport` and spreads only
 * a `full` answer into `modalSize`, so `ModalForm`'s own bounded default sizes
 * the dialog. objectui#12521 bounded the dialog with an interim of its own
 * until that spec was installed; objectui#12592 deleted it on the bump to
 * `18.0.0-next.2`, and this file pins the derivation's answer in its place.
 *
 * Measured from a real `AppContent` mount (the `AppContent.createSeed-12291`
 * harness): the global record-form modal records the schema it is handed and,
 * where a cell reads the dialog itself, renders the real `ModalForm`. A
 * dialog's width is its `sm:max-w-*` class; jsdom evaluates no media query, so
 * "below `sm`" is read as the classes that carry no responsive prefix.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, waitFor, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { registerAllFields } from '@object-ui/fields';
import {
  deriveRecordFlowSurface,
  deriveRecordSurface,
  type RecordFlow,
} from '@object-ui/plugin-view';

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

/** Fourteen plain fields, the size of HotCRM's lead: a field-heavy object. */
const HEAVY_FIELDS = Object.fromEntries(
  Array.from({ length: 14 }, (_, i) => [`f${i}`, { type: 'text', label: `F${i}` }]),
);

const HEAVY = { name: 'crm_lead', label: 'Lead', fields: HEAVY_FIELDS };
const PARENT = { name: 'crm_account', label: 'Account', fields: { name: { type: 'text', label: 'Name' } } };
const OBJECTS = [HEAVY, PARENT];

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

/** The URL that opens each task flow on the heavy object. */
const FLOW_URL: Record<Exclude<RecordFlow, 'view'>, string> = {
  create: '/apps/crm/crm_lead?form=new',
  edit: '/apps/crm/crm_lead?form=r1',
  'child-create': '/apps/crm/crm_account?form=new&formObject=crm_lead',
  'child-edit': '/apps/crm/crm_account?form=r1&formObject=crm_lead',
};

/** Open a task flow on the console and return the schema the record dialog was handed. */
async function openFlow(flow: Exclude<RecordFlow, 'view'>) {
  render(
    <MemoryRouter initialEntries={[FLOW_URL[flow]]}>
      <Routes>
        <Route path="/apps/:appName/*" element={<AppContent />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(lastModal()?.open).toBe(true));
  expect(lastModal().objectName).toBe('crm_lead');
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

/** Render the real `ModalForm` with a schema of the cell's own, and return its dialog. */
async function renderDialog(schema: Record<string, unknown>): Promise<HTMLElement> {
  const RealModalForm = probe.RealModalForm!;
  render(<RealModalForm schema={schema} dataSource={dataSourceStub} />);
  return dialogOnScreen();
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

describe('objectui#12521 — a desktop task flow on a field-heavy object opens bounded', () => {
  it('the object is field-heavy: the installed derivation pages it', () => {
    expect(deriveRecordSurface(HEAVY)).toBe('page');
  });

  it('create: the real dialog is within the xl bound, not 95vw', async () => {
    probe.realModal = true;
    const schema = await openFlow('create');
    expect(schema.modalSize).toBeUndefined();

    const dialog = await dialogOnScreen();
    expect(dialog.className).toContain('sm:max-w-5xl');
    expect(dialog.className).not.toContain('sm:max-w-[95vw]');
  });

  it.each(['edit', 'child-create', 'child-edit'] as const)(
    '%s: the dialog is handed no derived full size',
    async (flow) => {
      const schema = await openFlow(flow);
      expect(schema.mode).toBe(flow.endsWith('edit') ? 'edit' : 'create');
      expect(schema.modalSize).toBeUndefined();
    },
  );

  it('the phone sheet is unchanged: below sm the dialog carries the same classes as the 95vw dialog did', async () => {
    probe.realModal = true;
    const schema = await openFlow('create');
    const bounded = belowSm(await dialogOnScreen());
    cleanup();

    // What the console handed before letter B: the derivation's `full`.
    const full = belowSm(await renderDialog({ ...schema, modalSize: 'full' }));

    expect(bounded).toEqual(full);
    // Both are the full-screen sheet.
    expect(bounded).toEqual(expect.arrayContaining(['fixed', 'inset-0', 'w-full', 'h-[100dvh]']));
    // No width cap reaches a phone.
    expect(bounded.some((t) => t.startsWith('max-w-'))).toBe(false);
  });

  it('CONTROL: a modalSize handed to the dialog is used as written — full still opens at 95vw', async () => {
    const schema = await openFlow('create');
    cleanup();
    const dialog = await renderDialog({ ...schema, modalSize: 'full' });
    expect(dialog.className).toContain('sm:max-w-[95vw]');
  });
});

describe('objectui#12592 — the installed derivation bounds the field-heavy task flow itself', () => {
  it.each(['create', 'edit', 'child-create', 'child-edit'] as const)(
    '%s on desktop: a bounded modal overlay, size auto',
    (flow) => {
      // The import `AppContent` uses, called the way it calls it: no viewport.
      expect(deriveRecordFlowSurface(HEAVY, flow)).toEqual({ container: 'overlay', surface: 'modal', size: 'auto' });
    },
  );

  it('CONTROL: on a phone the same flow derives the full-screen modal', () => {
    expect(deriveRecordFlowSurface(HEAVY, 'create', { viewport: 'mobile' }).size).toBe('full');
  });
});
