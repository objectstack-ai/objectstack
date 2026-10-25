// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11772 — removing a node in the flow designer takes its edges with
 * it, and a node added afterwards never inherits an edge a removed one left.
 *
 * Driven the way an author drives Studio: the real `FlowPreview` (canvas) and
 * the real `FlowInspector` side by side, over a host that merges each patch
 * shallowly into the draft — the `{ ...d, ...patch }` merge the Studio
 * Automations pillar applies. The gestures are the card's reproduction, on the
 * draft Studio creates a new flow with (`buildFlowSkeleton`: `start → end`,
 * edge `e1`):
 *
 *   1. the edge's "Insert node here" — a node lands on `start → end`;
 *   2. the inspector's "Remove node";
 *   3. the start node's "Add connected node".
 *
 * Before the fix step 2 left `start → node_1` and `node_1 → end` naming a node
 * that no longer existed, and step 3 minted `node_1` again, so both stale edges
 * re-attached to the new node: the published flow then ran it once per edge.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';

// The engine palette / config-schema reads are stubbed to their offline answer
// and the trigger field catalog to an empty one, so nothing here needs a
// network client (the inspectors' own tests stub the same two hooks). The
// palette's offline answer is the hardcoded `NODE_PALETTE`, not an empty list:
// since objectui#11778 every "+" opens it and the node lands on a pick.
vi.mock('./useFlowNodePalette', async () => {
  const { NODE_PALETTE } = await import('./flow-canvas-parts');
  return {
    useActionConfigSchemas: () => ({}),
    useFlowNodePalette: () => NODE_PALETTE,
  };
});
vi.mock('./useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { t, tFormat, type SupportedLocale } from '../i18n';
import { FlowPreview } from './FlowPreview';
import { FlowInspector } from '../inspectors/FlowInspector';
import type { MetadataSelection } from '../preview-registry';

type Draft = Record<string, unknown>;
type Edge = { id?: string; source: string; target: string } & Record<string, unknown>;
type Node = { id: string; type?: string } & Record<string, unknown>;

// The canvas palette and the node inspectors read the engine
// (`/api/v1/automation/actions`, `/api/v1/meta/object`); answer every read as
// an absent engine. Installed once for the whole file and never torn down, so
// no read flushed after a test body can reach a real socket (the shape
// `RecordDetailView.approvalDeclaredActions.test.tsx` documents).
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('not found', { status: 404 })),
);

afterEach(cleanup);

/** The draft Studio's "New flow" saves (`buildFlowSkeleton`). */
function skeleton(): Draft {
  return {
    name: 'notify_on_done',
    label: 'Notify on Ticket Done',
    type: 'autolaunched',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
  };
}

/**
 * The Studio Automations pillar in miniature: one draft, one selection, the
 * canvas and the inspector both writing through the same shallow merge.
 */
function Host({ initial, onDraft, locale = 'en-US' }: { initial: Draft; onDraft: (d: Draft) => void; locale?: SupportedLocale }) {
  const [draft, setDraft] = React.useState<Draft>(initial);
  const [selection, setSelection] = React.useState<MetadataSelection | null>(null);
  const onPatch = React.useCallback((patch: Record<string, unknown>) => setDraft((d) => ({ ...d, ...patch })), []);
  React.useEffect(() => onDraft(draft), [draft, onDraft]);
  return (
    <>
      <FlowPreview
        type="flow"
        name={String(initial.name)}
        draft={draft}
        editing
        selection={selection}
        onSelectionChange={setSelection}
        onPatch={onPatch}
        locale={locale}
      />
      {selection && (
        <FlowInspector
          type="flow"
          name={String(initial.name)}
          draft={draft}
          selection={selection}
          onPatch={onPatch}
          onClearSelection={() => setSelection(null)}
          onSelectionChange={setSelection}
          readOnly={false}
          locale={locale}
        />
      )}
    </>
  );
}

function mount(initial: Draft, locale?: SupportedLocale) {
  const probe = { draft: initial };
  const onDraft = (d: Draft) => {
    probe.draft = d;
  };
  const utils = render(<Host initial={initial} onDraft={onDraft} locale={locale} />);
  return { probe, ...utils };
}

const nodesOf = (d: Draft) => d.nodes as Node[];
const edgesOf = (d: Draft) => d.edges as Edge[];
const pairs = (d: Draft) => edgesOf(d).map((e) => `${e.source}->${e.target}`);

