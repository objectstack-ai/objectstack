/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#32685 — the record form a URL opens over a record drawer
 * (`?recordId=…&form=new&formObject=…&formLink=…`) is the top layer after a
 * reload, as it is when it is opened from the drawer.
 *
 * Measured in the console: on a reload the form mounted at once and the drawer
 * opened a moment later (the list opens it from an effect), so the drawer's
 * sheet was the later body portal — it painted over the form's right half and
 * its Create button, and `Esc` closed the drawer instead of the form.
 *
 * The real `AppContent` and the real `ModalForm`, under the real
 * `RecordStackDrawer` the list mounts, opened the way the list opens it: from
 * an effect, after the list has mounted. A layer is later when its portal is
 * later in the document and when it answers `Esc` first.
 * CONTROL: the form a URL opens with no drawer opens at once.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import React, { useEffect } from 'react';
import { render, cleanup, waitFor, screen, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate, type NavigateFunction } from 'react-router-dom';
import { registerAllFields } from '@object-ui/fields';

registerAllFields();

const probe = vi.hoisted(() => ({
  /** Each `onOpenChange` the form's dialog called, and each close of the drawer. */
  events: [] as string[],
}));

vi.mock('@object-ui/plugin-form', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  const RealModalForm = actual.ModalForm;
  return {
    ...actual,
    ModalForm: (props: any) => {
      const schema = {
        ...props.schema,
        onOpenChange: (open: boolean) => {
          probe.events.push(`form:${open}`);
          props.schema.onOpenChange?.(open);
        },
      };
      return <RealModalForm {...props} schema={schema} />;
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
vi.mock('../../views/RecordFormPage', () => ({
  RecordFormPage: () => <div data-testid="record-form-page" />,
}));

// The list's record drawer, as `ObjectView` mounts it
// (`objectViewRecordOverlay.tsx`): the real stack and drawer over the list,
// its root the row `?recordId=` names, opened from an effect once the list
// has mounted (`useObjectViewRecordNavigation`).
vi.mock('../../views/ObjectView', async () => {
  const { useMemo, useState, useEffect: useMountEffect } = await import('react');
  const { useSearchParams } = await import('react-router-dom');
  const { RecordStackDrawer, useRecordDrawerStack } = await import('../../views/recordDrawerStack');
  return {
    ObjectView: ({ objects }: { objects: any[] }) => {
      const [searchParams] = useSearchParams();
      const recordId = searchParams.get('recordId');
      const root = useMemo(() => (recordId ? { objectName: 'crm_account', recordId } : null), [recordId]);
      const [open, setOpen] = useState(false);
      useMountEffect(() => {
        if (!recordId) return undefined;
        const timer = setTimeout(() => setOpen(true), 30);
        return () => clearTimeout(timer);
      }, [recordId]);
      const stack = useRecordDrawerStack({ root });
      return (
        <RecordStackDrawer
          stack={stack}
          open={open}
          objects={objects}
          mainContent={<div data-testid="list" />}
          onClose={() => probe.events.push('drawer:close')}
          renderRecord={(level) => <div data-testid="record-body">{level.recordId}</div>}
        />
      );
    },
  };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'user' },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: null,
  }),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

const OBJECTS = [
  { name: 'crm_account', label: 'Account', fields: { name: { type: 'text', label: 'Name' } } },
  {
    name: 'crm_contact',
    label: 'Contact',
    fields: {
      name: { type: 'text', label: 'Name' },
      account: { type: 'lookup', label: 'Account', reference: 'crm_account' },
    },
  },
];

const dataSourceStub = {
  onConnectionStateChange: () => () => {},
  getConnectionState: () => 'connected',
  getObjectSchema: vi.fn(async (name: string) => OBJECTS.find((o) => o.name === name)),
  findOne: vi.fn(async () => ({ id: 'a1' })),
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

// An edit dialog reads approvals; nothing here reaches a socket.
vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
})));
afterAll(() => vi.unstubAllGlobals());

import { AppContent } from '../AppContent';

const nav: { current: NavigateFunction | null } = { current: null };
function NavProbe() {
  const navigate = useNavigate();
  useEffect(() => {
    nav.current = navigate;
  });
  return null;
}

function mountAt(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <NavProbe />
      <Routes>
        <Route path="/apps/:appName/*" element={<AppContent />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The drawer's sheet and the form's dialog, once both are drawn. */
async function bothLayers() {
  const form = await waitFor(() => {
    const footer = document.querySelector('[data-testid="modal-form-footer"]');
    expect(footer).not.toBeNull();
    return footer!.closest('[role="dialog"]') as HTMLElement;
  }, { timeout: 5000 });
  const drawer = (await screen.findByTestId('record-body')).closest('[role="dialog"]') as HTMLElement;
  expect(drawer).not.toBeNull();
  expect(drawer).not.toBe(form);
  return { form, drawer };
}

const follows = (later: Element, earlier: Element) =>
  (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

const RELATED_NEW = 'form=new&formObject=crm_contact&formLink=account%3Aa1';

beforeEach(() => {
  probe.events.length = 0;
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('#32685 — a related-record form the URL opens over a record drawer is the top layer', () => {
  it('on a reload the form opens after the drawer: its dialog follows the sheet, and Esc closes the form first', async () => {
    mountAt(`/apps/crm/crm_account?recordId=a1&${RELATED_NEW}`);
    const { form, drawer } = await bothLayers();
    expect(follows(form, drawer)).toBe(true);
    expect(within(form).getByRole('button', { name: 'Create' })).toBeEnabled();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(probe.events).toContain('form:false'));
    expect(probe.events).not.toContain('drawer:close');
  });

  it('from a click in the drawer the form stacks the same way', async () => {
    mountAt('/apps/crm/crm_account?recordId=a1');
    await screen.findByTestId('record-body');
    act(() => nav.current!(`/apps/crm/crm_account?recordId=a1&${RELATED_NEW}`));
    const { form, drawer } = await bothLayers();
    expect(follows(form, drawer)).toBe(true);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(probe.events).toContain('form:false'));
    expect(probe.events).not.toContain('drawer:close');
  });

  it('CONTROL: the form a URL opens with no drawer opens at once', async () => {
    mountAt('/apps/crm/crm_contact?form=new');
    await waitFor(() => expect(document.querySelector('[data-testid="modal-form-footer"]')).not.toBeNull(), { timeout: 5000 });
    expect(screen.queryByTestId('record-body')).toBeNull();
  });
});
