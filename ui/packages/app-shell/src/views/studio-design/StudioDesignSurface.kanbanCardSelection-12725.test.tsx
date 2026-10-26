// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12725 — target 2 on a kanban view leaf: a click on a canvas element
 * switches the right slot to 属性 for that element. On a kanban board the
 * element is "the card", and its properties are the panel's kanban card
 * section (`ObjectListViewInspector`).
 *
 * Pinned here, through the mounted surface with its right slot:
 *
 *  - a click on a card switches the slot to 属性 with the kanban card section,
 *    outlines the clicked card, names the selection on the status line, and
 *    neither opens the record nor lets a press reach the card's drag sensor;
 *  - Esc, and a click on empty canvas, clear the card selection, and the slot
 *    keeps showing the view's properties;
 *  - each of the section's four controls writes exactly its spec key, and the
 *    saved list body parses as the spec's `ListViewSchema`;
 *  - CONTROLS: a grid leaf shows no kanban card section; the board outside
 *    Studio opens a record on click and its cards take the press; a canvas
 *    registered over the default gets no channel, so a card click opens the
 *    record and the slot keeps the copilot. The column selection on a grid
 *    leaf stays pinned by `leafColumnSelection-12725`.
 *
 * The canvas is the real `StudioObjectRecordsCanvas`; `object-view` is a stub
 * that draws the real kanban board (`KanbanRenderer`) for a kanban view and a
 * plain table for any other. The copilot is the stub `rightSlot-12725` uses.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ComponentRegistry } from '@object-ui/core';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { ListViewSchema } from '@objectstack/spec/ui';
import '@object-ui/components';
import { KanbanRenderer } from '@object-ui/plugin-kanban';
// The board's lazy chunk, loaded at module scope (AGENTS.md, test discipline).
import '../../../../plugin-kanban/src/KanbanImpl';

const PACKAGE_ID = 'com.acme.app';
const NAV = [
  { id: 'nav_board', type: 'object', label: 'Board', objectName: 'showcase_task', viewName: 'board' },
  { id: 'nav_tasks', type: 'object', label: 'Tasks', objectName: 'showcase_task' },
  { id: 'nav_bare', type: 'object', label: 'Bare board', objectName: 'showcase_task', viewName: 'bare' },
];

const OBJECT_DEF = {
  name: 'showcase_task',
  label: 'Task',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    status: { name: 'status', label: 'Status', type: 'text' },
    priority: { name: 'priority', label: 'Priority', type: 'text' },
    owner: { name: 'owner', label: 'Owner', type: 'text' },
  },
};

/** The kanban view the board entry lands on. */
const BOARD_VIEW = {
  name: 'showcase_task.board',
  object: 'showcase_task',
  viewKind: 'list',
  label: 'Board',
  config: {
    type: 'kanban',
    data: { provider: 'object', object: 'showcase_task' },
    columns: ['title', 'status'],
    kanban: { groupByField: 'status', columns: ['priority'] },
  },
};

/** A kanban view with no `kanban` block: the board picks its own lanes. */
const BARE_VIEW = {
  name: 'showcase_task.bare',
  object: 'showcase_task',
  viewKind: 'list',
  label: 'Bare board',
  config: {
    type: 'kanban',
    data: { provider: 'object', object: 'showcase_task' },
    columns: ['title', 'status'],
  },
};

/** The object's default list view: a grid. */
const DEFAULT_VIEW = {
  name: 'showcase_task.default',
  object: 'showcase_task',
  viewKind: 'list',
  label: 'All tasks',
  isDefault: true,
  config: {
    type: 'grid',
    data: { provider: 'object', object: 'showcase_task' },
    columns: [{ field: 'title' }, { field: 'status' }],
  },
};

