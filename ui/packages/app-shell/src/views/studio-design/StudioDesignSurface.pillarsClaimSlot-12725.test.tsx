// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12725, phase 2 — properties follow the selection in every pillar
 * (「studio 中其他的设计面板属性都是右侧打开的」, 「属性好需要考虑选中每个元素的时候也要显示」):
 * the Data and Automations pillars host their properties in the surface's one
 * right slot, through the seam the Interfaces pillar uses
 * (`useStudioRightSlot`), instead of an aside of their own.
 *
 *  - Data: selecting a field switches the slot to 属性 and shows the field
 *    inspector in it; no `data-field-inspector` beside the canvas. The pillar
 *    has no properties of its own with nothing selected, so Esc or a click on
 *    empty canvas hands the slot back to the copilot.
 *  - Automations: the Configuration is in the slot from the start (its empty
 *    sentence while nothing is selected, as the aside had); selecting a node
 *    switches the slot to 属性, and Esc or the canvas's background press
 *    returns it to the flow's Configuration. A row too narrow for the classic
 *    aside opens no drawer (objectui#11795's fold is the classic layout's).
 *  - While 属性 shows, the copilot strip stays at the slot's foot.
 *  - A hidden slot stays hidden on a selection, as on Interfaces.
 *  - CONTROL: the Access pillar claims nothing — the slot shows the copilot
 *    alone; the Interfaces pillar's own pins live in `rightSlot-12725`.
 *
 * The copilot, the flow canvas and both inspectors are stubs: the canvas
 * reports a node selection, or a background press, as `onSelectionChange`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PACKAGE_ID = 'com.acme.app';
const OBJECT = {
  name: 'acme_task',
  label: 'Task',
  fields: [
    { name: 'title', label: 'Title', type: 'text' },
    { name: 'due', label: 'Due', type: 'date' },
  ],
};
const FLOW = {
  name: 'notify_owner',
  label: 'Notify owner',
  type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));

const mockClient = {
  save: vi.fn(async () => ({})),
  list: vi.fn(async (type: string) =>
    type === 'app'
      ? [{ name: 'acme_app', label: 'Acme' }]
      : type === 'object'
        ? [{ name: OBJECT.name, label: OBJECT.label }]
        : type === 'flow'
          ? [{ name: FLOW.name, label: FLOW.label }]
          : [],
  ),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: [] } };
    if (type === 'object') return { effective: OBJECT, code: OBJECT };
    if (type === 'flow') return { effective: FLOW, code: FLOW };
    return { effective: { name } };
  }),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => undefined),
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
  return { ...actual, useAdapter: () => dataSource };
});

vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

/** What the copilot stub reports, per test. */
const copilot = vi.hoisted(() => ({ available: true }));
vi.mock('./StudioAiCopilot', () => ({
  StudioChatDock: ({ onStatusChange }: { onStatusChange?: (s: { available: boolean; planPending: boolean }) => void }) => {
    React.useEffect(() => {
      onStatusChange?.({ available: copilot.available, planPending: false });
    }, [onStatusChange]);
    return copilot.available ? <div data-testid="copilot-body">conversation</div> : null;
  },
}));

import { StudioDesignSurface } from './StudioDesignSurface';
import { t } from '../metadata-admin/i18n';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { DOCK_STUDIO_EXPANDED_STORAGE_KEY } from '../../layout/chatDockState';
import { createEmptyDataSource } from './__tests__/emptyDataSource';

const dataSource = createEmptyDataSource();

function StubFieldInspector(props: Record<string, unknown>): React.ReactElement {
  const selection = props.selection as { id: string };
  return (
    <div data-testid="stub-field-inspector">
      <input aria-label={`Field ${selection.id}`} />
    </div>
  );
}

function StubFlowInspector(props: Record<string, unknown>): React.ReactElement {
  const selection = props.selection as { id: string };
  return (
    <div data-testid="stub-flow-inspector">
      <input aria-label={`Node ${selection.id}`} />
    </div>
  );
}

