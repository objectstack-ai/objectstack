/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#33548 — a list whose rows open nothing does not look clickable
 * on its card faces either, and an authored `none` row opens nothing on any
 * click.
 *
 * The console's object list resolves a row's record navigation to `none` when
 * the view authors `navigation: { mode: 'none' }` or the object is list-only
 * (its served operations leave `get` out, `servesRecordRead`). The host hands
 * that answer down as `rowOpensRecord`, and each card face reads it: the
 * gallery card, the board card and the phone card draw no pointer and no hover
 * lift, and a tap on one opens nothing. A board card that cannot be dragged
 * either is no control at all: no `button` role, no tab stop, no title hover.
 * Card actions stay (the phone card's "⋮"), and a board card the reader may
 * drag keeps its drag semantics.
 *
 * Driven through the real `ObjectView`, `ListView`, gallery, board and grid,
 * and the real `MePermissionsProvider`: one differential per face, the same
 * object and rows, only the view's `navigation` or the served operations
 * differ. CONTROL: a list whose rows open (the record page, objectstack#35854) keeps its
 * pointer and its taps, and a ⌘-click on its row opens a new tab.
 *
 * The record body is not what this file reads, so `RecordDetailView` is a
 * null sink.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
import { SchemaRendererProvider } from '@object-ui/react';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRealtimeSubscription: () => ({ lastMessage: null }),
  useConflictResolution: () => ({ hasConflicts: false, resolveAllConflicts: () => {} }),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
// The record body: not what this file reads.
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => ({ save: vi.fn(async () => ({})), get: vi.fn(async () => null) }),
}));

// `ObjectView` reaches a dynamic `import('@objectstack/lint')`: pay its load at
// collection, never inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';
// Registers the real `object-kanban` renderer, the one `ListView` mounts, and
// loads the board's lazy chunk at module scope.
import '@object-ui/plugin-kanban';
import '../../../plugin-kanban/src/KanbanImpl';
import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'demo_credential';
const VIEW_ID = 'all';

/** The served operations of a list-only object: `list` and what derives from it, no `get`. */
const LIST_ONLY_OPERATIONS = ['list', 'aggregate', 'export', 'search'];

const ROWS = [
  { id: 'c1', name: 'Okta staging', connection: 'okta-staging', stage: 'open' },
  { id: 'c2', name: 'Azure prod', connection: 'azure-prod', stage: 'closed' },
];

type ViewShape = { type: 'grid' | 'gallery' | 'kanban'; navigation?: { mode: string } };

/** The object, its one list view of the given face, carrying `navigation` when given. */
function objectsWith(view: ViewShape) {
  return [
    {
      name: OBJECT_NAME,
      label: 'Credential',
      pluralLabel: 'Credentials',
      nameField: 'name',
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
        connection: { type: 'text', label: 'Connection' },
        stage: {
          type: 'select',
          label: 'Stage',
          options: [
            { value: 'open', label: 'Open' },
            { value: 'closed', label: 'Closed' },
          ],
        },
      },
      actions: [
        {
          name: 'revoke_credential',
          label: 'Revoke',
          objectName: OBJECT_NAME,
          type: 'script',
          target: 'revoke_credential',
          locations: ['list_item', 'record_header'],
        },
      ],
      listViews: {
        [VIEW_ID]: {
          name: VIEW_ID,
          label: 'All',
          type: view.type,
          columns: ['name', 'connection', 'stage'],
          ...(view.type === 'kanban' ? { kanban: { groupByField: 'stage' } } : {}),
          ...(view.navigation ? { navigation: view.navigation } : {}),
        },
      },
    },
  ];
}

/** The caller's `/me/permissions` answer: the served operations, and whether it may edit (drag a card). */
function answer(opts: { apiOperations?: string[]; allowEdit?: boolean }): MePermissionsAuthenticatedResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: null,
    positions: [],
    hasAnyQueue: false,
    objectsUsingQueues: [],
    permissionSets: ['admin'],
    systemPermissions: [],
    objects: {
      [OBJECT_NAME]: {
        allowRead: true,
        allowCreate: true,
        allowEdit: opts.allowEdit ?? true,
        allowDelete: true,
        ...(opts.apiOperations ? { apiOperations: opts.apiOperations } : {}),
      },
    },
    fields: {},
  } as MePermissionsAuthenticatedResponse;
}

let openSpy: ReturnType<typeof vi.fn>;
const DESKTOP_WIDTH = window.innerWidth;

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  openSpy = vi.fn(() => null);
  vi.stubGlobal('open', openSpy);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'innerWidth', { value: DESKTOP_WIDTH, configurable: true, writable: true });
  window.history.replaceState(null, '', '/');
});

