// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11776 — the Interfaces pillar's nav save sends only entries that
 * name a target, and its error banner goes once a nav save lands.
 *
 * "Add nav item" births `{ id, type: 'object' }` and selects it, so the author
 * can pick its object in the inspector. Until then the spec refuses it: an
 * `object` entry needs an `objectName`. The save sent it anyway, so every
 * autosave failed with "• navigation.2.objectName — Invalid input …", and the
 * banner that failure raised stayed after the entry was removed and a save
 * landed: nothing on a nav save's success path cleared it.
 *
 * Now the save leaves out every entry that names no target for its `type`
 * (`navPayloadOf`, pinned branch by branch beside `AppNavCanvas`), and the
 * editor keeps showing it, in its place, until it is bound or removed. The nav
 * editor holds its own failure apart from the pillar's, and a nav save that
 * lands clears it, never a failure a leaf is still showing.
 *
 * The server double refuses an app save the way the server does: it parses
 * the body with the spec's own `AppSchema` and answers the issues, which the
 * pillar formats as the filer's banner read. Nothing here is a synthetic
 * refusal except the one transport failure the banner pins inject on purpose.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppSchema } from '@objectstack/spec/ui';

const PKG = 'com.acme.app';

const NAV = [
  { id: 'nav_home', type: 'page', label: 'Home menu', pageName: 'home' },
  { id: 'nav_landing', type: 'page', label: 'Landing menu', pageName: 'landing' },
];
const APP = { name: 'acme_app', label: 'Acme', navigation: NAV };
const HOME = { name: 'home', label: 'Home', type: 'app', regions: [{ name: 'main', components: [] }] };
const LANDING = { name: 'landing', label: 'Landing', type: 'app', regions: [{ name: 'main', components: [] }] };
/** The object the inspector's picker offers. */
const TASK = { name: 'acme_task', label: 'Task', fields: [{ name: 'title', label: 'Title', type: 'text' }] };

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, Record<string, unknown>>(),
  /** Each app save as the server received it, and whether the spec took it. */
  appSaves: [] as Array<{ navigation: Array<Record<string, unknown>>; accepted: boolean }>,
  /** While set, the next app save fails with it before it is parsed (a transport failure). */
  fail: null as Error | null,
  /** While set, the layered read of this `type/name` fails with it. */
  failRead: null as { key: string; error: Error } | null,
}));

const appSchema = vi.hoisted(() => ({ parse: null as null | ((body: unknown) => { success: boolean; issues: Array<{ path: string; message: string }> }) }));

// A server double: an app save is parsed with the spec's AppSchema and refused
// with its issues, as the `/meta` write door answers; one it takes lands as
// the app's draft, and a later load serves it.
const mockClient = vi.hoisted(() => {
  const k = (type: string, name: string) => `${type}/${name}`;
  return {
    list: vi.fn(async (type: string) =>
      [...server.active.entries()]
        .filter(([key]) => key.startsWith(`${type}/`))
        .map(([, row]) => ({ name: row.name, label: row.label ?? row.name })),
    ),
    listDrafts: vi.fn(async () => []),
    listTypes: vi.fn(async () => ({ entries: [] })),
    get: vi.fn(async () => null),
    references: vi.fn(async () => []),
    layered: vi.fn(async (type: string, name: string) => {
      if (server.failRead && server.failRead.key === k(type, name)) throw server.failRead.error;
      const eff = server.active.get(k(type, name)) ?? null;
      return { code: null, overlay: eff, overlayScope: eff ? 'env' : null, effective: eff, editable: true, deletable: true, resettable: false, lock: 'none' };
    }),
    getDraft: vi.fn(async (type: string, name: string) => {
      const draft = server.drafts.get(k(type, name));
      if (draft) return { item: JSON.parse(JSON.stringify(draft)) as Record<string, unknown> };
      throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
    }),
    save: vi.fn(async (type: string, name: string, item: unknown) => {
      const body = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
      if (type === 'app') {
        const failure = server.fail;
        server.fail = null;
        if (failure) {
          server.appSaves.push({ navigation: (body.navigation as Array<Record<string, unknown>>) ?? [], accepted: false });
          throw failure;
        }
        const verdict = appSchema.parse!(body);
        server.appSaves.push({ navigation: (body.navigation as Array<Record<string, unknown>>) ?? [], accepted: verdict.success });
        if (!verdict.success) {
          throw Object.assign(new Error(`${verdict.issues.length} validation issue(s)`), { status: 400, issues: verdict.issues });
        }
      }
      server.drafts.set(k(type, name), body);
      return { type, name, item };
    }),
    publish: vi.fn(async () => ({ success: true })),
    reset: vi.fn(async () => ({})),
  };
});

appSchema.parse = (body: unknown) => {
  const r = AppSchema.safeParse(body);
  return {
    success: r.success,
    issues: r.success ? [] : r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  };
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));

