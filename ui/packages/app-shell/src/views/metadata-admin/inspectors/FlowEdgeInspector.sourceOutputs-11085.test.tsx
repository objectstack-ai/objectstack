// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11085 — an edge guard sees its SOURCE node's own outputs, through
 * the real edge inspector wiring (`useEdgeScope`). The engine writes a node's
 * outputs before it evaluates the node's out-edges, so `lead.status` on the
 * out-edge of a `get_record` whose `outputVariable` is `lead` is a reference
 * the engine writes, and the scope-aware "not in scope" note stays silent.
 *
 * The lit control on the same edge: a root no node writes is still flagged.
 * A `fault` edge keeps the scope at the source: the engine walks it only when
 * the node failed, with nothing written back.
 *
 * The note's wording is not pinned: each probe asserts only whether a note
 * naming the root is present.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowEdgeInspector } from './FlowEdgeInspector';
import type { MetadataSelection } from '../preview-registry';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function draftWith(edge: Record<string, unknown>, extraNodes: Array<Record<string, unknown>> = []) {
  return {
    // A declared variable keeps the scope non-empty, so the reference check runs.
    variables: [{ name: 'threshold', type: 'number' }],
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'fetch', type: 'get_record', label: 'Fetch lead', config: { objectName: 'crm_lead', outputVariable: 'lead' } },
      { id: 'route', type: 'decision' },
      ...extraNodes,
    ],
    edges: [{ id: 'e1', source: 'start', target: 'fetch' }, { id: 'e2', source: 'fetch', target: 'route', ...edge }],
  };
}

const common = {
  type: 'flow',
  name: 'lead_flow',
  onPatch: vi.fn(),
  onClearSelection: vi.fn(),
  locale: 'en-US' as const,
  readOnly: false,
};

function renderEdge(draft: Record<string, unknown>, id = 'e2') {
  const selection: MetadataSelection = { kind: 'edge', id };
  return render(<FlowEdgeInspector {...common} selection={selection} draft={draft} />);
}

function notesNaming(root: string): HTMLElement[] {
  return screen.queryAllByRole('note').filter((n) => (n.textContent ?? '').includes(root));
}

describe('FlowEdgeInspector — the source node’s own outputs are in scope on its out-edge (objectui#11085)', () => {
  it('`lead.status` on the out-edge of the get_record that writes `lead` draws no note', async () => {
    renderEdge(draftWith({ condition: "lead.status == 'open'" }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(notesNaming('lead')).toHaveLength(0);
  });

  it('lit control: a root no node writes is still flagged on the same edge', async () => {
    renderEdge(draftWith({ condition: "ghost.status == 'open'" }));
    await waitFor(() => expect(notesNaming('ghost')).toHaveLength(1));
  });

  it('a fault edge keeps the scope at the source, so `lead` is still flagged there', async () => {
    renderEdge(draftWith({ condition: "lead.status == 'open'", type: 'fault' }));
    await waitFor(() => expect(notesNaming('lead')).toHaveLength(1));
  });
});
