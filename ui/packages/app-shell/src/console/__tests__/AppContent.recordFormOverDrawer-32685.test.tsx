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
 * an effect, after the list has mounted — also when the route suspends
 * before the list mounts. A layer is later when its portal is later in the
 * document and when it answers `Esc` first.
 * CONTROL: the form a URL opens with no drawer opens at once.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import React, { useEffect } from 'react';
import { render, cleanup, waitFor, screen, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate, useLocation, type NavigateFunction } from 'react-router-dom';
import { registerAllFields } from '@object-ui/fields';
// The console's draft bar loads the linter lazily: pay that load while the file
// is collected, never inside a case's timeout (`check:test-source-alias`).
import '@objectstack/lint';

registerAllFields();

const probe = vi.hoisted(() => ({
  /** Each `onOpenChange` the form's dialog called, and each close of the drawer. */
  events: [] as string[],
  /** The list suspends once before it draws (a lazy chunk the route still loads). */
  suspend: null as null | { promise: Promise<void>; done: boolean },
  /** The location as of the latest render. */
  where: '',
}));

vi.mock('@object-ui/plugin-form', async (importOriginal) => {
  type FormProps = { schema: { onOpenChange?: (open: boolean) => void } & Record<string, unknown> } & Record<string, unknown>;
  const actual = await importOriginal<typeof import('@object-ui/plugin-form')>();
  const RealModalForm = actual.ModalForm as unknown as React.ComponentType<FormProps>;
  return {
    ...actual,
    ModalForm: (props: FormProps) => {
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
// objectstack#33111 — the record page's Edit and a drawer level's Edit over
// it, as the real header calls the host's `onEdit`: the record, then the
// object it belongs to (`RecordDetailView.drawerLevelEdit-33111` pins that
// call on both hosts).
vi.mock('../../views/RecordDetailView', () => ({
  RecordDetailView: ({ onEdit }: { onEdit: (record: { id: string }, objectName?: string) => void }) => (
    <div data-testid="record-page">
      <button type="button" data-testid="page-edit" onClick={() => onEdit({ id: 'a1' }, 'crm_account')} />
      <button type="button" data-testid="page-level-edit" onClick={() => onEdit({ id: 'c1' }, 'crm_contact')} />
    </div>
  ),
}));

// The list's record drawer, as `ObjectView` mounts it
// (`objectViewRecordOverlay.tsx`): the real stack and drawer over the list,
// its root the row `?recordId=` names, opened from an effect once the list
// has mounted (`useObjectViewRecordNavigation`). On a phone no pane is
// mounted, only the list (`ObjectView.tsx`, objectstack#27058).
vi.mock('../../views/ObjectView', async () => {
  const { useMemo, useState, useEffect: useMountEffect } = await import('react');
  const { useLocation: useMockLocation, useSearchParams } = await import('react-router-dom');
  const { RecordStackDrawer, readRestoredPath, useRecordDrawerStack } = await import('../../views/recordDrawerStack');
  const { usePhoneViewport } = await import('../../hooks/usePhoneViewport');
  return {
    ObjectView: ({ objects, onEdit }: { objects: ReadonlyArray<unknown>; onEdit: (record: { id: string }, objectName?: string) => void }) => {
      if (probe.suspend && !probe.suspend.done) throw probe.suspend.promise;
      const [searchParams] = useSearchParams();
      const recordId = searchParams.get('recordId');
      const root = useMemo(() => (recordId ? { objectName: 'crm_account', recordId } : null), [recordId]);
      const [open, setOpen] = useState(false);
      useMountEffect(() => {
        if (!recordId) return undefined;
        const timer = setTimeout(() => setOpen(true), 30);
        return () => clearTimeout(timer);
      }, [recordId]);
      // A stack handed back in the history state (the ↗ round trip) opens
      // its levels over the root.
      const restoredPath = readRestoredPath(useMockLocation().state);
      const stack = useRecordDrawerStack({ root, restoredPath });
      const phone = usePhoneViewport();
      if (phone) return <div data-testid="list" />;
      return (
        <RecordStackDrawer
          stack={stack}
          open={open}
          objects={objects}
          mainContent={<div data-testid="list" />}
          onClose={() => probe.events.push('drawer:close')}
          renderRecord={(level) => (
            <div data-testid="record-body">
              {level.recordId}
              <button type="button" data-testid="level-edit" onClick={() => onEdit({ id: level.recordId }, level.objectName)} />
            </div>
          )}
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
  const location = useLocation();
  useEffect(() => {
    nav.current = navigate;
    probe.where = `${location.pathname}${location.search}`;
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
  probe.suspend = null;
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

  it('the same when the route suspends before the list and its drawer mount', async () => {
    const suspend = { done: false } as { promise: Promise<void>; done: boolean };
    suspend.promise = new Promise<void>((resolve) => setTimeout(() => { suspend.done = true; resolve(); }, 60));
    probe.suspend = suspend;
    mountAt(`/apps/crm/crm_account?recordId=a1&${RELATED_NEW}`);
    const { form, drawer } = await bothLayers();
    expect(suspend.done).toBe(true);
    expect(follows(form, drawer)).toBe(true);

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

  it('on a phone the same URL draws no drawer, and the form is not held for one', async () => {
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 390 });
    try {
      mountAt(`/apps/crm/crm_account?recordId=a1&${RELATED_NEW}`);
      await waitFor(() => expect(document.querySelector('[data-testid="modal-form-footer"]')).not.toBeNull(), { timeout: 5000 });
      expect(screen.getByTestId('list')).toBeInTheDocument();
      expect(screen.queryByTestId('record-body')).toBeNull();
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
    }
  });

  it('CONTROL: the form a URL opens with no drawer opens at once', async () => {
    mountAt('/apps/crm/crm_contact?form=new');
    await waitFor(() => expect(document.querySelector('[data-testid="modal-form-footer"]')).not.toBeNull(), { timeout: 5000 });
    expect(screen.queryByTestId('record-body')).toBeNull();
  });
});

/**
 * objectstack#32750 — on a phone the list answers a drawer link with the
 * record's page (objectstack#27058), and carries the related-record form the
 * link names onto it: `record/<id>?form=new&formObject=…&formLink=…`
 * (`objectViewRecordNavigation.phonePush-29074.test.tsx` pins that redirect).
 * Here, the page it lands on: the form opens over the record page and stays
 * open, as the same link opens it over the drawer on a desktop.
 * CONTROL: the record page with no form parameters draws no form.
 *
 * Mounted at the URL the redirect writes: in this harness a router
 * transition from the list route to the record route never commits (measured
 * on a desktop width too), so the redirect itself is pinned at the hook. The
 * waits below are plain timers, not `act`: the record route keeps re-rendering
 * under this harness's doubles, and `act` waits for that to settle.
 */
describe('#32750 — on a phone the related-record form a drawer link carries stays open over the record page', () => {
  const width = window.innerWidth;
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 390 });
  });
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  });

  it('the form opens over the record page and is still open after the page settles', async () => {
    mountAt(`/apps/crm/crm_account/record/a1?${RELATED_NEW}`);
    await screen.findByTestId('record-page', {}, { timeout: 5000 });
    const footer = await waitFor(() => {
      const found = document.querySelector('[data-testid="modal-form-footer"]');
      expect(found).not.toBeNull();
      return found!;
    }, { timeout: 5000 });
    // The card measured the form closing about half a second after it opened.
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(footer.isConnected).toBe(true);
    expect(probe.events).not.toContain('form:false');
    expect(within(footer.closest('[role="dialog"]') as HTMLElement).getByRole('button', { name: 'Create' })).toBeEnabled();
    expect(probe.where).toBe(`/apps/crm/crm_account/record/a1?${RELATED_NEW}`);
  });

  it('CONTROL: the record page with no form parameters draws no form', async () => {
    mountAt('/apps/crm/crm_account/record/a1');
    await screen.findByTestId('record-page', {}, { timeout: 5000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(document.querySelector('[data-testid="modal-form-footer"]')).toBeNull();
    expect(probe.where).toBe('/apps/crm/crm_account/record/a1');
  });
});

/**
 * objectstack#33111 — a drawer level's Edit edits the level's record as a
 * record of the level's object: the form is that object's child task over the
 * route (`formObject`), on the list's drawer and on the record page's. Before,
 * the host dropped the object and opened the route object's form with the
 * child's id ("Edit Account" / "Record not found").
 * CONTROL: the route object's own Edit (the page's, and a level of the route's
 * object) is a top-level task and leaves no `formObject`, a stale one included.
 */
describe('#33111 — a drawer level’s Edit opens the form of the level’s object', () => {
  /** The record the form loaded once it opened: `[object, id]`. */
  const formLoaded = async (objectName: string, id: string) => {
    await waitFor(() => expect(document.querySelector('[data-testid="modal-form-footer"]')).not.toBeNull(), { timeout: 5000 });
    await waitFor(() =>
      expect(dataSourceStub.findOne.mock.calls.some((call: unknown[]) => call[0] === objectName && call[1] === id)).toBe(true),
    );
  };
  // `handleEdit` reads the live `window.location`, as the browser router keeps it.
  const at = (url: string) => window.history.replaceState(null, '', url);
  afterEach(() => at('/'));

  it('the list drawer: a child level’s Edit writes formObject = the child, and the form is the child’s', async () => {
    mountAt('/apps/crm/crm_account?recordId=a1');
    await screen.findByTestId('record-body');
    // The child level, as a related row opens it over the account.
    act(() => nav.current!('/apps/crm/crm_account?recordId=a1', { state: { recordDrawerRestore: [{ objectName: 'crm_account', recordId: 'a1' }, { objectName: 'crm_contact', recordId: 'c1' }] } }));
    await waitFor(() => expect(screen.getByTestId('record-body')).toHaveTextContent('c1'));
    at('/apps/crm/crm_account?recordId=a1');
    fireEvent.click(screen.getByTestId('level-edit'));
    await waitFor(() => expect(probe.where).toBe('/apps/crm/crm_account?recordId=a1&form=c1&formObject=crm_contact'));
    await formLoaded('crm_contact', 'c1');
  });

  it('the record page: a level’s Edit over the page writes formObject = the child', async () => {
    mountAt('/apps/crm/crm_account/record/a1');
    await screen.findByTestId('record-page', {}, { timeout: 5000 });
    at('/apps/crm/crm_account/record/a1');
    fireEvent.click(screen.getByTestId('page-level-edit'));
    await waitFor(() => expect(probe.where).toBe('/apps/crm/crm_account/record/a1?form=c1&formObject=crm_contact'));
    await formLoaded('crm_contact', 'c1');
  });

  it('CONTROL: the route object’s own Edit leaves no formObject, a stale one dropped', async () => {
    mountAt('/apps/crm/crm_account/record/a1?formObject=crm_contact&formLink=account%3Aa1');
    await screen.findByTestId('record-page', {}, { timeout: 5000 });
    at('/apps/crm/crm_account/record/a1?formObject=crm_contact&formLink=account%3Aa1');
    fireEvent.click(screen.getByTestId('page-edit'));
    await waitFor(() => expect(probe.where).toBe('/apps/crm/crm_account/record/a1?form=a1'));
    await formLoaded('crm_account', 'a1');
  });

  it('CONTROL: the list drawer’s root level (the route’s object) leaves no formObject', async () => {
    mountAt('/apps/crm/crm_account?recordId=a1');
    await screen.findByTestId('record-body');
    at('/apps/crm/crm_account?recordId=a1');
    fireEvent.click(screen.getByTestId('level-edit'));
    await waitFor(() => expect(probe.where).toBe('/apps/crm/crm_account?recordId=a1&form=a1'));
  });
});