import { InterfacesPillar } from './StudioDesignSurface';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { registerMetadataDefaultInspector } from '../metadata-admin/default-inspector-registry';
import { PagePreview } from '../metadata-admin/previews/PagePreview';
import { PageBlockInspector } from '../metadata-admin/inspectors/PageBlockInspector';
import { PageDefaultInspector } from '../metadata-admin/inspectors/PageDefaultInspector';

// No request here goes out over the global `fetch`; one double answers
// "absent" so a stray read keeps its documented fallback.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

// The first leaf the pillar opens is a page: its designer loads the page, so
// a leaf whose read fails shows that failure in the same banner.
registerMetadataPreview('page', PagePreview);
registerMetadataInspector('page', PageBlockInspector);
registerMetadataDefaultInspector('page', PageDefaultInspector);

const key = (type: string, name: string) => `${type}/${name}`;

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.appSaves.length = 0;
  server.fail = null;
  server.failRead = null;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  server.active.set(key('app', APP.name), JSON.parse(JSON.stringify(APP)));
  server.active.set(key('page', HOME.name), JSON.parse(JSON.stringify(HOME)));
  server.active.set(key('page', LANDING.name), JSON.parse(JSON.stringify(LANDING)));
  server.active.set(key('object', TASK.name), JSON.parse(JSON.stringify(TASK)));
});

afterEach(cleanup);

/** The pillar as the Studio surface mounts it: its draft-saved signal re-reads the app. */
const dirtyReports: boolean[] = [];
function NavHost() {
  const [nonce, setNonce] = React.useState(0);
  return (
    <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
      <InterfacesPillar
        packageId={PKG}
        draftNonce={nonce}
        onDraftSaved={() => setNonce((n) => n + 1)}
        onDirtyChange={(d) => dirtyReports.push(d)}
      />
    </MemoryRouter>
  );
}
beforeEach(() => {
  dirtyReports.length = 0;
});

/** The pillar's rail: the innermost navigation landmark that lists the app's items. */
function rail(): HTMLElement {
  const lists = screen.getAllByRole('navigation').filter((n) => n.textContent?.includes('Home menu'));
  const innermost = lists.filter((n) => !lists.some((other) => other !== n && n.contains(other)));
  expect(innermost).toHaveLength(1);
  return innermost[0];
}

async function openEditing(): Promise<void> {
  await screen.findByRole('button', { name: /Landing menu/ }, { timeout: 8000 });
  fireEvent.click(screen.getByTitle(/^Edit navigation/));
  await screen.findByRole('button', { name: /Add nav item/ }, { timeout: 8000 });
}

/** "Add nav item": the canvas appends a label-less entry and selects it. */
function addItem(): void {
  fireEvent.click(screen.getByRole('button', { name: /Add nav item/ }));
}

