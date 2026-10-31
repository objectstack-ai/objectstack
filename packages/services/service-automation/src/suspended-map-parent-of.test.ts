// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `suspendedMapParentOf` answers the run parked at a `map` node on an item run
 * from the item's own linkage, with keyed reads (#28230).
 *
 * The approvals recall reads it before it cancels a batch item, so it can wake
 * the batch afterwards. It used to find the batch in `listSuspendedRunsDurable`,
 * which reads one capped page of a DB-backed store; the end-to-end pin past
 * that page is `batch-item-recall-resumes-batch.test.ts` (plugin-approvals).
 *
 * The pins: a `map` item answers its parent, also on an engine that did not
 * park it; a subflow child, a subflow nested in a `map` item (which inherits
 * the item's `$parentMapNode`), a top-level run and an unknown id answer
 * `undefined`; and so does an item whose parent is no longer parked on it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { AutomationEngine } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import { registerMapNode } from './builtin/map-node.js';
import { registerSubflowNode } from './builtin/subflow-node.js';

function silentLogger(): any {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}
function pluginCtx(): any {
  return { logger: silentLogger(), getService() { throw new Error('none'); } };
}

/** start → `open_pause` (raw-resumable) → end. */
const ITEM_FLOW = {
  name: 'one_item', label: 'one_item', type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'pause', type: 'open_pause', label: 'Pause' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'pause' },
    { id: 'e2', source: 'pause', target: 'end' },
  ],
};

/** start → `call` (a subflow into `one_item`) → end. */
const WRAP_FLOW = {
  name: 'wrap_item', label: 'wrap_item', type: 'autolaunched',
  nodes: [
    { id: 'ws', type: 'start', label: 'Start' },
    { id: 'call', type: 'subflow', label: 'Call', config: { flowName: 'one_item' } },
    { id: 'we', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'w1', source: 'ws', target: 'call' },
    { id: 'w2', source: 'call', target: 'we' },
  ],
};

/** start → `signoffs` (a map over `items`, each item running `itemFlow`) → end. */
const batchFlow = (name: string, itemFlow: string) => ({
  name, label: name, type: 'autolaunched',
  variables: [{ name: 'items', type: 'list', isInput: true }],
  nodes: [
    { id: 'hs', type: 'start', label: 'Start' },
    { id: 'signoffs', type: 'map', label: 'Each', config: { collection: { dialect: 'cel', source: 'items' }, flowName: itemFlow } },
    { id: 'he', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'h1', source: 'hs', target: 'signoffs' },
    { id: 'h2', source: 'signoffs', target: 'he' },
  ],
});

function makeEngine(store: InMemorySuspendedRunStore): AutomationEngine {
  const engine = new AutomationEngine(silentLogger(), store);
  engine.registerNodeExecutor({
    type: 'open_pause',
    descriptor: defineActionDescriptor({
      type: 'open_pause', version: '1.0.0', name: 'Open Pause', supportsPause: true, resumeAuthority: 'any',
    }),
    async execute() { return { success: true, suspend: true }; },
  });
  registerMapNode(engine, pluginCtx());
  registerSubflowNode(engine, pluginCtx());
  engine.registerFlow('one_item', ITEM_FLOW as never);
  engine.registerFlow('wrap_item', WRAP_FLOW as never);
  engine.registerFlow('batch_flow', batchFlow('batch_flow', 'one_item') as never);
  engine.registerFlow('wrapped_batch', batchFlow('wrapped_batch', 'wrap_item') as never);
  return engine;
}

describe('suspendedMapParentOf answers the batch above a map item from its linkage (#28230)', () => {
  let store: InMemorySuspendedRunStore;
  let engine: AutomationEngine;

  beforeEach(() => {
    store = new InMemorySuspendedRunStore();
    engine = makeEngine(store);
  });

  const parked = (flowName: string) => engine.listSuspendedRuns().filter(r => r.flowName === flowName);
  const items = [{ id: 't1' }, { id: 't2' }];

  it('a map item answers the run parked on it at the map node, on an engine that did not park it too', async () => {
    const batch = await engine.execute('batch_flow', { params: { items } });
    const [item] = parked('one_item');
    const parent = { runId: batch.runId, flowName: 'batch_flow', nodeId: 'signoffs', correlation: `map:${item!.runId}` };

    expect(await engine.suspendedMapParentOf(item!.runId)).toEqual(parent);
    // Another process over the same store: nothing in its memory, keyed reads only.
    expect(await makeEngine(store).suspendedMapParentOf(item!.runId)).toEqual(parent);
  });

  it('a subflow child answers undefined: its parent waits at a subflow node, not a map', async () => {
    const wrap = await engine.execute('wrap_item', {});
    const [child] = parked('one_item');
    expect(parked('wrap_item')).toEqual([expect.objectContaining({ runId: wrap.runId, correlation: `subflow:${child!.runId}` })]);

    expect(await engine.suspendedMapParentOf(child!.runId)).toBeUndefined();
  });

  it('a subflow nested in a map item answers undefined, though it inherits the item\'s $parentMapNode', async () => {
    await engine.execute('wrapped_batch', { params: { items } });
    const [inner] = parked('one_item');
    const [item] = parked('wrap_item');
    expect((await store.load(inner!.runId))?.context).toMatchObject({ $parentRunId: item!.runId, $parentMapNode: 'signoffs' });

    expect(await engine.suspendedMapParentOf(inner!.runId)).toBeUndefined();
    // The item itself still answers its batch.
    expect(await engine.suspendedMapParentOf(item!.runId)).toMatchObject({ nodeId: 'signoffs', correlation: `map:${item!.runId}` });
  });

  it('an item whose parent is no longer parked on it answers undefined', async () => {
    const batch = await engine.execute('batch_flow', { params: { items } });
    const [item1] = parked('one_item');
    // Copy item 1's suspension aside, move the batch on to item 2, then put the copy back.
    const copy = await store.load(item1!.runId);
    await engine.cancelRun(item1!.runId, 'operator');
    expect((await engine.resume(batch.runId!, {})).status).toBe('paused');
    await store.save(copy!);

    expect(await engine.suspendedMapParentOf(item1!.runId)).toBeUndefined();
  });

  it('a top-level run and an unknown id answer undefined', async () => {
    const batch = await engine.execute('batch_flow', { params: { items } });

    expect(await engine.suspendedMapParentOf(batch.runId!)).toBeUndefined();
    expect(await engine.suspendedMapParentOf('no-such-run')).toBeUndefined();
  });
});
