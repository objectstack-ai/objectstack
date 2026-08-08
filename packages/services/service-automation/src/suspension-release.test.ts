// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from './engine.js';
import type { NodeExecutor, SuspensionRelease } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import { registerSubflowNode } from './builtin/subflow-node.js';
import { defineActionDescriptor } from '@objectstack/spec/automation';

/**
 * `NodeExecutor.onSuspensionReleased` — the engine side of #5512.
 *
 * A pausing node arms something external on entry (the `wait` node's one-shot
 * wake-up job; a lease, a reminder, a timeout in a plugin's node). Before this
 * hook the only route that tore that armature down was the node's OWN wake path,
 * so a pause ended any other way left it live — which is how a `flow-wait`
 * one-shot stayed `active` in `sys_job` for a day after its run completed.
 *
 * These tests pin the CONTRACT rather than the wait node's use of it: which
 * executor is notified, with what, on which routes, and what happens when the
 * teardown itself fails.
 */

function silentLogger(warns: string[] = []) {
  return {
    info() {},
    warn(msg: string) { warns.push(String(msg)); },
    error() {},
    debug() {},
    child() { return silentLogger(warns); },
  } as any;
}

function ctx() {
  return { logger: silentLogger(), getService() { throw new Error('none'); } } as any;
}

/**
 * The declaration every pausing fixture in this file needs since #5561: these
 * tests continue their pause through the public `resume` door, which a node type
 * now has to opt into with `resumeAuthority: 'any'` — a type that declares
 * nothing is refused there. Nothing here is about the resume gate itself (see
 * `resume-authority-gate.test.ts`), so each fixture states the posture it relies
 * on, exactly as the four pausing built-ins do.
 */
function openPauser(type: string) {
  return defineActionDescriptor({
    type, version: '1.0.0', name: type,
    supportsPause: true, resumeAuthority: 'any',
  });
}

/** A pausing executor that records every release it is told about. */
function recordingPauser(type: string, seen: SuspensionRelease[]): NodeExecutor {
  return {
    type,
    descriptor: openPauser(type),
    async execute(node) {
      // A correlation stands in for "the handle on whatever I armed on entry".
      return { success: true, suspend: true, correlation: `test-armature:${node.id}` };
    },
    onSuspensionReleased(release) {
      seen.push(release);
    },
  };
}

/** Records the order downstream nodes ran, to prove the continuation survived. */
function markerExecutor(ran: string[]): NodeExecutor {
  return { type: 'mark', async execute(node) { ran.push(node.id); return { success: true }; } };
}

const pauseFlow = (pauseType: string) => ({
  name: 'pause_flow',
  label: 'Pause Flow',
  type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'hold', type: pauseType, label: 'Hold' },
    { id: 'after', type: 'mark', label: 'After' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'hold' },
    { id: 'e2', source: 'hold', target: 'after' },
    { id: 'e3', source: 'after', target: 'end' },
  ],
});

