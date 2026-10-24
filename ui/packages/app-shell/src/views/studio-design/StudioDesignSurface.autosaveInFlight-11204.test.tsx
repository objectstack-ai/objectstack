// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11204 — Studio's shared draft autosave sends an edit made while a
 * save is in flight, on every caller of `useDraftAutoSave`.
 *
 * Each caller's save cleared its dirty flag after its await, whatever had been
 * edited meanwhile. The autosave is blocked while a save is in flight, so an
 * edit taken then was left on screen with the buffer marked clean, and the
 * autosave never sent it. Measured on the Automations pillar first (the flow
 * inspector's label), then on the Data pillar (an added field, both through
 * the autosave and through the records grid's column reorder, a save the
 * pillar sends itself) and on the Interfaces page inspector (the page label).
 *
 * The hook now hands each save it sends a claim on the buffer it sent, and a
 * completing save clears its dirty flag only while the buffer still holds what
 * it sent. The nav autosave (objectui#11189) reads the same claim: its per-
 * pillar edit generation is gone. A generation cannot tell an edit that was
 * undone while the save was in flight from one that was not, so the buffer
 * stayed dirty for good over content the server already held; the last case
 * below is that reading.
 *
 * The canvases and inspectors are the REAL registered `FlowPreview` /
 * `FlowInspector` and `PagePreview` / `PageBlockInspector` /
 * `PageDefaultInspector`. The Data pillar's records grid is a double that
 * hands the pillar a column order through the grid's own authoring context
 * (the drag mechanics are the data table's concern). The client is a server
 * double that records every save and can hold one in flight.
 *
 * "Unsent" is read from the saves the double received, 3.5 s after the held
 * save lands (past the autosave's debounce): one save, carrying the first
 * edit, is the defect; a second save carrying the later edit is the fix.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.app';

const NODES = [
  { id: 'start', type: 'start', label: 'Start' },
  { id: 'end', type: 'end', label: 'End' },
];
const FLOW = {
  name: 'notify_owner',
  label: 'Notify owner',
  type: 'autolaunched',
  status: 'active',
  nodes: NODES,
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

const OBJECT = {
  name: 'acme_task',
  label: 'Task',
  fields: [
    { name: 'title', label: 'Title', type: 'text' },
    { name: 'status', label: 'Status', type: 'text' },
  ],
};

const NAV = [
  { id: 'nav_home', type: 'page', label: 'Home menu', pageName: 'home' },
  { id: 'nav_landing', type: 'page', label: 'Landing menu', pageName: 'landing' },
];
const APP = { name: 'acme_app', label: 'Acme', navigation: NAV };
/** A block page: the first leaf the pillar opens, its page form in the rail. */
const HOME = {
  name: 'home',
  label: 'Home',
  type: 'app',
  regions: [{ name: 'main', components: [{ id: 'hello', type: 'element:text', properties: { content: 'Hello' } }] }],
};
const LANDING = { name: 'landing', label: 'Landing', type: 'app', regions: [{ name: 'main', components: [] }] };

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, Record<string, unknown>>(),
  /** Every save, as the server received it. */
  saves: [] as Array<{ type: string; name: string; body: Record<string, unknown> }>,
  /** While set, the next save waits on it (a save held in flight). */
  hold: null as Promise<void> | null,
}));

// A server double: a save lands as the item's draft, and a later load serves it.
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
      server.saves.push({ type, name, body });
      const hold = server.hold;
      server.hold = null;
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
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

// The Data pillar's records grid: a double that reorders the columns it was
// handed through the grid's authoring context, the way a header drag does.
vi.mock('@object-ui/plugin-view', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  const { useGridFieldAuthoring } = await import('@object-ui/components');
  function GridDouble({ schema }: { schema?: { table?: { fields?: string[] } } }) {
    const authoring = useGridFieldAuthoring();
    const cols = schema?.table?.fields ?? [];
    return (
      <>
        <button type="button" onClick={() => authoring?.onReorderFields?.([...cols].reverse())}>
          Reverse columns
        </button>
        {/* objectui#12511 — the grid's "+" column, drawn from the same context. */}
        {authoring?.onAddColumn && (
          <button type="button" data-testid="grid-add-column" onClick={authoring.onAddColumn}>
            Add column
          </button>
        )}
      </>
    );
  }
  return { ...mod, ObjectView: GridDouble };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));

import { AutomationsPillar, DataPillar, InterfacesPillar } from './StudioDesignSurface';
import { addFieldFromGrid } from './__tests__/dataPillarAddField';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { registerMetadataDefaultInspector } from '../metadata-admin/default-inspector-registry';
import { FlowPreview } from '../metadata-admin/previews/FlowPreview';
import { FlowInspector } from '../metadata-admin/inspectors/FlowInspector';
import { t } from '../metadata-admin/i18n';
import { PagePreview } from '../metadata-admin/previews/PagePreview';
import { PageBlockInspector } from '../metadata-admin/inspectors/PageBlockInspector';
import { PageDefaultInspector } from '../metadata-admin/inspectors/PageDefaultInspector';
import { readFields } from '../metadata-admin/previews/object-fields-io';

