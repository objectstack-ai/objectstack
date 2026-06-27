// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  exportConstructsToBpmn,
  importBpmnToConstructs,
  BPMN_PARALLEL_GATEWAY,
  BPMN_JOIN_GATEWAY,
  BPMN_BOUNDARY_EVENT,
  OS_CONSTRUCT_EXT,
  type MappableFlow,
} from './bpmn-mapping';

const node = (id: string, type = 'assignment', config?: Record<string, unknown>) => ({ id, type, label: id, config });
const edge = (id: string, source: string, target: string) => ({ id, source, target, type: 'default' as const });

/** Find the single node of a given type. */
const findType = (flow: MappableFlow, type: string) => flow.nodes.filter(n => n.type === type);
const findId = (flow: MappableFlow, id: string) => flow.nodes.find(n => n.id === id);
const hasEdge = (flow: MappableFlow, source: string, target: string) =>
  flow.edges.some(e => e.source === source && e.target === target);

describe('exportConstructsToBpmn — parallel', () => {
  const flow: MappableFlow = {
    nodes: [
      node('start', 'start'),
      node('par', 'parallel', {
        branches: [
          { name: 'A', nodes: [node('a')], edges: [] },
          { name: 'B', nodes: [node('b')], edges: [] },
        ],
      }),
      node('end', 'end'),
    ],
    edges: [edge('e1', 'start', 'par'), edge('e2', 'par', 'end')],
  };

  it('expands a parallel block into split/join gateways with branch nodes', () => {
    const { flow: out, mappedCount } = exportConstructsToBpmn(flow);
    expect(mappedCount).toBe(1);
    expect(findType(out, BPMN_PARALLEL_GATEWAY)).toHaveLength(1);
    expect(findType(out, BPMN_JOIN_GATEWAY)).toHaveLength(1);
    // the parallel construct node is gone; branch nodes are inlined
    expect(findId(out, 'par')).toBeUndefined();
    expect(findId(out, 'a')).toBeDefined();
    expect(findId(out, 'b')).toBeDefined();
    // wiring: start → split → {a,b} → join → end
    expect(hasEdge(out, 'start', 'par__split')).toBe(true);
    expect(hasEdge(out, 'par__split', 'a')).toBe(true);
    expect(hasEdge(out, 'par__split', 'b')).toBe(true);
    expect(hasEdge(out, 'a', 'par__join')).toBe(true);
    expect(hasEdge(out, 'b', 'par__join')).toBe(true);
    expect(hasEdge(out, 'par__join', 'end')).toBe(true);
    // the split carries the osConstruct extension marker
    const split = findId(out, 'par__split')!;
    expect((split.config as any)[OS_CONSTRUCT_EXT].type).toBe('parallel');
  });

  it('round-trips exactly: parallel → BPMN → parallel', () => {
    const exported = exportConstructsToBpmn(flow).flow;
    const { flow: back, mappedCount } = importBpmnToConstructs(exported);
    expect(mappedCount).toBe(1);
    const par = findId(back, 'par');
    expect(par).toBeDefined();
    expect(par!.type).toBe('parallel');
    expect(par!.config).toEqual(flow.nodes[1].config); // branches preserved
    // external wiring restored, gateways gone
    expect(hasEdge(back, 'start', 'par')).toBe(true);
    expect(hasEdge(back, 'par', 'end')).toBe(true);
    expect(findType(back, BPMN_PARALLEL_GATEWAY)).toHaveLength(0);
    expect(findType(back, BPMN_JOIN_GATEWAY)).toHaveLength(0);
  });
});

describe('exportConstructsToBpmn — try_catch', () => {
  const flow: MappableFlow = {
    nodes: [
      node('start', 'start'),
      node('tc', 'try_catch', {
        try: { nodes: [node('charge', 'http')], edges: [] },
        catch: { nodes: [node('flag', 'update_record')], edges: [] },
        errorVariable: '$error',
        retry: { maxRetries: 2, retryDelayMs: 100 },
      }),
      node('end', 'end'),
    ],
    edges: [edge('e1', 'start', 'tc'), edge('e2', 'tc', 'end')],
  };

  it('expands a try_catch into a protected activity + error boundary_event + handler', () => {
    const { flow: out } = exportConstructsToBpmn(flow);
    expect(findType(out, BPMN_BOUNDARY_EVENT)).toHaveLength(1);
    const boundary = findType(out, BPMN_BOUNDARY_EVENT)[0];
    expect((boundary as any).boundaryConfig.eventType).toBe('error');
    expect((boundary as any).boundaryConfig.attachedToNodeId).toBe('charge');
    expect(findId(out, 'charge')).toBeDefined(); // try activity inlined
    expect(findId(out, 'flag')).toBeDefined(); // catch handler inlined
    expect(findId(out, 'tc')).toBeUndefined();
    expect(hasEdge(out, 'start', 'charge')).toBe(true);
  });

  it('round-trips exactly: try_catch → BPMN → try_catch (retry preserved)', () => {
    const exported = exportConstructsToBpmn(flow).flow;
    const { flow: back } = importBpmnToConstructs(exported);
    const tc = findId(back, 'tc');
    expect(tc?.type).toBe('try_catch');
    expect(tc!.config).toEqual(flow.nodes[1].config); // try/catch/retry/errorVariable preserved
    expect(findType(back, BPMN_BOUNDARY_EVENT)).toHaveLength(0);
    expect(hasEdge(back, 'start', 'tc')).toBe(true);
    expect(hasEdge(back, 'tc', 'end')).toBe(true);
  });
});