/** Every edge whose endpoint names no node in the draft. */
function danglingEdges(d: Draft): Edge[] {
  const ids = new Set(nodesOf(d).map((n) => n.id));
  return edgesOf(d).filter((e) => !ids.has(e.source) || !ids.has(e.target));
}

/**
 * The open add-node palette's row for the node type the card's reproduction
 * added (`create_record`, the type the "+" inserted before objectui#11778 made
 * it ask).
 */
function pickCreateRecord() {
  const option = screen.getAllByRole('option').find((o) => o.textContent?.startsWith('Create record'));
  expect(option, 'the palette offers Create record').toBeDefined();
  fireEvent.click(option!);
}

function insertOnTheOnlyEdge() {
  fireEvent.click(screen.getByRole('button', { name: t('engine.flowCanvas.insertNode', 'en-US') }));
  pickCreateRecord();
}

function removeSelectedNode() {
  fireEvent.click(screen.getByRole('button', { name: t('engine.inspector.flowNode.remove', 'en-US') }));
}

/** The "+" under a node card — select-then-append, as in the card's step 4. */
function addConnectedFrom(container: HTMLElement, nodeId: string) {
  const card = container.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement;
  expect(card, `node card ${nodeId}`).not.toBeNull();
  fireEvent.click(within(card).getByRole('button', { name: t('engine.flowCanvas.addConnected', 'en-US') }));
  pickCreateRecord();
}

describe('flow designer: Remove node takes its edges, and a fresh node inherits none (objectui#11772)', () => {
  it("the card's reproduction: insert on start → end, remove it, add from start — one start → new edge, nothing dangling", () => {
    const { probe, container } = mount(skeleton());

    insertOnTheOnlyEdge();
    const inserted = nodesOf(probe.draft).find((n) => n.id !== 'start' && n.id !== 'end')!;
    expect(inserted, 'the inserted node').toBeTruthy();
    expect(pairs(probe.draft)).toEqual(['start->' + inserted.id, inserted.id + '->end']);

    // The inspector opened on the inserted node (the canvas selects what it adds).
    removeSelectedNode();
    expect(nodesOf(probe.draft).map((n) => n.id)).toEqual(['start', 'end']);
    expect(danglingEdges(probe.draft)).toEqual([]);

    addConnectedFrom(container, 'start');
    const added = nodesOf(probe.draft).find((n) => n.id !== 'start' && n.id !== 'end')!;
    expect(added, 'the added node').toBeTruthy();
    expect(added.id, 'a fresh node never takes the removed node’s id').not.toBe(inserted.id);
    expect(danglingEdges(probe.draft)).toEqual([]);
    expect(pairs(probe.draft).filter((p) => p === `start->${added.id}`)).toHaveLength(1);
    expect(edgesOf(probe.draft).some((e) => e.source === inserted.id || e.target === inserted.id)).toBe(false);
  });

  it('removing the node inserted on an edge gives the edge back exactly — the insert is undone byte for byte', () => {
    const before = skeleton();
    const { probe } = mount(before);
    insertOnTheOnlyEdge();
    removeSelectedNode();
    expect(JSON.stringify(probe.draft)).toBe(JSON.stringify(before));
  });

  it('control: with nothing removed, adding a connected node mints exactly what it did before the fix', () => {
    const { probe, container } = mount(skeleton());
    addConnectedFrom(container, 'start');
    expect(nodesOf(probe.draft).map((n) => n.id)).toEqual(['start', 'end', 'node_1']);
    // The same two ids as before the fix. Their WIRING is objectui#11778's: the
    // node goes into Start's one path (`e1` now ends at it, `edge_1` carries on
    // to End) where it used to open a second branch `start → node_1` beside it.
    expect(edgesOf(probe.draft)).toEqual([
      { id: 'e1', source: 'start', target: 'node_1' },
      { id: 'edge_1', source: 'node_1', target: 'end' },
    ]);
  });

  it('an id that existed earlier in the session is not minted again, even with every edge naming it gone', async () => {
    // node_1 exists with no edges at all, so removing it leaves no reference
    // behind — only the session remembers it.
    const initial: Draft = {
      ...skeleton(),
      nodes: [...(skeleton().nodes as Node[]), { id: 'node_1', type: 'create_record', label: 'Create record' }],
    };
    const { probe, container } = mount(initial);
    // Let the session's ledger record the ids it was opened with.
    await act(async () => {});
    fireEvent.click(container.querySelector('[data-node-id="node_1"] [role="button"]') as HTMLElement);
    removeSelectedNode();
    expect(nodesOf(probe.draft).map((n) => n.id)).toEqual(['start', 'end']);
    addConnectedFrom(container, 'start');
    const added = nodesOf(probe.draft).find((n) => n.id !== 'start' && n.id !== 'end')!;
    expect(added.id).not.toBe('node_1');
  });

  it('a stored flow already carrying an edge to a missing node: a new node does not take that id', () => {
    // The shape a draft saved before this fix can hold (the card's second
    // reproduction): nodes [start, end], edges naming the long-gone node_1.
    const stored: Draft = {
      ...skeleton(),
      edges: [
        { id: 'e1', source: 'start', target: 'node_1' },
        { id: 'edge_1', source: 'node_1', target: 'end' },
      ],
    };
    const { probe, container } = mount(stored);
    addConnectedFrom(container, 'start');
    const added = nodesOf(probe.draft).find((n) => n.id !== 'start' && n.id !== 'end')!;
    expect(added.id).not.toBe('node_1');
    // The stale edges stay dangling (no silent rewrite of stored data) — the
    // Problems panel names them, below.
    expect(danglingEdges(probe.draft).map((e) => e.id)).toEqual(['e1', 'edge_1']);
  });
});

