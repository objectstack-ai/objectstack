/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#27999 — an overlay record save whose answer
 * carries advisory warnings (a `severity: 'warning'` validation rule) shows ONE
 * toast: the record-named save message (objectstack-ai/objectstack#26172),
 * carrying the warning lines. The write-warning channel's "Saved — with
 * warnings" toast is not raised for that write; its stripped-fields notice
 * still is, and a write the overlay did not make keeps the channel toast.
 *
 * Measured from a real `AppContent` mount (the
 * `AppContent.recordSaveToastNamesRecord-26172` harness): the global record-form
 * modal is a stand-in, and the save does what the real chain does, in its
 * order: the adapter emits the write-warning event INSIDE the write (here the
 * channel's `emitWriteWarning`, handed the adapter as `AdapterProvider` hands
 * it, and not awaited), then the form hands the write's result to `onSuccess`.
 * The runner runs the handler `AppContent` registered, so the main path's
 * toast is the real `crud_success` one; the child-form task toasts directly.
 * The channel's sink is the same sonner `toast`, so every toast is counted.
 *
 * Direction, written before the run: with the channel ignoring the overlay's
 * claim, every "one toast" cell RED (a second "Saved — with warnings" toast,
 * and a success toast carrying no warning line); the CONTROL cells GREEN on
 * both sides.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import React from 'react';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { toast } from 'sonner';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import type { WriteWarningEvent } from '@object-ui/data-objectstack';
import { emitWriteWarning } from '../../providers/writeWarningToast';

/** The part of the modal's schema this file reads. */
interface ModalSchemaProbe {
  objectName?: string;
  onSuccess: (saved: Record<string, unknown>) => Promise<void> | void;
}
const { modalSchemas, handlers, execute } = vi.hoisted(() => {
  const handlers = new Map<string, (action: unknown) => Promise<unknown>>();
  return {
    modalSchemas: [] as ModalSchemaProbe[],
    handlers,
    execute: vi.fn(async (action: { type?: string }) => handlers.get(action?.type ?? '')?.(action)),
  };
});

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

// The adapter the overlay claims on, and the one the channel is handed as
// `AdapterProvider` hands it: the same object.
const dataSourceStub = {
  onConnectionStateChange: () => () => {},
  getConnectionState: () => 'connected',
  getObjectSchema: async () => ({ fields: {} as Record<string, { label?: string }> }),
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

// The runner runs what `AppContent` registered, so the `crud_success` toast is
// the real handler's.
const ACTION_RUNNER = {
  execute,
  runner: {
    registerHandler: (type: string, fn: (action: unknown) => Promise<unknown>) => { handlers.set(type, fn); },
    getContext: () => ({}),
  },
};
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

/** The channel's translator: the English default, interpolated. */
const t = (_key: string, opts?: Record<string, unknown>) =>
  String(opts?.defaultValue ?? '').replace('{{fields}}', String(opts?.fields ?? ''));
const identityLabel = (_o: string, _f: string, fallback: string) => fallback;

const MAIN_CREATE = '/apps/crm/showcase_task?form=new';
const MAIN_EDIT = '/apps/crm/showcase_task?form=t1';
const CHILD_EDIT = '/apps/crm/showcase_project/record/p1?form=t1&formObject=showcase_task';

const ADVISORY = {
  field: 'subject',
  code: 'validation_rule',
  message: 'Reviews are usually scheduled a week ahead',
  rule: 'review_lead_time',
  severity: 'warning' as const,
};
const SECOND = { ...ADVISORY, field: 'done', rule: 'done_owner', message: 'Done tasks usually name an owner' };
const NAMED = { id: 't1', subject: 'Quarterly review' };

let toastSuccess: ReturnType<typeof vi.spyOn>;
let toastWarning: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  modalSchemas.length = 0;
  execute.mockClear();
  toastSuccess = vi.spyOn(toast, 'success');
  toastWarning = vi.spyOn(toast, 'warning');
});
afterEach(() => {
  toastSuccess.mockRestore();
  toastWarning.mockRestore();
  cleanup();
});

/** Mount at `url`, save `saved` with `event` emitted by the write, and settle every toast. */
async function saveFrom(url: string, event: WriteWarningEvent, saved: Record<string, unknown>): Promise<void> {
  const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
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
  // The overlay's claim is opened by an effect of the mounted, open dialog.
  await waitFor(() => expect(handlers.has('crud_success')).toBe(true));
  const schema = modalSchemas[modalSchemas.length - 1];
  expect(schema.objectName).toBe('showcase_task');
  const channel = emitWriteWarning(event, t, dataSourceStub as never, identityLabel, toast);
  await schema.onSuccess(saved);
  await channel;
  await waitFor(() => expect(toastSuccess.mock.calls.length + toastWarning.mock.calls.length).toBeGreaterThan(0));
}

const update = (over: Partial<WriteWarningEvent> = {}): WriteWarningEvent => ({
  operation: 'update',
  resource: 'showcase_task',
  id: 't1',
  droppedFields: [],
  warnings: [ADVISORY],
  ...over,
});

describe('AppContent — an overlay save with warnings shows one record-named toast (objectstack-ai/objectstack#27999)', () => {
  it('update (crud_success): one toast, the record-named message carrying the warning line', async () => {
    await saveFrom(MAIN_EDIT, update(), NAMED);

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastWarning.mock.calls).toEqual([
      ['Task "Quarterly review" updated', { description: ADVISORY.message }],
    ]);
  });

  it('create (crud_success): one toast, each distinct warning on its own line', async () => {
    await saveFrom(
      MAIN_CREATE,
      { operation: 'create', resource: 'showcase_task', id: 't1', droppedFields: [], warnings: [ADVISORY, SECOND] },
      NAMED,
    );

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastWarning.mock.calls).toEqual([
      ['Task "Quarterly review" created', { description: `${ADVISORY.message}\n${SECOND.message}` }],
    ]);
  });

  it('child-form task: the direct toast is the one toast', async () => {
    await saveFrom(CHILD_EDIT, update(), NAMED);

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastWarning.mock.calls).toEqual([
      ['Task "Quarterly review" updated', { description: ADVISORY.message }],
    ]);
  });

  it('the stripped-fields notice keeps its own toast beside the save toast', async () => {
    await saveFrom(
      MAIN_EDIT,
      update({ droppedFields: [{ object: 'showcase_task', fields: ['done'], reason: 'readonly' }] }),
      NAMED,
    );

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastWarning.mock.calls.map(([title]) => title).sort()).toEqual([
      'Saved — but some fields did not take effect',
      'Task "Quarterly review" updated',
    ]);
    expect(toastWarning.mock.calls.find(([title]) => title === 'Task "Quarterly review" updated')?.[1]).toEqual({
      description: ADVISORY.message,
    });
  });

  it('CONTROL: a write the overlay did not make keeps the channel toast, and the save toast stays a success', async () => {
    await saveFrom(MAIN_EDIT, update({ id: 't9' }), NAMED);

    expect(toastSuccess.mock.calls).toEqual([['Task "Quarterly review" updated']]);
    expect(toastWarning.mock.calls).toEqual([['Saved — with warnings', { description: ADVISORY.message }]]);
  });
});