const dataSource = createEmptyDataSource();

// The Automations pillar's `/automation/_status` probe and the flow
// inspector's action-catalog read go through the global `fetch`; one double
// answers "absent" so each keeps its documented fallback.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

registerMetadataPreview('flow', FlowPreview);
registerMetadataInspector('flow', FlowInspector);
registerMetadataPreview('page', PagePreview);
registerMetadataInspector('page', PageBlockInspector);
registerMetadataDefaultInspector('page', PageDefaultInspector);

const key = (type: string, name: string) => `${type}/${name}`;

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.saves.length = 0;
  server.hold = null;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  for (const row of [FLOW, OBJECT, HOME, LANDING]) {
    const type = row === FLOW ? 'flow' : row === OBJECT ? 'object' : 'page';
    server.active.set(key(type, row.name), JSON.parse(JSON.stringify(row)));
  }
  server.active.set(key('app', APP.name), JSON.parse(JSON.stringify(APP)));
});

afterEach(cleanup);

/** Holds the next save in flight until the returned release is called. */
function holdNextSave(): () => Promise<void> {
  let release!: () => void;
  server.hold = new Promise<void>((r) => (release = r));
  return async () => {
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 0));
    });
  };
}

/** Past the autosave's debounce after a held save lands: what was sent by then is what will be. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 3500));
  });
}

function savesOf(type: string): Array<Record<string, unknown>> {
  return server.saves.filter((s) => s.type === type).map((s) => s.body);
}

function editText(el: HTMLElement, value: string): void {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
}

describe('Automations pillar — an edit taken while a flow save is in flight (objectui#11204)', () => {
  function startLabel(body: Record<string, unknown>): string {
    return String((body.nodes as Array<{ id: string; label?: string }>).find((n) => n.id === 'start')?.label);
  }

  it('stays on screen and lands in the next save', async () => {
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
        <AutomationsPillar packageId={PKG} />
      </MemoryRouter>,
    );
    // Loaded once the Status pill reads the flow's `active` status — in the
    // switch's words, with no runtime reading (objectui#11779).
    await waitFor(() => expect(screen.getByText('Status:').nextElementSibling).toHaveTextContent(t('engine.studio.auto.enabled', 'en')), { timeout: 8000 });
    fireEvent.click(document.querySelector('[data-node-id="start"] [role="button"]') as HTMLElement);
    const label = await within(screen.getByRole('complementary')).findByLabelText('Label', undefined, { timeout: 8000 });

    const release = holdNextSave();
    editText(label, 'Kick-off');
    await screen.findByTestId('auto-autosaving', undefined, { timeout: 8000 });
    expect(savesOf('flow').map(startLabel)).toEqual(['Kick-off']);
    editText(label, 'Kick-off two');
    await waitFor(() => expect(document.querySelector('[data-node-id="start"]')).toHaveTextContent('Kick-off two'), { timeout: 8000 });

    await release();
    await settle();
    expect(document.querySelector('[data-node-id="start"]')).toHaveTextContent('Kick-off two');
    expect(savesOf('flow').map(startLabel)).toEqual(['Kick-off', 'Kick-off two']);
  });
});

describe('Data pillar — an edit taken while an object save is in flight (objectui#11204)', () => {
  function renderData() {
    return render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/data`]}>
        <DataPillar packageId={PKG} />
      </MemoryRouter>,
    );
  }
  const fieldNames = (body: Record<string, unknown>) => readFields(body.fields).entries.map((e) => e.name);
  const fieldCountShown = () => screen.getByText(/^\d+ fields$/).textContent;
  const addField = () => addFieldFromGrid();

  it('the autosave: an added field stays on screen and lands in the next save', async () => {
    renderData();
    await waitFor(() => expect(fieldCountShown()).toBe('2 fields'), { timeout: 8000 });

    const release = holdNextSave();
    await addField();
    await screen.findByTestId('data-autosaving', undefined, { timeout: 8000 });
    expect(savesOf('object').map(fieldNames)).toEqual([['title', 'status', 'new_field']]);
    // A second label: a repeated one would ask for its api name (objectui#13389).
    await addFieldFromGrid(undefined, { label: 'Second field' });
    expect(fieldCountShown()).toBe('4 fields');

    await release();
    await settle();
    expect(fieldCountShown()).toBe('4 fields');
    expect(savesOf('object').map(fieldNames)).toEqual([
      ['title', 'status', 'new_field'],
      ['title', 'status', 'new_field', 'second_field'],
    ]);
  });

  it("the grid's column reorder, a save the pillar sends itself: a field added meanwhile lands in the next save", async () => {
    renderData();
    await waitFor(() => expect(fieldCountShown()).toBe('2 fields'), { timeout: 8000 });

    const release = holdNextSave();
    fireEvent.click(await screen.findByRole('button', { name: 'Reverse columns' }, { timeout: 8000 }));
    await screen.findByTestId('data-autosaving', undefined, { timeout: 8000 });
    expect(savesOf('object').map(fieldNames)).toEqual([['status', 'title']]);
    await addField();
    expect(fieldCountShown()).toBe('3 fields');

    await release();
    await settle();
    expect(fieldCountShown()).toBe('3 fields');
    expect(savesOf('object').map(fieldNames)).toEqual([
      ['status', 'title'],
      ['status', 'title', 'new_field'],
    ]);
  });

  it('the control: a reorder with nothing edited meanwhile is the only save', async () => {
    renderData();
    await waitFor(() => expect(fieldCountShown()).toBe('2 fields'), { timeout: 8000 });

    fireEvent.click(await screen.findByRole('button', { name: 'Reverse columns' }, { timeout: 8000 }));
    await waitFor(() => expect(server.saves).toHaveLength(1), { timeout: 8000 });
    await settle();
    expect(savesOf('object').map(fieldNames)).toEqual([['status', 'title']]);
  });
});

describe('Interfaces page inspector — an edit taken while a page save is in flight (objectui#11204)', () => {
  it('stays on screen and lands in the next save', async () => {
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
        <InterfacesPillar packageId={PKG} />
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: 'Select hello' }, { timeout: 8000 });
    const label = await within(screen.getByRole('complementary')).findByLabelText(/^Label/, undefined, { timeout: 8000 });

    const release = holdNextSave();
    editText(label, 'Welcome');
    await screen.findByTestId('if-autosaving', undefined, { timeout: 8000 });
    expect(savesOf('page').map((b) => b.label)).toEqual(['Welcome']);
    editText(label, 'Welcome two');

    await release();
    await settle();
    expect(within(screen.getByRole('complementary')).getByLabelText(/^Label/)).toHaveValue('Welcome two');
    expect(savesOf('page').map((b) => b.label)).toEqual(['Welcome', 'Welcome two']);
  });
});

describe('Interfaces nav autosave — the same claim, in place of its edit generation (objectui#11204)', () => {
  /** The pillar as the Studio surface mounts it: a draft-saved signal re-reads the app. */
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
  // objectui#11196: a new canvas entry is born with no `label`, and a save
  // carries it with no `label` key (`{ id }` below). It was born "New item".
  // objectui#11776: a save sends an entry only once it names a target, so each
  // Add here is bound to the fixture's object in its inspector, and the rail
  // shows it by that object's name.
  const addedItemsInRail = () => within(rail()).queryAllByRole('button', { name: new RegExp(OBJECT.name) }).length;
  const addBoundItem = async () => {
    fireEvent.click(screen.getByRole('button', { name: /Add nav item/ }));
    // *Link object* is the shared `Select` since objectui#11865: open its list and pick.
    fireEvent.keyDown(screen.getByTestId('nav-link-object'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: new RegExp(`\\(${OBJECT.name}\\)$`) }));
  };
  const navEditingOpen = () => screen.queryAllByRole('button', { name: /Add nav item/ }).length > 0;
  const savedNavEntries = () =>
    savesOf('app').map((b) =>
      (b.navigation as Array<Record<string, unknown>>).map((n) =>
        Object.prototype.hasOwnProperty.call(n, 'label') ? String(n.label) : { id: n.id },
      ),
    );

  it('an edit undone while the save is in flight leaves the buffer as it landed: clean, and "Done" closes', async () => {
    render(<NavHost />);
    await screen.findByRole('button', { name: /Landing menu/ }, { timeout: 8000 });
    fireEvent.click(screen.getByTitle(/^Edit navigation/));
    await screen.findByRole('button', { name: /Add nav item/ }, { timeout: 8000 });

    const release = holdNextSave();
    await addBoundItem();
    await screen.findByTestId('nav-autosaving', undefined, { timeout: 8000 });
    await addBoundItem();
    expect(addedItemsInRail()).toBe(2);
    // Undo it: the buffer is back to exactly what the save in flight carries.
    const rows = within(rail()).getAllByRole('button', { name: new RegExp(OBJECT.name) });
    fireEvent.mouseEnter(rows[rows.length - 1]);
    fireEvent.click(within(rows[rows.length - 1]).getByRole('button', { name: 'Remove nav item' }));
    expect(addedItemsInRail()).toBe(1);

    await release();
    await settle();
    expect(savedNavEntries()).toEqual([['Home menu', 'Landing menu', { id: 'nav_item_3' }]]);
    expect(addedItemsInRail()).toBe(1);
    expect(dirtyReports[dirtyReports.length - 1]).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByTitle('Done editing'));
    });
    await waitFor(() => expect(navEditingOpen()).toBe(false), { timeout: 8000 });
    expect(server.saves).toHaveLength(1);
  });
});
