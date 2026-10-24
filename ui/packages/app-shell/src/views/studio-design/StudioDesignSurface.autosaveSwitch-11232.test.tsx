// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11232 — a switch to another item inside the draft autosave's
 * debounce never writes the previous item's buffer into the newly opened one.
 *
 * `useDraftAutoSave`'s timer was keyed on the dirty flag, the blocked flag and
 * the buffer's snapshot only. A switch to another flow or page changed none
 * of them, and the save the timer called was read through a ref that already
 * addressed the newly opened item, while the buffer still held the previous
 * item's document until the new load landed. With a load slower than what was
 * left of the debounce, the timer sent the previous item's whole document as
 * the new item's draft. Measured on the Automations pillar (flow
 * `notify_owner` into `nightly_digest`) and the Interfaces page inspector
 * (page `home` into `landing`).
 *
 * The hook now binds a dirty period to the item that was open when it began.
 * After a switch it sends nothing until the caller's dirty flag has fallen
 * (the new item's load installs its own buffer and clears it), and a save's
 * claim on its buffer reads moved once the item has changed. The previous
 * item's pending edit is dropped, which is what the Data pillar's switch has
 * always done, and what every pillar did whenever the new load landed inside
 * the debounce. The Data pillar is the control.
 *
 * objectui#11203 (folded in): a package switch keeps the Interfaces pillar
 * mounted, so the nav editor's dirty flag and open editing survived into the
 * next package; its load installed that package's app over the buffer and the
 * autosave sent it, unedited, as a draft. The pillar is now keyed by package:
 * a confirmed discard drops the edit and every piece of editor state with it.
 *
 * The canvases and inspectors are the REAL registered `FlowPreview` /
 * `FlowInspector` and `PagePreview` / `PageBlockInspector` /
 * `PageDefaultInspector`. The client is a server double that records every
 * save and can hold an item's load (a slow load).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PKG = 'com.acme.app';
const PKG_B = 'com.beta.app';

const nodes = (start: string) => [
  { id: 'start', type: 'start', label: start },
  { id: 'end', type: 'end', label: 'End' },
];
const NOTIFY = {
  name: 'notify_owner',
  label: 'Notify owner',
  type: 'autolaunched',
  status: 'active',
  nodes: nodes('Start'),
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
};
const DIGEST = {
  name: 'nightly_digest',
  label: 'Nightly digest',
  type: 'autolaunched',
  status: 'active',
  nodes: nodes('Begin'),
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

const TASK = {
  name: 'acme_task',
  label: 'Task',
  fields: [
    { name: 'title', label: 'Title', type: 'text' },
    { name: 'status', label: 'Status', type: 'text' },
  ],
};
const NOTE = { name: 'acme_note', label: 'Note', fields: [{ name: 'body', label: 'Body', type: 'text' }] };

const APP = {
  name: 'acme_app',
  label: 'Acme',
  navigation: [
    { id: 'nav_home', type: 'page', label: 'Home menu', pageName: 'home' },
    { id: 'nav_landing', type: 'page', label: 'Landing menu', pageName: 'landing' },
  ],
};
const BETA_APP = {
  name: 'beta_app',
  label: 'Beta',
  navigation: [{ id: 'nav_board', type: 'page', label: 'Board menu', pageName: 'board' }],
};
/** A block page: the first leaf the pillar opens, its page form in the rail. */
const HOME = {
  name: 'home',
  label: 'Home',
  type: 'app',
  regions: [{ name: 'main', components: [{ id: 'hello', type: 'element:text', properties: { content: 'Hello' } }] }],
};
const LANDING = { name: 'landing', label: 'Landing', type: 'app', regions: [{ name: 'main', components: [] }] };
const BOARD = { name: 'board', label: 'Board', type: 'app', regions: [{ name: 'main', components: [] }] };

const server = vi.hoisted(() => ({
  /** `type/name` → the row as published, and the package that owns it. */
  active: new Map<string, { pkg: string; row: Record<string, unknown> }>(),
  drafts: new Map<string, Record<string, unknown>>(),
  /** Every save, as the server received it. */
  saves: [] as Array<{ type: string; name: string; packageId: unknown; body: Record<string, unknown> }>,
  /** `type/name` → while set, that item's load waits on it (a slow load). */
  loadHold: new Map<string, Promise<void>>(),
  /** While set, the next save waits on it (a save held in flight). */
  saveHold: null as Promise<void> | null,
}));

// A server double: a save lands as the item's draft, and a later load serves it.
const mockClient = vi.hoisted(() => {
  const k = (type: string, name: string) => `${type}/${name}`;
  return {
    list: vi.fn(async (type: string, opts?: { packageId?: string }) =>
      [...server.active.entries()]
        .filter(([key, { pkg }]) => key.startsWith(`${type}/`) && (!opts?.packageId || pkg === opts.packageId))
        .map(([, { row }]) => ({ name: row.name, label: row.label ?? row.name })),
    ),
    listDrafts: vi.fn(async () => []),
    listTypes: vi.fn(async () => ({ entries: [] })),
    get: vi.fn(async () => null),
    withPreviewDrafts: vi.fn((): unknown => mockClient),
    references: vi.fn(async () => []),
    layered: vi.fn(async (type: string, name: string) => {
      const hold = server.loadHold.get(k(type, name));
      if (hold) await hold;
      const eff = server.active.get(k(type, name))?.row ?? null;
      return { code: null, overlay: eff, overlayScope: eff ? 'env' : null, effective: eff, editable: true, deletable: true, resettable: false, lock: 'none' };
    }),
    getDraft: vi.fn(async (type: string, name: string) => {
      const draft = server.drafts.get(k(type, name));
      if (draft) return { item: JSON.parse(JSON.stringify(draft)) as Record<string, unknown> };
      throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
    }),
    save: vi.fn(async (type: string, name: string, item: unknown, opts?: { packageId?: string }) => {
      const body = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
      server.saves.push({ type, name, packageId: opts?.packageId, body });
      const hold = server.saveHold;
      server.saveHold = null;
      if (hold) await hold;
      server.drafts.set(k(type, name), body);
      return { type, name, item };
    }),
    publish: vi.fn(async () => ({ success: true })),
    reset: vi.fn(async () => ({})),
  };
});

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ loading: false, error: null, entries: [] }) };
});

