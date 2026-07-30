// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Resume authorization gate (#3801).
 *
 * `POST /automation/:name/runs/:runId/resume` forwards a caller-supplied
 * signal straight into `AutomationEngine.resume`, which validated MACHINE
 * state only — the run exists, the flow exists, the suspended node still
 * exists — and nothing about who was asking. Approval nodes suspend and
 * resume through exactly that mechanism, so a raw resume walked the `approve`
 * edge with no `sys_approval_action` row and no status mirror, leaving the
 * request row and the run permanently disagreeing.
 *
 * The gate keys on WHAT THE RUN IS PARKED ON: a suspension produced by a node
 * whose descriptor declares `resumeAuthority: 'service'` is resumable only
 * with the in-process {@link RESUME_AUTHORITY_SERVICE} marker — which no JSON
 * body can carry. A `screen` pause (the reason the route exists) is untouched.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { RESUME_AUTHORITY_SERVICE } from '@objectstack/spec/contracts';
import { AutomationEngine } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import { registerSubflowNode } from './builtin/subflow-node.js';
import { registerMapNode } from './builtin/map-node.js';

function silentLogger(): any {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}
function pluginCtx(): any {
  return { logger: silentLogger(), getService() { throw new Error('none'); } };
}

/**
 * An engine wired with the node types every flow below is built from: a
 * service-gated pauser, an ungated one, and a downstream marker that records
 * into `downstream` so "did the resume actually continue the run?" is
 * observable. `store` makes the pause durable (restart tests share one).
 */
function makeEngine(downstream: string[], store?: InMemorySuspendedRunStore): AutomationEngine {
  const engine = new AutomationEngine(silentLogger(), store);
  registerPausers(engine);
  engine.registerNodeExecutor({
    type: 'after',
    async execute(node) { downstream.push(node.id); return { success: true }; },
  });
  return engine;
}

/** Registers the two pausing node types every flow below is built from. */
function registerPausers(engine: AutomationEngine): void {
  // Stands in for `approval`: the owning service authorizes + records the
  // decision, then resumes. A raw resume must not.
  engine.registerNodeExecutor({
    type: 'gated_pause',
    descriptor: defineActionDescriptor({
      type: 'gated_pause', version: '1.0.0', name: 'Gated Pause',
      supportsPause: true, isAsync: true, resumeAuthority: 'service',
    }),
    async execute() { return { success: true, suspend: true, correlation: 'req_1' }; },
  });
  // Stands in for `screen` / `wait`: the caller supplies the continuation, so
  // the generic route is the intended door (descriptor defaults to 'any').
  engine.registerNodeExecutor({
    type: 'open_pause',
    descriptor: defineActionDescriptor({
      type: 'open_pause', version: '1.0.0', name: 'Open Pause', supportsPause: true,
    }),
    async execute() { return { success: true, suspend: true }; },
  });
}

/** A linear flow: start → <pause node> → after → end. */
function pauseFlow(name: string, pauseType: string) {
  return {
    name,
    label: name,
    type: 'autolaunched',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'pause', type: pauseType, label: 'Pause' },
      { id: 'after', type: 'after', label: 'After' },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'pause' },
      { id: 'e2', source: 'pause', target: 'after', label: 'approve' },
      { id: 'e3', source: 'after', target: 'end' },
    ],
  };
}