describe('NodeExecutor.onSuspensionReleased (#5512)', () => {
  let engine: AutomationEngine;
  let ran: string[];
  let seen: SuspensionRelease[];

  beforeEach(() => {
    engine = new AutomationEngine(silentLogger());
    ran = [];
    seen = [];
    engine.registerNodeExecutor(markerExecutor(ran));
    engine.registerNodeExecutor(recordingPauser('pauser', seen));
  });

  it('notifies the paused node on resume, with the correlation it suspended with', async () => {
    engine.registerFlow('pause_flow', pauseFlow('pauser'));

    const paused = await engine.execute('pause_flow');
    expect(paused.status).toBe('paused');
    expect(seen).toEqual([]); // nothing released yet — the run is still parked

    const resumed = await engine.resume(paused.runId!);
    expect(resumed.success).toBe(true);
    expect(ran).toEqual(['after']);
    expect(seen).toEqual([
      {
        runId: paused.runId,
        flowName: 'pause_flow',
        nodeId: 'hold',
        correlation: 'test-armature:hold',
        reason: 'resumed',
      },
    ]);
  });

  it('notifies on cancelRun — a run cancelled while parked still has an armature to drop', async () => {
    engine.registerFlow('pause_flow', pauseFlow('pauser'));

    const paused = await engine.execute('pause_flow');
    expect(await engine.cancelRun(paused.runId!, 'abandoned')).toBe(true);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ runId: paused.runId, nodeId: 'hold', reason: 'cancelled' });
    expect(ran).toEqual([]); // cancelled, not continued
  });

  it('notifies exactly once, and only the executor of the node that paused', async () => {
    const otherSeen: SuspensionRelease[] = [];
    engine.registerNodeExecutor(recordingPauser('other_pauser', otherSeen));
    engine.registerFlow('pause_flow', pauseFlow('pauser'));

    const paused = await engine.execute('pause_flow');
    await engine.resume(paused.runId!);

    expect(seen).toHaveLength(1);
    expect(otherSeen).toEqual([]); // not a broadcast — routed by the paused node's type
  });

  it('is silent for a pausing executor that implements no teardown', async () => {
    engine.registerNodeExecutor({
      type: 'bare_pauser',
      descriptor: openPauser('bare_pauser'),
      async execute() { return { success: true, suspend: true }; },
    } as NodeExecutor);
    engine.registerFlow('pause_flow', pauseFlow('bare_pauser'));

    const paused = await engine.execute('pause_flow');
    const resumed = await engine.resume(paused.runId!);
    expect(resumed.success).toBe(true);
    expect(ran).toEqual(['after']); // the optional hook changes nothing for executors without it
  });

  it('routes a suspension rehydrated from the durable store (fresh engine, cold path)', async () => {
    const store = new InMemorySuspendedRunStore();
    engine.setSuspendedRunStore(store);
    engine.registerFlow('pause_flow', pauseFlow('pauser'));
    const paused = await engine.execute('pause_flow');

    // A second "process": new engine, same durable store — the run is resumed
    // from the stored row, not the in-memory cache.
    const seen2: SuspensionRelease[] = [];
    const ran2: string[] = [];
    const engine2 = new AutomationEngine(silentLogger(), store);
    engine2.registerNodeExecutor(markerExecutor(ran2));
    engine2.registerNodeExecutor(recordingPauser('pauser', seen2));
    engine2.registerFlow('pause_flow', pauseFlow('pauser'));

    const resumed = await engine2.resume(paused.runId!);
    expect(resumed.success).toBe(true);
    expect(ran2).toEqual(['after']);
    expect(seen2).toHaveLength(1);
    expect(seen2[0]).toMatchObject({ nodeId: 'hold', correlation: 'test-armature:hold', reason: 'resumed' });
    expect(seen).toEqual([]); // released on the engine that consumed it, not the one that armed it
  });

  it('a teardown that throws is logged and does not fail the continuation', async () => {
    const warns: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const recordingLogger = {
      info() {}, error() {}, debug() {},
      warn(msg: string, meta?: Record<string, unknown>) { warns.push({ msg: String(msg), meta }); },
      child() { return recordingLogger; },
    } as any;
    const loud = new AutomationEngine(recordingLogger);
    const ranLoud: string[] = [];
    loud.registerNodeExecutor(markerExecutor(ranLoud));
    loud.registerNodeExecutor({
      type: 'pauser',
      descriptor: openPauser('pauser'),
      async execute(node) { return { success: true, suspend: true, correlation: `test-armature:${node.id}` }; },
      async onSuspensionReleased() { throw new Error('job service exploded'); },
    } as NodeExecutor);
    loud.registerFlow('pause_flow', pauseFlow('pauser'));

    const paused = await loud.execute('pause_flow');
    const resumed = await loud.resume(paused.runId!);

    expect(resumed.success).toBe(true); // the run is what matters — teardown is best-effort
    expect(ranLoud).toEqual(['after']);
    const warn = warns.find((w) => w.msg.includes('failed to release its suspension'));
    expect(warn).toBeTruthy();
    // The line has to name the handle an operator would clean up by hand.
    expect(warn!.msg).toContain('test-armature:hold');
    // #6499 — the executor's own text is plugin-supplied, so it rides the
    // STRUCTURED slot, never the message (whose line count must stay ours).
    expect(warn!.msg).not.toContain('job service exploded');
    expect(warn!.meta?.error).toBe('job service exploded');
  });

  it('delegates through a deprecated node alias to the canonical executor', async () => {
    engine.registerNodeAlias('pauser_old', 'pauser');
    engine.registerFlow('pause_flow', pauseFlow('pauser_old'));

    const paused = await engine.execute('pause_flow');
    const resumed = await engine.resume(paused.runId!);

    expect(resumed.success).toBe(true);
    // The alias's synthesized executor implements no teardown of its own; the
    // capability must not be lost just because the old type name was authored.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ nodeId: 'hold', reason: 'resumed' });
  });
});

