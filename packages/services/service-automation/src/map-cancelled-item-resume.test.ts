// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A resume of a run parked on a `map` node whose item run was CANCELLED records
 * that item as cancelled, in its own slot, and the map goes on (#27971).
 *
 * `cancelRun` on the item terminates it and never touches the parent, so the
 * parent stays parked on `map:<itemRunId>` with nothing to wake it. Measured on
 * the in-process door before this change: a parent-id resume re-ran the map,
 * which advanced past the item with nothing recorded — `results` held only the
 * later items' outputs, `results[0]` was no longer item 0, and the parent
 * finished `completed`.
 *
 * The rules pinned here: the cancelled item's slot holds the closed marker
 * `{ $status: 'cancelled', $itemRunId }`; `count` leaves it out; a downstream
 * node reads it where it reads the results; an item whose suspension is gone
 * WITHOUT a `cancelled` history row (or whose history cannot be read) is
 * refused with #27877's code, nothing moved; a caller still cannot write the
 * handoff variable. The still-suspended refusal and the ordinary up-bubble are
 * the controls.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { AutomationEngine } from './engine.js';
import { registerMapNode } from './builtin/map-node.js';
import { registerSubflowNode } from './builtin/subflow-node.js';
import { MAP_ITEM_PENDING_REFUSAL_CODE } from './run-resume.js';

function silentLogger(): any {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}
function pluginCtx(): any {
  return { logger: silentLogger(), getService() { throw new Error('none'); } };
}

/** start → `open_pause` (raw-resumable) → `after` → end; `after` outputs which item ran. */
const ITEM_FLOW = {
  name: 'one_item',
  label: 'one_item',
  type: 'autolaunched',
  variables: [{ name: 'tag', type: 'text', isInput: true }, { name: 'done', type: 'text', isOutput: true }],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'pause', type: 'open_pause', label: 'Pause' },
    { id: 'after', type: 'after', label: 'After' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'pause' },
    { id: 'e2', source: 'pause', target: 'after' },
    { id: 'e3', source: 'after', target: 'end' },
  ],
};

/** start → map → `peek` (the downstream reader) → end. */
const BATCH_FLOW = {
  name: 'batch_flow',
  label: 'batch_flow',
  type: 'autolaunched',
  variables: [{ name: 'items', type: 'list', isInput: true }],
  nodes: [
    { id: 'hs', type: 'start', label: 'Start' },
    {
      id: 'signoffs', type: 'map', label: 'Sign off each',
      config: {
        collection: { dialect: 'cel', source: 'items' }, flowName: 'one_item', outputVariable: 'results',
        input: { tag: { dialect: 'cel', source: 'item.id' } },
      },
    },
    { id: 'pk', type: 'peek', label: 'Peek' },
    { id: 'he', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'h1', source: 'hs', target: 'signoffs' },
    { id: 'h2', source: 'signoffs', target: 'pk' },
    { id: 'h3', source: 'pk', target: 'he' },
  ],
};

