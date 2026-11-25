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
 * item's pending edit is dropped by the hook, which is what every pillar did
 * whenever the new load landed inside the debounce. The Data pillar is the
 * control: it saves with the top bar's Save (objectstack#36511), so its rail
 * asks before a switch drops an unsaved edit, and nothing of it reaches either
 * object.
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
// The surface's reach loads `@objectstack/lint` lazily; pay that load during
// collection, not inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Module scope as well as in the `vi.mock` factory below: the cold transform is paid
// during collection, which no test or hook timeout clocks (AGENTS.md, flaky-test discipline).
import '@object-ui/components';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

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

import { DataPillar, StudioDesignSurface } from './StudioDesignSurface';
import { StudioSaveHarness, pressStudioSave } from './__tests__/studioSaveHarness';
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
import { confirmUnsavedLeave } from '../../chrome/unsavedEdits';

/**
 * A door to another package that leaves the surface mounted, asking first
 * when a pillar holds unsaved work: the shell seam's question, the one the
 * contributed rows' doors ask (`useOpenContributor`). The package switcher
 * was these tests' door until objectstack#36501 removed it.
 */
function PackageDoor({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      aria-label="test door: other package"
      data-testid="package-door"
      onClick={() => confirmUnsavedLeave(() => navigate(to))}
    />
  );
}

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

// objectstack#36903 — the flow designer holds one flow, named by its address:
// another flow is another address, and the area mounts a new designer keyed by
// the flow's name (`StudioMetadataArea`'s `AreaItem`), so no buffer of one flow
// can reach the next. The Automations rail's in-place switch these pins
// covered is gone with the rail; the Data pillar's control stays.

describe('Data pillar — an object switch over an unsaved edit, the control (objectui#11232)', () => {
  it('sends nothing to either object; an edit on the opened object goes to it on Save (objectstack#36511)', async () => {
    render(
      <StudioSaveHarness>
        <MemoryRouter initialEntries={[`/studio/${PKG}/data`]}>
          <DataPillar packageId={PKG} />
        </MemoryRouter>
      </StudioSaveHarness>,
    );
    await waitFor(() => expect(screen.getByText(/^\d+ fields?( \(\+\d+ system\))?$/)).toHaveTextContent('2 fields'), SLOW);

    await addFieldFromGrid();
    const release = holdLoad('object', 'acme_note');
    // The edit is unsaved: the switch asks, and the author drops it.
    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /Note/ }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    await release();
    await waitFor(() => expect(screen.getByText(/^\d+ fields?( \(\+\d+ system\))?$/)).toHaveTextContent('1 field'), SLOW);
    await pastDebounce(1800);
    expect(server.saves).toEqual([]);
    // The control's own control: an edit on the opened object saves to it.
    await addFieldFromGrid();
    await pressStudioSave();
    expect(savesOf('object', 'acme_note').map((b) => readFields(b.fields).entries.map((e) => e.name))).toEqual([
      ['body', 'new_field'],
    ]);
    expect(savesOf('object', 'acme_task')).toEqual([]);
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

  it('Data: a field added during the load saves nothing; one added after the load saves once, to the object opened', async () => {
    render(
      <StudioSaveHarness>
        <MemoryRouter initialEntries={[`/studio/${PKG}/data`]}>
          <DataPillar packageId={PKG} />
        </MemoryRouter>
      </StudioSaveHarness>,
    );
    await waitFor(() => expect(screen.getByText(/^\d+ fields?( \(\+\d+ system\))?$/)).toHaveTextContent('2 fields'), SLOW);

    const release = holdLoad('object', 'acme_note');
    fireEvent.click(screen.getByRole('button', { name: /Note/ }));
    // objectui#12511 — Add field on the Records tab is the grid's "+" column,
    // drawn exactly when it is offered.
    if (screen.queryByTestId(ADD_FIELD_OFFERED)) await addFieldFromGrid();
    await pastDebounce();
    expect(savesRead()).toEqual([]);
    const shownDuringLoad = {
      fieldCount: screen.queryByText(/^\d+ fields?( \(\+\d+ system\))?$/) !== null,
      addField: screen.queryByTestId(ADD_FIELD_OFFERED) !== null,
    };

    await release();
    await waitFor(() => expect(screen.getByText(/^\d+ fields?( \(\+\d+ system\))?$/)).toHaveTextContent('1 field'), SLOW);
    await pastDebounce(1800);
    expect(server.saves).toEqual([]);

    // The control: a field added after the load saves once, to its own object.
    await addFieldFromGrid();
    await pressStudioSave();
    await waitFor(() => expect(server.saves).toHaveLength(1), SLOW);
    expect(server.saves.map((s) => [s.type, s.name, s.body.label, fieldNamesOf(s.body)])).toEqual([
      ['object', 'acme_note', 'Note', ['body', 'new_field']],
    ]);
    // No field count or add-field of `acme_task` was shown under `acme_note`.
    expect(shownDuringLoad).toEqual({ fieldCount: false, addField: false });
  }, 30000);
});

describe('a package switch: Automations and Data open nothing of the previous package (objectui#11272)', () => {
  // Through the real surface and a door to package B: the route keeps the
  // surface mounted across `:packageId`, as the console's does.
  function surfaceTree(tab: string) {
    return (
      <MemoryRouter initialEntries={[`/studio/${PKG}/${tab}`]}>
        <PackageDoor to={`/studio/${PKG_B}/${tab}`} />
        <Routes>
          <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
        </Routes>
      </MemoryRouter>
    );
  }
  async function switchToBeta(): Promise<void> {
    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByTestId('package-door'));
  }

  it("Data: package A's open object is not kept; a field added saves package B's own object, in B", async () => {
    seedPackageB();
    render(surfaceTree('data'));
    await waitFor(() => expect(screen.getByText(/^\d+ fields?( \(\+\d+ system\))?$/)).toHaveTextContent('2 fields'), SLOW);

    await switchToBeta();
    await screen.findByRole('button', { name: /Beta item/ }, SLOW);
    await waitFor(() => expect(screen.getByText(/^\d+ fields?( \(\+\d+ system\))?$/)).toBeInTheDocument(), SLOW);
    await addFieldFromGrid();
    await pressStudioSave();
    await waitFor(() => expect(server.saves).toHaveLength(1), SLOW);
    expect(server.saves.map((s) => [s.type, s.name, s.packageId, s.body.label, fieldNamesOf(s.body)])).toEqual([
      ['object', 'beta_item', PKG_B, 'Beta item', ['name', 'new_field']],
    ]);
  }, 30000);
});

