/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#26172 — the record create and update success
 * toasts name the saved record (`ux-conventions.write-feedback`), e.g.
 * `Task "Quarterly review" created`, by its ADR-0079 display name. A record
 * with nothing nameable keeps the object-label toast (`Task created
 * successfully`).
 *
 * Measured from a real `AppContent` mount inside a real i18next instance (the
 * `AppContent.createLandingOriginPlural-11733` harness): the global record-form
 * modal is a stand-in whose `onSuccess` is called with the saved record. Two
 * paths raise the toast. The main path hands it to the action runner as a
 * `crud_success` message, read here off the runner's `execute`; the child-form
 * task (a subtable child opened over its parent's record page) toasts it
 * directly, read here off sonner's `toast.success`.
 *
 * Direction, written before the run: with the toast put back to the object
 * label alone, every "names the record" cell RED (`Task created
 * successfully`); every "no name" cell GREEN on both sides.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import React from 'react';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { toast } from 'sonner';
import { createI18n, I18nProvider } from '@object-ui/i18n';

/** The part of the modal's schema this file reads. */
interface ModalSchemaProbe {
  objectName?: string;
  onSuccess: (saved: Record<string, unknown>) => Promise<void> | void;
}
const { modalSchemas, execute } = vi.hoisted(() => ({
  modalSchemas: [] as ModalSchemaProbe[],
  execute: vi.fn(),
}));

/** The global record-form modal: its schema carries the `onSuccess` under test. */
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ModalForm: ({ schema }: { schema: ModalSchemaProbe }) => {
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
vi.mock('../../views/RecordDetailView', () => ({ RecordDetailView: () => <div data-testid="record-page" /> }));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'user' },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: null,
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

const OBJECTS = [
  // Declares its name field: a saved task is named by `subject`.
  {
    name: 'showcase_task',
    label: 'Task',
    nameField: 'subject',
    fields: { subject: { type: 'text', label: 'Subject' }, done: { type: 'boolean', label: 'Done' } },
  },
  // The parent the child-form task opens over.
  { name: 'showcase_project', label: 'Project', fields: { name: { type: 'text', label: 'Name' } } },
];

const APPS = [{ name: 'crm', label: 'CRM', isDefault: true, navigation: [] }];

// One value for the whole run: the route's effects key on these members.
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

const ACTION_RUNNER = { execute, runner: { registerHandler: () => {}, getContext: () => ({}) } };
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

type Lang = 'en' | 'zh-CN';

/** The catalog as the console loads it: `zh-CN` translates the task's label. */
const BUNDLE: Record<Lang, Record<string, unknown>> = {
  en: {},
  'zh-CN': { showcase: { objects: { showcase_task: { label: '任务' } } } },
};

const MAIN_CREATE = '/apps/crm/showcase_task?form=new';
const MAIN_EDIT = '/apps/crm/showcase_task?form=t1';
const CHILD_CREATE = '/apps/crm/showcase_project/record/p1?form=new&formObject=showcase_task';
const CHILD_EDIT = '/apps/crm/showcase_project/record/p1?form=t1&formObject=showcase_task';

let toastSuccess: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  modalSchemas.length = 0;
  execute.mockClear();
  toastSuccess = vi.spyOn(toast, 'success');
});
afterEach(() => {
  toastSuccess.mockRestore();
  cleanup();
});

/** Mount at `url`, save `saved` through the record-form modal, and wait for its toast. */
async function saveFrom(url: string, saved: Record<string, unknown>, lang: Lang = 'en'): Promise<void> {
  const i18n = createI18n({ defaultLanguage: lang, detectBrowserLanguage: false });
  expect(i18n.language).toBe(lang);
  i18n.addResourceBundle(lang, 'translation', BUNDLE[lang], true, true);
  render(
    <I18nProvider instance={i18n}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/apps/:appName/*" element={<AppContent />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
  await waitFor(() => expect(modalSchemas.length).toBeGreaterThan(0));
  const schema = modalSchemas[modalSchemas.length - 1];
  expect(schema.objectName).toBe('showcase_task');
  // Not inside `act`, as in the harness this file copies: the save settles at once.
  await schema.onSuccess(saved);
}

/** The message the main path handed the runner as its `crud_success`. */
function crudSuccessMessage(): string | undefined {
  const call = execute.mock.calls.find(([action]) => action?.type === 'crud_success');
  return call?.[0]?.params?.message;
}

/** The message the child-form task toasted directly. */
function childToastMessage(): string | undefined {
  return toastSuccess.mock.calls[0]?.[0] as string | undefined;
}

describe('AppContent — the record save toast names the saved record (objectstack-ai/objectstack#26172)', () => {
  describe('main path (crud_success)', () => {
    it('create: names the record by its declared name field', async () => {
      await saveFrom(MAIN_CREATE, { id: 't1', subject: 'Quarterly review' });
      expect(crudSuccessMessage()).toBe('Task "Quarterly review" created');
    });

    it('update: names the record by its declared name field', async () => {
      await saveFrom(MAIN_EDIT, { id: 't1', subject: 'Quarterly review' });
      expect(crudSuccessMessage()).toBe('Task "Quarterly review" updated');
    });

    it('create, no name: the object-label toast', async () => {
      await saveFrom(MAIN_CREATE, { id: 't2', done: false });
      expect(crudSuccessMessage()).toBe('Task created successfully');
    });

    it('update, no name: the object-label toast', async () => {
      await saveFrom(MAIN_EDIT, { id: 't1', done: true });
      expect(crudSuccessMessage()).toBe('Task updated successfully');
    });

    it('zh-CN: the pack string, with the translated object label', async () => {
      await saveFrom(MAIN_CREATE, { id: 't1', subject: '季度复盘' }, 'zh-CN');
      expect(crudSuccessMessage()).toBe('任务“季度复盘”已创建');
    });
  });

  describe('child-form task (direct toast)', () => {
    it('create: names the record', async () => {
      await saveFrom(CHILD_CREATE, { id: 't1', subject: 'Quarterly review' });
      expect(childToastMessage()).toBe('Task "Quarterly review" created');
      // The child task keeps the parent page as it is: no crud_success.
      expect(crudSuccessMessage()).toBeUndefined();
    });

    it('update: names the record', async () => {
      await saveFrom(CHILD_EDIT, { id: 't1', subject: 'Quarterly review' });
      expect(childToastMessage()).toBe('Task "Quarterly review" updated');
    });

    it('create, no name: the object-label toast', async () => {
      await saveFrom(CHILD_CREATE, { id: 't2', done: false });
      expect(childToastMessage()).toBe('Task created successfully');
    });

    it('update, no name: the object-label toast', async () => {
      await saveFrom(CHILD_EDIT, { id: 't1', done: true });
      expect(childToastMessage()).toBe('Task updated successfully');
    });
  });
});
