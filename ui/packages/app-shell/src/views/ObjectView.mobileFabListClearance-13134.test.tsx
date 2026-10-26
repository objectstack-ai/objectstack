/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13134 — at phone width the object-list page's floating create
 * button (`mobile-fab-create`) covered the last card of a list, and the list
 * had no room at its end to scroll that card clear of it.
 *
 * The page's half of the fix: while the button is drawn, the list host pads
 * the end of the list's own scroller (the box `ObjectGrid` marks
 * `data-fab-clearance`, pinned in plugin-grid's
 * `ObjectGrid.cardScroller-13134.test.tsx`) by at least the button's height
 * plus its bottom offset; while it is not drawn, by nothing.
 *
 * The room is DERIVED here from the button's own classes, never copied: the
 * button is `fixed`, so its top edge stands `bottom-N` + `h-N` above the
 * screen's bottom, and the clearance's `pb-N` must reach that far. Moving the
 * button (a higher `bottom-*`, a taller `h-*`) without moving the room fails
 * this file by name. Happy-dom has no layout, so the geometry itself is a
 * browser reading recorded on the pull request.
 *
 * Direction predicted before the first run: the cases where the button is
 * drawn RED on the base tree (no clearance anywhere above the list), the cases
 * where it is not drawn GREEN on both trees, which is what makes them the
 * controls.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

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
  ObjectView: () => <div data-fab-clearance="" data-testid="card-scroller-stand-in" />,
  ViewTabBar: () => null,
  ManageViewsDialog: () => null,
}));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

import { ObjectView } from './ObjectView';
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
      <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}`]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName"
            element={<ObjectView dataSource={makeDataSource()} objects={objects} onEdit={() => {}} />}
          />
        </Routes>
      </MemoryRouter>
    </ExpressionProvider>,
  );
  return screen.findByTestId('card-scroller-stand-in');
}

const fab = () => document.querySelector('[data-testid="mobile-fab-create"]');
const tokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

/** Tailwind's spacing scale: `N` is N quarter-rems. */
const SPACING_REM = 0.25;

/** The rem value of the button's `PREFIX-N` class (e.g. `bottom-36` = 9). */
function fabRem(prefix: string): number {
  const hit = tokens(fab()!).map((t) => t.match(new RegExp(`^${prefix}-(\\d+)$`))).find(Boolean);
  if (!hit) throw new Error(`the FAB carries no ${prefix}-N class to derive the clearance from`);
  return Number(hit[1]) * SPACING_REM;
}

/**
 * The clearance an ancestor of the list's scroller gives it: a class that pads
 * the descendant marked `data-fab-clearance`, with its breakpoint variant.
 */
function clearanceAbove(scroller: Element): { variant: string; rem: number } | null {
  const RE = /^(?:([\w-]+):)?\[&_\[data-fab-clearance\]\]:pb-(\d+)$/;
  for (let el = scroller.parentElement; el; el = el.parentElement) {
    for (const t of tokens(el)) {
      const m = t.match(RE);
      if (m) return { variant: m[1] ?? '', rem: Number(m[2]) * SPACING_REM };
    }
  }
  return null;
}

/** The room exists while the button is drawn, reaches past its top edge, and only where it is drawn. */
async function expectRoomForTheButton(objects: any[]) {
  const scroller = await renderList(objects);
  expect(fab()).toBeTruthy();
  const room = clearanceAbove(scroller);
  expect(room).not.toBeNull();
  expect(room!.rem).toBeGreaterThanOrEqual(fabRem('bottom') + fabRem('h'));
  // The button is `sm:hidden`; the room is `max-sm:`, the same breakpoint.
  expect(tokens(fab()!)).toContain('sm:hidden');
  expect(room!.variant).toBe('max-sm');
}

async function expectNoRoom(objects: any[]) {
  const scroller = await renderList(objects);
  expect(fab()).toBeNull();
  expect(clearanceAbove(scroller)).toBeNull();
}

beforeEach(() => {
  principal = {};
  cleanup();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the phone list leaves room for the create button at its end (objectui#13134)', () => {
  it('create offered: the list scroller gets room past the button', async () => {
    await expectRoomForTheButton(objectsWith(true));
  });

  it('create offered but greyed (`disabledWhen` holds): the button is still drawn, so is the room', async () => {
    await expectRoomForTheButton(objectsWith({ enabled: true, disabledWhen: "os.user.profile == 'admin'" }));
  });

  it('create hidden by `visibleWhen`: no button, no room', async () => {
    await expectNoRoom(objectsWith({ enabled: true, visibleWhen: "os.user.profile == 'guest'" }));
  });

  it('create closed by the principal: no button, no room', async () => {
    principal = { create: false };
    await expectNoRoom(objectsWith(true));
  });
});