const LANES = [
  { id: 'open', title: 'Open' },
  { id: 'done', title: 'Done' },
];
const ROWS = [
  { id: 'r1', title: 'Bob', status: 'open', priority: 'high' },
  { id: 'r2', title: 'Ada', status: 'open', priority: 'low' },
  { id: 'r3', title: 'Cyd', status: 'done', priority: 'low' },
];

/** What a card click asks the runtime to open. */
const openRecord = vi.fn();
/** What the control drawn inside a card does. */
const cardControl = vi.fn();

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));

const mockClient = {
  save: vi.fn(async () => ({ success: true, version: 'v1', state: 'draft' })),
  list: vi.fn(async (type: string) => {
    if (type === 'app') return [{ name: 'acme_app', label: 'Acme' }];
    if (type === 'object') return [{ name: 'showcase_task', label: 'Task' }];
    return [];
  }),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
    if (type === 'object') return { effective: OBJECT_DEF, code: OBJECT_DEF };
    if (type === 'view' && name === BOARD_VIEW.name) {
      return { code: null, overlay: BOARD_VIEW, overlayScope: 'env', effective: BOARD_VIEW };
    }
    if (type === 'view' && name === BARE_VIEW.name) {
      return { code: null, overlay: BARE_VIEW, overlayScope: 'env', effective: BARE_VIEW };
    }
    if (type === 'view' && name === DEFAULT_VIEW.name) {
      return { code: null, overlay: DEFAULT_VIEW, overlayScope: 'env', effective: DEFAULT_VIEW };
    }
    return { effective: { name } };
  }),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async (type: string) => (type === 'object' ? OBJECT_DEF : undefined)),
  references: vi.fn(async () => []),
  withPreviewDrafts() {
    return this;
  },
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ loading: false, error: null, entries: [] }),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => ({}) };
});

vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

vi.mock('./StudioAiCopilot', () => ({
  StudioChatDock: ({ onStatusChange }: { onStatusChange?: (s: { available: boolean; planPending: boolean }) => void }) => {
    React.useEffect(() => {
      onStatusChange?.({ available: true, planPending: false });
    }, [onStatusChange]);
    return <div data-testid="copilot-body">conversation</div>;
  },
}));

import { StudioDesignSurface } from './StudioDesignSurface';
import { registerStudioCanvasPreview, StudioObjectRecordsCanvas } from './studio-canvas-preview';
import { t, tFormat } from '../metadata-admin/i18n';

/** The real board, lanes by the view's group-by field, a card click opening the record. */
function Board({ groupBy }: { groupBy: string }) {
  return (
    <KanbanRenderer
      schema={{ type: 'object-kanban', groupBy, columns: LANES, data: ROWS, onCardClick: (card) => openRecord(card.id) }}
    />
  );
}

