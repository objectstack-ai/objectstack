// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11772 — the inspector's "Remove node" removes the edges that name
 * the node in the SAME patch, and splices a node on a single path out
 * (predecessor → successor). Every case presses the real Remove button and
 * reads the patch the inspector hands its host.
 *
 * The canvas's Delete key makes the same removal through the same function
 * (`edgesAfterNodeRemoval`); the last describe presses both on every fixture
 * here and requires the two patches' edges to be equal.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowNodeInspector } from './FlowNodeInspector';
import { FlowCanvas } from '../previews/FlowCanvas';
import { t } from '../i18n';

afterEach(cleanup);

// The node inspectors read the object catalog (`/api/v1/meta/object`); answer
// every read as an absent engine. Installed once for the whole file and never
// torn down, so no read flushed after a test body can reach a real socket
// (the shape `RecordDetailView.approvalDeclaredActions.test.tsx` documents).
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('not found', { status: 404 })),
);

type Edge = { id?: string; source: string; target: string } & Record<string, unknown>;
type Node = { id: string; type: string } & Record<string, unknown>;
interface Fixture {
  nodes: Node[];
  edges: Edge[];
}

/** Press the inspector's Remove on `id`; the patch it hands the host. */
function removeWithInspector(draft: Fixture, id: string): { nodes: Node[]; edges: Edge[] } {
  const onPatch = vi.fn();
  render(
    <FlowNodeInspector
      type="flow"
      name="f"
      draft={draft as unknown as Record<string, unknown>}
      selection={{ kind: 'node', id }}
      onPatch={onPatch}
      onClearSelection={() => {}}
      readOnly={false}
      locale="en-US"
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: t('engine.inspector.flowNode.remove', 'en-US') }));
  expect(onPatch).toHaveBeenCalledTimes(1);
  cleanup();
  return onPatch.mock.calls[0][0];
}

/** Press Delete on the canvas with `id` selected; the patch it hands the host. */
function removeWithCanvas(draft: Fixture, id: string): { nodes: Node[]; edges: Edge[] } {
  const onPatch = vi.fn();
  render(
    <FlowCanvas
      nodes={draft.nodes}
      edges={draft.edges as never}
      editable
      designMode
      selectedId={id}
      onSelect={() => {}}
      onPatch={onPatch}
    />,
  );
  fireEvent.keyDown(screen.getByRole('application', { name: t('engine.flowCanvas.canvas', 'en-US') }), { key: 'Delete' });
  expect(onPatch).toHaveBeenCalledTimes(1);
  cleanup();
  return onPatch.mock.calls[0][0];
}

const naming = (edges: Edge[], id: string) => edges.filter((e) => e.source === id || e.target === id);

const FIXTURES: Record<string, { draft: Fixture; remove: string }> = {
  'a single path s → x → e': {
    remove: 'x',
    draft: {
      nodes: [{ id: 's', type: 'start' }, { id: 'x', type: 'create_record' }, { id: 'e', type: 'end' }],
      edges: [
        { id: 'in', source: 's', target: 'x' },
        { id: 'out', source: 'x', target: 'e' },
      ],
    },
  },
  'a node on a decision branch': {
    remove: 'x',
    draft: {
      nodes: [
        { id: 'd', type: 'decision' },
        { id: 'x', type: 'create_record' },
        { id: 'y', type: 'create_record' },
        { id: 'e', type: 'end' },
      ],
      edges: [
        { id: 'big', source: 'd', target: 'x', condition: 'amount > 100', label: 'Big' },
        { id: 'else', source: 'd', target: 'y', isDefault: true },
        { id: 'x-e', source: 'x', target: 'e' },
        { id: 'y-e', source: 'y', target: 'e' },
      ],
    },
  },
  'a branch node (a decision with two edges out)': {
    remove: 'd',
    draft: {
      nodes: [
        { id: 's', type: 'start' },
        { id: 'd', type: 'decision' },
        { id: 'x', type: 'create_record' },
        { id: 'y', type: 'create_record' },
      ],
      edges: [
        { id: 's-d', source: 's', target: 'd' },
        { id: 'big', source: 'd', target: 'x', condition: 'amount > 100' },
        { id: 'else', source: 'd', target: 'y', isDefault: true },
      ],
    },
  },
  'a node whose one edge out is guarded': {
    remove: 'x',
    draft: {
      nodes: [{ id: 's', type: 'start' }, { id: 'x', type: 'create_record' }, { id: 'e', type: 'end' }],
      edges: [
        { id: 'in', source: 's', target: 'x' },
        { id: 'out', source: 'x', target: 'e', condition: 'ok == true' },
      ],
    },
  },
  'a node whose one edge out is labelled (an approval outcome)': {
    remove: 'x',
    draft: {
      nodes: [{ id: 's', type: 'start' }, { id: 'x', type: 'approval' }, { id: 'e', type: 'end' }],
      edges: [
        { id: 'in', source: 's', target: 'x' },
        { id: 'out', source: 'x', target: 'e', label: 'approve' },
      ],
    },
  },
  'a node entered only by a declared back-edge': {
    remove: 'w',
    draft: {
      nodes: [{ id: 'a', type: 'approval' }, { id: 'w', type: 'wait' }, { id: 'e', type: 'end' }],
      edges: [
        { id: 'back', source: 'a', target: 'w', type: 'back' },
        { id: 'out', source: 'w', target: 'e' },
      ],
    },
  },
  'a single path whose ends are already joined the same way': {
    remove: 'x',
    draft: {
      nodes: [{ id: 's', type: 'start' }, { id: 'x', type: 'create_record' }, { id: 'e', type: 'end' }],
      edges: [
        { id: 'in', source: 's', target: 'x' },
        { id: 'out', source: 'x', target: 'e' },
        { id: 'direct', source: 's', target: 'e' },
      ],
    },
  },
  'a join (two edges in)': {
    remove: 'x',
    draft: {
      nodes: [{ id: 'a', type: 'start' }, { id: 'b', type: 'create_record' }, { id: 'x', type: 'create_record' }, { id: 'e', type: 'end' }],
      edges: [
        { id: 'a-b', source: 'a', target: 'b' },
        { id: 'a-x', source: 'a', target: 'x' },
        { id: 'b-x', source: 'b', target: 'x' },
        { id: 'x-e', source: 'x', target: 'e' },
      ],
    },
  },
  'a node whose edge in already names a missing node': {
    remove: 'x',
    draft: {
      nodes: [{ id: 'x', type: 'create_record' }, { id: 'e', type: 'end' }],
      edges: [
        { id: 'in', source: 'ghost', target: 'x' },
        { id: 'out', source: 'x', target: 'e' },
      ],
    },
  },
};

