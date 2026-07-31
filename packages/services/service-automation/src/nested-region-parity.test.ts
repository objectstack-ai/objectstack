// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A node behaves the same inside a structured region as it does outside one
 * (#4347).
 *
 * `registerFlow` canonicalizes a stored flow through three passes — the ADR-0087
 * conversion table, `FlowSchema.parse`, and the ADR-0032 predicate validation —
 * and all three walked `flow.nodes` / `flow.edges` only. An ADR-0031 container
 * keeps a whole sub-graph in its open `config`, so every one of them stopped at
 * the container and metadata came out **position-dependent**: the reporting app
 * shipped three sweeps whose gates never opened, with `success: true` on every
 * run and nothing in the log.
 *
 * Each test here is a parity assertion: identical metadata, once at the top
 * level and once inside a `loop` body, must come out the same.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from './engine.js';
import type { NodeExecutor } from './engine.js';
import { registerLoopNode } from './builtin/loop-node.js';
import { registerLogicNodes } from './builtin/logic-nodes.js';

function silentLogger() {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } } as any;
}
function ctx() {
  return { logger: silentLogger(), getService() { return undefined; } } as any;
}

const CONDITION = 'row.shouldRun == true';
const ENVELOPE = { dialect: 'cel', source: CONDITION };

describe('#4347 — a loop-body predicate is canonicalized like a top-level one', () => {
  let engine: AutomationEngine;
  let opened: string[];

  beforeEach(() => {
    engine = new AutomationEngine(silentLogger());
    opened = [];
    registerLoopNode(engine, ctx());
    registerLogicNodes(engine, ctx());
    // The node behind the gate: it records that the gate let execution through,
    // which is the only way to tell "nothing to do" from "the gate is broken".
    engine.registerNodeExecutor({
      type: 'mark',
      async execute(node) { opened.push(String(node.id)); return { success: true }; },
    } as NodeExecutor);
  });

  /** The issue's repro: the same predicate on a top-level edge and a body edge. */
  const reproFlow = (condition: unknown) => ({
    name: 'repro', label: 'Repro', type: 'schedule' as const, status: 'active' as const, runAs: 'system' as const,
    nodes: [
      { id: 'start', type: 'start', label: 'Start', config: { schedule: '0 0 * * *' } },
      {
        id: 'loop', type: 'loop', label: 'Loop',
        config: {
          collection: [{ shouldRun: true }], iteratorVariable: 'row',
          body: {
            nodes: [
              { id: 'gate', type: 'decision', label: 'Gate' },
              { id: 'inner', type: 'mark', label: 'Inner' },
            ],
            edges: [{ id: 'b1', source: 'gate', target: 'inner', type: 'conditional' as const, condition }],
          },
        },
      },
      { id: 'outer', type: 'mark', label: 'Outer' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'loop', type: 'default' as const },
      { id: 'e2', source: 'loop', target: 'outer', type: 'conditional' as const, condition },
    ],
  });

  it.each([
    ['a bare string', CONDITION],
    ['an explicit CEL envelope', ENVELOPE],
  ])('stores %s as the canonical envelope on BOTH edges', (_label, condition) => {
    engine.registerFlow('repro', reproFlow(condition));
    const flow = engine.flows.get('repro')!;

    const topEdge = flow.edges.find(e => e.id === 'e2')!.condition;
    const bodyEdge = (flow.nodes.find(n => n.id === 'loop')!.config as any).body.edges[0].condition;

    expect(topEdge).toEqual(ENVELOPE);
    expect(bodyEdge).toEqual(ENVELOPE);
  });

  it.each([
    ['a bare string', CONDITION],
    ['an explicit CEL envelope', ENVELOPE],
  ])('opens the loop-body gate when written as %s', async (_label, condition) => {
    engine.registerFlow('repro', reproFlow(condition));
    const result = await engine.execute('repro', { params: {}, event: 'schedule' } as never);

    expect(result.success).toBe(true);
    // The assertion the reporting app had to add by hand: a run that reports
    // success and writes nothing is indistinguishable from one with no work.
    expect(opened).toEqual(['inner', 'outer']);
  });

  it('still evaluates a loop-body predicate that is FALSE as false', async () => {
    engine.registerFlow('repro', reproFlow('row.shouldRun == false'));
    await engine.execute('repro', { params: {}, event: 'schedule' } as never);
    expect(opened).toEqual([]);
  });
});

