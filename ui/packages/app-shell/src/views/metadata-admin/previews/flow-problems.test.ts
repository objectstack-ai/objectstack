// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { validateFlowDraft } from './simulator/flow-sim-validate';
import { buildFlowProblems, indexProblemBadges, deriveInvalidElements } from './flow-problems';

describe('validateFlowDraft — per-element keying', () => {
  it('attaches the edge endpoints to a dangling-edge error', () => {
    const v = validateFlowDraft([{ id: 'a', type: 'start' }], [{ source: 'a', target: 'ghost' }]);
    const dangling = v.errors.find((e) => e.message.includes('target "ghost"'));
    expect(dangling?.edge).toEqual({ source: 'a', target: 'ghost' });
  });
});

describe('buildFlowProblems — structural mapping', () => {
  it('maps a duplicate node id to a node target', () => {
    const problems = buildFlowProblems({
      nodes: [
        { id: 'a', type: 'start' },
        { id: 'a', type: 'end' },
      ],
      edges: [],
    });
    const dup = problems.find((p) => p.message.includes('Duplicate node id'));
    expect(dup?.target).toEqual({ kind: 'node', nodeId: 'a' });
    expect(dup?.level).toBe('error');
    expect(dup?.source).toBe('structural');
  });

  it('maps a dangling edge to an edge target with a resolved edge key', () => {
    const problems = buildFlowProblems({
      nodes: [{ id: 'a', type: 'start' }],
      edges: [{ id: 'e1', source: 'a', target: 'ghost' }],
    });
    const dangling = problems.find((p) => p.message.includes('"ghost"'));
    expect(dangling?.target).toMatchObject({ kind: 'edge', source: 'a', target: 'ghost', edgeKey: 'e1' });
  });

  it('points an un-declared cycle at the closing edge', () => {
    // a → b → a; the b→a hop closes the loop.
    const problems = buildFlowProblems({
      nodes: [
        { id: 'a', type: 'decision' },
        { id: 'b', type: 'create_record' },
      ],
      edges: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ],
    });
    const cycle = problems.find((p) => p.message.includes('Cycle detected'));
    expect(cycle?.target).toMatchObject({ kind: 'edge', source: 'b', target: 'a' });
  });

  it('maps a missing-default decision warning to its node', () => {
    const problems = buildFlowProblems({
      nodes: [
        { id: 's', type: 'start' },
        { id: 'd', type: 'decision' },
        { id: 'x', type: 'end' },
        { id: 'y', type: 'end' },
      ],
      edges: [
        { source: 's', target: 'd' },
        { source: 'd', target: 'x', condition: 'a > 1' },
        { source: 'd', target: 'y', condition: 'a < 0' },
      ],
    });
    const warn = problems.find((p) => p.level === 'warning' && p.message.includes('no default branch'));
    expect(warn?.target).toEqual({ kind: 'node', nodeId: 'd' });
  });

  it('keeps a no-entry error as a flow-level problem', () => {
    const problems = buildFlowProblems({
      nodes: [
        { id: 'a', type: 'create_record' },
        { id: 'b', type: 'create_record' },
      ],
      // fully cyclic → no entry node; that error has no specific element.
      edges: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ],
    });
    const noEntry = problems.find((p) => p.message.toLowerCase().includes('entry'));
    expect(noEntry?.target).toEqual({ kind: 'flow' });
  });

  it('lists errors before warnings', () => {
    const problems = buildFlowProblems({
      nodes: [
        { id: 'a', type: 'start' },
        { id: 'a', type: 'decision' },
      ],
      edges: [],
    });
    const levels = problems.map((p) => p.level);
    expect(levels).toEqual([...levels].sort((x, y) => (x === y ? 0 : x === 'error' ? -1 : 1)));
  });
});