const LIST_PATH = `/apps/setup/${OBJECT_NAME}/view/${VIEW_ID}`;

function dataSourceFor(objects: ReturnType<typeof objectsWith>) {
  return {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async (name: string) => objects.find((o) => o.name === name) ?? null),
  } as never;
}

/** Where the list stands: its path and its query (`?recordId=` is the drawer). */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

async function mountList(opts: {
  view: ViewShape;
  apiOperations?: string[];
  allowEdit?: boolean;
  phone?: boolean;
}) {
  if (opts.phone) {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true, writable: true });
  }
  const objects = objectsWith(opts.view);
  const dataSource = dataSourceFor(objects);
  window.history.replaceState(null, '', LIST_PATH);
  render(
    // The board reads the renderer context the console's app root provides.
    <SchemaRendererProvider dataSource={dataSource}>
    <MePermissionsProvider initialPermissions={answer(opts)}>
      <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })}>
        <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
          <MemoryRouter initialEntries={[LIST_PATH]}>
            <Routes>
              <Route
                path="/apps/:appName/:objectName/view/:viewId"
                element={
                  <>
                    <ObjectView dataSource={dataSource} objects={objects} onEdit={() => {}} />
                    <LocationProbe />
                  </>
                }
              />
              <Route path="*" element={<LocationProbe />} />
            </Routes>
          </MemoryRouter>
        </ExpressionProvider>
      </I18nProvider>
    </MePermissionsProvider>
    </SchemaRendererProvider>,
  );
}

const location = () => screen.getByTestId('location').textContent;

/** The gallery card titled `title`. */
async function galleryCard(title: string): Promise<HTMLElement> {
  const heading = await screen.findByText(title, { selector: 'h3' }, { timeout: 5000 });
  return heading.closest('[role="listitem"]') as HTMLElement;
}

/** The board card of record `id`: the control, and the card face it draws. */
async function boardCard(id: string): Promise<{ control: HTMLElement; face: HTMLElement }> {
  const control = await waitFor(
    () => {
      const el = document.querySelector(`[data-kanban-card="${id}"]`) as HTMLElement | null;
      expect(el).not.toBeNull();
      return el as HTMLElement;
    },
    { timeout: 5000 },
  );
  return { control, face: control.firstElementChild as HTMLElement };
}

/** The phone card showing `title`. */
async function phoneCard(title: string): Promise<HTMLElement> {
  const cards = await screen.findAllByTestId('grid-mobile-card', undefined, { timeout: 5000 });
  const card = cards.find((c) => (c.textContent ?? '').includes(title));
  expect(card).toBeTruthy();
  return card as HTMLElement;
}

/** Whether the board card's wrapper is a control: a `button` a Tab reaches. */
function isBoardControl(control: HTMLElement): boolean {
  return control.getAttribute('role') === 'button' && control.getAttribute('tabindex') === '0';
}

/** Whether the board card's face drives its title's hover colour (`group` → `group-hover:text-primary`). */
function hasTitleHover(face: HTMLElement): boolean {
  return /(^|\s)group(\s|$)/.test(face.className) && face.querySelector('[class*="group-hover:"]') !== null;
}

/** Whether `el` wears a clickable face: the pointer, or a hover lift / wash. */
function looksClickable(el: HTMLElement): boolean {
  return /(^|\s)(cursor-pointer|hover:shadow-lg|hover:bg-accent\/50)(\s|$)/.test(el.className);
}