describe('#4347 — the conversion table reaches a node inside a region', () => {
  it('renames a protocol-11 callout type in a loop body, so the node still has an executor', async () => {
    const engine = new AutomationEngine(silentLogger());
    registerLoopNode(engine, ctx());
    const called: string[] = [];
    // Only the CANONICAL type is registered — exactly the runtime situation: the
    // retired alias has no executor, so an unconverted nested node fails.
    engine.registerNodeExecutor({
      type: 'http',
      async execute(node) { called.push(String(node.id)); return { success: true }; },
    } as NodeExecutor);

    engine.registerFlow('callout', {
      name: 'callout', label: 'Callout', type: 'schedule', status: 'active', runAs: 'system',
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { schedule: '0 0 * * *' } },
        {
          id: 'loop', type: 'loop', label: 'Loop',
          config: {
            collection: [1], iteratorVariable: 'row',
            body: { nodes: [{ id: 'nested', type: 'webhook', label: 'Nested', config: { url: 'https://x' } }], edges: [] },
          },
        },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'loop', type: 'default' }],
    });

    expect((engine.flows.get('callout')!.nodes[1]!.config as any).body.nodes[0].type).toBe('http');
    const result = await engine.execute('callout', { params: {}, event: 'schedule' } as never);
    expect(result.success).toBe(true);
    expect(called).toEqual(['nested']);
  });

  it('canonicalizes a nested CRUD alias — an unconverted `filters` leaves no filter at all', () => {
    const engine = new AutomationEngine(silentLogger());
    registerLoopNode(engine, ctx());
    engine.registerNodeExecutor({ type: 'delete_record', async execute() { return { success: true }; } } as NodeExecutor);

    engine.registerFlow('purge', {
      name: 'purge', label: 'Purge', type: 'schedule', status: 'active', runAs: 'system',
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { schedule: '0 0 * * *' } },
        {
          id: 'loop', type: 'loop', label: 'Loop',
          config: {
            collection: [1], iteratorVariable: 'row',
            body: {
              nodes: [{ id: 'del', type: 'delete_record', label: 'Del', config: { object: 'lead', filters: { status: 'stale' } } }],
              edges: [],
            },
          },
        },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'loop', type: 'default' }],
    });

    expect((engine.flows.get('purge')!.nodes[1]!.config as any).body.nodes[0].config)
      .toEqual({ objectName: 'lead', filter: { status: 'stale' } });
  });
});

describe('#4347 — predicate validation covers region graphs', () => {
  const braceTrapFlow = (placeNested: boolean) => {
    const bad = '{record.rating} >= 4'; // #1491 — braces in a CEL predicate
    const body = {
      nodes: [{ id: 'gate', type: 'decision', label: 'Gate' }, { id: 'inner', type: 'mark', label: 'Inner' }],
      edges: [{
        id: 'b1', source: 'gate', target: 'inner', type: 'conditional' as const,
        ...(placeNested ? { condition: bad } : {}),
      }],
    };
    return {
      name: 'trap', label: 'Trap', type: 'schedule' as const, status: 'active' as const, runAs: 'system' as const,
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { schedule: '0 0 * * *' } },
        { id: 'loop', type: 'loop', label: 'Loop', config: { collection: [1], iteratorVariable: 'row', body } },
        { id: 'outer', type: 'mark', label: 'Outer' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'loop', type: 'default' as const },
        {
          id: 'e2', source: 'loop', target: 'outer', type: 'conditional' as const,
          ...(placeNested ? {} : { condition: bad }),
        },
      ],
    };
  };

  let engine: AutomationEngine;
  beforeEach(() => {
    engine = new AutomationEngine(silentLogger());
    registerLoopNode(engine, ctx());
    registerLogicNodes(engine, ctx());
    engine.registerNodeExecutor({ type: 'mark', async execute() { return { success: true }; } } as NodeExecutor);
  });

  it('rejects the brace trap at the top level (unchanged)', () => {
    expect(() => engine.registerFlow('trap', braceTrapFlow(false))).toThrow(/invalid expression/i);
  });

  it('rejects the SAME brace trap inside a loop body, naming the region', () => {
    expect(() => engine.registerFlow('trap', braceTrapFlow(true))).toThrow(/invalid expression/i);
    expect(() => engine.registerFlow('trap', braceTrapFlow(true))).toThrow(/loop 'loop' body/);
  });
});

describe("#4347 — the legacy `{var}` path refuses an unresolved reference", () => {
  let engine: AutomationEngine;
  beforeEach(() => { engine = new AutomationEngine(silentLogger()); });

  it('refuses a dotted reference instead of comparing it lexicographically', () => {
    const vars = new Map<string, unknown>([['oppRecord', { amount: 10 }]]);
    // The reported footgun: 'oppRecord.amount' > '500000' compares 'o' to '5',
    // so this used to be TRUE for every record regardless of the amount.
    expect(() => engine.evaluateCondition('oppRecord.amount > 500000', vars)).toThrow(/unresolved expression reference/);
    expect(() => engine.evaluateCondition('oppRecord.amount > 500000', vars)).toThrow(/dialect: 'cel'/);
  });

  it('refuses it on either side of the operator', () => {
    const vars = new Map<string, unknown>();
    expect(() => engine.evaluateCondition('5 == row.shouldRun', vars)).toThrow(/unresolved expression reference/);
  });

  it('evaluates the same predicate correctly once it is a CEL envelope', () => {
    const vars = new Map<string, unknown>([['oppRecord', { amount: 10 }]]);
    expect(engine.evaluateCondition({ dialect: 'cel', source: 'oppRecord.amount > 500000' }, vars)).toBe(false);
  });

  it('leaves the documented legacy dialects alone', () => {
    const vars = new Map<string, unknown>([['amount', 500], ['status', 'active'], ['rate', 1.5]]);
    // `{var}` templates: substitution resolves the reference before comparison.
    expect(engine.evaluateCondition('{amount} > 100', vars)).toBe(true);
    // A decimal literal is not a reference.
    expect(engine.evaluateCondition('{rate} > 1.25', vars)).toBe(true);
    // Bare words compare as strings on purpose — the documented spelling.
    expect(engine.evaluateCondition('{status} == active', vars)).toBe(true);
    expect(engine.evaluateCondition('true', vars)).toBe(true);
    // A dotted key that DID resolve is a value by the time the compare runs.
    expect(engine.evaluateCondition('{a.b} == 7', new Map([['a.b', 7]]))).toBe(true);
  });
});
