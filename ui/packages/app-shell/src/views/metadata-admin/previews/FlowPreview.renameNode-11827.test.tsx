// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11827 — renaming a node in the flow designer keeps it connected.
 *
 * Driven the way an author drives Studio: the real `FlowPreview` (canvas) and
 * the real `FlowInspector` side by side, over a host that merges each patch
 * shallowly into the draft — the `{ ...d, ...patch }` merge the Studio
 * Automations pillar applies. The author clicks a node card, types a new id in
 * the inspector's ID field and leaves the field.
 *
 * Before the fix the field committed `{ nodes }` alone on every keystroke: both
 * edges kept naming the old id (the Problems panel listed them as dangling) and
 * the selection still named the old id, so the inspector lost its node after
 * the first character.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';

// The engine palette / config-schema reads are stubbed to their offline answer
// and the trigger field catalog to an empty one, so nothing here needs a
// network client (the inspectors' own tests stub the same two hooks). The
// palette's offline answer is the hardcoded `NODE_PALETTE`: since
// objectui#11778 every "+" opens it and the node lands on a pick.
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

import { t } from '../i18n';
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

/** The Studio Automations pillar in miniature (as `FlowPreview.removeNode-11772.test.tsx`). */
function Host({ initial, onDraft }: { initial: Draft; onDraft: (d: Draft) => void }) {
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
        locale="en-US"
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
          locale="en-US"
        />
      )}
    </>
  );
}

function mount(initial: Draft) {
  const probe = { draft: initial };
  const onDraft = (d: Draft) => {
    probe.draft = d;
  };
  const utils = render(<Host initial={initial} onDraft={onDraft} />);
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

function selectCard(container: HTMLElement, nodeId: string) {
  const card = container.querySelector(`[data-node-id="${nodeId}"] [role="button"]`) as HTMLElement;
  expect(card, `node card ${nodeId}`).not.toBeNull();
  fireEvent.click(card);
}

const idField = () => screen.getByLabelText(t('engine.inspector.flowNode.id', 'en-US')) as HTMLInputElement;

/** Type a new id into the inspector's ID field and leave the field. */
function renameSelected(next: string) {
  fireEvent.change(idField(), { target: { value: next } });
  fireEvent.blur(idField());
}

function pickCreateRecord() {
  const option = screen.getAllByRole('option').find((o) => o.textContent?.startsWith('Create record'));
  expect(option, 'the palette offers Create record').toBeDefined();
  fireEvent.click(option!);
}

/** The "+" under a node card — select-then-append. */
function addConnectedFrom(container: HTMLElement, nodeId: string) {
  const card = container.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement;
  expect(card, `node card ${nodeId}`).not.toBeNull();
  fireEvent.click(within(card).getByRole('button', { name: t('engine.flowCanvas.addConnected', 'en-US') }));
  pickCreateRecord();
}

/** The card's flow: `s → x → e`. */
function card(): Draft {
  return {
    name: 'rename_probe',
    label: 'Rename probe',
    type: 'autolaunched',
    nodes: [
      { id: 's', type: 'start', label: 'Start' },
      { id: 'x', type: 'create_record', label: 'Create record' },
      { id: 'e', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'in', source: 's', target: 'x' },
      { id: 'out', source: 'x', target: 'e' },
    ],
  };
}

describe('flow designer: a renamed node keeps its edges (objectui#11827)', () => {
  it("the card's pin: rename x → renamed — both edges follow, nothing dangles, the Problems panel stays empty", () => {
    const { probe, container } = mount(card());
    selectCard(container, 'x');
    renameSelected('renamed');

    expect(nodesOf(probe.draft).map((n) => n.id)).toEqual(['s', 'renamed', 'e']);
    expect(pairs(probe.draft)).toEqual(['s->renamed', 'renamed->e']);
    expect(edgesOf(probe.draft).map((e) => e.id)).toEqual(['in', 'out']);
    expect(danglingEdges(probe.draft)).toEqual([]);

    fireEvent.click(screen.getByTitle(t('engine.flowPreview.problemsTitle', 'en-US')));
    expect(screen.getByText(t('engine.flowProblems.empty', 'en-US'))).toBeInTheDocument();
  });

  it('the inspector and the canvas selection stay on the renamed node', () => {
    const { container } = mount(card());
    selectCard(container, 'x');
    renameSelected('renamed');
    expect(idField().value).toBe('renamed');
    expect(container.querySelector('[data-node-id="renamed"]')).not.toBeNull();
    expect(container.querySelector('[data-node-id="x"]')).toBeNull();
  });

  it('after a rename, Add connected node never mints the old id — the session still remembers it', async () => {
    // `node_1` is the id the designer itself minted, the one it would mint
    // again: after the rename nothing in the draft names it, and only the
    // session's ledger (objectui#11772) keeps it from being handed out.
    const initial: Draft = {
      ...card(),
      nodes: [
        { id: 's', type: 'start', label: 'Start' },
        { id: 'node_1', type: 'create_record', label: 'Create record' },
        { id: 'e', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'in', source: 's', target: 'node_1' },
        { id: 'out', source: 'node_1', target: 'e' },
      ],
    };
    const { probe, container } = mount(initial);
    // Let the session's ledger record the ids it was opened with.
    await act(async () => {});
    selectCard(container, 'node_1');
    renameSelected('create_ticket');
    expect(pairs(probe.draft)).toEqual(['s->create_ticket', 'create_ticket->e']);

    addConnectedFrom(container, 's');
    const added = nodesOf(probe.draft).find((n) => !['s', 'create_ticket', 'e'].includes(n.id));
    expect(added, 'the added node').toBeTruthy();
    expect(added!.id).not.toBe('node_1');
    expect(danglingEdges(probe.draft)).toEqual([]);
  });
});
