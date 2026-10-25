/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12291 — the console half of the calendar's quick-create hand-off.
 *
 * On an object whose required fields quick-create cannot fill (the stock
 * `showcase_task`, required `project`), an empty-day click no longer offers
 * the dialog that cannot succeed: `ObjectCalendar` calls the host's `onEdit`
 * with a NEW record — no id — carrying the clicked day (pinned in
 * `plugin-calendar`'s `ObjectCalendar.quickCreateHandoff-12291.test.tsx`).
 * `ListView` hands that `onEdit` down, and in the console it is this
 * component's `handleEdit`, the handler the list's "New" already opens the
 * record form through (`onEdit(null)`).
 *
 * What is pinned here is what the console does with such a record:
 *
 *   - the record-form OVERLAY opens in create mode with the values as its
 *     `initialValues`, and a row created from it carries the clicked date —
 *     driven through the real `ModalForm` down to the adapter's `create`;
 *   - a page-mode object (`editMode: 'page'`) opens its create page with the
 *     values as the query-string prefill `RecordFormPage` reads;
 *   - and the two old callers are unchanged: `onEdit(null)` opens a blank
 *     create form, and a record WITH an id opens the edit form, its other
 *     keys ignored.
 *
 * The values ride the history entry that opens the overlay, not a URL param
 * (`RECORD_FORM_CREATE_VALUES_STATE`, whose doc comment says why).
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, waitFor, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { registerAllFields } from '@object-ui/fields';

registerAllFields();

const probe = vi.hoisted(() => ({
  /** Every schema the global record-form modal was rendered with. */
  modalSchemas: [] as any[],
  /** Render the real `ModalForm` under the probe (the create-payload case). */
  realModal: false,
  /** What the stand-in list hands `onEdit` — the calendar's hand-off by default. */
  record: { due_date: '2026-10-20' } as Record<string, unknown> | null,
  /** The router's location, read after each navigation. */
  location: null as null | { pathname: string; search: string; state: unknown },
}));

vi.mock('@object-ui/plugin-form', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  const RealModalForm = actual.ModalForm;
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

/**
 * The object list stands in for the calendar: what reaches `AppContent` is the
 * `onEdit` call the calendar makes through `ListView`, so the list's only job
 * here is to make that call.
 */
vi.mock('../../views/ObjectView', () => ({
  ObjectView: ({ onEdit }: { onEdit: (record: unknown) => void }) => (
    <button type="button" data-testid="hand-off" onClick={() => onEdit(probe.record)}>
      hand off
    </button>
  ),
}));

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

/** The stock `showcase_task`, cut to the fields this card is about. */
const TASK_FIELDS = {
  title: { type: 'text', label: 'Title', required: true },
  due_date: { type: 'date', label: 'Due Date' },
};

const OBJECTS = [
  { name: 'showcase_task', label: 'Task', pluralLabel: 'Tasks', fields: TASK_FIELDS },
  { name: 'page_task', label: 'Page Task', editMode: 'page', fields: TASK_FIELDS },
];

const dataSourceStub = {
  onConnectionStateChange: () => () => {},
  getConnectionState: () => 'connected',
  getObjectSchema: vi.fn(async (name: string) => OBJECTS.find((o) => o.name === name)),
  create: vi.fn(async (_object: string, data: Record<string, unknown>) => ({ id: 't-1', ...data })),
  findOne: vi.fn(async () => null),
};
vi.mock('../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => dataSourceStub,
}));

const APPS = [{ name: 'showcase_app', label: 'Showcase', isDefault: true, navigation: [] }];

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

function LocationProbe() {
  const location = useLocation();
  probe.location = { pathname: location.pathname, search: location.search, state: location.state };
  return null;
}

/** Open an object's calendar view and make the hand-off from it. */
async function handOffFrom(objectName: string) {
  render(
    <MemoryRouter initialEntries={[`/apps/showcase_app/${objectName}/view/calendar`]}>
      <LocationProbe />
      <Routes>
        <Route path="/apps/:appName/*" element={<AppContent />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByTestId('hand-off'));
}

const lastModal = () => probe.modalSchemas[probe.modalSchemas.length - 1];

beforeEach(() => {
  probe.modalSchemas.length = 0;
  probe.realModal = false;
  probe.record = { due_date: '2026-10-20' };
  probe.location = null;
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('objectui#12291 — a new record carrying values opens the console\'s create form with them', () => {
  it('the overlay opens in create mode with the clicked day as its initial value', async () => {
    await handOffFrom('showcase_task');

    await waitFor(() => expect(lastModal()?.open).toBe(true));
    expect(new URLSearchParams(probe.location!.search).get('form')).toBe('new');
    expect(lastModal().mode).toBe('create');
    expect(lastModal().objectName).toBe('showcase_task');
    expect(lastModal().initialValues).toEqual({ due_date: '2026-10-20' });
  });

  it('a row created from that form carries the clicked date (the real ModalForm, down to the adapter)', async () => {
    probe.realModal = true;
    await handOffFrom('showcase_task');

    const title = await screen.findByRole('textbox', { name: /^Title/ }, { timeout: 5000 });
    fireEvent.change(title, { target: { value: 'Plan the sprint' } });
    // Not inside an awaited `act`: under React 19 that did not return before
    // the test timeout (as `AppContent.createLandingOriginPlural-11733` found);
    // the `waitFor` below polls inside `act` on its own.
    fireEvent.submit(screen.getByRole('dialog').querySelector('form') as HTMLFormElement);

    await waitFor(() => expect(dataSourceStub.create).toHaveBeenCalledTimes(1));
    expect(dataSourceStub.create.mock.calls[0][0]).toBe('showcase_task');
    expect(dataSourceStub.create.mock.calls[0][1]).toMatchObject({
      title: 'Plan the sprint',
      due_date: '2026-10-20',
    });
  });

  it('a page-mode object opens its create page with the values as the query-string prefill', async () => {
    await handOffFrom('page_task');

    await waitFor(() => expect(probe.location?.pathname).toBe('/apps/showcase_app/page_task/new'));
    expect(new URLSearchParams(probe.location!.search).get('due_date')).toBe('2026-10-20');
    expect(await screen.findByTestId('record-form-page')).toBeInTheDocument();
  });
});

describe('objectui#12291 — the two callers before it are unchanged', () => {
  it('onEdit(null) — the list\'s "New" — opens a blank create form', async () => {
    probe.record = null;
    await handOffFrom('showcase_task');

    await waitFor(() => expect(lastModal()?.open).toBe(true));
    expect(lastModal().mode).toBe('create');
    expect(lastModal().initialValues).toBeUndefined();
  });

  it('a record WITH an id opens the edit form, and its other keys seed nothing', async () => {
    probe.record = { id: 't-9', due_date: '2026-10-20' };
    await handOffFrom('showcase_task');

    await waitFor(() => expect(lastModal()?.open).toBe(true));
    expect(new URLSearchParams(probe.location!.search).get('form')).toBe('t-9');
    expect(lastModal().mode).toBe('edit');
    expect(lastModal().recordId).toBe('t-9');
    expect(lastModal().initialValues).toBeUndefined();
  });
});
