// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11778 — the flow canvas's three ways to add a node agree.
 *
 * Before the fix, on the `start → end` draft Studio creates a new flow with:
 *
 *   - the toolbar's Add node put the picked node beside the path (a second
 *     branch `start → N` with Start selected, no edge at all with nothing
 *     selected);
 *   - an edge's "+" and a node's "Add connected node" never asked for a type:
 *     each added a `create_record`, the edge's pinned at its endpoints'
 *     midpoint, on top of the Start card.
 *
 * Now each "+" opens the one add-node palette, the pick goes INTO the path,
 * and the node is left to the layered auto-layout. Driven through the real
 * canvas over a host that merges each patch into the draft and keeps the
 * selection the canvas reports, as Studio does. Palette rows are pressed with
 * `browserClick`, which routes the click the way a browser does after a
 * pointer capture (objectui#11546): a palette opened from an edge or a card
 * lives inside the canvas viewport in the React tree.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { FlowCanvas } from './FlowCanvas';
import { NODE_H, type FlowDesignerEdge, type FlowDesignerNode } from './flow-canvas-layout';
import { browserClick } from './__tests__/browserClick';

// The palette's engine overlay answers "engine absent": the canvas then offers
// the hardcoded palette, its offline answer. Installed for the whole file so no
// read flushed after a test body reaches a real socket.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('not found', { status: 404 })),
);

afterEach(() => {
  cleanup();
  // The palette's "Recently used" group lives in localStorage outside a provider.
  localStorage.clear();
});

type Draft = { nodes: FlowDesignerNode[]; edges: FlowDesignerEdge[] };

/** The draft Studio's "New flow" saves (`buildFlowSkeleton`). */
const skeleton = (): Draft => ({
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

function mount(initial: Draft, selected: string | null = null) {
  const probe = { draft: initial, patches: 0 };
  function Host() {
    const [draft, setDraft] = React.useState<Draft>(initial);
    const [selectedId, setSelectedId] = React.useState<string | null>(selected);
    React.useEffect(() => {
      probe.draft = draft;
    }, [draft]);
    return (
      <FlowCanvas
        nodes={draft.nodes}
        edges={draft.edges}
        editable
        designMode
        selectedId={selectedId}
        onSelect={(n) => setSelectedId(n?.id ?? null)}
        onPatch={(patch) => {
          probe.patches += 1;
          setDraft((d) => ({ ...d, ...(patch as Partial<Draft>) }));
        }}
      />
    );
  }
  const utils = render(<Host />);
  return { probe, ...utils };
}

const pairs = (d: Draft) => d.edges.map((e) => `${e.source}->${e.target}`);
const added = (d: Draft) => d.nodes.filter((n) => n.id !== 'start' && n.id !== 'end');

/** Press the open palette's row for `label` the way a browser routes the click. */
function pick(label: string) {
  const option = screen.getAllByRole('option').find((o) => o.textContent?.startsWith(label));
  expect(option, `the open palette offers ${label}`).toBeDefined();
  browserClick(option!);
}

const edgePlus = () => screen.getByRole('button', { name: 'Insert node here' });
const toolbarAdd = () => screen.getByRole('button', { name: 'Add node' });
function cardPlus(container: HTMLElement, id: string) {
  const card = container.querySelector(`[data-node-id="${id}"]`) as HTMLElement;
  return within(card).getByRole('button', { name: 'Add connected node' });
}
const topOf = (container: HTMLElement, id: string) =>
  parseFloat((container.querySelector(`[data-node-id="${id}"]`) as HTMLElement).style.top);

describe('every "+" opens the add-node palette, and nothing lands before a pick (objectui#11778)', () => {
  it('the edge "+": no node yet, the grouped palette is open', () => {
    const { probe } = mount(skeleton());
    fireEvent.click(edgePlus());
    expect(probe.patches, 'the "+" alone adds nothing').toBe(0);
    expect(screen.getByPlaceholderText('Search nodes…')).toBeInTheDocument();
    expect(screen.getByText('Integration')).toBeInTheDocument();
  });

  it('a node card\'s "Add connected node": no node yet, the grouped palette is open', () => {
    const { probe, container } = mount(skeleton());
    fireEvent.click(cardPlus(container, 'start'));
    expect(probe.patches).toBe(0);
    expect(screen.getByPlaceholderText('Search nodes…')).toBeInTheDocument();
  });
});

describe('the edge "+" inserts the picked type between the edge\'s endpoints (objectui#11778)', () => {
  it('picking Notify on start → end gives start → notify → end, one edge in and one out', () => {
    const { probe } = mount(skeleton());
    fireEvent.click(edgePlus());
    pick('Notify');
    const [node] = added(probe.draft);
    expect(node.type).toBe('notify');
    expect(pairs(probe.draft)).toEqual([`start->${node.id}`, `${node.id}->end`]);
    // The inserted segment keeps the edge's identity; the new one carries on.
    expect(probe.draft.edges[0].id).toBe('e1');
  });

  it('the inserted node is not pinned: the layered layout gives it its own layer, clear of Start', () => {
    const { probe, container } = mount(skeleton());
    fireEvent.click(edgePlus());
    pick('Notify');
    const [node] = added(probe.draft);
    expect(node.position, 'no stored position').toBeUndefined();
    const start = topOf(container, 'start');
    const mid = topOf(container, node.id);
    const end = topOf(container, 'end');
    expect(mid - start, 'below the Start card, not on top of it').toBeGreaterThanOrEqual(NODE_H);
    expect(end - mid, 'and End moves down below it').toBeGreaterThanOrEqual(NODE_H);
  });
});

describe('"Add connected node" puts the picked type after its node, in the path (objectui#11778)', () => {
  it('on Start of start → end: start → N → end, no second branch from Start', () => {
    const { probe, container } = mount(skeleton());
    fireEvent.click(cardPlus(container, 'start'));
    pick('Notify');
    const [node] = added(probe.draft);
    expect(node.type).toBe('notify');
    expect(pairs(probe.draft)).toEqual([`start->${node.id}`, `${node.id}->end`]);
    expect(node.position).toBeUndefined();
  });

  it('on a node with no way on: appends after it', () => {
    const { probe, container } = mount({
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'a', type: 'script', label: 'A' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'a' }],
    });
    fireEvent.click(cardPlus(container, 'a'));
    pick('Create record');
    const node = probe.draft.nodes.find((n) => !['start', 'a'].includes(n.id))!;
    expect(pairs(probe.draft)).toEqual(['start->a', `a->${node.id}`]);
  });

  it('on a decision: a new branch from it, carrying its next condition — a decision has no single path on', () => {
    const { probe, container } = mount({
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        {
          id: 'd',
          type: 'decision',
          label: 'Big?',
          config: { conditions: [{ label: 'Big', expression: 'amount > 100' }, { label: 'Else', expression: 'true' }] },
        },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'd' },
        { id: 'e2', source: 'd', target: 'end', label: 'Big', condition: 'amount > 100' },
      ],
    });
    fireEvent.click(cardPlus(container, 'd'));
    pick('Notify');
    const node = probe.draft.nodes.find((n) => n.type === 'notify')!;
    expect(pairs(probe.draft)).toEqual(['start->d', 'd->end', `d->${node.id}`]);
    expect(probe.draft.edges[2]).toMatchObject({ source: 'd', target: node.id, label: 'Else', isDefault: true });
  });
});