/** Pick the object in the inspector of the selected entry: the shared `Select` since objectui#11865. */
async function bindSelected(objectName: string): Promise<void> {
  const inspector = screen.getByRole('complementary');
  // objectui#12455 — the inspector also offers an Icon picker (a combobox), so the object picker is addressed by its test id.
  const picker = await within(inspector).findByTestId('nav-link-object');
  fireEvent.keyDown(picker, { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(await within(listbox).findByRole('option', { name: new RegExp(`\\(${objectName}\\)$`) }, { timeout: 8000 }));
}

/** The ids a save carried, in order. */
function sentIds(n: number): unknown[] {
  return (server.appSaves[n - 1]?.navigation ?? []).map((e) => e.id);
}

/** The banner the canvas shows a failure in, if any. */
function banner(): HTMLElement | null {
  return document.querySelector('main .border-destructive\\/40');
}

/** Past the autosave's debounce and the re-read its landing signals. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 2500));
  });
}

describe('the fixture (objectui#11776)', () => {
  it('the app the double serves is one the spec takes, and the double refuses what the spec refuses', () => {
    expect(appSchema.parse!(APP).success).toBe(true);
    const placeholder = { ...APP, navigation: [...NAV, { id: 'nav_item_3', type: 'object' }] };
    expect(appSchema.parse!(placeholder).issues).toEqual([
      { path: 'navigation.2.objectName', message: 'Invalid input: expected string, received undefined' },
    ]);
  });
});

describe('Interfaces nav save — an entry with no target is left out of what is sent (objectui#11776)', () => {
  it('"Add nav item" left unbound: the autosave sends the navigation without it, and the spec takes it', async () => {
    render(<NavHost />);
    await openEditing();
    addItem();
    // objectui#11862 — the unbound card reads the positional wording by its
    // place, never the id the canvas minted.
    expect((rail().textContent ?? '').match(/Item 3/g)).toHaveLength(1);
    expect(rail().textContent).not.toContain('nav_item_3');

    await waitFor(() => expect(server.appSaves).toHaveLength(1), { timeout: 8000 });
    expect(server.appSaves[0]).toEqual({ navigation: NAV, accepted: true });
    await settle();
    expect(banner()).toBeNull();
    expect(screen.queryByText(/navigation\.2\.objectName/)).toBeNull();
  });

  it('the left-out entry stays on the canvas, in its place, through the re-read the landed save signals', async () => {
    render(<NavHost />);
    await openEditing();
    addItem();
    await waitFor(() => expect(server.appSaves).toHaveLength(1), { timeout: 8000 });
    // The landed save re-reads the app (its draft-saved signal).
    await waitFor(
      () => expect(mockClient.getDraft.mock.calls.filter(([t, n]) => t === 'app' && n === APP.name).length).toBeGreaterThan(1),
      { timeout: 8000 },
    );
    await settle();
    const rows = within(rail()).getAllByRole('button', { name: /menu|Item \d+/ });
    expect(rows.map((r) => (r.textContent ?? '').match(/Home menu|Landing menu|Item \d+/)?.[0])).toEqual([
      'Home menu',
      'Landing menu',
      'Item 3',
    ]);
    // It is on screen and not on the server: the buffer stays unsent, so the
    // leave guard holds, and nothing more is sent until it is edited.
    expect(dirtyReports[dirtyReports.length - 1]).toBe(true);
    expect(server.appSaves).toHaveLength(1);
  });

  it('binding it later sends it in the place it was added, ahead of an entry added after it', async () => {
    render(<NavHost />);
    await openEditing();
    addItem(); // nav_item_3, left unbound
    addItem(); // nav_item_4, selected
    await bindSelected(TASK.name);
    await waitFor(() => expect(server.appSaves).toHaveLength(1), { timeout: 8000 });
    expect(sentIds(1)).toEqual(['nav_home', 'nav_landing', 'nav_item_4']);
    expect(server.appSaves[0].accepted).toBe(true);

    fireEvent.click(within(rail()).getByRole('button', { name: /Item 3/ }));
    await bindSelected(TASK.name);
    await waitFor(() => expect(server.appSaves).toHaveLength(2), { timeout: 8000 });
    expect(sentIds(2)).toEqual(['nav_home', 'nav_landing', 'nav_item_3', 'nav_item_4']);
    expect(server.appSaves[1]).toEqual({
      navigation: [
        ...NAV,
        { id: 'nav_item_3', type: 'object', objectName: TASK.name },
        { id: 'nav_item_4', type: 'object', objectName: TASK.name },
      ],
      accepted: true,
    });
    // Everything on screen is on the server: the guard lets go.
    await waitFor(() => expect(dirtyReports[dirtyReports.length - 1]).toBe(false), { timeout: 8000 });
  });

  it('the control: a navigation whose every entry names a target is sent exactly as the editor holds it', async () => {
    render(<NavHost />);
    await openEditing();
    addItem();
    await bindSelected(TASK.name);
    await waitFor(() => expect(server.appSaves).toHaveLength(1), { timeout: 8000 });
    expect(server.appSaves[0]).toEqual({
      navigation: [...NAV, { id: 'nav_item_3', type: 'object', objectName: TASK.name }],
      accepted: true,
    });
    await waitFor(() => expect(dirtyReports[dirtyReports.length - 1]).toBe(false), { timeout: 8000 });
  });
});

describe('Interfaces nav save — its banner goes once a nav save lands (objectui#11776)', () => {
  it('a nav save that failed and then lands clears the banner it raised', async () => {
    render(<NavHost />);
    await openEditing();
    server.fail = new Error('Service unavailable');
    addItem();
    await bindSelected(TASK.name);
    await waitFor(() => expect(server.appSaves).toHaveLength(1), { timeout: 8000 });
    await screen.findByText('Service unavailable', undefined, { timeout: 8000 });

    // The author removes the entry; the save that sends that lands. (Pointed
    // at first, as a mouse user removes it: this pin reads the banner alone.)
    const row = within(rail()).getAllByRole('button', { name: /acme_task|Task/ })[0];
    fireEvent.mouseEnter(row);
    fireEvent.click(within(row).getByRole('button', { name: 'Remove nav item' }));
    await waitFor(() => expect(server.appSaves).toHaveLength(2), { timeout: 8000 });
    expect(server.appSaves[1]).toEqual({ navigation: NAV, accepted: true });
    await waitFor(() => expect(screen.queryByText('Service unavailable')).toBeNull(), { timeout: 8000 });
    expect(banner()).toBeNull();
  });

  it('the control: a nav save that lands leaves a failure the open leaf is showing', async () => {
    server.failRead = { key: key('page', HOME.name), error: new Error('Home page could not be read') };
    render(<NavHost />);
    await screen.findByText('Home page could not be read', undefined, { timeout: 8000 });
    await openEditing();
    addItem();
    await bindSelected(TASK.name);
    await waitFor(() => expect(server.appSaves).toHaveLength(1), { timeout: 8000 });
    expect(server.appSaves[0].accepted).toBe(true);
    await settle();
    expect(screen.getByText('Home page could not be read')).toBeInTheDocument();
  });
});