describe('resume authorization gate (#3801)', () => {
  let engine: AutomationEngine;
  let downstream: string[];

  beforeEach(() => {
    downstream = [];
    engine = makeEngine(downstream);
  });

  it('refuses a raw resume of a run parked on a service-gated node', async () => {
    engine.registerFlow('gated_flow', pauseFlow('gated_flow', 'gated_pause') as never);
    const paused = await engine.execute('gated_flow');
    expect(paused.status).toBe('paused');

    // Exactly what the REST route builds out of a JSON body.
    const refused = await engine.resume(paused.runId!, { branchLabel: 'approve', output: { decision: 'approve' } });

    expect(refused.success).toBe(false);
    expect(refused.code).toBe('PERMISSION_DENIED');
    expect(refused.error).toMatch(/only its owning service may resume/i);
    // Refused, not consumed: downstream never ran and the pause is still live,
    // so the real decision can still land.
    expect(downstream).toEqual([]);
    expect(engine.listSuspendedRuns()).toHaveLength(1);
  });

  it('lets the owning service through with the in-process marker', async () => {
    engine.registerFlow('gated_flow', pauseFlow('gated_flow', 'gated_pause') as never);
    const paused = await engine.execute('gated_flow');

    const resumed = await engine.resume(paused.runId!, {
      branchLabel: 'approve',
      output: { decision: 'approve' },
      [RESUME_AUTHORITY_SERVICE]: true,
    });

    expect(resumed.success).toBe(true);
    expect(resumed.code).toBeUndefined();
    expect(downstream).toEqual(['after']);
    expect(engine.listSuspendedRuns()).toHaveLength(0);
  });

  it('leaves an ungated pause (screen / wait) resumable through the route', async () => {
    engine.registerFlow('open_flow', pauseFlow('open_flow', 'open_pause') as never);
    const paused = await engine.execute('open_flow');

    const resumed = await engine.resume(paused.runId!, { variables: { new_assignee: 'ada' } });

    expect(resumed.success).toBe(true);
    expect(downstream).toEqual(['after']);
  });

  it('a node type with no published descriptor stays ungated', async () => {
    // `registerNodeExecutor` without a descriptor — the gate has nothing
    // declaring itself service-owned, so behaviour is unchanged.
    engine.registerNodeExecutor({
      type: 'bare_pause',
      async execute() { return { success: true, suspend: true }; },
    });
    engine.registerFlow('bare_flow', pauseFlow('bare_flow', 'bare_pause') as never);
    const paused = await engine.execute('bare_flow');

    expect((await engine.resume(paused.runId!)).success).toBe(true);
    expect(downstream).toEqual(['after']);
  });

  it('gates a flow authored against a deprecated ALIAS of the gated type', async () => {
    // `registerNodeAlias` synthesizes the alias descriptor and does not copy
    // the canonical's capabilities — reading it directly would hand anyone who
    // authors the old type name an ungated pause.
    engine.registerNodeAlias('legacy_pause', 'gated_pause', { name: 'Legacy Pause' });
    engine.registerFlow('alias_flow', pauseFlow('alias_flow', 'legacy_pause') as never);
    const paused = await engine.execute('alias_flow');

    const refused = await engine.resume(paused.runId!, { branchLabel: 'approve' });
    expect(refused.code).toBe('PERMISSION_DENIED');
    expect(downstream).toEqual([]);
  });

  it('reports machine-state errors, not a refusal, for an unknown run', async () => {
    const result = await engine.resume('run_does_not_exist');
    expect(result.success).toBe(false);
    expect(result.code).toBeUndefined();
    expect(result.error).toContain('No suspended run');
  });

  // ── the suspension carries its own node type ─────────────────────────

  it('tags the suspension with the node type that produced it', async () => {
    engine.registerFlow('gated_flow', pauseFlow('gated_flow', 'gated_pause') as never);
    const paused = await engine.execute('gated_flow');

    const run = (engine as any).suspendedRuns.get(paused.runId!);
    expect(run.nodeType).toBe('gated_pause');
  });

  it('gates a run rehydrated from the durable store after a restart', async () => {
    const store = new InMemorySuspendedRunStore();
    const engineA = makeEngine(downstream, store);
    engineA.registerFlow('gated_flow', pauseFlow('gated_flow', 'gated_pause') as never);
    const paused = await engineA.execute('gated_flow');

    // Process lifetime #2: nothing in memory, the pause comes back off the row.
    const engineB = makeEngine(downstream, store);
    engineB.registerFlow('gated_flow', pauseFlow('gated_flow', 'gated_pause') as never);

    const refused = await engineB.resume(paused.runId!, { branchLabel: 'approve' });
    expect(refused.code).toBe('PERMISSION_DENIED');
    // Still resumable by the service that owns it.
    const ok = await engineB.resume(paused.runId!, { branchLabel: 'approve', [RESUME_AUTHORITY_SERVICE]: true });
    expect(ok.success).toBe(true);
  });

  it('falls back to the flow definition for a row stored before the tag existed', async () => {
    const store = new InMemorySuspendedRunStore();
    const e = makeEngine(downstream, store);
    e.registerFlow('gated_flow', pauseFlow('gated_flow', 'gated_pause') as never);
    const paused = await e.execute('gated_flow');

    // Strip the tag from both the hot cache and the durable row, exactly as a
    // pause persisted by an older build would come back.
    const cached = (e as any).suspendedRuns.get(paused.runId!);
    delete cached.nodeType;
    const stored = await store.load(paused.runId!);
    delete (stored as any).nodeType;
    await store.save(stored!);

    const refused = await e.resume(paused.runId!, { branchLabel: 'approve' });
    expect(refused.code).toBe('PERMISSION_DENIED');
  });

  // ── subflow chains: the signal lands on the CHILD ─────────────────────

  describe('through a subflow pause', () => {
    /** Parent whose `subflow` node calls a child that parks on `pauseType`. */
    function registerChain(e: AutomationEngine, pauseType: string): void {
      registerSubflowNode(e, pluginCtx());
      e.registerFlow('child_flow', pauseFlow('child_flow', pauseType) as never);
      e.registerFlow('parent_flow', {
        name: 'parent_flow',
        label: 'parent_flow',
        type: 'autolaunched',
        nodes: [
          { id: 'ps', type: 'start', label: 'Start' },
          { id: 'call', type: 'subflow', label: 'Call Child', config: { flowName: 'child_flow' } },
          { id: 'pe', type: 'end', label: 'End' },
        ],
        edges: [
          { id: 'p1', source: 'ps', target: 'call' },
          { id: 'p2', source: 'call', target: 'pe' },
        ],
      } as never);
    }

    it('refuses a resume of the PARENT when the child is parked on a gated node', async () => {
      registerChain(engine, 'gated_pause');
      const paused = await engine.execute('parent_flow');
      expect(paused.status).toBe('paused');

      // The parent is parked on a `subflow` node — ungated on its own. But the
      // signal is DELEGATED to the child, so the gate has to judge the child.
      const refused = await engine.resume(paused.runId!, { branchLabel: 'approve' });

      expect(refused.code).toBe('PERMISSION_DENIED');
      expect(downstream).toEqual([]);
      // Neither run was consumed — parent and child are both still suspended.
      expect(engine.listSuspendedRuns()).toHaveLength(2);
    });

    it('still delegates a legitimate parent resume when the child pause is ungated', async () => {
      registerChain(engine, 'open_pause');
      const paused = await engine.execute('parent_flow');

      const resumed = await engine.resume(paused.runId!, { branchLabel: 'approve' });

      expect(resumed.success).toBe(true);
      expect(downstream).toEqual(['after']);
    });
  });

  // ── map chains: the signal would ADVANCE PAST the child (#3853) ───────
  //
  // A `map` pause is the batch-approval shape, and unlike `subflow` the signal
  // is NOT delegated — the map node re-runs, and `$mapState.started` was
  // already advanced past the in-flight item before the suspend. So resuming
  // the parent skips the item whose decision is still open. The run id a
  // launcher holds is the map parent's, which made it the reachable one.

  describe('through a map pause', () => {
    /** Parent whose `map` node runs a per-item child that parks on `pauseType`. */
    function registerBatch(e: AutomationEngine, pauseType: string): void {
      registerMapNode(e, pluginCtx());
      e.registerFlow('one_item', pauseFlow('one_item', pauseType) as never);
      e.registerFlow('batch_flow', {
        name: 'batch_flow',
        label: 'batch_flow',
        type: 'autolaunched',
        variables: [{ name: 'items', type: 'list', isInput: true }],
        nodes: [
          { id: 'bs', type: 'start', label: 'Start' },
          {
            id: 'signoffs', type: 'map', label: 'Sign off each',
            config: { collection: '{items}', iteratorVariable: 'task', flowName: 'one_item', outputVariable: 'results' },
          },
          { id: 'be', type: 'end', label: 'End' },
        ],
        edges: [
          { id: 'b1', source: 'bs', target: 'signoffs' },
          { id: 'b2', source: 'signoffs', target: 'be' },
        ],
      } as never);
    }

    const launch = (e: AutomationEngine) =>
      e.execute('batch_flow', { params: { items: [{ id: 't1' }, { id: 't2' }] } });
    const mapState = (e: AutomationEngine, runId: string) =>
      (e as any).suspendedRuns.get(runId)?.variables?.['signoffs.$mapState'];

    it('refuses a resume of the MAP PARENT while an item is parked on a gated node', async () => {
      registerBatch(engine, 'gated_pause');
      const paused = await launch(engine);
      expect(mapState(engine, paused.runId!)).toEqual({ started: 1, results: [] });

      // Exactly what the route builds from an empty body.
      const refused = await engine.resume(paused.runId!, {});

      expect(refused.code).toBe('PERMISSION_DENIED');
      expect(refused.error).toMatch(/waiting on run/);
      // The map did NOT advance past item 1, and nothing was consumed.
      expect(mapState(engine, paused.runId!)).toEqual({ started: 1, results: [] });
      expect(engine.listSuspendedRuns()).toHaveLength(2); // parent + item 1
      expect(downstream).toEqual([]);
    });

    it('lets the item complete through its owning service, which advances the map', async () => {
      registerBatch(engine, 'gated_pause');
      await launch(engine);
      const item1 = engine.listSuspendedRuns().find(r => r.flowName === 'one_item')!;

      // The service decides item 1 — the child bubbles up and the map moves on.
      const ok = await engine.resume(item1.runId, {
        branchLabel: 'approve', [RESUME_AUTHORITY_SERVICE]: true,
      });

      expect(ok.success).toBe(true);
      const parent = engine.listSuspendedRuns().find(r => r.flowName === 'batch_flow')!;
      expect(mapState(engine, parent.runId).started).toBe(2); // item 2 now in flight
      expect(downstream).toEqual(['after']);                   // item 1 really ran through
    });

    it('leaves a map over ungated items resumable', async () => {
      registerBatch(engine, 'open_pause');
      const paused = await launch(engine);

      const resumed = await engine.resume(paused.runId!, {});

      expect(resumed.code).toBeUndefined();
      expect(resumed.success).toBe(true);
    });

    // ── the signal may not write the engine's own variables ────────────
    //
    // The map's item handoff (`<mapNodeId>.$mapItemDone` / `$mapItemOutput`) is
    // how a completed child tells the map to record its result and advance.
    // A caller who can write those forges the outcome of an item nobody
    // decided. Both signal fields reach the same variable map, and `output` is
    // the subtle one: its keys are prefixed with the SUSPENDED NODE's id, which
    // for a map-parked parent is the map node — so `output: { $mapItemDone }`
    // lands on exactly the reserved key. Guarding one field is not a guard.

    it.each([
      ['variables', { variables: { 'signoffs.$mapItemDone': true, 'signoffs.$mapItemOutput': { result: 'FORGED' } } }],
      ['output', { output: { $mapItemDone: true, $mapItemOutput: { result: 'FORGED' } } }],
    ])('refuses a signal that forges the map item handoff via `%s`', async (_field, signal) => {
      registerBatch(engine, 'open_pause'); // ungated items — the gate lets the parent through
      const paused = await launch(engine);

      const refused = await engine.resume(paused.runId!, signal as any);

      expect(refused.code).toBe('INVALID_SIGNAL');
      expect(refused.error).toMatch(/reserved by the flow engine/);
      // Nothing applied, nothing consumed: the map has not advanced and the
      // pause is still live.
      expect(mapState(engine, paused.runId!)).toEqual({ started: 1, results: [] });
      expect(engine.listSuspendedRuns().some(r => r.runId === paused.runId)).toBe(true);
    });

    it('still lets the engine write the handoff on the legitimate bubble', async () => {
      // The one writer allowed to set those keys — proves the guard did not
      // break the mechanism it protects.
      registerBatch(engine, 'open_pause');
      await launch(engine);
      const item1 = engine.listSuspendedRuns().find(r => r.flowName === 'one_item')!;

      await engine.resume(item1.runId, {}); // item completes → bubbles to the map

      const parent = engine.listSuspendedRuns().find(r => r.flowName === 'batch_flow')!;
      expect(mapState(engine, parent.runId).started).toBe(2);
      expect(mapState(engine, parent.runId).results).toHaveLength(1);
    });
  });

  // ── reserved names outside the map shape ─────────────────────────────

  it('refuses a bare `$runId` rewrite on an ordinary screen resume', async () => {
    engine.registerFlow('open_flow', pauseFlow('open_flow', 'open_pause') as never);
    const paused = await engine.execute('open_flow');

    const refused = await engine.resume(paused.runId!, {
      variables: { new_assignee: 'ada', $runId: 'someone_elses_run' },
    });

    expect(refused.code).toBe('INVALID_SIGNAL');
    // All-or-nothing: the legitimate key was not applied either.
    expect(downstream).toEqual([]);
    expect(engine.listSuspendedRuns()).toHaveLength(1);
  });

  it('leaves ordinary author variable names alone, `$` mid-name included', async () => {
    engine.registerFlow('open_flow', pauseFlow('open_flow', 'open_pause') as never);
    const paused = await engine.execute('open_flow');

    const ok = await engine.resume(paused.runId!, {
      variables: { new_assignee: 'ada', 'collect.note': 'hi', price$: 3 },
      output: { decision: 'ok' },
    });

    expect(ok.success).toBe(true);
    expect(ok.code).toBeUndefined();
    expect(downstream).toEqual(['after']);
  });
});