describe('FlowNodeInspector — Remove node takes the edges that name it (objectui#11772)', () => {
  for (const [name, { draft, remove }] of Object.entries(FIXTURES)) {
    it(`${name}: no edge left names the removed node`, () => {
      const patch = removeWithInspector(draft, remove);
      expect(patch.nodes.map((n) => n.id)).toEqual(draft.nodes.map((n) => n.id).filter((id) => id !== remove));
      expect(naming(patch.edges, remove)).toEqual([]);
    });
  }

  it('a single path is spliced out: the edge in is kept, retargeted to the successor', () => {
    const { edges } = removeWithInspector(FIXTURES['a single path s → x → e'].draft, 'x');
    expect(edges).toEqual([{ id: 'in', source: 's', target: 'e' }]);
  });

  it('a decision branch through the removed node now leads to its successor, guard, label and position kept', () => {
    const { edges } = removeWithInspector(FIXTURES['a node on a decision branch'].draft, 'x');
    expect(edges).toEqual([
      { id: 'big', source: 'd', target: 'e', condition: 'amount > 100', label: 'Big' },
      { id: 'else', source: 'd', target: 'y', isDefault: true },
      { id: 'y-e', source: 'y', target: 'e' },
    ]);
  });

  it('a branch node loses its edges and nothing is reconnected', () => {
    const { edges } = removeWithInspector(FIXTURES['a branch node (a decision with two edges out)'].draft, 'd');
    expect(edges).toEqual([]);
  });

  for (const name of [
    'a node whose one edge out is guarded',
    'a node whose one edge out is labelled (an approval outcome)',
    'a node entered only by a declared back-edge',
    'a join (two edges in)',
    'a node whose edge in already names a missing node',
  ]) {
    it(`${name}: dropped, not reconnected`, () => {
      const { draft, remove } = FIXTURES[name];
      const { edges } = removeWithInspector(draft, remove);
      expect(edges).toEqual(draft.edges.filter((e) => e.source !== remove && e.target !== remove));
    });
  }

  it('a splice never draws a second copy of a connection that already exists', () => {
    const { edges } = removeWithInspector(FIXTURES['a single path whose ends are already joined the same way'].draft, 'x');
    expect(edges).toEqual([{ id: 'direct', source: 's', target: 'e' }]);
  });

  it('while another node still carries the removed id, its edges are that node’s and stay', () => {
    const draft: Fixture = {
      nodes: [{ id: 's', type: 'start' }, { id: 'x', type: 'create_record', label: 'first' }, { id: 'x', type: 'create_record', label: 'second' }],
      edges: [{ id: 'in', source: 's', target: 'x' }],
    };
    const patch = removeWithInspector(draft, 'x');
    expect(patch.nodes.map((n) => n.label ?? n.id)).toEqual(['s', 'second']);
    expect(patch.edges).toEqual(draft.edges);
  });
});

describe('the canvas Delete key makes the very removal the inspector makes (objectui#11772)', () => {
  for (const [name, { draft, remove }] of Object.entries(FIXTURES)) {
    it(name, () => {
      expect(removeWithCanvas(draft, remove).edges).toEqual(removeWithInspector(draft, remove).edges);
    });
  }
});
