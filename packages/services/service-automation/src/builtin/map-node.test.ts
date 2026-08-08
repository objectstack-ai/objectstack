// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor } from '../engine.js';
import { InMemorySuspendedRunStore } from '../suspended-run-store.js';
import { registerMapNode } from './map-node.js';
import { defineActionDescriptor } from '@objectstack/spec/automation';

/**
 * The `resumeAuthority: 'any'` a pausing fixture needs since #5561: the resume
 * gate follows a linked-run chain to the CHILD's node, so the type the child
 * parks on is what a resume of the parent is judged against — and a type that
 * declares nothing is now refused there. These tests are about linked-run
 * mechanics, not the gate (`resume-authority-gate.test.ts` owns that), so the
 * fixtures state the posture they rely on.
 */
const openPauser = (type: string) => defineActionDescriptor({
  type, version: '1.0.0', name: type,
  supportsPause: true, resumeAuthority: 'any',
});

function silentLogger() {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } } as any;
}
function ctx() {
  return { logger: silentLogger(), getService() { throw new Error('none'); } } as any;
}

/**
 * Wire an engine with the `map` node, a per-item child flow, and a parent flow
 * that maps over `{items}`. `childNodes` is the child flow's middle node(s)
 * (between start and end) — pass a `pauser` to exercise per-item durable pause.
 */
function setup(childNodes: Array<{ id: string; type: string }>, captured: unknown[]) {
  const engine = new AutomationEngine(silentLogger());
  registerMapNode(engine, ctx());

  // Child marker: copies the mapped item (passed as params.val) to the child's
  // output variable `result`.
  engine.registerNodeExecutor({
    type: 'itemmark',
    async execute(_node, variables, context) {
      variables.set('result', (context as any)?.params?.val);
      return { success: true };
    },
  } as NodeExecutor);
  // Pauses the child (stands in for an approval / screen / wait).
  engine.registerNodeExecutor({
    type: 'pauser',
    descriptor: openPauser('pauser'),
    async execute() { return { success: true, suspend: true }; },
  } as NodeExecutor);
  // Fails the child terminally.
  engine.registerNodeExecutor({
    type: 'failer',
    async execute() { return { success: false, error: 'boom' }; },
  } as NodeExecutor);
  // Parent checker after the map node: captures the collected results array.
  engine.registerNodeExecutor({
    type: 'mapcheck',
    async execute(_node, variables) {
      captured.push(variables.get('mapped'));
      return { success: true };
    },
  } as NodeExecutor);

  const seq = [{ id: 'cs', type: 'start' }, ...childNodes, { id: 'ce', type: 'end' }];
  engine.registerFlow('child_flow', {
    name: 'child_flow',
    label: 'Child',
    type: 'autolaunched',
    variables: [{ name: 'result', type: 'text', isOutput: true }],
    nodes: seq.map(n => ({ label: n.id, ...n })),
    edges: seq.slice(0, -1).map((n, i) => ({ id: `c${i}`, source: n.id, target: seq[i + 1].id })),
  } as never);

  engine.registerFlow('parent_flow', {
    name: 'parent_flow',
    label: 'Parent',
    type: 'autolaunched',
    variables: [{ name: 'items', type: 'list', isInput: true }],
    nodes: [
      { id: 'ps', type: 'start', label: 'Start' },
      {
        id: 'do_map', type: 'map', label: 'For each',
        config: { flowName: 'child_flow', collection: '{items}', iteratorVariable: 'item', input: { val: '{item}' }, outputVariable: 'mapped' },
      },
      { id: 'chk', type: 'mapcheck', label: 'Check' },
      { id: 'pe', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'p1', source: 'ps', target: 'do_map' },
      { id: 'p2', source: 'do_map', target: 'chk' },
      { id: 'p3', source: 'chk', target: 'pe' },
    ],
  } as never);

  return engine;
}

const childRunId = (engine: AutomationEngine) =>
  engine.listSuspendedRuns().find(r => r.flowName === 'child_flow')?.runId;

