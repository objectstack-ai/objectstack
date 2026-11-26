// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12725, phase 2 — properties follow the selection in every pillar
 * (「studio 中其他的设计面板属性都是右侧打开的」, 「属性好需要考虑选中每个元素的时候也要显示」):
 * the Data and Automations pillars host their properties in the surface's one
 * right slot, through the seam the Interfaces pillar uses
 * (`useStudioRightSlot`), instead of an aside of their own.
 *
 *  - Data: selecting a field opens the slot and shows the field inspector in
 *    it; no `data-field-inspector` beside the canvas. The pillar has no
 *    properties of its own with nothing selected, so Esc or a click on empty
 *    canvas closes the slot again.
 *  - Automations: the Configuration is in the slot from the start (its empty
 *    sentence while nothing is selected, as the aside had); selecting a node
 *    shows its configuration, and Esc or the canvas's background press
 *    returns it to the flow's Configuration. A row too narrow for the classic
 *    aside opens no drawer (objectui#11795's fold is the classic layout's).
 *  - A hidden slot unfolds on a new selection (objectstack#26737); hidden again
 *    over the same selection, it stays hidden.
 *  - CONTROL: the sharing overview (objectstack#36905; the Access pillar before
 *    it) claims nothing — the slot stays closed.
 *
 * The flow canvas and both inspectors are stubs: the canvas reports a node
 * selection, or a background press, as `onSelectionChange`.
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

// The source loads `@objectstack/lint` lazily; paid here, at collection, not
// inside a case's clock (check:test-source-alias).
import '@objectstack/lint';
// objectstack#36900 — the surface mounts the command palette, which reaches the
// record preview's `lazy()` detail entry: its first load is paid at collection too.
import '@object-ui/plugin-detail';
import { StudioDesignSurface } from './StudioDesignSurface';
import { StudioPillarRedirect } from './StudioPillarRedirect';
import { t } from '../metadata-admin/i18n';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { DOCK_STUDIO_EXPANDED_STORAGE_KEY } from '../../layout/chatDockState';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
// The source under test reaches these dynamic imports (the command palette's
// record preview, the drafts panel's lint, the code editor): their first load
// is paid here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@object-ui/plugin-detail';

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
        <Route path="/studio/:packageId/metadata/*" element={<StudioDesignSurface area="metadata" />} />
        <Route path="/studio/:packageId/:tab" element={<StudioPillarRedirect><StudioDesignSurface /></StudioPillarRedirect>} />
      </Routes>
    </MemoryRouter>,
  );
}

const SLOW = { timeout: 4000 };
/** objectstack#36904 — the Task object's designer, on its own address. */
const TASK_DESIGNER = 'metadata/object/acme_task';
const slot = () => screen.getByTestId('studio-right-slot');
const slotProps = () => screen.getByTestId('studio-slot-props');

/** Data: open the object's Form tab and click its one field's card. */
async function selectDataField() {
  renderAt(TASK_DESIGNER);
  fireEvent.click(await screen.findByRole('button', { name: t('engine.studio.data.tab.form', 'en') }, SLOW));
  const card = (await screen.findByText('Title', undefined, SLOW)).closest('[role="button"]') as HTMLElement;
  fireEvent.click(card);
  await waitFor(() => expect(within(slotProps()).getByTestId('stub-field-inspector')).toBeInTheDocument());
  return card;
}

/** The flow designer on the flow's address (objectstack#36903); its canvas is the stub above. */
async function openFlow() {
  renderAt('metadata/flow/notify_owner');
  await screen.findByTestId('pick-node', undefined, SLOW);
}

