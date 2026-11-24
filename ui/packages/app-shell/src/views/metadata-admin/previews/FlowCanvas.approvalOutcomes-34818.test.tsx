// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34818 item 4 — an approval node is inserted with its two
 * outcomes: an `approve` edge on to the step it was inserted before (or to a
 * new "Approved" end) and a `reject` edge to a new "Rejected" end. Every other
 * node type inserts as it did (the control). The approval's outcome pills read
 * in the designer's language.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FlowCanvas, approvalOutcomes } from './FlowCanvas';
import { freshNodeId } from './flow-problems';

beforeEach(() => {
  // The palette hook's GET of the engine's action list, answered "engine absent".
  vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Rec = Record<string, unknown>;

const START = { id: 'start', type: 'start', label: 'Start', config: { triggerType: 'record-after-create', objectName: 'meeting_note' } };
const NOTE = { id: 'node_1', type: 'update_record', label: 'Mark noted' };

function pick(open: () => void, label: string) {
  open();
  const option = screen.getAllByRole('option').find((o) => o.textContent?.startsWith(label));
  expect(option, `palette row ${label}`).toBeDefined();
  fireEvent.click(option!);
}

function renderCanvas(nodes: Rec[], edges: Rec[]) {
  const patches: Rec[] = [];
  render(
    <FlowCanvas
      nodes={nodes as never}
      edges={edges as never}
      editable
      designMode
      selectedId={null}
      onSelect={() => {}}
      onPatch={(partial) => patches.push(partial)}
    />,
  );
  return patches;
}

describe('an approval is inserted with approve and reject edges (objectstack#34818 item 4)', () => {
  it('on a connection: approve continues to the next step, reject goes to a new Rejected end', () => {
    const patches = renderCanvas([START, NOTE], [{ id: 'edge_1', source: 'start', target: 'node_1' }]);
    pick(() => fireEvent.click(screen.getByRole('button', { name: 'Insert node here' })), 'Approval');
    expect(patches).toHaveLength(1);
    const nodes = patches[0].nodes as Rec[];
    const edges = patches[0].edges as Rec[];
    const approval = nodes.find((n) => n.type === 'approval')!;
    const ends = nodes.filter((n) => n.type === 'end');
    expect(ends).toEqual([{ id: expect.any(String), type: 'end', label: 'Rejected' }]);
    expect(edges).toEqual([
      { id: 'edge_1', source: 'start', target: approval.id },
      { id: expect.any(String), source: approval.id, target: 'node_1', label: 'approve' },
      { id: expect.any(String), source: approval.id, target: ends[0].id, label: 'reject' },
    ]);
    // Every id is its own.
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length);
  });

  it('appended after a step: approve to a new Approved end, reject to a new Rejected end', () => {
    const patches = renderCanvas([START], []);
    pick(() => fireEvent.click(screen.getAllByRole('button', { name: 'Add connected node' })[0]), 'Approval');
    const nodes = patches[0].nodes as Rec[];
    const edges = patches[0].edges as Rec[];
    const approval = nodes.find((n) => n.type === 'approval')!;
    const approved = nodes.find((n) => n.label === 'Approved')!;
    const rejected = nodes.find((n) => n.label === 'Rejected')!;
    expect([approved.type, rejected.type]).toEqual(['end', 'end']);
    expect(edges.map(({ source, target, label }) => ({ source, target, label }))).toEqual([
      { source: 'start', target: approval.id, label: undefined },
      { source: approval.id, target: approved.id, label: 'approve' },
      { source: approval.id, target: rejected.id, label: 'reject' },
    ]);
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
  });

  it('control: any other node inserted on a connection keeps one plain out-edge', () => {
    const patches = renderCanvas([START, NOTE], [{ id: 'edge_1', source: 'start', target: 'node_1' }]);
    pick(() => fireEvent.click(screen.getByRole('button', { name: 'Insert node here' })), 'Wait');
    const nodes = patches[0].nodes as Rec[];
    const edges = patches[0].edges as Rec[];
    expect(nodes.filter((n) => n.type === 'end')).toEqual([]);
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.label === undefined)).toBe(true);
  });

  it('the outcome ends take ids the host’s minter has never handed out', () => {
    // The host's session ledger remembers `node_2`, removed earlier: no end may take it.
    const seen = ['node_2'];
    const nodes = [START, NOTE, { id: 'node_3', type: 'approval' }];
    const mint = (also: readonly string[] = []) => freshNodeId(nodes, [], [...seen, ...also]);
    const out = approvalOutcomes('node_3', undefined, [], mint);
    expect(out.nodes.map((n) => n.id)).toEqual(['node_4', 'node_5']);
  });

  it('the outcome pills read in the designer’s language, the keyword kept in the title', () => {
    renderCanvas(
      [START, { id: 'node_2', type: 'approval', label: '经理审批' }, NOTE, { id: 'node_9', type: 'end', label: '已驳回' }],
      [
        { id: 'edge_1', source: 'start', target: 'node_2' },
        { id: 'edge_2', source: 'node_2', target: 'node_1', label: 'approve' },
        { id: 'edge_3', source: 'node_2', target: 'node_9', label: 'reject' },
        // Control: the same word on a non-approval edge is the author's own label.
        { id: 'edge_4', source: 'node_1', target: 'node_9', label: 'approve' },
      ],
    );
    const pills = Array.from(document.querySelectorAll('[data-branch-label]')).map((p) => [p.textContent, p.getAttribute('title')]);
    expect(pills).toEqual([
      ['Approve', 'Approve\napprove'],
      ['Reject', 'Reject\nreject'],
      ['approve', 'approve'],
    ]);
  });
});