describe('buildFlowProblems — server diagnostics', () => {
  const nodes = [
    { id: 's', type: 'start' },
    { id: 'task', type: 'create_record' },
  ];
  const edges = [{ id: 'e1', source: 's', target: 'task' }];

  it('maps a nodes.<i> path to the node', () => {
    const problems = buildFlowProblems({
      nodes,
      edges,
      serverDiagnostics: [{ path: 'nodes.1.config.objectName', message: 'Required', severity: 'error' }],
    });
    const p = problems.find((x) => x.source === 'server');
    expect(p?.target).toEqual({ kind: 'node', nodeId: 'task' });
    expect(p?.level).toBe('error');
  });

  it('maps an edges.<i> path (array form) to the edge', () => {
    const problems = buildFlowProblems({
      nodes,
      edges,
      serverDiagnostics: [{ path: ['edges', 0, 'target'], message: 'bad', severity: 'warning' }],
    });
    const p = problems.find((x) => x.source === 'server');
    expect(p?.target).toMatchObject({ kind: 'edge', source: 's', target: 'task', edgeKey: 'e1' });
    expect(p?.level).toBe('warning');
  });

  it('falls back to flow-level for an unmappable path (default severity error)', () => {
    const problems = buildFlowProblems({
      nodes,
      edges,
      serverDiagnostics: [{ path: 'name', message: 'flow name required' }],
    });
    const p = problems.find((x) => x.source === 'server');
    expect(p?.target).toEqual({ kind: 'flow' });
    expect(p?.level).toBe('error');
  });
});

describe('indexProblemBadges', () => {
  it('returns empty maps for no problems', () => {
    const idx = indexProblemBadges([]);
    expect(idx.byNode.size).toBe(0);
    expect(idx.byEdge.size).toBe(0);
  });

  it('folds error over warning on the same element', () => {
    const problems = buildFlowProblems({
      nodes: [
        { id: 's', type: 'start' },
        { id: 'd', type: 'decision' },
      ],
      edges: [{ source: 's', target: 'd' }],
      serverDiagnostics: [{ path: 'nodes.1.config', message: 'bad config', severity: 'error' }],
    });
    const { byNode } = indexProblemBadges(problems);
    expect(byNode.get('d')?.level).toBe('error');
    expect(byNode.get('d')?.count).toBeGreaterThanOrEqual(2);
  });
});

describe('deriveInvalidElements', () => {
  it('flags every cycle hop (node + edge) for the red error set', () => {
    const problems = buildFlowProblems({
      nodes: [
        { id: 'a', type: 'decision' },
        { id: 'b', type: 'create_record' },
      ],
      edges: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ],
    });
    const { invalidNodeIds, invalidEdges } = deriveInvalidElements(problems);
    expect(new Set(invalidNodeIds)).toEqual(new Set(['a', 'b']));
    expect(invalidEdges.has('a->b')).toBe(true);
    expect(invalidEdges.has('b->a')).toBe(true);
  });

  it('excludes warning-only elements from the red set', () => {
    const problems = buildFlowProblems({
      nodes: [
        { id: 's', type: 'start' },
        { id: 'd', type: 'decision' }, // no outgoing → warning only
      ],
      edges: [{ source: 's', target: 'd' }],
    });
    const { invalidNodeIds, invalidEdges } = deriveInvalidElements(problems);
    expect(invalidNodeIds).not.toContain('d');
    expect(invalidEdges.size).toBe(0);
  });
});

describe('buildFlowProblems — the connector registry reaches the expression scan (objectui#11085)', () => {
  const REGISTRY = [
    {
      name: 'slack',
      actions: [{ key: 'chat.postMessage', outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } } }],
    },
  ];
  const args = (condition: string) => ({
    variables: [{ name: 'threshold' }],
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'post', type: 'connector_action', connectorConfig: { connectorId: 'slack', actionId: 'chat.postMessage' } },
      { id: 'check', type: 'decision', config: { condition } },
    ],
    edges: [
      { source: 'start', target: 'post' },
      { source: 'post', target: 'check' },
    ],
  });
  const expressionWarningsOn = (problems: ReturnType<typeof buildFlowProblems>, nodeId: string) =>
    problems.filter((p) => p.source === 'expression' && p.level === 'warning' && p.target.kind === 'node' && p.target.nodeId === nodeId);

  it('with the registry, `post.ok` is in scope downstream of the connector action', () => {
    expect(expressionWarningsOn(buildFlowProblems({ ...args('post.ok == true'), connectors: REGISTRY }), 'check')).toEqual([]);
  });

  it('lit control: without it, the same reference is reported; a root no node writes is reported either way', () => {
    expect(expressionWarningsOn(buildFlowProblems(args('post.ok == true')), 'check')).toHaveLength(1);
    expect(expressionWarningsOn(buildFlowProblems({ ...args('ghost.ok == true'), connectors: REGISTRY }), 'check')).toHaveLength(1);
  });
});