// The package list is the surface's write-state probe and the switcher's list:
// both packages are writable.
vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return {
    ...mod,
    fetchPackages: vi.fn(async () => [
      { id: 'com.acme.app', name: 'Acme', writable: true, namespace: 'acme' },
      { id: 'com.beta.app', name: 'Beta', writable: true, namespace: 'beta' },
    ]),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

// The Data pillar's records grid is not what this suite reads.
// The records grid: only its "+" column, drawn from the grid's authoring
// context the way the real grid draws it (objectui#12511).
vi.mock('@object-ui/plugin-view', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  const { useGridFieldAuthoring } = await import('@object-ui/components');
  function GridDouble() {
    const authoring = useGridFieldAuthoring();
    return authoring?.onAddColumn ? (
      <button type="button" data-testid="grid-add-column" onClick={authoring.onAddColumn}>
        Add column
      </button>
    ) : null;
  }
  return { ...mod, ObjectView: GridDouble };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));

// Rail siblings / docks the whole-surface cases do not read.
vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { AutomationsPillar, DataPillar, InterfacesPillar, StudioDesignSurface } from './StudioDesignSurface';
import { ADD_FIELD_OFFERED, addFieldFromGrid } from './__tests__/dataPillarAddField';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { registerMetadataDefaultInspector } from '../metadata-admin/default-inspector-registry';
import { FlowPreview } from '../metadata-admin/previews/FlowPreview';
import { FlowInspector } from '../metadata-admin/inspectors/FlowInspector';
import { PagePreview } from '../metadata-admin/previews/PagePreview';
import { PageBlockInspector } from '../metadata-admin/inspectors/PageBlockInspector';
import { PageDefaultInspector } from '../metadata-admin/inspectors/PageDefaultInspector';
import { readFields } from '../metadata-admin/previews/object-fields-io';

const dataSource = createEmptyDataSource();

registerMetadataPreview('flow', FlowPreview);
registerMetadataInspector('flow', FlowInspector);
registerMetadataPreview('page', PagePreview);
registerMetadataInspector('page', PageBlockInspector);
registerMetadataDefaultInspector('page', PageDefaultInspector);

