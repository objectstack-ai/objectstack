/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35883 — while the phone's card list is selecting, the page's
 * floating 「+」 is not drawn, so it never sits on the selection bar that
 * floats at the bottom of the list (objectstack#35678). It comes back when the
 * selection ends.
 *
 * The list stands in as a card scroller that publishes its selection through
 * the grid's own store (`usePublishListSelecting`, plugin-grid
 * `listPageScope.ts`, the same module the page reads through the vitest
 * alias). What the real grid publishes is plugin-grid's pin
 * (`cardSelection-35883.test.tsx`).
 *
 * The same stand-in pins the phone's 「⋮ More」 → 「Select」: it is offered only
 * while the list says a request would open a selection
 * (`usePublishListSelectable`), so a kanban, a calendar or a list with no or
 * single selection never shows an item that does nothing.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
// The page's draft bar reaches `import('@objectstack/lint')` inside a function;
// its first load is paid here, at collection, not in a clocked case.
import '@objectstack/lint';

/** Controllable principal verdict, keyed by action (`can()` is permissive by default). */
let principal: Record<string, boolean> = {};

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({
      check: () => ({ allowed: true }),
      checkField: () => true,
      getFieldPermissions: () => [],
      getRowFilter: () => undefined,
      getObjectApiOperations: () => undefined,
      roles: [],
      isLoaded: false,
      hasCapabilities: () => true,
      can: (_object: string, action: string) => principal[action] ?? true,
      cannot: (_object: string, action: string) => !(principal[action] ?? true),
    }),
    useFieldPermissions: () => ({ canRead: () => true, canWrite: () => true, permissions: [] }),
  };
});

/** The page's phone verdict; the 「+」 case runs at the default (desktop) width. */
let phoneViewport = false;
vi.mock('../hooks/usePhoneViewport.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePhoneViewport: () => phoneViewport,
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRealtimeSubscription: () => ({ lastMessage: null }),
  useConflictResolution: () => ({ hasConflicts: false, resolveAllConflicts: () => {} }),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

// The list itself stands in as the box `ObjectGrid` draws at phone width: a
// scroller marked `data-fab-clearance`. Which classes the page gives it is the
// subject; what the real grid draws inside it is plugin-grid's pin.
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: () => null,
}));
vi.mock('@object-ui/plugin-view', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectView: () => <CardListStandIn />,
  ViewTabBar: () => null,
  ManageViewsDialog: () => null,
}));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

import { ObjectView } from './ObjectView';
import { PhonePageBarProvider, PhonePageBarEnd } from '../layout/PhonePageBar';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'showcase_project';
const USER = { id: 'u1', name: 'Ada', profile: 'admin' };

function objectsWith(createOverride: unknown) {
  return [
    {
      name: OBJECT_NAME,
      label: 'Project',
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
      },
      userActions: createOverride === undefined ? undefined : { create: createOverride },
    },
  ];
}

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

async function renderList(objects: any[]) {
  render(
    <ExpressionProvider user={USER}>
      <PhonePageBarProvider>
        <PhonePageBarEnd />
        <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}`]}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName"
              element={<ObjectView dataSource={makeDataSource()} objects={objects} onEdit={() => {}} />}
            />
          </Routes>
        </MemoryRouter>
      </PhonePageBarProvider>
    </ExpressionProvider>,
  );
  return screen.findByTestId('card-scroller-stand-in');
}


import { usePublishListSelectable, usePublishListSelecting } from '../../../plugin-grid/src/listPageScope';

function CardListStandIn() {
  const [root, setRoot] = React.useState<HTMLDivElement | null>(null);
  const [selecting, setSelecting] = React.useState(false);
  const [selectable, setSelectable] = React.useState(false);
  usePublishListSelecting(root, selecting);
  usePublishListSelectable(root, selectable);
  return (
    <div ref={setRoot} data-fab-clearance="" data-testid="card-scroller-stand-in">
      <button type="button" data-testid="toggle-selecting" onClick={() => setSelecting((s) => !s)} />
      <button type="button" data-testid="toggle-selectable" onClick={() => setSelectable((s) => !s)} />
    </div>
  );
}

const fab = () => document.querySelector('[data-testid="mobile-fab-create"]');

beforeEach(() => {
  principal = {};
  phoneViewport = false;
});

afterEach(() => cleanup());

describe('the phone 「+」 while cards are selected (objectstack#35883)', () => {
  it('is drawn, is not drawn while a selection is open, and is drawn again after it ends', async () => {
    await renderList(objectsWith(undefined));
    expect(fab(), 'CONTROL: drawn with no selection').toBeTruthy();

    fireEvent.click(screen.getByTestId('toggle-selecting'));
    expect(fab(), 'not drawn while selecting').toBeNull();

    fireEvent.click(screen.getByTestId('toggle-selecting'));
    expect(fab(), 'back once the selection ends').toBeTruthy();
  });
});

describe('the phone 「⋮ More」 → 「Select」 (objectstack#35883)', () => {
  const openMore = async () => {
    const trigger = (await screen.findByTestId('phone-page-bar-end')).querySelector('button');
    expect(trigger, 'the ⋮ More trigger').toBeTruthy();
    fireEvent.keyDown(trigger!, { key: 'Enter' });
    await screen.findByRole('menu');
  };
  const selectItem = () => document.querySelector('[data-testid="object-view-select"]');

  it('is not offered while the list says no selection would open', async () => {
    phoneViewport = true;
    await renderList(objectsWith(undefined));
    await openMore();
    expect(selectItem(), 'no 「Select」 on a list that would not open one').toBeNull();
  });

  it('is offered once the list says a selection would open', async () => {
    phoneViewport = true;
    await renderList(objectsWith(undefined));
    fireEvent.click(screen.getByTestId('toggle-selectable'));
    await openMore();
    expect(selectItem(), 'CONTROL: 「Select」 on a list that would open one').toBeTruthy();
  });
});