describe('exportConstructsToBpmn — loop', () => {
  const flow: MappableFlow = {
    nodes: [
      node('start', 'start'),
      node('loop1', 'loop', {
        collection: '{items}',
        iteratorVariable: 'item',
        body: { nodes: [node('work', 'script')], edges: [] },
      }),
      node('end', 'end'),
    ],
    edges: [edge('e1', 'start', 'loop1'), edge('e2', 'loop1', 'end')],
  };

  it('expands a loop into a multi-instance activity (loopCharacteristics)', () => {
    const { flow: out } = exportConstructsToBpmn(flow);
    const work = findId(out, 'work')!;
    expect((work.config as any).bpmnLoopCharacteristics.collection).toBe('{items}');
    expect((work.config as any).bpmnLoopCharacteristics.elementVariable).toBe('item');
    expect(findId(out, 'loop1')).toBeUndefined();
    expect(hasEdge(out, 'start', 'work')).toBe(true);
    expect(hasEdge(out, 'work', 'end')).toBe(true);
  });

  it('round-trips exactly: loop → BPMN → loop', () => {
    const exported = exportConstructsToBpmn(flow).flow;
    const { flow: back } = importBpmnToConstructs(exported);
    const loop = findId(back, 'loop1');
    expect(loop?.type).toBe('loop');
    expect(loop!.config).toEqual(flow.nodes[1].config);
    // the multi-instance marker is gone from the reconstructed body
    expect((findId(back, 'work') as any)).toBeUndefined(); // body folded back into the loop
  });
});

describe('importBpmnToConstructs — foreign BPMN (no markers)', () => {
  it('folds a foreign parallel_gateway/join_gateway pair into a parallel block', () => {
    const foreign: MappableFlow = {
      nodes: [
        node('start', 'start'),
        node('split', BPMN_PARALLEL_GATEWAY),
        node('a', 'script'),
        node('b', 'script'),
        node('join', BPMN_JOIN_GATEWAY),
        node('end', 'end'),
      ],
      edges: [
        edge('e1', 'start', 'split'),
        edge('e2', 'split', 'a'),
        edge('e3', 'split', 'b'),
        edge('e4', 'a', 'join'),
        edge('e5', 'b', 'join'),
        edge('e6', 'join', 'end'),
      ],
    };
    const { flow: back, mappedCount } = importBpmnToConstructs(foreign);
    expect(mappedCount).toBe(1);
    const par = findType(back, 'parallel');
    expect(par).toHaveLength(1);
    expect((par[0].config as any).branches).toHaveLength(2);
    expect(findType(back, BPMN_PARALLEL_GATEWAY)).toHaveLength(0);
    expect(findType(back, BPMN_JOIN_GATEWAY)).toHaveLength(0);
    expect(hasEdge(back, 'start', par[0].id)).toBe(true);
    expect(hasEdge(back, par[0].id, 'end')).toBe(true);
  });

  it('warns (does not fold) a foreign boundary_event with no marker', () => {
    const foreign: MappableFlow = {
      nodes: [node('host', 'http'), node('b', BPMN_BOUNDARY_EVENT)],
      edges: [],
    };
    const { diagnostics, unmappedCount } = importBpmnToConstructs(foreign);
    expect(unmappedCount).toBe(1);
    expect(diagnostics.some(d => d.severity === 'warning' && d.message.includes('boundary_event'))).toBe(true);
  });

  it('warns when a parallel_gateway does not reconverge at a single join', () => {
    const foreign: MappableFlow = {
      nodes: [
        node('split', BPMN_PARALLEL_GATEWAY),
        node('a', 'script'),
        node('b', 'script'),
      ],
      edges: [edge('e1', 'split', 'a'), edge('e2', 'split', 'b')], // no join
    };
    const { diagnostics } = importBpmnToConstructs(foreign);
    expect(diagnostics.some(d => d.severity === 'warning' && d.message.includes('could not be matched'))).toBe(true);
  });
});