describe('objectstack#33548 — gallery cards on a list whose rows open nothing', () => {
  it('authored `navigation.mode: none`: no pointer, no hover lift, and a tap opens nothing', async () => {
    await mountList({ view: { type: 'gallery', navigation: { mode: 'none' } } });
    const card = await galleryCard('Okta staging');
    expect(looksClickable(card)).toBe(false);
    const before = location();
    fireEvent.click(card);
    fireEvent.click(card, { metaKey: true });
    expect(location()).toBe(before);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('a list-only object: no pointer, no hover lift, and a tap opens nothing', async () => {
    await mountList({ view: { type: 'gallery' }, apiOperations: LIST_ONLY_OPERATIONS });
    const card = await galleryCard('Okta staging');
    expect(looksClickable(card)).toBe(false);
    const before = location();
    fireEvent.click(card);
    expect(location()).toBe(before);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('CONTROL — a list whose rows open: the card wears the pointer, a tap opens the record page and a ⌘-click a new tab', async () => {
    await mountList({ view: { type: 'gallery' } });
    const card = await galleryCard('Okta staging');
    expect(card.className).toMatch(/(^|\s)cursor-pointer(\s|$)/);
    // The ⌘-click first: the tap leaves the list for the record page.
    fireEvent.click(card, { metaKey: true });
    expect(openSpy).toHaveBeenCalledTimes(1);
    fireEvent.click(card);
    await waitFor(() => expect(location()).toContain('/record/c1'));
  });
});

describe('objectstack#33548 — board cards on a list whose rows open nothing', () => {
  it('authored `none`, a card the reader may not drag: no pointer, no hover lift, and a tap or Enter opens nothing', async () => {
    await mountList({ view: { type: 'kanban', navigation: { mode: 'none' } }, allowEdit: false });
    const { control, face } = await boardCard('c1');
    expect(looksClickable(face)).toBe(false);
    const before = location();
    fireEvent.click(control);
    fireEvent.keyDown(control, { key: 'Enter' });
    fireEvent.click(control, { ctrlKey: true });
    expect(location()).toBe(before);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('a list-only object, a card the reader may not drag: no pointer, no hover lift, and a tap opens nothing', async () => {
    await mountList({ view: { type: 'kanban' }, apiOperations: LIST_ONLY_OPERATIONS, allowEdit: false });
    const { control, face } = await boardCard('c1');
    expect(looksClickable(face)).toBe(false);
    const before = location();
    fireEvent.click(control);
    expect(location()).toBe(before);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('authored `none`, a card the reader may not drag: the card is no control — no button role, no tab stop, no title hover', async () => {
    await mountList({ view: { type: 'kanban', navigation: { mode: 'none' } }, allowEdit: false });
    const { control, face } = await boardCard('c1');
    expect(isBoardControl(control)).toBe(false);
    expect(hasTitleHover(face)).toBe(false);
  });

  it('a list-only object, a card the reader may not drag: the card is no control either', async () => {
    await mountList({ view: { type: 'kanban' }, apiOperations: LIST_ONLY_OPERATIONS, allowEdit: false });
    const { control, face } = await boardCard('c1');
    expect(isBoardControl(control)).toBe(false);
    expect(hasTitleHover(face)).toBe(false);
  });

  it('authored `none`, a card the reader may drag: it keeps its drag semantics — the grab cursor, the button role and the tab stop — and gains no pointer', async () => {
    await mountList({ view: { type: 'kanban', navigation: { mode: 'none' } } });
    const { control, face } = await boardCard('c1');
    expect(face.className).toMatch(/(^|\s)cursor-grab(\s|$)/);
    expect(face.className).not.toMatch(/(^|\s)cursor-pointer(\s|$)/);
    expect(isBoardControl(control)).toBe(true);
  });

  it('CONTROL — a list whose rows open, a card the reader may not drag: a control with the pointer and title hover; Enter opens the record page', async () => {
    await mountList({ view: { type: 'kanban' }, allowEdit: false });
    const { control, face } = await boardCard('c1');
    expect(face.className).toMatch(/(^|\s)cursor-pointer(\s|$)/);
    expect(isBoardControl(control)).toBe(true);
    expect(hasTitleHover(face)).toBe(true);
    fireEvent.keyDown(control, { key: 'Enter' });
    await waitFor(() => expect(location()).toContain('/record/c1'));
  });

  it('CONTROL — a list whose rows open: a tap on the card opens the record page', async () => {
    await mountList({ view: { type: 'kanban' }, allowEdit: false });
    const { control } = await boardCard('c1');
    fireEvent.click(control);
    await waitFor(() => expect(location()).toContain('/record/c1'));
  });
});

describe('objectstack#33548 — phone cards on a list whose rows open nothing', () => {
  it('a list-only object: no pointer, no hover wash, a tap opens nothing, and the "⋮" stays', async () => {
    await mountList({ view: { type: 'grid' }, apiOperations: LIST_ONLY_OPERATIONS, phone: true });
    const card = await phoneCard('Okta staging');
    expect(looksClickable(card)).toBe(false);
    expect(card.querySelector('[data-testid="grid-card-actions"]')).not.toBeNull();
    const before = location();
    fireEvent.click(card);
    expect(location()).toBe(before);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('CONTROL — a served object: the card wears the pointer and a tap opens the record page', async () => {
    await mountList({ view: { type: 'grid' }, phone: true });
    const card = await phoneCard('Okta staging');
    expect(card.className).toMatch(/(^|\s)cursor-pointer(\s|$)/);
    fireEvent.click(card);
    await waitFor(() => expect(location()).toContain('/record/c1'));
  });
});