function StubFlowPreview(props: Record<string, unknown>): React.ReactElement {
  const onSel = props.onSelectionChange as ((s: unknown) => void) | undefined;
  return (
    <div>
      <button type="button" data-testid="pick-node" onClick={() => onSel?.({ kind: 'node', id: 'start', label: 'Start' })}>
        node
      </button>
      <button type="button" data-testid="pick-other-node" onClick={() => onSel?.({ kind: 'node', id: 'end', label: 'End' })}>
        other node
      </button>
      {/* FlowCanvas's background press reports no selection (`onBgPointerDown`). */}
      <button type="button" data-testid="flow-background" onClick={() => onSel?.(null)}>
        background
      </button>
    </div>
  );
}

registerMetadataInspector('object', StubFieldInspector as never);
registerMetadataInspector('flow', StubFlowInspector as never);
registerMetadataPreview('flow', StubFlowPreview as never);

const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  copilot.available = true;
  window.sessionStorage.clear();
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
});

function renderAt(tab: string) {
  render(
    <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/${tab}`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
}

const SLOW = { timeout: 4000 };
const slot = () => screen.getByTestId('studio-right-slot');
const slotProps = () => screen.getByTestId('studio-slot-props');

/** Data: open the object's Form tab and click its one field's card. */
async function selectDataField() {
  renderAt('data');
  fireEvent.click(await screen.findByRole('button', { name: /Task/ }, SLOW));
  fireEvent.click(await screen.findByRole('button', { name: t('engine.studio.data.tab.form', 'en') }, SLOW));
  const card = (await screen.findByText('Title', undefined, SLOW)).closest('[role="button"]') as HTMLElement;
  fireEvent.click(card);
  await waitFor(() => expect(within(slotProps()).getByTestId('stub-field-inspector')).toBeInTheDocument());
  return card;
}

/** Automations: open the flow; its canvas is the stub above. */
async function openFlow() {
  renderAt('automations');
  fireEvent.click(await screen.findByRole('button', { name: /Notify owner/ }, SLOW));
  await screen.findByTestId('pick-node', undefined, SLOW);
}

describe('Data: the field inspector is in the right slot (objectui#12725)', () => {
  it('claims nothing while no field is selected: the slot shows the copilot alone', async () => {
    renderAt('data');
    fireEvent.click(await screen.findByRole('button', { name: /Task/ }, SLOW));
    fireEvent.click(await screen.findByRole('button', { name: t('engine.studio.data.tab.form', 'en') }, SLOW));
    await screen.findByText('Title', undefined, SLOW);
    await waitFor(() => expect(slot()).toHaveAttribute('data-mode', 'copilot'));
    expect(within(slot()).queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryByTestId('data-field-inspector')).toBeNull();
  });

  it("selecting a field switches the slot to 属性 with that field's inspector, the copilot a strip at its foot", async () => {
    await selectDataField();

    expect(slot()).toHaveAttribute('data-mode', 'props');
    expect(within(slot()).getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
    // The one field inspector is the slot's: none beside the canvas.
    expect(screen.getAllByTestId('data-field-inspector')).toHaveLength(1);
    expect(slotProps().contains(screen.getByTestId('data-field-inspector'))).toBe(true);
    expect(within(slotProps()).getByTestId('stub-field-inspector')).toBeVisible();
    expect(screen.getByTestId('copilot-body')).not.toBeVisible();
    const strip = screen.getByTestId('studio-slot-copilot-strip');
    expect(slot().lastElementChild).toBe(strip);
  });

  it('Esc drops the selection and hands the slot back; an Escape another layer took does not', async () => {
    await selectDataField();

    const answer = (e: KeyboardEvent) => e.preventDefault();
    document.addEventListener('keydown', answer, { capture: true });
    fireEvent.keyDown(within(slotProps()).getByLabelText('Field title'), { key: 'Escape' });
    document.removeEventListener('keydown', answer, { capture: true });
    expect(within(slotProps()).getByTestId('stub-field-inspector')).toBeInTheDocument();

    // Pressed inside the slot's inspector: the pillar's, though outside its DOM.
    fireEvent.keyDown(within(slotProps()).getByLabelText('Field title'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('data-field-inspector')).toBeNull());
    expect(slot()).toHaveAttribute('data-mode', 'copilot');
    expect(within(slot()).queryAllByRole('tab')).toHaveLength(0);
  });

  it('a click on empty canvas drops it too; a click on the field does not', async () => {
    const card = await selectDataField();

    fireEvent.click(card);
    expect(within(slotProps()).getByTestId('stub-field-inspector')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('data-canvas-main'));
    await waitFor(() => expect(screen.queryByTestId('data-field-inspector')).toBeNull());
    expect(slot()).toHaveAttribute('data-mode', 'copilot');
  });

  it('a second field selected while the copilot shows asks for the properties again', async () => {
    await selectDataField();
    fireEvent.click(screen.getByTestId('studio-slot-copilot-strip'));
    expect(slot()).toHaveAttribute('data-mode', 'copilot');
    // The selection stands: the copilot stays chosen.
    expect(within(slotProps()).getByTestId('stub-field-inspector')).toBeInTheDocument();

    // The same field again is no new selection: the copilot stays chosen.
    fireEvent.click(screen.getByText('Title').closest('[role="button"]') as HTMLElement);
    expect(slot()).toHaveAttribute('data-mode', 'copilot');

    fireEvent.click(screen.getByText('Due').closest('[role="button"]') as HTMLElement);
    await waitFor(() => expect(slot()).toHaveAttribute('data-mode', 'props'));
    expect(within(slotProps()).getByLabelText('Field due')).toBeInTheDocument();
  });

  it('no copilot served: a selection shows the slot with the properties alone', async () => {
    copilot.available = false;
    renderAt('data');
    fireEvent.click(await screen.findByRole('button', { name: /Task/ }, SLOW));
    fireEvent.click(await screen.findByRole('button', { name: t('engine.studio.data.tab.form', 'en') }, SLOW));
    const card = (await screen.findByText('Title', undefined, SLOW)).closest('[role="button"]') as HTMLElement;
    await act(async () => {});
    expect(slot()).not.toBeVisible();

    fireEvent.click(card);
    await waitFor(() => expect(slot()).toBeVisible());
    expect(slot()).toHaveAttribute('data-mode', 'props');
    expect(screen.queryByTestId('studio-slot-copilot-strip')).toBeNull();
    expect(within(slotProps()).getByTestId('stub-field-inspector')).toBeVisible();
  });
});

describe('Automations: the Configuration is in the right slot (objectui#12725)', () => {
  it("holds the slot with the flow's Configuration while nothing is selected; no aside beside the canvas", async () => {
    await openFlow();
    await waitFor(() => expect(within(slot()).getAllByRole('tab')).toHaveLength(2));
    expect(slot()).toHaveAttribute('data-mode', 'copilot');
    expect(screen.getAllByTestId('auto-config-aside')).toHaveLength(1);
    expect(slotProps().contains(screen.getByTestId('auto-config-aside'))).toBe(true);
    expect(slotProps()).toHaveTextContent(t('engine.studio.auto.emptyLine1', 'en'));
  });

  it("selecting a node switches the slot to 属性 with that node's configuration, the copilot a strip at its foot", async () => {
    await openFlow();
    fireEvent.click(screen.getByTestId('pick-node'));

    await waitFor(() => expect(slot()).toHaveAttribute('data-mode', 'props'));
    expect(within(slotProps()).getByTestId('stub-flow-inspector')).toBeVisible();
    expect(screen.getAllByTestId('auto-config-aside')).toHaveLength(1);
    expect(screen.queryByTestId('auto-config-drawer')).toBeNull();
    expect(screen.getByTestId('copilot-body')).not.toBeVisible();
    expect(slot().lastElementChild).toBe(screen.getByTestId('studio-slot-copilot-strip'));
  });

  it("Esc returns to the flow's own Configuration; an Escape typed in the inspector is the field's", async () => {
    await openFlow();
    fireEvent.click(screen.getByTestId('pick-node'));
    await waitFor(() => expect(within(slotProps()).getByTestId('stub-flow-inspector')).toBeInTheDocument());

    fireEvent.keyDown(within(slotProps()).getByLabelText('Node start'), { key: 'Escape' });
    expect(within(slotProps()).getByTestId('stub-flow-inspector')).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(within(slotProps()).queryByTestId('stub-flow-inspector')).toBeNull());
    expect(slot()).toHaveAttribute('data-mode', 'props');
    expect(slotProps()).toHaveTextContent(t('engine.studio.auto.emptyLine1', 'en'));
  });

  it("the canvas's background press returns there too", async () => {
    await openFlow();
    fireEvent.click(screen.getByTestId('pick-node'));
    await waitFor(() => expect(within(slotProps()).getByTestId('stub-flow-inspector')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('flow-background'));
    await waitFor(() => expect(within(slotProps()).queryByTestId('stub-flow-inspector')).toBeNull());
    expect(slotProps()).toHaveTextContent(t('engine.studio.auto.emptyLine1', 'en'));
  });

  it('a second node selected while the copilot shows asks for the properties again', async () => {
    await openFlow();
    fireEvent.click(screen.getByTestId('pick-node'));
    await waitFor(() => expect(slot()).toHaveAttribute('data-mode', 'props'));
    fireEvent.click(screen.getByTestId('studio-slot-copilot-strip'));
    expect(slot()).toHaveAttribute('data-mode', 'copilot');

    fireEvent.click(screen.getByTestId('pick-other-node'));
    await waitFor(() => expect(slot()).toHaveAttribute('data-mode', 'props'));
    expect(within(slotProps()).getByLabelText('Node end')).toBeInTheDocument();
  });

  it('a row too narrow for the classic aside opens no drawer: the Configuration is in the slot, outside the row', async () => {
    const original = Element.prototype.getBoundingClientRect;
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.getAttribute('data-testid') !== 'auto-layout-row') return original.call(this);
      return { x: 0, y: 0, top: 0, left: 0, right: 390, bottom: 0, width: 390, height: 0, toJSON: () => ({}) } as DOMRect;
    });
    try {
      await openFlow();
      fireEvent.click(screen.getByTestId('pick-node'));
      await waitFor(() => expect(within(slotProps()).getByTestId('stub-flow-inspector')).toBeVisible());
      expect(screen.queryByTestId('auto-config-drawer')).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      rect.mockRestore();
    }
  });

  it('a hidden slot stays hidden on a selection, as on Interfaces', async () => {
    window.sessionStorage.setItem(DOCK_STUDIO_EXPANDED_STORAGE_KEY, '0');
    await openFlow();
    expect(slot()).not.toBeVisible();

    fireEvent.click(screen.getByTestId('pick-node'));
    await act(async () => {});
    expect(slot()).not.toBeVisible();
    expect(screen.queryByTestId('auto-config-drawer')).toBeNull();
    // Shown again, it opens on the selection's properties.
    fireEvent.click(screen.getByTestId('studio-slot-toggle'));
    expect(slot()).toHaveAttribute('data-mode', 'props');
    expect(within(slotProps()).getByTestId('stub-flow-inspector')).toBeVisible();
  });
});

describe('CONTROL — a pillar that claims nothing (objectui#12725)', () => {
  it('Access keeps its own layout: the slot shows the copilot alone, with no properties half', async () => {
    renderAt('access');
    await waitFor(() => expect(slot()).toHaveAttribute('data-mode', 'copilot'));
    expect(within(slot()).queryAllByRole('tab')).toHaveLength(0);
    expect(slotProps()).toBeEmptyDOMElement();
  });
});