describe('Data: the field inspector is in the right slot (objectui#12725)', () => {
  it('claims nothing while no field is selected: the slot stays closed', async () => {
    renderAt(TASK_DESIGNER);
    fireEvent.click(await screen.findByRole('button', { name: t('engine.studio.data.tab.form', 'en') }, SLOW));
    await screen.findByText('Title', undefined, SLOW);
    await act(async () => {});
    expect(slot()).not.toBeVisible();
    expect(screen.queryByTestId('data-field-inspector')).toBeNull();
  });

  it("selecting a field opens the slot with that field's inspector", async () => {
    await selectDataField();

    expect(slot()).toBeVisible();
    expect(within(slot()).getByTestId('studio-slot-title')).toHaveTextContent(t('engine.studio.inspector.props', 'en'));
    // The one field inspector is the slot's: none beside the canvas.
    expect(screen.getAllByTestId('data-field-inspector')).toHaveLength(1);
    expect(slotProps().contains(screen.getByTestId('data-field-inspector'))).toBe(true);
    expect(within(slotProps()).getByTestId('stub-field-inspector')).toBeVisible();
  });

  it('Esc drops the selection and closes the slot; an Escape another layer took does not', async () => {
    await selectDataField();

    const answer = (e: KeyboardEvent) => e.preventDefault();
    document.addEventListener('keydown', answer, { capture: true });
    fireEvent.keyDown(within(slotProps()).getByLabelText('Field title'), { key: 'Escape' });
    document.removeEventListener('keydown', answer, { capture: true });
    expect(within(slotProps()).getByTestId('stub-field-inspector')).toBeInTheDocument();

    // Pressed inside the slot's inspector: the pillar's, though outside its DOM.
    fireEvent.keyDown(within(slotProps()).getByLabelText('Field title'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('data-field-inspector')).toBeNull());
    expect(slot()).not.toBeVisible();
  });

  it('a click on empty canvas drops it too; a click on the field does not', async () => {
    const card = await selectDataField();

    fireEvent.click(card);
    expect(within(slotProps()).getByTestId('stub-field-inspector')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('data-canvas-main'));
    await waitFor(() => expect(screen.queryByTestId('data-field-inspector')).toBeNull());
    expect(slot()).not.toBeVisible();
  });

  it('a selection shows the slot with the properties', async () => {
    renderAt(TASK_DESIGNER);
    fireEvent.click(await screen.findByRole('button', { name: t('engine.studio.data.tab.form', 'en') }, SLOW));
    const card = (await screen.findByText('Title', undefined, SLOW)).closest('[role="button"]') as HTMLElement;
    await act(async () => {});
    expect(slot()).not.toBeVisible();

    fireEvent.click(card);
    await waitFor(() => expect(slot()).toBeVisible());
    expect(within(slotProps()).getByTestId('stub-field-inspector')).toBeVisible();
  });
});