describe('map node executor (sequential multi-instance)', () => {
  let captured: unknown[];
  beforeEach(() => { captured = []; });

  it('runs a synchronous per-item subflow over the collection, collecting results in order', async () => {
    const engine = setup([{ id: 'cm', type: 'itemmark' }], captured);
    const result = await engine.execute('parent_flow', { params: { items: ['a', 'b', 'c'] } });

    expect(result.success).toBe(true);
    expect(result.status).toBeUndefined(); // ran to completion, no pause
    expect(captured).toEqual([[{ result: 'a' }, { result: 'b' }, { result: 'c' }]]);
    expect(engine.listSuspendedRuns()).toHaveLength(0);
  });

  it('completes immediately on an empty collection', async () => {
    const engine = setup([{ id: 'cm', type: 'itemmark' }], captured);
    const result = await engine.execute('parent_flow', { params: { items: [] } });
    expect(result.success).toBe(true);
    expect(captured).toEqual([[]]);
  });

  it('drives items ONE AT A TIME when each subflow pauses, re-entering on resume', async () => {
    const engine = setup([{ id: 'cp', type: 'pauser' }, { id: 'cm', type: 'itemmark' }], captured);

    // Item 0 pauses → the parent suspends at the map node.
    const r0 = await engine.execute('parent_flow', { params: { items: ['a', 'b', 'c'] } });
    expect(r0.status).toBe('paused');
    const parent = engine.listSuspendedRuns().find(x => x.flowName === 'parent_flow')!;
    expect(parent.nodeId).toBe('do_map');
    expect(parent.correlation).toMatch(/^map:/);
    expect(captured).toHaveLength(0); // not done yet

    // Resume item 0's child → bubbles → re-enters map → item 1 pauses.
    const id0 = childRunId(engine)!;
    const after0 = await engine.resume(id0);
    expect(after0.success).toBe(true);
    expect(engine.listSuspendedRuns().some(x => x.flowName === 'parent_flow')).toBe(true); // still paused
    expect(captured).toHaveLength(0);

    // Resume item 1 → item 2 pauses.
    await engine.resume(childRunId(engine)!);
    expect(captured).toHaveLength(0);

    // Resume item 2 → all done → parent continues past the map node.
    await engine.resume(childRunId(engine)!);
    expect(captured).toEqual([[{ result: 'a' }, { result: 'b' }, { result: 'c' }]]);
    expect(engine.listSuspendedRuns()).toHaveLength(0);
  });

  it('fails the map fast when an item subflow fails', async () => {
    const engine = setup([{ id: 'cf', type: 'failer' }], captured);
    const result = await engine.execute('parent_flow', { params: { items: ['a', 'b'] } });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/item 0.*failed/i);
    expect(captured).toEqual([]); // downstream never ran
  });

  it('survives a process restart mid-map: resume on a fresh engine continues the sequence', async () => {
    const store = new InMemorySuspendedRunStore();
    const engine = setup([{ id: 'cp', type: 'pauser' }, { id: 'cm', type: 'itemmark' }], captured);
    engine.setSuspendedRunStore(store);

    await engine.execute('parent_flow', { params: { items: ['a', 'b'] } });
    const id0 = childRunId(engine)!;
    expect((await store.list()).length).toBe(2); // parent (map) + child item 0

    // "Restart": a fresh engine sharing only the durable store + the registry.
    const capturedB: unknown[] = [];
    const engineB = setup([{ id: 'cp', type: 'pauser' }, { id: 'cm', type: 'itemmark' }], capturedB);
    engineB.setSuspendedRunStore(store);

    await engineB.resume(id0);                       // item 0 done → item 1 pauses
    await engineB.resume(childRunId(engineB)!);      // item 1 done → all done
    expect(capturedB).toEqual([[{ result: 'a' }, { result: 'b' }]]);
    expect(await store.list()).toHaveLength(0);
  });
});

describe('map descriptor configSchema (objectui #2670 Phase 3 / #3304)', () => {
  it('publishes a structured config form matching the objectui `map` field group', () => {
    // `map` is the one previously-schemaless node whose fields all map cleanly
    // through jsonSchemaToFlowFields (scalars + typed references, no keyValue /
    // virtual columns), so shipping this schema makes the online designer form
    // match the offline hardcoded one with zero regression.
    const engine = new AutomationEngine(silentLogger());
    registerMapNode(engine, ctx());
    const schema = engine.getActionDescriptor('map')?.configSchema as
      | { properties?: Record<string, { xExpression?: unknown; xRef?: { kind?: string } }>; required?: string[] }
      | undefined;
    expect(schema).toBeDefined();
    // `collection` is an interpolate() `{items}` template (mono editor + `{var}`
    // picker, no CEL brace-trap) — the same marker as loop.collection.
    expect(schema?.properties?.collection?.xExpression).toBe('template');
    // `flowName` / `itemObject` are typed references → pickers, not free text.
    expect(schema?.properties?.flowName?.xRef?.kind).toBe('flow');
    expect(schema?.properties?.itemObject?.xRef?.kind).toBe('object');
    // Plain scalar text fields carry no authoring marker.
    expect(schema?.properties?.iteratorVariable?.xExpression).toBeUndefined();
    expect(schema?.properties?.outputVariable?.xExpression).toBeUndefined();
  });
});

// #4045 — this proves the CONVERSION, not executor tolerance. The executor
// reads only the canonical `flowName`; a stored flow on the undeclared `flow`
// spelling reaches it because `registerFlow` applies
// 'flow-node-map-flow-alias', which renames it at load.
describe('map config `flow` alias (#4045)', () => {
  it('accepts the legacy `config.flow` spelling via the conversion layer', async () => {
    const captured: unknown[] = [];
    const engine = setup([{ id: 'cm', type: 'itemmark' }], captured);
    engine.registerFlow('legacy_parent', {
      name: 'legacy_parent',
      label: 'Legacy Parent',
      type: 'autolaunched',
      variables: [{ name: 'items', type: 'list', isInput: true }],
      nodes: [
        { id: 'ps', type: 'start', label: 'Start' },
        {
          id: 'do_map', type: 'map', label: 'For each',
          config: { flow: 'child_flow', collection: '{items}', iteratorVariable: 'item', input: { val: '{item}' }, outputVariable: 'mapped' },
        },
        { id: 'chk', type: 'mapcheck', label: 'Check' },
        { id: 'pe', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'p1', source: 'ps', target: 'do_map' },
        { id: 'p2', source: 'do_map', target: 'chk' },
        { id: 'p3', source: 'chk', target: 'pe' },
      ],
    } as never);

    const result = await engine.execute('legacy_parent', { params: { items: ['a', 'b'] } });
    expect(result.success).toBe(true);
    expect(captured).toEqual([[{ result: 'a' }, { result: 'b' }]]);
  });
});
