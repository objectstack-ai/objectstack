// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11790 — Studio's nav editor offers every nav item type the spec's
 * `NavigationItemSchema` declares, not only *Link to object*.
 *
 * *Add nav item* births an `object` entry and selects it; the nav-item
 * inspector's Type choice then offers the spec union's members, read here off
 * the INSTALLED spec rather than from a list written in this file. Each
 * target-bearing type picks its target from the package's own items (or, for a
 * `component`, from the screens registered with the console; a `url` is
 * typed), and what the editor writes is judged by the spec's own schema:
 * `NavigationItemSchema` for an entry, and — through the server double, which
 * parses an app save with `AppSchema` as the `/meta` write door does — the
 * whole navigation a save sends. objectui#11776's rule is the control: an
 * entry with no target for its type is left out of the save and stays on the
 * canvas, and a `group` or `separator`, which name no target, are sent.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppSchema, NavigationItemSchema } from '@objectstack/spec/ui';

const PKG = 'com.acme.app';
const OTHER_PKG = 'com.other.app';

const NAV = [
  { id: 'nav_home', type: 'page', label: 'Home menu', pageName: 'home' },
  { id: 'nav_landing', type: 'page', label: 'Landing menu', pageName: 'landing' },
];
const APP = { name: 'acme_app', label: 'Acme', navigation: NAV };

/** Rows the double serves: `pkg` is the package a row belongs to, the rest is the item. */
const ROWS: Array<{ type: string; pkg: string; item: Record<string, unknown> }> = [
  { type: 'app', pkg: PKG, item: APP },
  { type: 'page', pkg: PKG, item: { name: 'home', label: 'Home', type: 'app', regions: [{ name: 'main', components: [] }] } },
  { type: 'page', pkg: PKG, item: { name: 'landing', label: 'Landing', type: 'app', regions: [{ name: 'main', components: [] }] } },
  // A record page needs a record id a `page` entry cannot pass: not offered.
  { type: 'page', pkg: PKG, item: { name: 'task_detail', label: 'Task detail', type: 'record' } },
  // Another package's page: not this package's item.
  { type: 'page', pkg: OTHER_PKG, item: { name: 'foreign_page', label: 'Foreign', type: 'app' } },
  { type: 'dashboard', pkg: PKG, item: { name: 'ops_board', label: 'Operations' } },
  { type: 'report', pkg: PKG, item: { name: 'tasks_by_status', label: 'Tasks by status' } },
  { type: 'action', pkg: PKG, item: { name: 'sync_all', label: 'Sync all' } },
  // Bound to an object: the nav runs global actions only, so not offered.
  { type: 'action', pkg: PKG, item: { name: 'close_task', label: 'Close task', objectName: 'acme_task' } },
  { type: 'doc', pkg: PKG, item: { name: 'getting_started', label: 'Getting started' } },
  { type: 'book', pkg: PKG, item: { name: 'acme_manual', label: 'Acme manual' } },
  { type: 'object', pkg: PKG, item: { name: 'acme_task', label: 'Task', fields: [{ name: 'title', label: 'Title', type: 'text' }] } },
];
/** Draft-only items: a draft header carries a name and no body. */
const DRAFT_HEADERS: Array<{ type: string; packageId: string; name: string }> = [
  { type: 'page', packageId: PKG, name: 'draft_page' },
];

const server = vi.hoisted(() => ({
  active: new Map<string, { pkg: string; item: Record<string, unknown> }>(),
  drafts: new Map<string, Record<string, unknown>>(),
  draftHeaders: [] as Array<{ type: string; packageId: string; name: string }>,
  /** Each app save as the server received it, and whether the spec took it. */
  appSaves: [] as Array<{ navigation: Array<Record<string, unknown>>; accepted: boolean; issues: unknown[] }>,
}));

const appSchema = vi.hoisted(() => ({ parse: null as null | ((body: unknown) => { success: boolean; issues: Array<{ path: string; message: string }> }) }));