/**
 * The `failed` reason, on the one path that produces it: a `subflow` ancestor
 * terminally failed by its child (`failSuspendedRun`). It is delivered through
 * the same choke point as the other two, which is the property worth pinning —
 * an executor that implements the hook disarms on ALL routes out of a pause, not
 * just the one it knows about.
 *
 * The real `subflow` executor is used, wrapped in a recording decorator: the
 * subflow node closes over the live engine (it runs the child flow through it),
 * so a hand-written stand-in would be testing the stand-in.
 */
describe('onSuspensionReleased — the `failed` route (subflow ancestor)', () => {
  it('reports reason `failed` when a subflow descendant fails under the pause', async () => {
    const engine = new AutomationEngine(silentLogger());
    const seen: SuspensionRelease[] = [];

    // Capture the executor `registerSubflowNode` registers, then re-register it
    // wrapped — same `execute`, plus a recording teardown.
    let real: NodeExecutor | undefined;
    const register = engine.registerNodeExecutor.bind(engine);
    (engine as unknown as { registerNodeExecutor: (e: NodeExecutor) => void }).registerNodeExecutor = (e) => {
      if (e.type === 'subflow') real = e;
      register(e);
    };
    registerSubflowNode(engine, ctx());
    expect(real).toBeTruthy();
    register({
      type: 'subflow',
      descriptor: real!.descriptor,
      execute: (node, variables, context) => real!.execute(node, variables, context),
      onSuspensionReleased(release) { seen.push(release); },
    });

    engine.registerNodeExecutor({
      type: 'pauser',
      descriptor: openPauser('pauser'),
      async execute() { return { success: true, suspend: true }; },
    } as NodeExecutor);
    engine.registerNodeExecutor({
      type: 'failer',
      async execute() { return { success: false, error: 'boom' }; },
    } as NodeExecutor);

    engine.registerFlow('child_flow', {
      name: 'child_flow',
      label: 'Child',
      type: 'autolaunched',
      nodes: [
        { id: 'cs', type: 'start', label: 'Start' },
        { id: 'cp', type: 'pauser', label: 'Child Pause' },
        { id: 'cf', type: 'failer', label: 'Child Fail' },
        { id: 'ce', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'c1', source: 'cs', target: 'cp' },
        { id: 'c2', source: 'cp', target: 'cf' },
        { id: 'c3', source: 'cf', target: 'ce' },
      ],
    });
    engine.registerFlow('parent_flow', {
      name: 'parent_flow',
      label: 'Parent',
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
    });

    const parent = await engine.execute('parent_flow');
    expect(parent.status).toBe('paused'); // parent parked on the subflow node
    const child = engine.listSuspendedRuns().find((r) => r.flowName === 'child_flow')!;
    expect(child).toBeTruthy();

    const childRes = await engine.resume(child.runId);
    expect(childRes.success).toBe(false); // the child failed after its pause

    // The parent's suspension was consumed by the failure path, and its node
    // was told so — with `failed`, not `resumed`.
    const failed = seen.filter((r) => r.reason === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ runId: parent.runId, nodeId: 'call', reason: 'failed' });
  });
});