describe('the toolbar\'s Add node puts the picked type after the selected node, else after Start (objectui#11778)', () => {
  it('nothing selected, on start → end: start → N → end — never a node wired to nothing', () => {
    const { probe } = mount(skeleton());
    fireEvent.click(toolbarAdd());
    pick('Notify');
    const [node] = added(probe.draft);
    expect(pairs(probe.draft)).toEqual([`start->${node.id}`, `${node.id}->end`]);
  });

  it('Start selected: the same — not the card\'s second branch start → notify beside start → end', () => {
    const { probe } = mount(skeleton(), 'start');
    fireEvent.click(toolbarAdd());
    pick('Notify');
    const [node] = added(probe.draft);
    expect(pairs(probe.draft)).toEqual([`start->${node.id}`, `${node.id}->end`]);
    expect(pairs(probe.draft)).not.toContain('start->end');
  });

  it('End selected: the node goes before End — an End has no "after"', () => {
    const { probe } = mount(
      {
        nodes: [...skeleton().nodes, { id: 'a', type: 'script', label: 'A' }],
        edges: [
          { id: 'e1', source: 'start', target: 'a' },
          { id: 'e2', source: 'a', target: 'end' },
        ],
      },
      'end',
    );
    fireEvent.click(toolbarAdd());
    pick('Notify');
    const node = probe.draft.nodes.find((n) => n.type === 'notify')!;
    expect(pairs(probe.draft)).toEqual(['start->a', `a->${node.id}`, `${node.id}->end`]);
  });

  it('adds in a row build the path in order, because the new node is the selection the next add follows', () => {
    const { probe } = mount(skeleton());
    for (const label of ['Notify', 'Create record', 'Script']) {
      fireEvent.click(toolbarAdd());
      pick(label);
    }
    const [n1, n2, n3] = added(probe.draft);
    expect([n1.type, n2.type, n3.type]).toEqual(['notify', 'create_record', 'script']);
    expect(pairs(probe.draft).sort()).toEqual(
      [`start->${n1.id}`, `${n1.id}->${n2.id}`, `${n2.id}->${n3.id}`, `${n3.id}->end`].sort(),
    );
  });
});