// A server double: a list is scoped to the package it names; an app save is
// parsed with the spec's AppSchema and refused with its issues, as the `/meta`
// write door answers; one it takes lands as the app's draft.
const mockClient = vi.hoisted(() => {
  const k = (type: string, name: string) => `${type}/${name}`;
  return {
    list: vi.fn(async (type: string, options?: { packageId?: string }) =>
      [...server.active.entries()]
        .filter(([key, row]) => key.startsWith(`${type}/`) && (!options?.packageId || row.pkg === options.packageId))
        .map(([, row]) => JSON.parse(JSON.stringify(row.item)) as Record<string, unknown>),
    ),
    listDrafts: vi.fn(async (options?: { packageId?: string; type?: string }) =>
      server.draftHeaders
        .filter((d) => (!options?.type || d.type === options.type) && (!options?.packageId || d.packageId === options.packageId))
        .map((d) => ({ name: d.name, packageId: d.packageId })),
    ),
    listTypes: vi.fn(async () => ({ entries: [] })),
    get: vi.fn(async () => null),
    references: vi.fn(async () => []),
    layered: vi.fn(async (type: string, name: string) => {
      const eff = server.active.get(k(type, name))?.item ?? null;
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
        const verdict = appSchema.parse!(body);
        server.appSaves.push({
          navigation: (body.navigation as Array<Record<string, unknown>>) ?? [],
          accepted: verdict.success,
          issues: verdict.issues,
        });
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

import { InterfacesPillar, StudioNavItemInspector } from './StudioDesignSurface';
import { navPayloadOf } from '../metadata-admin/previews/AppNavCanvas';
import { registerAppComponent } from '../../services/componentRegistry';
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

// The first leaf the pillar opens is a page.
registerMetadataPreview('page', PagePreview);
registerMetadataInspector('page', PageBlockInspector);
registerMetadataDefaultInspector('page', PageDefaultInspector);

// A screen registered with the console: what a `component` entry picks from.
registerAppComponent({ ref: 'acme:board', label: 'Acme board', component: () => null });

/**
 * Walk `.unwrap()` (the spec wraps its schemas lazily) until the node carries
 * `key` (the walk plugin-designer's `NavigationDesigner.specNavTypes.test.tsx`
 * uses, objectui#10287).
 */
function unwrapUntil(node: unknown, key: string): Record<string, unknown> | undefined {
  let current = node as Record<string, unknown> | undefined;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    if (key in current) return current;
    const unwrap = current.unwrap;
    if (typeof unwrap !== 'function') return undefined;
    current = unwrap.call(current) as Record<string, unknown> | undefined;
  }
  return current && key in current ? current : undefined;
}

/** The discriminant values of the INSTALLED spec's nav-item union. Throws when unreadable. */
function specNavItemTypes(): string[] {
  const options = unwrapUntil(NavigationItemSchema, 'options')?.options;
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error('could not read NavigationItemSchema options from @objectstack/spec');
  }
  return options.flatMap((option, index) => {
    const shape = unwrapUntil(option, 'shape')?.shape as Record<string, unknown> | undefined;
    const literal = shape?.type as { values?: unknown } | undefined;
    if (!(literal?.values instanceof Set) || literal.values.size === 0) {
      throw new Error(`could not read the \`type\` literal of NavigationItemSchema option ${index}`);
    }
    return [...literal.values].map(String);
  });
}

const SPEC_NAV_ITEM_TYPES = specNavItemTypes().sort();

const key = (type: string, name: string) => `${type}/${name}`;

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.appSaves.length = 0;
  server.draftHeaders = DRAFT_HEADERS.map((d) => ({ ...d }));
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  for (const row of ROWS) {
    server.active.set(key(row.type, String(row.item.name)), { pkg: row.pkg, item: JSON.parse(JSON.stringify(row.item)) });
  }
});

afterEach(cleanup);

/** The type choices an inspector offers, by the spec type each one writes. */
function offeredTypes(scope: HTMLElement = document.body): string[] {
  return within(scope)
    .getAllByRole('radio')
    .map((r) => (r as HTMLInputElement).value)
    .sort();
}

/** The type choice that writes `type`. */
function typeChoice(type: string, scope: HTMLElement = document.body): HTMLInputElement {
  const hit = within(scope)
    .getAllByRole('radio')
    .find((r) => (r as HTMLInputElement).value === type);
  if (!hit) throw new Error(`no type choice writes \`${type}\``);
  return hit as HTMLInputElement;
}

/** Open the picker named `name` (the shared `Select` since objectui#11865) and return its listbox. */
async function openPicker(name: string, scope: HTMLElement = document.body): Promise<HTMLElement> {
  fireEvent.keyDown(within(scope).getByRole('combobox', { name }), { key: 'ArrowDown' });
  return await screen.findByRole('listbox');
}

/** Pick `value` in the picker named `name`, once the package's list has offered it. */
async function pick(name: string, value: string, scope: HTMLElement = document.body): Promise<void> {
  const listbox = await openPicker(name, scope);
  fireEvent.click(
    await within(listbox).findByRole('option', { name: new RegExp(`\\(${value}\\)|^${value}$`) }, { timeout: 8000 }),
  );
}

/**
 * The options the picker named `name` lists, once the package's list has
 * offered `loaded`, in order; the list is closed again after.
 */
async function offered(name: string, loaded: RegExp): Promise<string[]> {
  const listbox = await openPicker(name);
  await within(listbox).findByRole('option', { name: loaded }, { timeout: 8000 });
  const labels = within(listbox)
    .getAllByRole('option')
    .map((o) => o.textContent ?? '');
  fireEvent.keyDown(listbox, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  return labels;
}

// ---------------------------------------------------------------------------
// The inspector on its own: what each type writes
// ---------------------------------------------------------------------------

/** The inspector over a one-entry navigation it edits in place, as the pillar does. */
const held = { draft: {} as Record<string, unknown> };
function InspectorHost({ entry }: { entry: Record<string, unknown> }) {
  const [draft, setDraft] = React.useState<Record<string, unknown>>(() => ({ navigation: [entry] }));
  React.useEffect(() => {
    held.draft = draft;
  }, [draft]);
  return (
    <StudioNavItemInspector
      navId="navigation[0]"
      appDraft={draft}
      objects={[{ name: 'acme_task', label: 'Task' }]}
      packageId={PKG}
      onNavPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      onClear={() => undefined}
    />
  );
}
/** The entry as the editor now holds it, as a save would send it (JSON erases `undefined`). */
const entryNow = () =>
  JSON.parse(JSON.stringify((held.draft.navigation as Array<Record<string, unknown>>)[0])) as Record<string, unknown>;

/** What *Add nav item* births (`AppNavCanvas`). */
const BORN = { id: 'nav_item_3', type: 'object' };

describe('StudioNavItemInspector — the Type choice is the spec nav-item union (objectui#11790)', () => {
  it('reads a non-empty vocabulary from the installed spec', () => {
    // Non-vacuity: an empty or mis-read list would make the equality below pass on nothing.
    expect(SPEC_NAV_ITEM_TYPES).toContain('object');
    expect(SPEC_NAV_ITEM_TYPES).toContain('separator');
    expect(new Set(SPEC_NAV_ITEM_TYPES).size).toBe(SPEC_NAV_ITEM_TYPES.length);
  });

  it('offers exactly the types the spec declares, with the entry\'s own type chosen', () => {
    render(<InspectorHost entry={BORN} />);
    expect(offeredTypes()).toEqual(SPEC_NAV_ITEM_TYPES);
    expect(typeChoice('object').checked).toBe(true);
    expect(screen.getByRole('group', { name: 'Type' })).toBeInTheDocument();
  });
});

/** Each target-bearing type, the picker it shows, and the entry a pick writes. */
const TARGET_CASES: Array<{ type: string; pickIn: string; value: string; written: Record<string, unknown> }> = [
  { type: 'page', pickIn: 'Page', value: 'home', written: { pageName: 'home' } },
  { type: 'dashboard', pickIn: 'Dashboard', value: 'ops_board', written: { dashboardName: 'ops_board' } },
  { type: 'report', pickIn: 'Report', value: 'tasks_by_status', written: { reportName: 'tasks_by_status' } },
  { type: 'action', pickIn: 'Action', value: 'sync_all', written: { actionDef: { actionName: 'sync_all' } } },
  { type: 'component', pickIn: 'Component', value: 'acme:board', written: { componentRef: 'acme:board' } },
  { type: 'doc', pickIn: 'Doc page', value: 'getting_started', written: { doc: 'getting_started' } },
];

describe('StudioNavItemInspector — each target-bearing type picks a target and writes a spec-valid entry (objectui#11790)', () => {
  it.each(TARGET_CASES)('$type: picked from the package, the entry parses with NavigationItemSchema', async ({ type, pickIn, value, written }) => {
    render(<InspectorHost entry={BORN} />);
    fireEvent.click(typeChoice(type));
    // Unbound until picked: left out of a save (objectui#11776), kept here.
    expect(entryNow()).toEqual({ id: 'nav_item_3', type });
    expect(navPayloadOf([entryNow()])).toEqual([]);
    expect(screen.getByText(/left out of the saved navigation/)).toBeInTheDocument();

    await pick(pickIn, value);
    const entry = entryNow();
    expect(entry).toEqual({ id: 'nav_item_3', type, ...written });
    const parsed = NavigationItemSchema.safeParse(entry);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    expect(navPayloadOf([entry])).toEqual([entry]);
  });

  it('url: the address is typed, and the entry parses', async () => {
    render(<InspectorHost entry={BORN} />);
    fireEvent.click(typeChoice('url'));
    fireEvent.change(screen.getByRole('textbox', { name: 'URL' }), { target: { value: 'https://example.com/help' } });
    const listbox = await openPicker('Open in');
    fireEvent.click(within(listbox).getByRole('option', { name: 'New tab' }));
    const entry = entryNow();
    expect(entry).toEqual({ id: 'nav_item_3', type: 'url', url: 'https://example.com/help', target: '_blank' });
    expect(NavigationItemSchema.safeParse(entry).success).toBe(true);
  });

  it('doc: a book alone is a target too, and parses', async () => {
    render(<InspectorHost entry={BORN} />);
    fireEvent.click(typeChoice('doc'));
    await pick('Book', 'acme_manual');
    const entry = entryNow();
    expect(entry).toEqual({ id: 'nav_item_3', type: 'doc', book: 'acme_manual' });
    expect(NavigationItemSchema.safeParse(entry).success).toBe(true);
  });

  it('the pickers offer THIS package\'s items: published and draft, less record pages and object-bound actions', async () => {
    render(<InspectorHost entry={BORN} />);
    fireEvent.click(typeChoice('page'));
    // Each item is listed as `Label (name)`, or by its name alone when it has no label.
    expect(await offered('Page', /draft_page/)).toEqual(['— Choose —', 'Home (home)', 'Landing (landing)', 'draft_page']);
    expect(mockClient.list).toHaveBeenCalledWith('page', { packageId: PKG });
    expect(mockClient.listDrafts).toHaveBeenCalledWith({ packageId: PKG, type: 'page' });

    fireEvent.click(typeChoice('action'));
    expect(await offered('Action', /sync_all/)).toEqual(['— Choose —', 'Sync all (sync_all)']);
  });

  it('clearing a target unbinds the entry: the key is removed, never written as \'\', and the save leaves it out', async () => {
    render(<InspectorHost entry={{ id: 'nav_item_3', type: 'dashboard', dashboardName: 'ops_board' }} />);
    const listbox = await openPicker('Dashboard');
    await within(listbox).findByRole('option', { name: /ops_board/ }, { timeout: 8000 });
    fireEvent.click(within(listbox).getByRole('option', { name: '— Choose —' }));
    expect(entryNow()).toEqual({ id: 'nav_item_3', type: 'dashboard' });
    expect(navPayloadOf([entryNow()])).toEqual([]);
  });

  it('a change of type keeps what describes the entry and drops what it opened', () => {
    render(<InspectorHost entry={{ id: 'nav_tasks', type: 'object', objectName: 'acme_task', label: 'Tasks', icon: 'list' }} />);
    fireEvent.click(typeChoice('report'));
    expect(entryNow()).toEqual({ id: 'nav_tasks', type: 'report', label: 'Tasks', icon: 'list' });
  });

  it('separator: no target and no label — the Label field goes, and the entry parses and is sent', () => {
    render(<InspectorHost entry={{ ...BORN, label: 'Was labelled' }} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    fireEvent.click(typeChoice('separator'));
    const entry = entryNow();
    expect(entry).toEqual({ id: 'nav_item_3', type: 'separator' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(NavigationItemSchema.safeParse(entry).success).toBe(true);
    expect(navPayloadOf([entry])).toEqual([entry]);
  });

  it('group: born with no children, parses, and is sent', () => {
    render(<InspectorHost entry={BORN} />);
    fireEvent.click(typeChoice('group'));
    const entry = entryNow();
    expect(entry).toEqual({ id: 'nav_item_3', type: 'group', children: [] });
    expect(NavigationItemSchema.safeParse(entry).success).toBe(true);
    expect(navPayloadOf([entry])).toEqual([entry]);
  });

  it('an entry holding children may change only to a type that keeps them', () => {
    const child = { id: 'nav_child', type: 'object', objectName: 'acme_task' };
    render(<InspectorHost entry={{ id: 'nav_grp', type: 'group', label: 'Work', children: [child] }} />);
    const enabled = screen
      .getAllByRole('radio')
      .filter((r) => !(r as HTMLInputElement).disabled)
      .map((r) => (r as HTMLInputElement).value)
      .sort();
    expect(enabled).toEqual(['group', 'object']);
  });

  it('the control: *Link to object* binds an object entry as before', async () => {
    render(<InspectorHost entry={BORN} />);
    // The object entry's only combobox is its object picker.
    // objectui#12455 — the inspector also offers an Icon picker (a combobox), so the object picker is addressed by its test id.
    fireEvent.keyDown(screen.getByTestId('nav-link-object'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'Task (acme_task)' }));
    const entry = entryNow();
    expect(entry).toEqual({ id: 'nav_item_3', type: 'object', objectName: 'acme_task' });
    expect(NavigationItemSchema.safeParse(entry).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The pillar: Add nav item → a type → the save → the rail
// ---------------------------------------------------------------------------

function NavHost() {
  const [nonce, setNonce] = React.useState(0);
  return (
    <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
      <InterfacesPillar packageId={PKG} draftNonce={nonce} onDraftSaved={() => setNonce((n) => n + 1)} />
    </MemoryRouter>
  );
}

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

/** "Add nav item" appends an entry and selects it; the inspector opens on it. */
async function addItem(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: /Add nav item/ }));
  const inspector = screen.getByRole('complementary');
  await within(inspector).findByRole('group', { name: 'Type' });
  return inspector;
}

/** The last save the server took, once one carrying `ids` (in order) has landed. */
async function savedWith(ids: string[]): Promise<Array<Record<string, unknown>>> {
  await waitFor(
    () => {
      const last = server.appSaves[server.appSaves.length - 1];
      expect(last?.navigation.map((e) => e.id)).toEqual(ids);
      expect(last?.accepted).toBe(true);
    },
    { timeout: 8000 },
  );
  return server.appSaves[server.appSaves.length - 1].navigation;
}

describe('Interfaces nav editor — Add nav item offers every spec type (objectui#11790)', () => {
  it('"Add nav item" offers exactly the spec\'s nav item types', async () => {
    render(<NavHost />);
    await openEditing();
    const inspector = await addItem();
    expect(offeredTypes(inspector)).toEqual(SPEC_NAV_ITEM_TYPES);
    expect(typeChoice('object', inspector).checked).toBe(true);
  });

  it('a dashboard, a separator and an empty group are sent as the spec takes them; an unbound url is left out and stays on the canvas', async () => {
    render(<NavHost />);
    await openEditing();

    let inspector = await addItem(); // nav_item_3
    fireEvent.click(typeChoice('dashboard', inspector));
    await pick('Dashboard', 'ops_board', inspector);
    inspector = await addItem(); // nav_item_4
    fireEvent.click(typeChoice('separator', inspector));
    inspector = await addItem(); // nav_item_5
    fireEvent.click(typeChoice('group', inspector));
    inspector = await addItem(); // nav_item_6, left unbound
    fireEvent.click(typeChoice('url', inspector));

    const sent = await savedWith(['nav_home', 'nav_landing', 'nav_item_3', 'nav_item_4', 'nav_item_5']);
    expect(sent.slice(2)).toEqual([
      { id: 'nav_item_3', type: 'dashboard', dashboardName: 'ops_board' },
      { id: 'nav_item_4', type: 'separator' },
      { id: 'nav_item_5', type: 'group', children: [] },
    ]);
    // Every save the editor made was one the spec took.
    expect(server.appSaves.every((s) => s.accepted)).toBe(true);
    // The unbound url entry is on the canvas, not on the server. objectui#11862 —
    // its card reads the positional wording by its place, never its minted id.
    expect(rail().textContent).toContain('Item 6');
    expect(rail().textContent).not.toContain('nav_item_6');
  });

  it('the rail shows the new entries once editing is done', async () => {
    render(<NavHost />);
    await openEditing();
    let inspector = await addItem(); // nav_item_3
    fireEvent.click(typeChoice('dashboard', inspector));
    await pick('Dashboard', 'ops_board', inspector);
    inspector = await addItem(); // nav_item_4
    fireEvent.click(typeChoice('group', inspector));
    await savedWith(['nav_home', 'nav_landing', 'nav_item_3', 'nav_item_4']);

    fireEvent.click(within(rail()).getByRole('button', { name: /Done/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Add nav item/ })).toBeNull(), { timeout: 8000 });
    // The dashboard entry opens its surface from the rail; the group heads a section.
    const dashboardRow = within(rail()).getByRole('button', { name: /ops_board/ });
    expect(dashboardRow).toBeEnabled();
    expect(within(rail()).getByText('nav_item_4')).toBeInTheDocument();
  });
});