describe('Automations: the Configuration is in the right slot (objectui#12725)', () => {
  it("holds the slot with the flow's Configuration while nothing is selected; no aside beside the canvas", async () => {
    await openFlow();
    await waitFor(() => expect(slot()).toBeVisible());
    expect(screen.getAllByTestId('auto-config-aside')).toHaveLength(1);
    expect(slotProps().contains(screen.getByTestId('auto-config-aside'))).toBe(true);
    expect(slotProps()).toHaveTextContent(t('engine.studio.auto.emptyLine1', 'en'));
  });

  it("selecting a node shows that node's configuration in the slot", async () => {
    await openFlow();
    fireEvent.click(screen.getByTestId('pick-node'));

    await waitFor(() => expect(within(slotProps()).getByTestId('stub-flow-inspector')).toBeVisible());
    expect(screen.getAllByTestId('auto-config-aside')).toHaveLength(1);
    expect(screen.queryByTestId('auto-config-drawer')).toBeNull();
  });

  it("Esc returns to the flow's own Configuration; an Escape typed in the inspector is the field's", async () => {
    await openFlow();
    fireEvent.click(screen.getByTestId('pick-node'));
    await waitFor(() => expect(within(slotProps()).getByTestId('stub-flow-inspector')).toBeInTheDocument());

    fireEvent.keyDown(within(slotProps()).getByLabelText('Node start'), { key: 'Escape' });
    expect(within(slotProps()).getByTestId('stub-flow-inspector')).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(within(slotProps()).queryByTestId('stub-flow-inspector')).toBeNull());
    expect(slot()).toBeVisible();
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

  // objectstack#26737 — at a desktop width (no `md` match), a node selected
  // while the panel is hidden unfolds it on that node's configuration.
  it('a hidden slot unfolds on a selection, on the selected node’s configuration', async () => {
    await openFlow();
    fireEvent.click(await screen.findByTestId('studio-slot-toggle'));
    expect(slot()).not.toBeVisible();
    expect(window.sessionStorage.getItem(DOCK_STUDIO_EXPANDED_STORAGE_KEY)).toBe('0');

    fireEvent.click(screen.getByTestId('pick-node'));
    await waitFor(() => expect(slot()).toBeVisible());
    expect(within(slotProps()).getByLabelText('Node start')).toBeVisible();
    expect(screen.getByTestId('studio-slot-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect(window.sessionStorage.getItem(DOCK_STUDIO_EXPANDED_STORAGE_KEY)).toBe('1');
    expect(screen.queryByTestId('auto-config-drawer')).toBeNull();
  });

  it('hidden again over the same selection, it stays hidden until another node is selected', async () => {
    await openFlow();
    fireEvent.click(screen.getByTestId('pick-node'));
    await waitFor(() => expect(within(slotProps()).getByTestId('stub-flow-inspector')).toBeVisible());

    fireEvent.click(screen.getByTestId('studio-slot-toggle'));
    await act(async () => {});
    expect(slot()).not.toBeVisible();
    // The same node again is no new selection.
    fireEvent.click(screen.getByTestId('pick-node'));
    await act(async () => {});
    expect(slot()).not.toBeVisible();

    fireEvent.click(screen.getByTestId('pick-other-node'));
    await waitFor(() => expect(slot()).toBeVisible());
    expect(within(slotProps()).getByLabelText('Node end')).toBeVisible();
  });
});

describe('CONTROL — a pillar that claims nothing (objectui#12725)', () => {
  it('the sharing overview keeps its own layout: the slot stays closed and empty', async () => {
    renderAt('owd');
    await screen.findByTestId('studio-shell-header');
    await act(async () => {});
    expect(slot()).not.toBeVisible();
    expect(slotProps()).toBeEmptyDOMElement();
  });
});

// objectstack#37520 (S1) — the title row's right-most icon is the slot's show /
// hide toggle. objectstack#37455 moved it from the top bar to the end of the
// open page's title row; the flow designer claims the slot from the start (its
// Configuration), so the toggle is drawn there with nothing selected.
describe('the slot\'s toggle ends the page\'s title row (objectstack#37520)', () => {
  const toggle = () => screen.getByTestId('studio-slot-toggle');

  it('in the page\'s title row, behind a hairline, not in the top bar; it hides and shows the slot', async () => {
    await openFlow();
    await waitFor(() => expect(slot()).toBeVisible());

    const button = await screen.findByTestId('studio-slot-toggle');
    expect(screen.getAllByTestId('studio-slot-toggle')).toHaveLength(1);
    expect(within(screen.getByTestId('studio-shell-header')).queryByTestId('studio-slot-toggle')).toBeNull();
    expect(screen.getByTestId('studio-pillars-host')).toContainElement(button);
    expect(slot().contains(button)).toBe(false);
    // The last control of its row, the hairline right before it.
    expect(button.parentElement?.lastElementChild).toBe(button);
    expect(button.previousElementSibling).toHaveAttribute('data-testid', 'studio-title-row-divider');
    expect(screen.queryByTestId('topbar-ai-assistant')).toBeNull();

    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAccessibleName(t('engine.studio.slot.collapse', 'en'));
    fireEvent.click(button);
    expect(slot()).not.toBeVisible();
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    expect(toggle()).toHaveAccessibleName(t('engine.studio.slot.expand', 'en'));

    fireEvent.click(toggle());
    expect(slot()).toBeVisible();
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
  });
});
