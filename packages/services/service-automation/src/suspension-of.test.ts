// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `suspensionOf` answers where one run is parked, with a keyed read by its id
 * (#28271).
 *
 * The approvals re-issue of a restored continuation reads it to prove the
 * pause it continues is the one its outcome was issued at. It used to find the
 * run in `listSuspendedRunsDurable`, which reads one capped page of a
 * DB-backed store; the end-to-end pin past that page is
 * `restored-approval-continuation.test.ts` (plugin-approvals).
 *
 * The pins: a parked run answers its node, also on an engine that did not park
 * it; the answer follows the run to its next pause; a completed run and an
 * unknown id answer `undefined`; a store that cannot be read rejects.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { AutomationEngine } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';

function silentLogger(): any {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}

/** start → `p1` → `p2` → end, both pauses raw-resumable. */
const TWO_PAUSES = {
  name: 'two_pauses', label: 'two_pauses', type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'p1', type: 'open_pause', label: 'First' },
    { id: 'p2', type: 'open_pause', label: 'Second' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'p1' },
    { id: 'e2', source: 'p1', target: 'p2' },
    { id: 'e3', source: 'p2', target: 'end' },
  ],
};

function makeEngine(store: InMemorySuspendedRunStore): AutomationEngine {
  const engine = new AutomationEngine(silentLogger(), store);
  engine.registerNodeExecutor({
    type: 'open_pause',
    descriptor: defineActionDescriptor({
      type: 'open_pause', version: '1.0.0', name: 'Open Pause', supportsPause: true, resumeAuthority: 'any',
    }),
    async execute() { return { success: true, suspend: true }; },
  });
  engine.registerFlow('two_pauses', TWO_PAUSES as never);
  return engine;
}

describe('suspensionOf answers where one run is parked, by its id (#28271)', () => {
  let store: InMemorySuspendedRunStore;
  let engine: AutomationEngine;

  beforeEach(() => {
    store = new InMemorySuspendedRunStore();
    engine = makeEngine(store);
  });

  it('a parked run answers its node, also on an engine that did not park it', async () => {
    const run = await engine.execute('two_pauses', {});
    expect(run.status).toBe('paused');

    const expected = { runId: run.runId, flowName: 'two_pauses', nodeId: 'p1' };
    expect(await engine.suspensionOf(run.runId!)).toMatchObject(expected);
    expect(await makeEngine(store).suspensionOf(run.runId!)).toMatchObject(expected);
  });

  it('the answer follows the run to its next pause, and is undefined once it completes', async () => {
    const run = await engine.execute('two_pauses', {});
    const other = makeEngine(store);

    expect((await engine.resume(run.runId!, {})).status).toBe('paused');
    expect((await other.suspensionOf(run.runId!))?.nodeId, 'another engine reads the store, not a memory').toBe('p2');

    expect((await other.resume(run.runId!, {})).success).toBe(true);
    expect(await engine.suspensionOf(run.runId!), 'nor a stale entry of its own').toBeUndefined();
  });

  it('an unknown id answers undefined', async () => {
    expect(await engine.suspensionOf('no-such-run')).toBeUndefined();
  });

  it('a store that cannot be read rejects: an outage is "unknown", never "not parked"', async () => {
    const run = await engine.execute('two_pauses', {});
    store.load = async () => { throw new Error('store down'); };

    await expect(engine.suspensionOf(run.runId!)).rejects.toThrow('store down');
  });
});