describe('a parent-id resume of a map whose item run was cancelled (#27971)', () => {
  let engine: AutomationEngine;
  let seen: { results: unknown; nodeResults: unknown; count: unknown } | undefined;

  beforeEach(() => {
    seen = undefined;
    engine = new AutomationEngine(silentLogger());
    engine.registerNodeExecutor({
      type: 'open_pause',
      descriptor: defineActionDescriptor({
        type: 'open_pause', version: '1.0.0', name: 'Open Pause', supportsPause: true, resumeAuthority: 'any',
      }),
      async execute() { return { success: true, suspend: true }; },
    });
    engine.registerNodeExecutor({
      type: 'after',
      async execute(_node, variables) { variables.set('done', `ran ${String(variables.get('tag'))}`); return { success: true }; },
    });
    engine.registerNodeExecutor({
      type: 'peek',
      async execute(_node, variables) {
        seen = { results: variables.get('results'), nodeResults: variables.get('signoffs.results'), count: variables.get('signoffs.count') };
        return { success: true };
      },
    });
    registerMapNode(engine, pluginCtx());
    registerSubflowNode(engine, pluginCtx());
    engine.registerFlow('one_item', ITEM_FLOW as never);
    engine.registerFlow('batch_flow', BATCH_FLOW as never);
  });

  const launch = () => engine.execute('batch_flow', { params: { items: [{ id: 't1' }, { id: 't2' }] } });
  const parked = (flowName: string) => engine.listSuspendedRuns().filter(r => r.flowName === flowName);
  const mapState = (runId: string) =>
    (engine as any).suspendedRuns.get(runId)?.variables?.['signoffs.$mapState'];

  it('records the cancelled item in its slot, outside count, and the map goes on to the next item', async () => {
    const paused = await launch();
    const [item1] = parked('one_item');
    expect(await engine.cancelRun(item1!.runId, 'operator')).toBe(true);

    const resumed = await engine.resume(paused.runId!, {});

    expect(resumed.success).toBe(true);
    expect(resumed.status).toBe('paused');
    // Item 1's slot holds the marker; the map parked on item 2.
    expect(mapState(paused.runId!)).toEqual({
      started: 2, results: [{ $status: 'cancelled', $itemRunId: item1!.runId }],
    });
    const [item2] = parked('one_item');
    expect(item2!.runId).not.toBe(item1!.runId);

    const finished = await engine.resume(item2!.runId, {});
    expect(finished.success).toBe(true);

    // The downstream node reads the marker where it reads the results, and
    // `count` is the one item that RAN.
    const marker = { $status: 'cancelled', $itemRunId: item1!.runId };
    expect(seen).toEqual({ results: [marker, { done: 'ran t2' }], nodeResults: [marker, { done: 'ran t2' }], count: 1 });
    expect(engine.listSuspendedRuns()).toEqual([]);
    expect((await engine.getRun(paused.runId!))?.status).toBe('completed');
  });

  it('records it one level down when the resumed id is a subflow parent of the map', async () => {
    engine.registerFlow('outer_flow', {
      name: 'outer_flow', label: 'outer_flow', type: 'autolaunched',
      nodes: [
        { id: 'os', type: 'start', label: 'Start' },
        { id: 'call', type: 'subflow', label: 'Call batch', config: { flowName: 'batch_flow', input: { items: [{ id: 't1' }] } } },
        { id: 'oe', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'o1', source: 'os', target: 'call' }, { id: 'o2', source: 'call', target: 'oe' }],
    } as never);
    const outer = await engine.execute('outer_flow');
    const [item1] = parked('one_item');
    await engine.cancelRun(item1!.runId);

    const resumed = await engine.resume(outer.runId!, {});

    expect(resumed.success).toBe(true);
    expect(seen).toEqual({
      results: [{ $status: 'cancelled', $itemRunId: item1!.runId }],
      nodeResults: [{ $status: 'cancelled', $itemRunId: item1!.runId }],
      count: 0,
    });
    expect(engine.listSuspendedRuns()).toEqual([]);
  });

  it('refuses, nothing moved, when the item row is gone without a cancelled history row', async () => {
    const paused = await launch();
    const [item1] = parked('one_item');
    // The suspension is gone but nothing cancelled it: its history still says
    // `paused` (a consumed strand, or a child that completed without bubbling).
    (engine as any).suspendedRuns.delete(item1!.runId);
    expect((await engine.getRun(item1!.runId))?.status).toBe('paused');

    const refused = await engine.resume(paused.runId!, {});

    expect(refused.success).toBe(false);
    expect(refused.code).toBe(MAP_ITEM_PENDING_REFUSAL_CODE);
    expect(refused.error).toContain(`item run '${item1!.runId}', which is no longer suspended`);
    // The remedy names the run to cancel — the map's own, not the gone item's.
    expect(refused.error).toContain(`To end the batch, cancel run '${paused.runId}'`);
    expect(mapState(paused.runId!)).toEqual({ started: 1, results: [] });
    expect(parked('batch_flow').map(r => r.runId)).toEqual([paused.runId]);
    expect(seen).toBeUndefined();
  });

  it('refuses when the item run history cannot be read', async () => {
    const paused = await launch();
    const [item1] = parked('one_item');
    await engine.cancelRun(item1!.runId);
    // `getRun` degrades a store failure to `null` — indistinguishable from no row.
    (engine as any).getRun = async () => null;

    const refused = await engine.resume(paused.runId!, {});

    expect(refused.code).toBe(MAP_ITEM_PENDING_REFUSAL_CODE);
    expect(refused.error).toContain('no run history for it can be read');
    expect(refused.error).toContain(`To end the batch, cancel run '${paused.runId}'`);
    expect(mapState(paused.runId!)).toEqual({ started: 1, results: [] });
  });

  it('still refuses a caller signal that writes the engine namespace, so the marker cannot be forged', async () => {
    const paused = await launch();
    const [item1] = parked('one_item');
    await engine.cancelRun(item1!.runId);

    const refused = await engine.resume(paused.runId!, { output: { $mapItemCancelled: 'run_forged' } } as never);

    expect(refused.success).toBe(false);
    expect(refused.code).toBe('INVALID_SIGNAL');
    expect(mapState(paused.runId!)).toEqual({ started: 1, results: [] });
    expect(parked('batch_flow').map(r => r.runId)).toEqual([paused.runId]);
  });

  it('control: a still-suspended item is still refused, naming it', async () => {
    const paused = await launch();
    const [item1] = parked('one_item');

    const refused = await engine.resume(paused.runId!, {});

    expect(refused.code).toBe(MAP_ITEM_PENDING_REFUSAL_CODE);
    expect(refused.error).toContain(`Resume run '${item1!.runId}' instead`);
    expect(mapState(paused.runId!)).toEqual({ started: 1, results: [] });
  });

  it('control: items that complete are recorded as before, and count is every item', async () => {
    await launch();
    await engine.resume(parked('one_item')[0]!.runId, {});
    await engine.resume(parked('one_item')[0]!.runId, {});

    expect(seen).toEqual({
      results: [{ done: 'ran t1' }, { done: 'ran t2' }],
      nodeResults: [{ done: 'ran t1' }, { done: 'ran t2' }],
      count: 2,
    });
  });
});
