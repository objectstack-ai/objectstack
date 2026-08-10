// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor } from '../engine.js';
import { InMemorySuspendedRunStore } from '../suspended-run-store.js';
import { registerSubflowNode } from './subflow-node.js';
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

describe('subflow node executor', () => {
  let engine: AutomationEngine;
  let ran: string[];
  let seenInput: unknown[];
  let captured: unknown[];

  beforeEach(() => {
    engine = new AutomationEngine(silentLogger());
    ran = [];
    seenInput = [];
    captured = [];
    registerSubflowNode(engine, ctx());

    // Child marker: records it ran + sets the child's declared output var.
    engine.registerNodeExecutor({
      type: 'childmark',
      async execute(_node, variables, context) {
        ran.push('child');
        seenInput.push((context as any)?.params?.msg);
        variables.set('result', 'CHILD_DONE');
        return { success: true };
      },
    } as NodeExecutor);
    // Parent checker after the subflow node: captures the mapped output var.
    engine.registerNodeExecutor({
      type: 'parentcheck',
      async execute(_node, variables) {
        captured.push(variables.get('subResult'));
        return { success: true };
      },
    } as NodeExecutor);
    // A node that suspends (to exercise nested durable pause).
    engine.registerNodeExecutor({
      type: 'pauser',
      descriptor: openPauser('pauser'),
      async execute() { return { success: true, suspend: true }; },
    } as NodeExecutor);
    // A screen-style pauser: suspends surfacing the screen from node config.
    engine.registerNodeExecutor({
      type: 'screenpauser',
      descriptor: openPauser('screenpauser'),
      async execute(node) {
        return { success: true, suspend: true, screen: (node.config as any)?.screen };
      },
    } as NodeExecutor);
    // Copies the screen-collected `new_val` (a bare resumed variable) to `result`.
    engine.registerNodeExecutor({
      type: 'copier',
      async execute(_node, variables) {
        variables.set('result', variables.get('new_val'));
        return { success: true };
      },
    } as NodeExecutor);
    // Fails terminally (post-pause failure propagation).
    engine.registerNodeExecutor({
      type: 'failer',
      async execute() { return { success: false, error: 'boom' }; },
    } as NodeExecutor);

    engine.registerFlow('child_flow', {
      name: 'child_flow',
      label: 'Child Flow',
      type: 'autolaunched',
      variables: [
        { name: 'msg', type: 'text', isInput: true },
        { name: 'result', type: 'text', isOutput: true },
      ],
      nodes: [
        { id: 'cs', type: 'start', label: 'Start' },
        { id: 'cm', type: 'childmark', label: 'Child Work' },
        { id: 'ce', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'c1', source: 'cs', target: 'cm' },
        { id: 'c2', source: 'cm', target: 'ce' },
      ],
    });
  });

  const parentFlow = (subConfig: Record<string, unknown>) => ({
    name: 'parent_flow',
    label: 'Parent Flow',
    type: 'autolaunched',
    variables: [{ name: 'greeting', type: 'text', isInput: true }],
    nodes: [
      { id: 'ps', type: 'start', label: 'Start' },
      { id: 'call', type: 'subflow', label: 'Call Child', config: subConfig },
      { id: 'chk', type: 'parentcheck', label: 'Check' },
      { id: 'pe', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'p1', source: 'ps', target: 'call' },
      { id: 'p2', source: 'call', target: 'chk' },
      { id: 'p3', source: 'chk', target: 'pe' },
    ],
  });

  it('invokes the child flow, maps input, and captures its output', async () => {
    engine.registerFlow('parent_flow', parentFlow({
      flowName: 'child_flow',
      input: { msg: '{greeting}' },
      outputVariable: 'subResult',
    }));

    const result = await engine.execute('parent_flow', { params: { greeting: 'hi' } });

    expect(result.success).toBe(true);
    expect(result.status).toBeUndefined(); // ran to completion
    expect(ran).toEqual(['child']); // the child flow actually executed
    expect(seenInput).toEqual(['hi']); // input mapping interpolated from parent vars
    expect(captured).toEqual([{ result: 'CHILD_DONE' }]); // child output captured into the parent var
  });

  it('fails with a clear error when flowName is missing', async () => {
    engine.registerFlow('parent_flow', parentFlow({ input: {} }));
    const result = await engine.execute('parent_flow');
    expect(result.success).toBe(false);
    // #4343 — the hand-written guard became the contract parse; same guard
    // classification, message now derived from `SubflowConfigSchema`.
    expect(result.error).toMatch(/does not satisfy the subflow contract/i);
    expect(result.error).toMatch(/config\.flowName/);
  });

  it('fails with a clear error when the child flow is not registered', async () => {
    engine.registerFlow('parent_flow', parentFlow({ flowName: 'no_such_flow' }));
    const result = await engine.execute('parent_flow');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no_such_flow.*failed/i);
    expect(captured).toEqual([]); // downstream did not run
  });

  // ── Nested durable pause (linked-runs model) ─────────────────────────

  /** Child that pauses, then sets its output var when resumed. */
  const pausedChild = (pauseNodes: Array<{ id: string; type: string; config?: Record<string, unknown> }>) => ({
    name: 'paused_child',
    label: 'Paused Child',
    type: 'autolaunched',
    variables: [{ name: 'result', type: 'text', isOutput: true }],
    nodes: [
      { id: 's', type: 'start', label: 'Start' },
      ...pauseNodes.map((n) => ({ label: n.id, ...n })),
      { id: 'cm', type: 'childmark', label: 'Child Work' },
      { id: 'e', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'es', source: 's', target: pauseNodes[0].id },
      ...pauseNodes.map((n, i) => ({
        id: `ep${i}`,
        source: n.id,
        target: pauseNodes[i + 1]?.id ?? 'cm',
      })),
      { id: 'ee', source: 'cm', target: 'e' },
    ],
  });

  const registerPausingPair = (pauseNodes: Array<{ id: string; type: string; config?: Record<string, unknown> }>) => {
    engine.registerFlow('paused_child', pausedChild(pauseNodes) as never);
    engine.registerFlow('parent_flow', parentFlow({ flowName: 'paused_child', outputVariable: 'subResult' }));
  };

  const suspendedByFlow = (name: string) =>
    engine.listSuspendedRuns().find((r) => r.flowName === name);

  it('suspends the parent (not fails) when the child pauses, linking the runs', async () => {
    registerPausingPair([{ id: 'p', type: 'pauser' }]);
    const result = await engine.execute('parent_flow');

    expect(result.success).toBe(true);
    expect(result.status).toBe('paused');
    const parent = suspendedByFlow('parent_flow');
    const child = suspendedByFlow('paused_child');
    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    expect(result.runId).toBe(parent!.runId);
    expect(parent!.nodeId).toBe('call');
    expect(parent!.correlation).toBe(`subflow:${child!.runId}`);
  });

  it('bubbles a directly-resumed child completion up to the parent (approval/wait path)', async () => {
    registerPausingPair([{ id: 'p', type: 'pauser' }]);
    await engine.execute('parent_flow');
    const child = suspendedByFlow('paused_child')!;

    const childRes = await engine.resume(child.runId);

    expect(childRes.success).toBe(true);
    expect(childRes.status).toBeUndefined(); // child ran to completion
    // Parent auto-continued: downstream captured the mapped output, both rows gone.
    expect(captured).toEqual([{ result: 'CHILD_DONE' }]);
    expect(engine.listSuspendedRuns()).toHaveLength(0);
  });

  it('delegates a parent resume down to the child (screen-flow path), surfacing the child screen', async () => {
    const screen = { nodeId: 'p', title: 'Collect', fields: [{ name: 'new_val', type: 'text' }] };
    registerPausingPair([{ id: 'p', type: 'screenpauser', config: { screen } }]);
    // Replace cm: copy the collected input instead of the static marker.
    const flow = pausedChild([{ id: 'p', type: 'screenpauser', config: { screen } }]);
    flow.nodes = flow.nodes.map((n) => (n.id === 'cm' ? { ...n, type: 'copier' } : n));
    engine.registerFlow('paused_child', flow as never);

    const result = await engine.execute('parent_flow');
    expect(result.status).toBe('paused');
    expect(result.screen).toEqual(screen); // nested screen surfaces on the parent result

    const parentRunId = result.runId!;
    const final = await engine.resume(parentRunId, { variables: { new_val: 'typed-in' } });

    expect(final.success).toBe(true);
    expect(final.status).toBeUndefined();
    expect(captured).toEqual([{ result: 'typed-in' }]);
    expect(engine.listSuspendedRuns()).toHaveLength(0);
  });

  it('keeps the parent paused across a multi-screen child wizard', async () => {
    const s1 = { nodeId: 'p1', title: 'Step 1', fields: [{ name: 'new_val', type: 'text' }] };
    const s2 = { nodeId: 'p2', title: 'Step 2', fields: [{ name: 'other', type: 'text' }] };
    const flow = pausedChild([
      { id: 'p1', type: 'screenpauser', config: { screen: s1 } },
      { id: 'p2', type: 'screenpauser', config: { screen: s2 } },
    ]);
    flow.nodes = flow.nodes.map((n) => (n.id === 'cm' ? { ...n, type: 'copier' } : n));
    engine.registerFlow('paused_child', flow as never);
    engine.registerFlow('parent_flow', parentFlow({ flowName: 'paused_child', outputVariable: 'subResult' }));

    const r1 = await engine.execute('parent_flow');
    expect(r1.status).toBe('paused');
    expect(r1.screen).toEqual(s1);
    const parentRunId = r1.runId!;

    const r2 = await engine.resume(parentRunId, { variables: { new_val: 'v1' } });
    expect(r2.status).toBe('paused');
    expect(r2.runId).toBe(parentRunId); // UI keeps one stable run id
    expect(r2.screen).toEqual(s2); // next wizard screen
    expect(await engine.getSuspendedScreen(parentRunId)).toEqual(s2); // refresh-safe re-fetch

    const r3 = await engine.resume(parentRunId, { variables: { other: 'x' } });
    expect(r3.success).toBe(true);
    expect(r3.status).toBeUndefined();
    expect(captured).toEqual([{ result: 'v1' }]);
    expect(engine.listSuspendedRuns()).toHaveLength(0);
  });

  it('bubbles through two levels of nesting', async () => {
    registerPausingPair([{ id: 'p', type: 'pauser' }]);
    // grandparent → parent_flow → paused_child
    engine.registerNodeExecutor({
      type: 'grandcheck',
      async execute(_node, variables) {
        captured.push(variables.get('grandResult'));
        return { success: true };
      },
    } as NodeExecutor);
    engine.registerFlow('grand_flow', {
      name: 'grand_flow',
      label: 'Grand Flow',
      type: 'autolaunched',
      nodes: [
        { id: 'gs', type: 'start', label: 'Start' },
        { id: 'gcall', type: 'subflow', label: 'Call Parent', config: { flowName: 'parent_flow', outputVariable: 'grandResult' } },
        { id: 'gchk', type: 'grandcheck', label: 'Check' },
        { id: 'ge', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'g1', source: 'gs', target: 'gcall' },
        { id: 'g2', source: 'gcall', target: 'gchk' },
        { id: 'g3', source: 'gchk', target: 'ge' },
      ],
    } as never);

    const result = await engine.execute('grand_flow');
    expect(result.status).toBe('paused');
    expect(engine.listSuspendedRuns()).toHaveLength(3); // grand + parent + child

    const child = suspendedByFlow('paused_child')!;
    const childRes = await engine.resume(child.runId);
    expect(childRes.success).toBe(true);
    // parentcheck captured the child output; grandcheck captured the parent output (its output vars — none declared → {}).
    expect(captured[0]).toEqual({ result: 'CHILD_DONE' });
    expect(captured).toHaveLength(2);
    expect(engine.listSuspendedRuns()).toHaveLength(0);
  });

  it('survives a process restart: chain persisted, resume on a fresh engine bubbles to the parent', async () => {
    const store = new InMemorySuspendedRunStore();
    engine.setSuspendedRunStore(store);
    registerPausingPair([{ id: 'p', type: 'pauser' }]);
    await engine.execute('parent_flow');
    const child = suspendedByFlow('paused_child')!;
    expect((await store.list()).length).toBe(2);

    // "Restart": a fresh engine sharing only the durable store + flow registry.
    const engineB = new AutomationEngine(silentLogger(), store);
    registerSubflowNode(engineB, ctx());
    const capturedB: unknown[] = [];
    engineB.registerNodeExecutor({
      type: 'childmark',
      async execute(_node, variables) { variables.set('result', 'CHILD_DONE'); return { success: true }; },
    } as NodeExecutor);
    engineB.registerNodeExecutor({
      type: 'parentcheck',
      async execute(_node, variables) { capturedB.push(variables.get('subResult')); return { success: true }; },
    } as NodeExecutor);
    engineB.registerNodeExecutor({ type: 'pauser', descriptor: openPauser('pauser'), async execute() { return { success: true, suspend: true }; } } as NodeExecutor);
    engineB.registerFlow('paused_child', pausedChild([{ id: 'p', type: 'pauser' }]) as never);
    engineB.registerFlow('parent_flow', parentFlow({ flowName: 'paused_child', outputVariable: 'subResult' }) as never);

    const res = await engineB.resume(child.runId);
    expect(res.success).toBe(true);
    expect(capturedB).toEqual([{ result: 'CHILD_DONE' }]);
    expect(await store.list()).toHaveLength(0); // both rows consumed
  });

  it('fails the waiting parent when the resumed child fails terminally', async () => {
    const flow = pausedChild([{ id: 'p', type: 'pauser' }]);
    flow.nodes = flow.nodes.map((n) => (n.id === 'cm' ? { ...n, type: 'failer' } : n));
    engine.registerFlow('paused_child', flow as never);
    engine.registerFlow('parent_flow', parentFlow({ flowName: 'paused_child', outputVariable: 'subResult' }));

    const r = await engine.execute('parent_flow');
    const parentRunId = r.runId!;
    const child = suspendedByFlow('paused_child')!;

    const childRes = await engine.resume(child.runId);
    expect(childRes.success).toBe(false);

    // The parent is terminally failed, not left suspended forever.
    expect(engine.listSuspendedRuns()).toHaveLength(0);
    const again = await engine.resume(parentRunId);
    expect(again.success).toBe(false);
    expect(again.error).toMatch(/No suspended run/);
    expect(captured).toEqual([]); // parent downstream never ran
  });

  it('guards against a recursive subflow cycle (clean error, no stack overflow)', async () => {
    // A flow that calls itself — should hit the depth cap and fail cleanly.
    engine.registerFlow('recursive_flow', {
      name: 'recursive_flow',
      label: 'Recursive Flow',
      type: 'autolaunched',
      nodes: [
        { id: 's', type: 'start', label: 'Start' },
        { id: 'self', type: 'subflow', label: 'Self', config: { flowName: 'recursive_flow' } },
        { id: 'e', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'a', source: 's', target: 'self' },
        { id: 'b', source: 'self', target: 'e' },
      ],
    });
    const result = await engine.execute('recursive_flow');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/depth|recursive/i);
  });

  // #4278 — this proves the CONVERSION, not executor tolerance. The executor
  // reads only the canonical `flowName` (its bare `cfg.flow` fallback was
  // deleted with the graduation); a stored flow on the undeclared `flow`
  // spelling reaches it because `registerFlow` applies
  // 'flow-node-subflow-flow-alias', which renames it at load.
  it('accepts the legacy `config.flow` spelling via the conversion layer (#4278)', async () => {
    engine.registerFlow('parent_flow', parentFlow({
      flow: 'child_flow',
      input: { msg: '{greeting}' },
      outputVariable: 'subResult',
    }));

    const result = await engine.execute('parent_flow', { params: { greeting: 'hi' } });

    expect(result.success).toBe(true);
    expect(ran).toEqual(['child']);
    expect(captured).toEqual([{ result: 'CHILD_DONE' }]);
  });
});