// The surface's viewport hooks and Radix's floating-ui measurement need these.
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

const key = (type: string, name: string) => `${type}/${name}`;

// This environment ships no window.confirm: the surface's discard prompt.
let confirmSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.saves.length = 0;
  server.loadHold.clear();
  server.saveHold = null;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  const seed = (pkg: string, type: string, row: Record<string, unknown>) =>
    server.active.set(key(type, String(row.name)), { pkg, row: JSON.parse(JSON.stringify(row)) });
  seed(PKG, 'flow', NOTIFY);
  seed(PKG, 'flow', DIGEST);
  seed(PKG, 'object', TASK);
  seed(PKG, 'object', NOTE);
  seed(PKG, 'app', APP);
  seed(PKG, 'page', HOME);
  seed(PKG, 'page', LANDING);
  seed(PKG_B, 'app', BETA_APP);
  seed(PKG_B, 'page', BOARD);
  confirmSpy = vi.fn();
  window.confirm = confirmSpy as unknown as typeof window.confirm;
  // The Automations pillar's `/automation/_status` probe, the flow inspector's
  // action catalog and the surface's pending-drafts counter all read the
  // global `fetch`; one double answers "absent" so each keeps its fallback.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Holds an item's load until the returned release is called. */
function holdLoad(type: string, name: string): () => Promise<void> {
  let release!: () => void;
  server.loadHold.set(key(type, name), new Promise<void>((r) => (release = r)));
  return async () => {
    await act(async () => {
      release();
      server.loadHold.delete(key(type, name));
      await new Promise((r) => setTimeout(r, 0));
    });
  };
}

/** Holds the next save in flight until the returned release is called. */
function holdNextSave(): () => Promise<void> {
  let release!: () => void;
  server.saveHold = new Promise<void>((r) => (release = r));
  return async () => {
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 0));
    });
  };
}

/** Waits past the autosave's debounce: what was sent by then is what will be. */
async function pastDebounce(ms = 2500): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function savesOf(type: string, name: string): Array<Record<string, unknown>> {
  return server.saves.filter((s) => s.type === type && s.name === name).map((s) => s.body);
}

function editText(el: HTMLElement, value: string): void {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
}

const SLOW = { timeout: 8000 };

describe('Automations pillar — a flow switch inside the debounce (objectui#11232)', () => {
  function startLabel(body: Record<string, unknown>): string {
    return String((body.nodes as Array<{ id: string; label?: string }>).find((n) => n.id === 'start')?.label);
  }
  async function openStartNode(): Promise<HTMLElement> {
    fireEvent.click(document.querySelector('[data-node-id="start"] [role="button"]') as HTMLElement);
    return within(screen.getByRole('complementary')).findByLabelText('Label', undefined, SLOW);
  }

  it('sends nothing to the newly opened flow; the edit after its load saves to it', async () => {
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
        <AutomationsPillar packageId={PKG} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.querySelector('[data-node-id="start"]')).toHaveTextContent('Start'), SLOW);

    editText(await openStartNode(), 'Kick-off');
    const release = holdLoad('flow', 'nightly_digest');
    fireEvent.click(screen.getByRole('button', { name: /Nightly digest/ }));
    await pastDebounce();

    // Nothing is written to the flow the author only opened, and the previous
    // flow's pending edit is dropped with the switch, as the Data pillar's is.
    expect(savesOf('flow', 'nightly_digest')).toEqual([]);
    expect(server.saves).toEqual([]);

    await release();
    await waitFor(() => expect(document.querySelector('[data-node-id="start"]')).toHaveTextContent('Begin'), SLOW);
    await pastDebounce(1800);
    expect(server.saves).toEqual([]);

    // The control: an edit after the switch saves normally, to its own flow.
    editText(await openStartNode(), 'Go');
    await waitFor(() => expect(server.saves).toHaveLength(1), SLOW);
    expect(savesOf('flow', 'nightly_digest').map((b) => [b.label, startLabel(b)])).toEqual([['Nightly digest', 'Go']]);
  }, 30000);
});

