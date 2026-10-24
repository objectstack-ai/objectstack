// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11905 — the flow canvas connects two nodes the flow already has.
 *
 * Before the fix the canvas drew an edge only while ADDING a node (the three
 * add-node paths, objectui#11778), so a node left without an edge could only be
 * deleted and re-added, losing its configuration. Now each card but an End
 * carries a connect handle: press it, drag, drop on another node.
 *
 * Driven through the real canvas over a host that merges each patch into the
 * draft, as Studio does. The drag is dispatched the way a browser dispatches
 * it to elements: the press on the handle, the move and the release on the
 * element under the pointer, bubbling to the window the canvas listens on.
 *
 * Refusal reasons are compared with what the shared rule says
 * (`describeEdgeConnectionRefusal`), never with a wording.
 *
 * The control, that the three add-node paths are unchanged, is
 * `FlowCanvas.addNodePaths-11778.test.tsx`, run unmodified beside this file:
 * the edge those paths draw is now built by the same `outEdge` the drag uses.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { FlowCanvas } from './FlowCanvas';
import type { FlowDesignerEdge, FlowDesignerNode } from './flow-canvas-layout';
import { buildFlowProblems, describeEdgeConnectionRefusal } from './flow-problems';

// The palette's engine overlay answers "engine absent", so no read reaches a
// real socket.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('not found', { status: 404 })),
);

afterEach(() => {
  cleanup();
  localStorage.clear();
});

type Draft = { nodes: FlowDesignerNode[]; edges: FlowDesignerEdge[] };

/** The card's state: Start, a configured Notify and End, none of them connected. */
const orphaned = (): Draft => ({
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'notify_1',
      type: 'notify',
      label: 'Tell the owner',
      config: { recipients: ['{record.owner}'], title: 'Renewal due', message: 'Renew {record.name}' },
      position: { x: 420, y: 40 },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [],
});

/** The draft Studio's "New flow" saves. */
const skeleton = (): Draft => ({
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

function mount(initial: Draft, props: Partial<React.ComponentProps<typeof FlowCanvas>> = {}) {
  const probe = { draft: initial, patches: [] as Array<Record<string, unknown>>, selectedEdges: [] as string[] };
  function Host() {
    const [draft, setDraft] = React.useState<Draft>(initial);
    React.useEffect(() => {
      probe.draft = draft;
    }, [draft]);
    return (
      <FlowCanvas
        nodes={draft.nodes}
        edges={draft.edges}
        editable
        designMode
        selectedId={null}
        onSelect={() => {}}
        onSelectEdge={(_edge, key) => probe.selectedEdges.push(key)}
        onPatch={(patch) => {
          probe.patches.push(patch);
          setDraft((d) => ({ ...d, ...(patch as Partial<Draft>) }));
        }}
        {...props}
      />
    );
  }
  const utils = render(<Host />);
  return { probe, ...utils };
}

const handleOf = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-connect-handle="${id}"]`) as HTMLElement | null;
const cardOf = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-node-id="${id}"]`) as HTMLElement;
const pairs = (d: Draft) => d.edges.map((e) => `${e.source}->${e.target}`);
const refusalShown = () => screen.queryAllByRole('alert').map((a) => a.textContent ?? '');

const PRESS = { button: 0, pointerId: 1, clientX: 0, clientY: 0 };
const AWAY = { pointerId: 1, clientX: 60, clientY: 120 };

/** Press `from`'s connect handle, drag over `over`, release there. */
function connect(container: HTMLElement, from: string, over: HTMLElement) {
  const handle = handleOf(container, from);
  expect(handle, `"${from}" carries a connect handle`).not.toBeNull();
  fireEvent.pointerDown(handle!, PRESS);
  fireEvent.pointerMove(over, AWAY);
  fireEvent.pointerUp(over, { ...AWAY, button: 0 });
}

