// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A resume of a run parked on a `map` node, addressed by the PARENT's id while
 * the in-flight item's child run is still suspended, is refused (#27877).
 *
 * The `map` node does not delegate a signal the way `subflow` does: on resume
 * it RE-RUNS, and `$mapState.started` was advanced past the in-flight item
 * before the suspend. So continuing the parent advanced the map past an item
 * that never ran — measured on the in-process door: `success: true`, the
 * parent's run row `completed`, and the item child left in
 * `listSuspendedRuns()`, orphaned. The gate now refuses that resume with a code
 * and a message naming the child run id to resume instead, and nothing moves.
 *
 * What stays as it was: resuming the item child (the door the refusal names)
 * continues the map through the engine's own up-bubble, and a `subflow`
 * parent-id resume — whose signal IS delegated to the child — still succeeds.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { RESUME_AUTHORITY_SERVICE } from '@objectstack/spec/contracts';
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

/** start → `open_pause` (raw-resumable, like `screen` / `wait`) → after → end. */
function itemFlow(name: string) {
  return {
    name,
    label: name,
    type: 'autolaunched',
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
}

/** start → `<node>` → end, the `map` / `subflow` host. */
function hostFlow(name: string, node: Record<string, unknown>, variables?: unknown[]) {
  return {
    name,
    label: name,
    type: 'autolaunched',
    ...(variables ? { variables } : {}),
    nodes: [{ id: 'hs', type: 'start', label: 'Start' }, node, { id: 'he', type: 'end', label: 'End' }],
    edges: [
      { id: 'h1', source: 'hs', target: node.id as string },
      { id: 'h2', source: node.id as string, target: 'he' },
    ],
  };
}

const MAP_NODE = {
  id: 'signoffs', type: 'map', label: 'Sign off each',
  config: { collection: { dialect: 'cel', source: 'items' }, flowName: 'one_item', outputVariable: 'results' },
};

describe('a parent-id resume of a map whose item is still parked (#27877)', () => {
  let engine: AutomationEngine;
  let downstream: string[];

  beforeEach(() => {
    downstream = [];
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
      async execute(node) { downstream.push(node.id); return { success: true }; },
    });
    registerMapNode(engine, pluginCtx());
    registerSubflowNode(engine, pluginCtx());
    engine.registerFlow('one_item', itemFlow('one_item') as never);
    engine.registerFlow('batch_flow', hostFlow('batch_flow', MAP_NODE, [{ name: 'items', type: 'list', isInput: true }]) as never);
  });

  const launch = () => engine.execute('batch_flow', { params: { items: [{ id: 't1' }, { id: 't2' }] } });
  const parked = (flowName: string) => engine.listSuspendedRuns().filter(r => r.flowName === flowName);
  const mapState = (runId: string) =>
    (engine as any).suspendedRuns.get(runId)?.variables?.['signoffs.$mapState'];

  it('refuses with a code naming the item run, and nothing advances', async () => {
    const paused = await launch();
    const [item1] = parked('one_item');
    expect(item1).toBeDefined();

    const refused = await engine.resume(paused.runId!, {});

    expect(refused.success).toBe(false);
    expect(refused.code).toBe(MAP_ITEM_PENDING_REFUSAL_CODE);
    expect(refused.error).toContain(`Resume run '${item1!.runId}' instead`);
    // The parent is still parked on item 1, the map did not move, and the item
    // is still resumable — nothing was consumed and nothing ran.
    expect(parked('batch_flow').map(r => r.runId)).toEqual([paused.runId]);
    expect(mapState(paused.runId!)).toEqual({ started: 1, results: [] });
    expect(parked('one_item').map(r => r.runId)).toEqual([item1!.runId]);
    expect(downstream).toEqual([]);
    expect((await engine.listRuns('batch_flow')).map(r => r.status)).not.toContain('completed');
  });

  it('is refused whatever the signal carries — a skip is not a question of authority', async () => {
    const paused = await launch();

    const refused = await engine.resume(paused.runId!, { [RESUME_AUTHORITY_SERVICE]: true });

    expect(refused.code).toBe(MAP_ITEM_PENDING_REFUSAL_CODE);
    expect(mapState(paused.runId!)).toEqual({ started: 1, results: [] });
    expect(parked('one_item')).toHaveLength(1);
  });

  it('resuming the named item run still works, and the map then continues to completion', async () => {
    const paused = await launch();
    const [item1] = parked('one_item');

    const first = await engine.resume(item1!.runId, {});
    expect(first.success).toBe(true);
    // Item 1 ran through; the map recorded it and parked on item 2.
    expect(downstream).toEqual(['after']);
    expect(mapState(paused.runId!)).toEqual({ started: 2, results: [expect.anything()] });
    const [item2] = parked('one_item');
    expect(item2!.runId).not.toBe(item1!.runId);

    const second = await engine.resume(item2!.runId, {});
    expect(second.success).toBe(true);
    expect(downstream).toEqual(['after', 'after']);
    expect(engine.listSuspendedRuns()).toEqual([]);
    const [row] = await engine.listRuns('batch_flow');
    expect(row?.status).toBe('completed');
  });

  it('follows a subflow link down to a map parked on its item, and names that item', async () => {
    engine.registerFlow('outer_flow', hostFlow('outer_flow', {
      id: 'call', type: 'subflow', label: 'Call batch', config: { flowName: 'batch_flow', input: { items: [{ id: 't1' }] } },
    }) as never);
    const outer = await engine.execute('outer_flow');
    expect(outer.status).toBe('paused');
    const [batch] = parked('batch_flow');
    const [item1] = parked('one_item');
    expect(batch && item1).toBeTruthy();

    const refused = await engine.resume(outer.runId!, {});

    expect(refused.code).toBe(MAP_ITEM_PENDING_REFUSAL_CODE);
    expect(refused.error).toContain(`waiting on run '${batch!.runId}'`);
    expect(refused.error).toContain(`Resume run '${item1!.runId}' instead`);
    expect(engine.listSuspendedRuns()).toHaveLength(3);
    expect(downstream).toEqual([]);
  });

  it('names the item run, never the caller\'s own, when a corrupt correlation cycles back to the caller', async () => {
    const paused = await launch();
    const [item1] = parked('one_item');
    // Corrupt the item's row so it points back at its parent: map:A → map:B → A.
    (engine as any).suspendedRuns.get(item1!.runId).correlation = `map:${paused.runId}`;

    const refused = await engine.resume(paused.runId!, {});

    expect(refused.code).toBe(MAP_ITEM_PENDING_REFUSAL_CODE);
    expect(refused.error).toContain(`Resume run '${item1!.runId}' instead`);
    expect(refused.error).not.toContain(`Resume run '${paused.runId}'`);
    expect(mapState(paused.runId!)).toEqual({ started: 1, results: [] });
  });

  it('leaves a subflow parent-id resume unchanged: the signal is delegated to the child', async () => {
    engine.registerFlow('child_flow', itemFlow('child_flow') as never);
    engine.registerFlow('parent_flow', hostFlow('parent_flow', {
      id: 'call', type: 'subflow', label: 'Call child', config: { flowName: 'child_flow' },
    }) as never);
    const paused = await engine.execute('parent_flow');
    expect(paused.status).toBe('paused');

    const resumed = await engine.resume(paused.runId!, {});

    expect(resumed.code).toBeUndefined();
    expect(resumed.success).toBe(true);
    expect(downstream).toEqual(['after']);
    expect(engine.listSuspendedRuns()).toEqual([]);
  });
});