describe('Interfaces page inspector — a page switch inside the debounce (objectui#11232)', () => {
  const pageLabel = () => within(screen.getByRole('complementary')).findByLabelText(/^Label/, undefined, SLOW);

  it('sends nothing to the newly opened page; the edit after its load saves to it', async () => {
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
        <InterfacesPillar packageId={PKG} />
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: 'Select hello' }, SLOW);

    editText(await pageLabel(), 'Welcome');
    const release = holdLoad('page', 'landing');
    fireEvent.click(screen.getByRole('button', { name: /Landing menu/ }));
    await pastDebounce();

    expect(savesOf('page', 'landing')).toEqual([]);
    expect(server.saves).toEqual([]);

    await release();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Select hello' })).toBeNull(), SLOW);
    await waitFor(async () => expect(await pageLabel()).toHaveValue('Landing'), SLOW);
    await pastDebounce(1800);
    expect(server.saves).toEqual([]);

    // The control: an edit after the switch saves normally, to its own page.
    editText(await pageLabel(), 'Landing two');
    await waitFor(() => expect(server.saves).toHaveLength(1), SLOW);
    expect(savesOf('page', 'landing').map((b) => [b.label, b.regions])).toEqual([['Landing two', LANDING.regions]]);
  }, 30000);
});

describe('Interfaces page inspector — a save in flight across a page switch (objectui#11232)', () => {
  const pageLabel = () => within(screen.getByRole('complementary')).findByLabelText(/^Label/, undefined, SLOW);

  it("the save lands on its own page, and its claim does not clear the page opened since", async () => {
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
        <InterfacesPillar packageId={PKG} />
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: 'Select hello' }, SLOW);

    const releaseSave = holdNextSave();
    editText(await pageLabel(), 'Welcome');
    await screen.findByTestId('if-autosaving', undefined, SLOW);
    const releaseLoad = holdLoad('page', 'landing');
    fireEvent.click(screen.getByRole('button', { name: /Landing menu/ }));
    // The save of `home` lands while `landing` is still loading.
    await releaseSave();
    // The buffer still holds `home`'s document; an edit typed there is not
    // `landing`'s, and it is not sent there. objectui#11272: the rail offers
    // no editor over it under `landing`, so the edit goes to whatever it does
    // offer, and nothing is.
    const offered = within(screen.getByRole('complementary')).queryByLabelText(/^Label/);
    if (offered) editText(offered, 'Typed during load');
    await pastDebounce();
    expect(server.saves.map((s) => [s.type, s.name, s.body.label])).toEqual([['page', 'home', 'Welcome']]);

    await releaseLoad();
    await waitFor(async () => expect(await pageLabel()).toHaveValue('Landing'), SLOW);
    await pastDebounce(1800);
    expect(server.saves.map((s) => [s.type, s.name, s.body.label])).toEqual([['page', 'home', 'Welcome']]);
    expect(offered).toBeNull();
  }, 30000);
});