describe('a node left without an edge is reconnected, its configuration untouched (objectui#11905)', () => {
  it('Start → Notify → End, drawn by two drags, with no node rewritten', () => {
    const initial = orphaned();
    const before = JSON.stringify(initial.nodes);
    const { probe, container } = mount(initial);

    // Lit control: the Problems check names the Notify node before the drags.
    const flagged = (d: Draft) =>
      buildFlowProblems({ nodes: d.nodes, edges: d.edges, locale: 'en-US' }).filter(
        (p) => p.target.kind === 'node' && (p.target.nodeId === 'notify_1' || p.target.nodeId === 'end'),
      );
    expect(flagged(initial).length, 'unreachable before').toBeGreaterThan(0);

    connect(container, 'start', cardOf(container, 'notify_1'));
    connect(container, 'notify_1', cardOf(container, 'end'));

    expect(pairs(probe.draft)).toEqual(['start->notify_1', 'notify_1->end']);
    expect(probe.patches.every((p) => !('nodes' in p)), 'no patch carries the nodes').toBe(true);
    expect(probe.draft.nodes, 'the very same nodes array').toBe(initial.nodes);
    expect(JSON.stringify(probe.draft.nodes), 'byte-identical node records').toBe(before);
    expect(flagged(probe.draft), 'nothing left unreachable').toEqual([]);
  });

  it('each new edge carries a fresh id, and the canvas selects it for the edge inspector', () => {
    const { probe, container } = mount(orphaned());
    connect(container, 'start', cardOf(container, 'notify_1'));
    connect(container, 'notify_1', cardOf(container, 'end'));
    const ids = probe.draft.edges.map((e) => e.id);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(probe.selectedEdges).toEqual(ids);
  });

  it('out of a decision, the new edge carries its next branch, as a "+" on it would', () => {
    const { probe, container } = mount({
      nodes: [
        { id: 'start', type: 'start' },
        {
          id: 'd',
          type: 'decision',
          config: { conditions: [{ label: 'Big', expression: 'amount > 100' }, { label: 'Else', expression: 'true' }] },
        },
        { id: 'big', type: 'notify' },
        { id: 'small', type: 'notify' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'd' },
        { id: 'e2', source: 'd', target: 'big', label: 'Big', condition: 'amount > 100' },
      ],
    });
    connect(container, 'd', cardOf(container, 'small'));
    expect(probe.draft.edges[2]).toMatchObject({ source: 'd', target: 'small', label: 'Else', isDefault: true });
  });
});

describe('the drag refuses what the edge inspector refuses, and says why (objectui#11905)', () => {
  it('a pair already connected: nothing written, the repeat reason shown', () => {
    const { probe, container } = mount(skeleton());
    connect(container, 'start', cardOf(container, 'end'));
    expect(probe.patches).toEqual([]);
    expect(refusalShown()).toContain(describeEdgeConnectionRefusal('repeat', 'start', 'end', 'en-US'));
  });

  it('a node to itself: nothing written, the self reason shown', () => {
    const { probe, container } = mount(orphaned());
    connect(container, 'notify_1', cardOf(container, 'notify_1'));
    expect(probe.patches).toEqual([]);
    expect(refusalShown()).toContain(describeEdgeConnectionRefusal('self', 'notify_1', 'notify_1', 'en-US'));
  });

  it('the reason goes with the next press on the canvas', () => {
    const { container } = mount(skeleton());
    connect(container, 'start', cardOf(container, 'end'));
    expect(refusalShown().length).toBeGreaterThan(0);
    fireEvent.pointerDown(screen.getByRole('application'), PRESS);
    expect(refusalShown()).toEqual([]);
  });

  it('while dragging, the node under the pointer is ringed with the verdict a drop would get', () => {
    const { container } = mount({ ...orphaned(), edges: [{ id: 'e1', source: 'start', target: 'end' }] });
    fireEvent.pointerDown(handleOf(container, 'start')!, PRESS);
    fireEvent.pointerMove(cardOf(container, 'end'), AWAY);
    expect(container.querySelector('[data-connect-target]')?.getAttribute('data-connect-target')).toBe('refused');
    expect(container.querySelector('[data-connect-preview]'), 'the preview line follows the pointer').not.toBeNull();
    fireEvent.pointerMove(cardOf(container, 'notify_1'), AWAY);
    expect(container.querySelector('[data-connect-target]')?.getAttribute('data-connect-target')).toBe('connects');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('[data-connect-preview]')).toBeNull();
  });
});

describe('a drag that does not end on a node writes nothing and refuses nothing (objectui#11905)', () => {
  it('released over the canvas background', () => {
    const { probe, container } = mount(orphaned());
    connect(container, 'start', screen.getByRole('application'));
    expect(probe.patches).toEqual([]);
    expect(refusalShown()).toEqual([]);
  });

  it('a press on the handle that never moves', () => {
    const { probe, container } = mount(orphaned());
    const handle = handleOf(container, 'start')!;
    fireEvent.pointerDown(handle, PRESS);
    fireEvent.pointerUp(cardOf(container, 'notify_1'), { ...PRESS });
    expect(probe.patches).toEqual([]);
    expect(refusalShown()).toEqual([]);
  });

  it('Escape lets the drag go before the release', () => {
    const { probe, container } = mount(orphaned());
    fireEvent.pointerDown(handleOf(container, 'start')!, PRESS);
    fireEvent.pointerMove(cardOf(container, 'notify_1'), AWAY);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerUp(cardOf(container, 'notify_1'), { ...AWAY, button: 0 });
    expect(probe.patches).toEqual([]);
  });
});

describe('where the connect handle is offered (objectui#11905)', () => {
  it('on every card but an End, like the "+"', () => {
    const { container } = mount(orphaned());
    expect(handleOf(container, 'start')).not.toBeNull();
    expect(handleOf(container, 'notify_1')).not.toBeNull();
    expect(handleOf(container, 'end')).toBeNull();
  });

  it('nowhere on a read-only canvas', () => {
    const { container } = mount(orphaned(), { editable: false });
    expect(container.querySelectorAll('[data-connect-handle]')).toHaveLength(0);
  });
});