/** Every Problems-panel row's message, after opening the panel. */
function panelMessages(locale: SupportedLocale): string[] {
  fireEvent.click(screen.getByTitle(t('engine.flowPreview.problemsTitle', locale)));
  const title = screen.getAllByText(t('engine.flowProblems.title', locale)).find((el) => el.tagName === 'SPAN');
  expect(title, 'the Problems panel title').toBeTruthy();
  const panel = title!.parentElement!.parentElement as HTMLElement;
  return within(panel)
    .queryAllByRole('listitem')
    .map((li) => li.querySelector('span.block')?.textContent ?? '');
}

describe('the Problems panel names a dangling edge and a repeated connection, so a stored flow can be repaired (objectui#11772)', () => {
  /** The flow the card published: three `start → node_1` edges. */
  const published = (): Draft => ({
    ...skeleton(),
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'node_1', type: 'create_record', label: 'Create record', config: { objectName: 'repairs_repair_ticket' } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'node_1' },
      { id: 'edge_1', source: 'start', target: 'node_1' },
      { id: 'edge_3', source: 'start', target: 'node_1' },
      { id: 'edge_2', source: 'node_1', target: 'end' },
    ],
  });

  /** The card's second reproduction: the saved draft after step 3. */
  const dangling = (): Draft => ({
    ...skeleton(),
    edges: [
      { id: 'e1', source: 'start', target: 'node_1' },
      { id: 'edge_1', source: 'node_1', target: 'end' },
    ],
  });

  for (const locale of ['en-US', 'zh-CN'] as const) {
    it(`${locale}: each extra copy of start → node_1 is a row; the first copy is not`, () => {
      mount(published(), locale);
      const rows = panelMessages(locale);
      const repeated = tFormat('engine.flowProblems.repeatedEdge', locale, { sourceName: 'Start', source: 'start', targetName: 'Create record', target: 'node_1' });
      expect(repeated).not.toBe('engine.flowProblems.repeatedEdge');
      expect(rows.filter((m) => m === repeated)).toHaveLength(2);
      expect(rows).not.toContain(t('engine.flowProblems.empty', locale));
    });

    it(`${locale}: both edges naming the missing node_1 are rows`, () => {
      mount(dangling(), locale);
      const rows = panelMessages(locale);
      expect(rows).toContain(tFormat('engine.flowValidate.edgeTargetMissing', locale, { target: 'node_1' }));
      expect(rows).toContain(tFormat('engine.flowValidate.edgeSourceMissing', locale, { source: 'node_1' }));
    });
  }

  it('control: the skeleton itself draws no row', () => {
    mount(skeleton(), 'en-US');
    fireEvent.click(screen.getByTitle(t('engine.flowPreview.problemsTitle', 'en-US')));
    expect(screen.getByText(t('engine.flowProblems.empty', 'en-US'))).toBeInTheDocument();
  });
});