describe('Data pillar — an object switch inside the debounce, the control (objectui#11232)', () => {
  it('sends nothing to the newly opened object, as it always has', async () => {
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/data`]}>
        <DataPillar packageId={PKG} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/^\d+ fields$/)).toHaveTextContent('2 fields'), SLOW);

    await addFieldFromGrid();
    const release = holdLoad('object', 'acme_note');
    fireEvent.click(screen.getByRole('button', { name: /Note/ }));
    await pastDebounce();

    expect(savesOf('object', 'acme_note')).toEqual([]);
    expect(server.saves).toEqual([]);

    await release();
    await waitFor(() => expect(screen.getByText(/^\d+ fields$/)).toHaveTextContent('1 fields'), SLOW);
    await pastDebounce(1800);
    expect(server.saves).toEqual([]);
    // The control's own control: an edit on the opened object saves to it.
    await addFieldFromGrid();
    await waitFor(() => expect(server.saves).toHaveLength(1), SLOW);
    expect(savesOf('object', 'acme_note').map((b) => readFields(b.fields).entries.map((e) => e.name))).toEqual([
      ['body', 'new_field'],
    ]);
  }, 30000);
});

describe('Studio surface — a package switch over an unsaved nav edit (objectui#11203, folded in)', () => {
  function surfaceTree() {
    return (
      <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
        <Routes>
          <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
        </Routes>
      </MemoryRouter>
    );
  }
  // objectui#11776: a save sends an entry only once it names a target, so each
  // Add here is bound to an object of its package in its inspector, and the
  // rail shows the label-less entry by that object's name.
  const addedItems = () => screen.queryAllByRole('button', { name: new RegExp(`${TASK.name}|${BETA_ITEM.name}`) }).length;
  const navEditingOpen = () => screen.queryAllByRole('button', { name: /Add nav item/ }).length > 0;
  async function openEditing(): Promise<void> {
    fireEvent.click(screen.getByTitle(/^Edit navigation/));
    await screen.findByRole('button', { name: /Add nav item/ }, SLOW);
  }
  const addItem = async (objectName: string = TASK.name) => {
    fireEvent.click(screen.getByRole('button', { name: /Add nav item/ }));
    // *Link object* is the shared `Select` since objectui#11865: open its list and pick.
    fireEvent.keyDown(screen.getByTestId('nav-link-object'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: new RegExp(`\\(${objectName}\\)$`) }));
  };
  async function switchTo(name: RegExp, confirmed: boolean): Promise<void> {
    fireEvent.click(await screen.findByTestId('studio-pkg-chip', undefined, SLOW));
    confirmSpy.mockReturnValueOnce(confirmed);
    fireEvent.click(await screen.findByRole('button', { name }, SLOW));
  }
  const savedNav = (body: Record<string, unknown>) =>
    (body.navigation as Array<Record<string, unknown>>).map((n) =>
      Object.prototype.hasOwnProperty.call(n, 'label') ? String(n.label) : { id: n.id },
    );

  it('a confirmed discard sends nothing to the new package; an edit after the switch saves normally', async () => {
    // Package B's object, for the edit made there after the switch.
    seedPackageB();
    render(surfaceTree());
    await screen.findByRole('button', { name: /Landing menu/ }, SLOW);
    await openEditing();
    await addItem();
    expect(addedItems()).toBe(1);

    await switchTo(/Beta/, true);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    await screen.findByRole('button', { name: /Board menu/ }, SLOW);
    await pastDebounce(3500);

    expect(server.saves.filter((s) => s.type === 'app')).toEqual([]);
    // The discarded edit went with the package: editing is closed and nothing is held.
    expect(navEditingOpen()).toBe(false);
    expect(addedItems()).toBe(0);

    // The control: an edit made after the switch saves normally, to the new package's app.
    await openEditing();
    await addItem(BETA_ITEM.name);
    await waitFor(() => expect(server.saves.filter((s) => s.type === 'app')).toHaveLength(1), SLOW);
    expect(server.saves.map((s) => [s.type, s.name, s.packageId])).toEqual([['app', 'beta_app', PKG_B]]);
    expect(savedNav(server.saves[0].body)).toEqual(['Board menu', { id: 'nav_item_2' }]);
  }, 30000);

  it("a confirmed discard with the new package's app slow to load sends nothing either", async () => {
    render(surfaceTree());
    await screen.findByRole('button', { name: /Landing menu/ }, SLOW);
    await openEditing();
    await addItem();

    const release = holdLoad('app', 'beta_app');
    await switchTo(/Beta/, true);
    await pastDebounce();
    expect(server.saves).toEqual([]);

    await release();
    await screen.findByRole('button', { name: /Board menu/ }, SLOW);
    await pastDebounce(3500);
    expect(server.saves).toEqual([]);
  }, 30000);

  it("the page inspector: a package switch opens the new package's page, and an edit saves to it", async () => {
    render(surfaceTree());
    await screen.findByRole('button', { name: 'Select hello' }, SLOW);

    // No nav edit, so no prompt: page edits are not what the guard holds.
    await switchTo(/Beta/, true);
    expect(confirmSpy).not.toHaveBeenCalled();
    await screen.findByRole('button', { name: /Board menu/ }, SLOW);
    // The previous package's page does not stay open on the new package.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Select hello' })).toBeNull(), SLOW);

    // objectui#12725 — the page's properties are in the right slot, which shows
    // them with no copilot served (this tree mocks it away): no tab to open.
    const label = await within(screen.getByTestId('studio-slot-props')).findByLabelText(/^Label/, undefined, SLOW);
    expect(label).toHaveValue('Board');
    editText(label, 'Board two');
    await waitFor(() => expect(server.saves).toHaveLength(1), SLOW);
    expect(server.saves.map((s) => [s.type, s.name, s.packageId, s.body.label])).toEqual([
      ['page', 'board', PKG_B, 'Board two'],
    ]);
  }, 30000);

  it('a cancelled discard keeps package A and its edit, which then saves to A', async () => {
    render(surfaceTree());
    await screen.findByRole('button', { name: /Landing menu/ }, SLOW);
    await openEditing();
    await addItem();

    await switchTo(/Beta/, false);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('studio-pkg-chip')).toHaveTextContent('Acme');
    expect(addedItems()).toBe(1);

    await waitFor(() => expect(server.saves).toHaveLength(1), SLOW);
    expect(server.saves.map((s) => [s.type, s.name, s.packageId])).toEqual([['app', 'acme_app', PKG]]);
    expect(savedNav(server.saves[0].body)).toEqual(['Home menu', 'Landing menu', { id: 'nav_item_3' }]);
  }, 30000);
});

// ---------------------------------------------------------------------------
// objectui#11272 — a pillar never accepts an edit or a save on a buffer that is
// not the open item's. One rule, three members: the load window on all three
// pillars; Automations and Data across a package switch; and the page
// inspector's non-editable round trip. Each sequence below is the card's, and
// each gives zero saves of the wrong document; each ends on the control, an
// edit after the load that saves once, to its own item.
// ---------------------------------------------------------------------------

/** Package B's own flow and object, for the package-switch member. */
const BETA_SYNC = {
  name: 'beta_sync',
  label: 'Beta sync',
  type: 'autolaunched',
  status: 'active',
  nodes: nodes('Sync'),
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
};
const BETA_ITEM = { name: 'beta_item', label: 'Beta item', fields: [{ name: 'name', label: 'Name', type: 'text' }] };
function seedPackageB(): void {
  server.active.set(key('flow', BETA_SYNC.name), { pkg: PKG_B, row: JSON.parse(JSON.stringify(BETA_SYNC)) });
  server.active.set(key('object', BETA_ITEM.name), { pkg: PKG_B, row: JSON.parse(JSON.stringify(BETA_ITEM)) });
}

const savesRead = () => server.saves.map((s) => [s.type, s.name, s.packageId, s.body]);
const fieldNamesOf = (body: Record<string, unknown>) => readFields(body.fields).entries.map((e) => e.name);
const startLabelOf = (body: Record<string, unknown>) =>
  String((body.nodes as Array<{ id: string; label?: string }>).find((n) => n.id === 'start')?.label);

describe("the load window: nothing of the previous item is offered, shown or saved under the next one (objectui#11272)", () => {
  // Whatever a pillar still offers while the next item's load is held, the
  // author can use. So each sequence USES it when it is there, and records
  // what was shown: every save reading is taken first, and what was shown is
  // asserted last.

  it('Interfaces page inspector: the page form typed into during the load sends nothing; the edit after the load saves once', async () => {
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
        <InterfacesPillar packageId={PKG} />
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: 'Select hello' }, SLOW);
    const rail = () => within(screen.getByRole('complementary'));
    await waitFor(() => expect(rail().getByLabelText(/^Label/)).toHaveValue('Home'), SLOW);

    const release = holdLoad('page', 'landing');
    fireEvent.click(screen.getByRole('button', { name: /Landing menu/ }));
    const offered = rail().queryByLabelText(/^Label/);
    if (offered) editText(offered, 'Typed during load');
    await pastDebounce();
    expect(savesRead()).toEqual([]);
    const shownDuringLoad = {
      pageForm: rail().queryByLabelText(/^Label/) !== null,
      homeBlock: screen.queryByRole('button', { name: 'Select hello' }) !== null,
    };

    await release();
    await waitFor(() => expect(rail().getByLabelText(/^Label/)).toHaveValue('Landing'), SLOW);
    await pastDebounce(1800);
    expect(server.saves).toEqual([]);

    // The control: an edit after the load saves once, to its own page.
    editText(rail().getByLabelText(/^Label/), 'Landing two');
    await waitFor(() => expect(server.saves).toHaveLength(1), SLOW);
    expect(server.saves.map((s) => [s.type, s.name, s.body.label, s.body.regions])).toEqual([
      ['page', 'landing', 'Landing two', LANDING.regions],
    ]);
    // Nothing of `home` was shown under `landing` until its own document was in.
    expect(shownDuringLoad).toEqual({ pageForm: false, homeBlock: false });
  }, 30000);

  it("Automations: the enable switch flipped during the load saves nothing; after the load it saves the flow's own document once", async () => {
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
        <AutomationsPillar packageId={PKG} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.querySelector('[data-node-id="start"]')).toHaveTextContent('Start'), SLOW);

    const release = holdLoad('flow', 'nightly_digest');
    fireEvent.click(screen.getByRole('button', { name: /Nightly digest/ }));
    const offered = screen.queryByRole('switch');
    if (offered && !offered.hasAttribute('disabled')) fireEvent.click(offered);
    await pastDebounce();
    expect(savesRead()).toEqual([]);
    const shownDuringLoad = { enableSwitch: screen.queryByRole('switch') !== null };

    await release();
    await waitFor(() => expect(document.querySelector('[data-node-id="start"]')).toHaveTextContent('Begin'), SLOW);
    await pastDebounce(1800);
    expect(server.saves).toEqual([]);

    // The control: the switch after the load saves once, the flow's own document.
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(server.saves).toHaveLength(1), SLOW);
    expect(server.saves.map((s) => [s.type, s.name, s.body.label, startLabelOf(s.body), s.body.status])).toEqual([
      ['flow', 'nightly_digest', 'Nightly digest', 'Begin', 'obsolete'],
    ]);
    // The switch reads the open flow's status: it was not offered on another's.
    expect(shownDuringLoad).toEqual({ enableSwitch: false });
  }, 30000);

  it('Data: a field added during the load saves nothing; one added after the load saves once, to the object opened', async () => {
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/data`]}>
        <DataPillar packageId={PKG} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/^\d+ fields$/)).toHaveTextContent('2 fields'), SLOW);

    const release = holdLoad('object', 'acme_note');
    fireEvent.click(screen.getByRole('button', { name: /Note/ }));
    // objectui#12511 — Add field on the Records tab is the grid's "+" column,
    // drawn exactly when it is offered.
    if (screen.queryByTestId(ADD_FIELD_OFFERED)) await addFieldFromGrid();
    await pastDebounce();
    expect(savesRead()).toEqual([]);
    const shownDuringLoad = {
      fieldCount: screen.queryByText(/^\d+ fields$/) !== null,
      addField: screen.queryByTestId(ADD_FIELD_OFFERED) !== null,
    };

    await release();
    await waitFor(() => expect(screen.getByText(/^\d+ fields$/)).toHaveTextContent('1 fields'), SLOW);
    await pastDebounce(1800);
    expect(server.saves).toEqual([]);

    // The control: a field added after the load saves once, to its own object.
    await addFieldFromGrid();
    await waitFor(() => expect(server.saves).toHaveLength(1), SLOW);
    expect(server.saves.map((s) => [s.type, s.name, s.body.label, fieldNamesOf(s.body)])).toEqual([
      ['object', 'acme_note', 'Note', ['body', 'new_field']],
    ]);
    // No field count or add-field of `acme_task` was shown under `acme_note`.
    expect(shownDuringLoad).toEqual({ fieldCount: false, addField: false });
  }, 30000);
});