/** Stands in for `plugin-view`'s `object-view`: the board for a kanban view, a table otherwise. */
function ObjectViewStub({ schema }: { schema: Record<string, unknown> }) {
  const views = (schema.listViews ?? {}) as Record<string, { type?: string; kanban?: { groupByField?: string } }>;
  const view = views[String(schema.defaultListView)];
  if (view?.type === 'kanban') {
    return (
      <>
        <Board groupBy={view.kanban?.groupByField ?? 'status'} />
        {/* A card drawn with a control in it, in the board's markup (`SortableCard`). */}
        <div role="listitem" aria-label="Eve">
          <div role="button" tabIndex={0} aria-label="Eve" data-kanban-card="r9">
            <span>Eve</span>
            <button type="button" onClick={cardControl}>
              Act
            </button>
          </div>
        </div>
      </>
    );
  }
  return (
    <table>
      <tbody>
        {ROWS.map((r) => (
          <tr key={r.id}>
            <td>{r.title}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const METADATA: MetadataContextValue = {
  apps: [],
  objects: [OBJECT_DEF],
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
};

const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeAll(() => {
  ComponentRegistry.register('object-view', ObjectViewStub as never, { namespace: 'plugin-view' });
});

beforeEach(() => {
  window.sessionStorage.clear();
  openRecord.mockClear();
  cardControl.mockClear();
  mockClient.save.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) =>
      String(input) === '/api/v1/packages'
        ? answer({ success: true, data: { packages: [{ manifest: { id: PACKAGE_ID, name: 'Acme' }, writable: true }] } })
        : answer([]),
    ),
  );
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  registerStudioCanvasPreview('object', StudioObjectRecordsCanvas);
});

function renderSurface() {
  render(
    <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/interfaces`]}>
      <MetadataCtx.Provider value={METADATA}>
        <Routes>
          <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
        </Routes>
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

const slot = () => screen.getByTestId('studio-right-slot');
const slotProps = () => screen.getByTestId('studio-slot-props');
const canvas = () => screen.getByTestId('if-canvas-main');
const cardSection = () => within(slotProps()).queryByTestId('list-view-kanban-card');

/** A card of the board on the canvas, by its title. */
async function card(title: string): Promise<HTMLElement> {
  const label = await within(canvas()).findByText(title, undefined, { timeout: 4000 });
  return label.closest('[data-kanban-card]') as HTMLElement;
}

/** The record id of the card the canvas outlines, or `null`. */
function outlinedCard(): string | null {
  const rule = within(canvas()).getByTestId('studio-canvas-cards').querySelector('style')?.textContent ?? '';
  return /data-kanban-card="([^"]+)"/.exec(rule)?.[1] ?? null;
}

/** Open the rail's nth `object · showcase_task` entry (0: the board, 1: the default grid, 2: the bare board). */
async function openLeaf(index: 0 | 1 | 2) {
  renderSurface();
  const leaves = await screen.findAllByTitle('object · showcase_task', undefined, { timeout: 4000 });
  fireEvent.click(leaves[index]);
  await waitFor(() => expect(within(slotProps()).getByTestId('list-view-columns')).toBeInTheDocument(), {
    timeout: 8000,
  });
  await waitFor(() => expect(slot()).toHaveAttribute('data-mode', 'copilot'));
}

async function openBoardLeaf() {
  await openLeaf(0);
  await waitFor(() => expect(cardSection()).not.toBeNull(), { timeout: 4000 });
  await card('Bob');
}

/** The list body of the newest saved draft of the board view. */
function lastSavedBoardBody(viewName: string = BOARD_VIEW.name): Record<string, unknown> | null {
  const calls = mockClient.save.mock.calls as unknown as Array<[string, string, Record<string, unknown>]>;
  const saved = calls.filter((c) => c[0] === 'view' && c[1] === viewName).at(-1);
  return saved ? (saved[2].config as Record<string, unknown>) : null;
}

/** Pick an option in one of the section's selects, as the shared `Select` is driven. */
async function pick(trigger: HTMLElement, option: string | RegExp) {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

/** The board view's saved body must parse as the spec's list view. */
function expectSpecValid(body: Record<string, unknown>) {
  const parsed = ListViewSchema.safeParse(body);
  expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
}

describe("a card on a kanban leaf's canvas selects the board's card (objectui#12725)", () => {
  it('a card click switches the slot to 属性 with the kanban card section, outlines the card, and opens nothing', async () => {
    await openBoardLeaf();
    expect(screen.getByTestId('if-canvas-hint')).toHaveTextContent(t('engine.studio.if.canvasHint.pick', 'en'));
    expect(cardSection()).not.toHaveAttribute('data-selected');
    const bob = await card('Bob');
    // A press on the card reaches no drag sensor of the board's.
    const press = vi.fn();
    bob.addEventListener('pointerdown', press);

    fireEvent.pointerDown(bob);
    fireEvent.click(bob);

    await waitFor(() => expect(slot()).toHaveAttribute('data-mode', 'props'));
    expect(cardSection()).toBeVisible();
    expect(cardSection()).toHaveAttribute('data-selected', 'true');
    expect(outlinedCard()).toBe('r1');
    expect(screen.getByTestId('if-canvas-hint')).toHaveTextContent(
      tFormat('engine.studio.if.canvasHint.selected', 'en', {
        label: t('engine.studio.inspector.listView.kanbanCard', 'en'),
      }),
    );
    expect(openRecord).not.toHaveBeenCalled();
    expect(press).not.toHaveBeenCalled();
    // The copilot stays, folded to the strip at the slot's foot.
    expect(slot().lastElementChild).toBe(screen.getByTestId('studio-slot-copilot-strip'));

    // Another card moves the outline; still nothing opens.
    fireEvent.click(await card('Cyd'));
    await waitFor(() => expect(outlinedCard()).toBe('r3'));
    expect(openRecord).not.toHaveBeenCalled();
  });

  it('a control drawn inside a card keeps its click, and selects nothing', async () => {
    await openBoardLeaf();

    fireEvent.click(within(canvas()).getByRole('button', { name: 'Act' }));

    expect(cardControl).toHaveBeenCalledTimes(1);
    expect(outlinedCard()).toBeNull();
    expect(slot()).toHaveAttribute('data-mode', 'copilot');
    // The card itself still selects.
    fireEvent.click(within(canvas()).getByText('Eve'));
    await waitFor(() => expect(outlinedCard()).toBe('r9'));
  });

  it('Enter on a focused card selects it, and opens nothing', async () => {
    await openBoardLeaf();
    const bob = await card('Bob');
    bob.focus();

    const notPrevented = fireEvent.keyDown(bob, { key: 'Enter' });

    expect(notPrevented).toBe(false);
    await waitFor(() => expect(slot()).toHaveAttribute('data-mode', 'props'));
    expect(outlinedCard()).toBe('r1');
    expect(cardSection()).toHaveAttribute('data-selected', 'true');
    expect(openRecord).not.toHaveBeenCalled();
  });

  it("Space on a focused card selects it on the release, and its press does not scroll or open", async () => {
    await openBoardLeaf();
    const ada = await card('Ada');
    ada.focus();
    // The board's own key handlers sit on the card: neither key reaches them.
    const own = vi.fn();
    ada.addEventListener('keydown', own);
    ada.addEventListener('keyup', own);

    expect(fireEvent.keyDown(ada, { key: ' ' })).toBe(false);
    expect(outlinedCard()).toBeNull();
    expect(fireEvent.keyUp(ada, { key: ' ' })).toBe(false);

    await waitFor(() => expect(slot()).toHaveAttribute('data-mode', 'props'));
    expect(outlinedCard()).toBe('r2');
    expect(openRecord).not.toHaveBeenCalled();
    expect(own).not.toHaveBeenCalled();
  });

  it('a key on a control drawn inside a card is that control\'s, and selects nothing', async () => {
    await openBoardLeaf();
    const act = within(canvas()).getByRole('button', { name: 'Act' });
    const own = vi.fn();
    act.addEventListener('keydown', own);

    expect(fireEvent.keyDown(act, { key: 'Enter' })).toBe(true);
    fireEvent.keyUp(act, { key: ' ' });

    expect(own).toHaveBeenCalledTimes(1);
    expect(outlinedCard()).toBeNull();
    expect(slot()).toHaveAttribute('data-mode', 'copilot');
  });

  it("Esc clears the card selection, and the slot keeps the view's properties", async () => {
    await openBoardLeaf();
    fireEvent.click(await card('Ada'));
    await waitFor(() => expect(outlinedCard()).toBe('r2'));

    fireEvent.keyDown(document.body, { key: 'Escape' });

    await waitFor(() => expect(outlinedCard()).toBeNull());
    expect(slot()).toHaveAttribute('data-mode', 'props');
    expect(cardSection()).toBeVisible();
    expect(cardSection()).not.toHaveAttribute('data-selected');
    expect(screen.queryByTestId('if-canvas-hint')).toBeNull();
  });

  it('a click on empty canvas clears the card selection', async () => {
    await openBoardLeaf();
    fireEvent.click(await card('Ada'));
    await waitFor(() => expect(outlinedCard()).toBe('r2'));

    fireEvent.click(canvas());

    await waitFor(() => expect(outlinedCard()).toBeNull());
    expect(slot()).toHaveAttribute('data-mode', 'props');
    expect(cardSection()).not.toHaveAttribute('data-selected');
  });
});

describe('the kanban card section writes only its spec keys (objectui#12725)', () => {
  /** Open the board leaf and select a card, so the slot shows the section. */
  async function openCardProps() {
    await openBoardLeaf();
    fireEvent.click(await card('Bob'));
    await waitFor(() => expect(slot()).toHaveAttribute('data-mode', 'props'));
  }

  /** Every key of the saved body but the ones named, and every key of its kanban block but the ones named. */
  function unchangedApart(body: Record<string, unknown>, keys: string[], kanbanKeys: string[] = []) {
    const strip = (o: Record<string, unknown>, drop: string[]) =>
      Object.fromEntries(Object.entries(o).filter(([k]) => !drop.includes(k)));
    expect(strip(body, [...keys, 'kanban'])).toEqual(strip(BOARD_VIEW.config, [...keys, 'kanban']));
    expect(strip(body.kanban as Record<string, unknown>, kanbanKeys)).toEqual(
      strip(BOARD_VIEW.config.kanban, kanbanKeys),
    );
  }

  it('card fields write kanban.columns, in order', async () => {
    await openCardProps();
    const fields = within(cardSection() as HTMLElement).getByTestId('list-view-kanban-fields');
    await pick(within(fields).getByRole('combobox'), /Owner/);

    await waitFor(() => expect(lastSavedBoardBody()).not.toBeNull(), { timeout: 4000 });
    const body = lastSavedBoardBody()!;
    expect((body.kanban as Record<string, unknown>).columns).toEqual(['priority', 'owner']);
    unchangedApart(body, [], ['columns']);
    expectSpecValid(body);
  });

  it('the title writes kanban.titleField, and the record name removes it', async () => {
    await openCardProps();
    const title = () => within(cardSection() as HTMLElement).getByLabelText(t('engine.studio.inspector.listView.kanbanCard.title', 'en'));
    await pick(title(), /Title/);

    await waitFor(() => expect((lastSavedBoardBody()?.kanban as Record<string, unknown> | undefined)?.titleField).toBe('title'), {
      timeout: 4000,
    });
    unchangedApart(lastSavedBoardBody()!, [], ['titleField']);
    expectSpecValid(lastSavedBoardBody()!);

    await pick(title(), t('engine.studio.inspector.listView.kanbanCard.titleRecordName', 'en'));
    await waitFor(() => expect(lastSavedBoardBody()?.kanban).toEqual(BOARD_VIEW.config.kanban), { timeout: 4000 });
    expectSpecValid(lastSavedBoardBody()!);
  });

  it('click to open writes navigation.mode, over the spec modes', async () => {
    await openCardProps();
    const open = within(cardSection() as HTMLElement).getByLabelText(t('engine.studio.inspector.listView.kanbanCard.open', 'en'));
    await pick(open, t('engine.studio.inspector.listView.kanbanCard.mode.drawer', 'en'));

    await waitFor(() => expect(lastSavedBoardBody()?.navigation).toEqual({ mode: 'drawer' }), { timeout: 4000 });
    unchangedApart(lastSavedBoardBody()!, ['navigation']);
    expectSpecValid(lastSavedBoardBody()!);
  });

  it('the group-by field writes kanban.groupByField', async () => {
    await openCardProps();
    const group = within(cardSection() as HTMLElement).getByLabelText(t('engine.studio.inspector.listView.kanbanCard.groupBy', 'en'));
    await pick(group, /Priority/);

    await waitFor(
      () => expect((lastSavedBoardBody()?.kanban as Record<string, unknown> | undefined)?.groupByField).toBe('priority'),
      { timeout: 4000 },
    );
    unchangedApart(lastSavedBoardBody()!, [], ['groupByField']);
    expectSpecValid(lastSavedBoardBody()!);
  });
});

describe('a kanban view with no kanban block (objectui#12725)', () => {
  it('the title and the card fields wait for the group-by field, which writes the block with no card fields', async () => {
    await openLeaf(2);
    await waitFor(() => expect(cardSection()).not.toBeNull(), { timeout: 4000 });
    fireEvent.click(await card('Bob'));
    await waitFor(() => expect(slot()).toHaveAttribute('data-mode', 'props'));
    const section = cardSection() as HTMLElement;
    expect(within(section).getByTestId('list-view-kanban-group-first')).toBeVisible();
    expect(within(section).getByLabelText(t('engine.studio.inspector.listView.kanbanCard.title', 'en'))).toBeDisabled();
    expect(within(section).queryByRole('combobox', { name: t('engine.form.addField', 'en') })).toBeNull();

    await pick(within(section).getByLabelText(t('engine.studio.inspector.listView.kanbanCard.groupBy', 'en')), /Priority/);

    await waitFor(() => expect(lastSavedBoardBody(BARE_VIEW.name)).not.toBeNull(), { timeout: 4000 });
    const body = lastSavedBoardBody(BARE_VIEW.name)!;
    expect(body).toEqual({ ...BARE_VIEW.config, kanban: { groupByField: 'priority', columns: [] } });
    expectSpecValid(body);
    await waitFor(() => expect(within(section).getByLabelText(t('engine.studio.inspector.listView.kanbanCard.title', 'en'))).toBeEnabled());
  });
});

describe('CONTROLS (objectui#12725)', () => {
  it('a grid leaf shows no kanban card section, and its canvas has no card channel', async () => {
    await openLeaf(1);
    await within(canvas()).findByText('Bob');
    expect(cardSection()).toBeNull();
    expect(within(canvas()).getByTestId('studio-canvas-cards').querySelector('style')).toBeNull();
  });

  it('outside Studio, a card click opens the record, and the card takes the press', async () => {
    render(<Board groupBy="status" />);
    const bob = (await screen.findByText('Bob', undefined, { timeout: 4000 })).closest('[data-kanban-card]') as HTMLElement;
    expect(bob).toHaveAttribute('data-kanban-card', 'r1');
    const press = vi.fn();
    bob.addEventListener('pointerdown', press);

    fireEvent.pointerDown(bob);
    fireEvent.click(bob);

    expect(press).toHaveBeenCalledTimes(1);
    expect(openRecord).toHaveBeenCalledWith('r1');
  });

  it('outside Studio, Enter on a focused card opens the record (objectui#12888)', async () => {
    render(<Board groupBy="status" />);
    const bob = (await screen.findByText('Bob', undefined, { timeout: 4000 })).closest('[data-kanban-card]') as HTMLElement;
    bob.focus();

    fireEvent.keyDown(bob, { key: 'Enter' });

    expect(openRecord).toHaveBeenCalledWith('r1');
  });

  it('a canvas registered over the default gets no channel: a card click opens the record and the slot keeps the copilot', async () => {
    registerStudioCanvasPreview('object', () => <Board groupBy="status" />);
    await openLeaf(0);
    const bob = (await within(canvas()).findByText('Bob', undefined, { timeout: 4000 })).closest('[data-kanban-card]') as HTMLElement;
    expect(within(canvas()).queryByTestId('studio-canvas-cards')).toBeNull();
    // Nor does the canvas promise a click it cannot answer.
    expect(screen.queryByTestId('if-canvas-hint')).toBeNull();

    fireEvent.click(bob);

    expect(openRecord).toHaveBeenCalledWith('r1');
    expect(slot()).toHaveAttribute('data-mode', 'copilot');
  });
});