describe('a package switch: Automations and Data open nothing of the previous package (objectui#11272)', () => {
  // Through the real surface and its `PackageSwitcher`: the route keeps the
  // surface mounted across `:packageId`, as the console's does.
  function surfaceTree(tab: string) {
    return (
      <MemoryRouter initialEntries={[`/studio/${PKG}/${tab}`]}>
        <Routes>
          <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
        </Routes>
      </MemoryRouter>
    );
  }
  async function switchToBeta(): Promise<void> {
    fireEvent.click(await screen.findByTestId('studio-pkg-chip', undefined, SLOW));
    confirmSpy.mockReturnValue(true);
    fireEvent.click(await screen.findByRole('button', { name: /Beta/ }, SLOW));
    await waitFor(() => expect(screen.getByTestId('studio-pkg-chip')).toHaveTextContent('Beta'), SLOW);
  }

  it("Automations: package A's open flow is not kept; an edit saves package B's own flow, in B", async () => {
    seedPackageB();
    render(surfaceTree('automations'));
    await waitFor(() => expect(document.querySelector('[data-node-id="start"]')).toHaveTextContent('Start'), SLOW);

    await switchToBeta();
    await screen.findByRole('button', { name: /Beta sync/ }, SLOW);
    // Whatever flow the canvas holds on package B takes the edit.
    await waitFor(() => expect(document.querySelector('[data-node-id="start"]')).not.toBeNull(), SLOW);
    fireEvent.click(document.querySelector('[data-node-id="start"] [role="button"]') as HTMLElement);
    // objectui#12725 — the Configuration aside now sits inside the surface's
    // right slot, itself an `aside`: two complementary landmarks, so the
    // Configuration is found by its own test id.
    editText(await within(screen.getByTestId('auto-config-aside')).findByLabelText('Label', undefined, SLOW), 'Kick-off');
    await waitFor(() => expect(server.saves).toHaveLength(1), SLOW);
    expect(server.saves.map((s) => [s.type, s.name, s.packageId, s.body.label, startLabelOf(s.body)])).toEqual([
      ['flow', 'beta_sync', PKG_B, 'Beta sync', 'Kick-off'],
    ]);
  }, 30000);

  it("Data: package A's open object is not kept; a field added saves package B's own object, in B", async () => {
    seedPackageB();
    render(surfaceTree('data'));
    await waitFor(() => expect(screen.getByText(/^\d+ fields$/)).toHaveTextContent('2 fields'), SLOW);

    await switchToBeta();
    await screen.findByRole('button', { name: /Beta item/ }, SLOW);
    await waitFor(() => expect(screen.getByText(/^\d+ fields$/)).toBeInTheDocument(), SLOW);
    await addFieldFromGrid();
    await waitFor(() => expect(server.saves).toHaveLength(1), SLOW);
    expect(server.saves.map((s) => [s.type, s.name, s.packageId, s.body.label, fieldNamesOf(s.body)])).toEqual([
      ['object', 'beta_item', PKG_B, 'Beta item', ['name', 'new_field']],
    ]);
  }, 30000);
});

describe("the page inspector's non-editable round trip (objectui#11272)", () => {
  it("an edit, a studio-canvas leaf, then the same page again with its reload held: no '{}' is sent as the page's draft", async () => {
    server.active.set(key('app', APP.name), {
      pkg: PKG,
      row: {
        ...APP,
        navigation: [...APP.navigation, { id: 'nav_tasks', type: 'object', label: 'Tasks menu', objectName: 'acme_task' }],
      },
    });
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
        <InterfacesPillar packageId={PKG} />
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: 'Select hello' }, SLOW);
    const rail = () => within(screen.getByRole('complementary'));

    // Inside the debounce: edit `home`, open the object leaf, reopen `home`.
    editText(await rail().findByLabelText(/^Label/, undefined, SLOW), 'Welcome');
    fireEvent.click(screen.getByRole('button', { name: /Tasks menu/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Select hello' })).toBeNull(), SLOW);
    const release = holdLoad('page', 'home');
    fireEvent.click(screen.getByRole('button', { name: /Home menu/ }));
    await pastDebounce();
    expect(savesRead()).toEqual([]);

    await release();
    await screen.findByRole('button', { name: 'Select hello' }, SLOW);
    await pastDebounce(1800);
    expect(server.saves).toEqual([]);

    // The control: an edit after the reload saves once, `home`'s own document.
    editText(rail().getByLabelText(/^Label/), 'Home two');
    await waitFor(() => expect(server.saves).toHaveLength(1), SLOW);
    expect(server.saves.map((s) => [s.type, s.name, s.body.label, s.body.regions])).toEqual([
      ['page', 'home', 'Home two', HOME.regions],
    ]);
  }, 30000);
});
