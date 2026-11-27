// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0162 Execution item 7, "The root run"] The engine hands every run of a
 * tree, to any depth, its root run: the run's id, the flow it was started on,
 * the object of its record and when it started (`root-run.ts`).
 *
 * The pins, each read where a node executor reads it (`rootRunOf` on the
 * context the node receives):
 *  - a run with no parent is its own root, and a stale root on the caller's
 *    context does not survive into it; each retry attempt is its own root;
 *  - a `subflow` child two levels down and a `map` item read the run at the
 *    top, the item with the parent's object, never its own item's;
 *  - a run parked before root runs were stamped gets its root run when it is
 *    resumed, derived from its links to its parents, also on an engine that
 *    did not park it; a child that a resumed pre-change parent starts carries
 *    the derived root over;
 *  - a chain that cannot be read whole (a parent no longer parked) leaves the
 *    run with none, said once at `warn`, and the run goes on;
 *  - a parent the store cannot READ refuses the resume with
 *    `STORE_UNAVAILABLE` before it consumes anything, and a retry continues.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { AutomationEngine } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import { registerMapNode } from './builtin/map-node.js';
import { registerSubflowNode } from './builtin/subflow-node.js';
import { RECORD_RUN_CONTEXT_KEY, ROOT_RUN_CONTEXT_KEY, type RecordRun, type RootRun } from './root-run.js';

function recordingLogger(): any {
  const lines: Array<{ level: string; msg: string }> = [];
  const mk = (level: string) => (msg: string) => { lines.push({ level, msg }); };
  const self: any = { lines, info: mk('info'), warn: mk('warn'), error: mk('error'), debug: mk('debug'), child() { return self; } };
  return self;
}
function pluginCtx(logger: any): any {
  return { logger, getService() { throw new Error('none'); } };
}

const flow = (name: string, nodes: Array<{ id: string; type: string; config?: unknown }>, extra: Record<string, unknown> = {}) => ({
  name, label: name, type: 'autolaunched', ...extra,
  nodes: nodes.map(n => ({ label: n.id, ...n })),
  edges: nodes.slice(1).map((n, i) => ({ id: `${name}_e${i}`, source: nodes[i]!.id, target: n.id })),
});

/** start → see → pause → see_after → end: what a run reads before and after its pause. */
const LEAF = flow('leaf', [
  { id: 'ls', type: 'start' }, { id: 'see', type: 'see' }, { id: 'pause', type: 'open_pause' },
  { id: 'see_after', type: 'see' }, { id: 'le', type: 'end' },
]);
const MIDDLE = flow('middle', [
  { id: 'ms', type: 'start' }, { id: 'call_leaf', type: 'subflow', config: { flowName: 'leaf' } }, { id: 'me', type: 'end' },
]);
const OUTER = flow('outer', [
  { id: 'os', type: 'start' }, { id: 'call_middle', type: 'subflow', config: { flowName: 'middle' } }, { id: 'oe', type: 'end' },
]);
const TOP = flow('top', [
  { id: 'ts', type: 'start' }, { id: 'see', type: 'see' }, { id: 'pause', type: 'open_pause' },
  { id: 'see_after', type: 'see' }, { id: 'te', type: 'end' },
]);
/** Parks first, and only then starts its child: the child starts in the resumed segment. */
const LATE_PARENT = flow('late_parent', [
  { id: 'ps', type: 'start' }, { id: 'pause', type: 'open_pause' },
  { id: 'call_leaf', type: 'subflow', config: { flowName: 'leaf' } }, { id: 'pe', type: 'end' },
]);
const BATCH = flow('batch', [
  { id: 'bs', type: 'start' },
  { id: 'each', type: 'map', config: { collection: { dialect: 'cel', source: 'items' }, flowName: 'leaf', itemObject: 'crm_task' } },
  { id: 'be', type: 'end' },
], { variables: [{ name: 'items', type: 'list', isInput: true }] });
/** A `map` whose body is a `subflow` chain: each item run is `middle`, which calls `leaf`. */
const BATCH_WRAPPED = flow('batch_wrapped', [
  { id: 'ws', type: 'start' },
  { id: 'each', type: 'map', config: { collection: { dialect: 'cel', source: 'items' }, flowName: 'middle', itemObject: 'crm_task' } },
  { id: 'we', type: 'end' },
], { variables: [{ name: 'items', type: 'list', isInput: true }] });
/** Fails its first attempt, so `retry` runs a second one. */
const FLAKY = flow('flaky', [
  { id: 'fs', type: 'start' }, { id: 'flake', type: 'flake' }, { id: 'see', type: 'see' }, { id: 'fe', type: 'end' },
], { errorHandling: { strategy: 'retry', maxRetries: 1, backoffMs: 0 } });

interface Sight { runId: string; nodeId: string; root: RootRun | undefined }

describe('ADR-0162 item 7 — every run of a tree is handed its root run', () => {
  let store: InMemorySuspendedRunStore;
  let logger: ReturnType<typeof recordingLogger>;
  let seen: Sight[];
  let records: Array<{ runId: string; nodeId: string; record: RecordRun | undefined }>;
  let flakes: number;

  beforeEach(() => {
    store = new InMemorySuspendedRunStore();
    logger = recordingLogger();
    seen = [];
    records = [];
    flakes = 0;
  });

  function makeEngine(onStore = store): AutomationEngine {
    const engine: AutomationEngine = new AutomationEngine(logger, onStore);
    engine.registerNodeExecutor({
      type: 'open_pause',
      descriptor: defineActionDescriptor({
        type: 'open_pause', version: '1.0.0', name: 'Open Pause', supportsPause: true, resumeAuthority: 'any',
      }),
      async execute() { return { success: true, suspend: true }; },
    });
    engine.registerNodeExecutor({
      type: 'see',
      async execute(node: any, variables: Map<string, unknown>, context: any) {
        seen.push({ runId: String(variables.get('$runId')), nodeId: node.id, root: engine.rootRunOf(context) });
        records.push({ runId: String(variables.get('$runId')), nodeId: node.id, record: engine.recordRunOf(context) });
        return { success: true };
      },
    } as never);
    engine.registerNodeExecutor({
      type: 'flake',
      async execute() {
        flakes += 1;
        if (flakes === 1) throw new Error('first attempt fails');
        return { success: true };
      },
    } as never);
    registerMapNode(engine, pluginCtx(logger));
    registerSubflowNode(engine, pluginCtx(logger));
    for (const f of [LEAF, MIDDLE, OUTER, TOP, LATE_PARENT, BATCH, BATCH_WRAPPED, FLAKY]) engine.registerFlow(f.name, f as never);
    return engine;
  }

  const parkedOf = (engine: AutomationEngine, flowName: string) =>
    engine.listSuspendedRuns().filter(r => r.flowName === flowName);

  /** Make every parked run read as one parked before root runs were stamped. */
  async function forgetRootRuns(runIds: string[]): Promise<void> {
    for (const id of runIds) {
      const row = await store.load(id);
      expect(row, `run '${id}' is parked`).toBeTruthy();
      expect((row!.context as any)[ROOT_RUN_CONTEXT_KEY], 'parked with a root run, before it is forgotten').toBeDefined();
      expect((row!.context as any)[RECORD_RUN_CONTEXT_KEY], 'and with a record run').toBeDefined();
      delete (row!.context as any)[ROOT_RUN_CONTEXT_KEY];
      delete (row!.context as any)[RECORD_RUN_CONTEXT_KEY];
      await store.save(row!);
    }
  }

  it('a run with no parent is its own root: id, flow, object and start, also past its pause', async () => {
    const engine = makeEngine();
    const started = await engine.execute('top', { object: 'crm_deal', record: { id: 'd1' } } as never);
    const parked = await store.load(started.runId!);
    const own: RootRun = { runId: started.runId!, flowName: 'top', object: 'crm_deal', startedAt: parked!.startedAt };

    expect(seen).toEqual([{ runId: started.runId, nodeId: 'see', root: own }]);
    expect((parked!.context as any)[ROOT_RUN_CONTEXT_KEY], 'the stamp rides the suspension').toEqual(own);

    await engine.resume(started.runId!, {});
    expect(seen[1]).toEqual({ runId: started.runId, nodeId: 'see_after', root: own });
  });

  it('a stale root on the caller\'s context does not survive into a run with no parent', async () => {
    const engine = makeEngine();
    const stale: RootRun = { runId: 'someone-elses-run', flowName: 'other', object: 'crm_lead', startedAt: '2020-01-01T00:00:00.000Z' };
    const started = await engine.execute('top', { object: 'crm_deal', record: { id: 'd1' }, [ROOT_RUN_CONTEXT_KEY]: stale } as never);

    expect(seen[0]!.root?.runId).toBe(started.runId);
    expect(seen[0]!.root?.flowName).toBe('top');
  });

  it('a record-less root run records a null object', async () => {
    const engine = makeEngine();
    const started = await engine.execute('top', {} as never);
    expect(seen[0]!.root).toMatchObject({ runId: started.runId, flowName: 'top', object: null });
  });

  it('each retry attempt is a run of its own, and its own root', async () => {
    const engine = makeEngine();
    const result = await engine.execute('flaky', { object: 'crm_deal', record: { id: 'd1' } } as never);

    expect(result.success).toBe(true);
    expect(flakes, 'the second attempt ran').toBe(2);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.root).toMatchObject({ runId: seen[0]!.runId, flowName: 'flaky', object: 'crm_deal' });
  });

  it('a subflow child two levels down reads the run at the top of its tree', async () => {
    const engine = makeEngine();
    const outer = await engine.execute('outer', { object: 'crm_deal', record: { id: 'd1' } } as never);
    const [leaf] = parkedOf(engine, 'leaf');
    const [middle] = parkedOf(engine, 'middle');
    const outerRow = await store.load(outer.runId!);
    const top: RootRun = { runId: outer.runId!, flowName: 'outer', object: 'crm_deal', startedAt: outerRow!.startedAt };

    expect(leaf!.runId).not.toBe(outer.runId);
    expect(((await store.load(leaf!.runId))!.context as any).$parentRunId, 'the child knows only its immediate parent').toBe(middle!.runId);
    expect(seen).toEqual([{ runId: leaf!.runId, nodeId: 'see', root: top }]);

    await engine.resume(leaf!.runId, {});
    expect(seen[1]).toEqual({ runId: leaf!.runId, nodeId: 'see_after', root: top });
  });

  it('two map items side by side read the parent, with the parent\'s object, never their own item\'s', async () => {
    const engine = makeEngine();
    const batch = await engine.execute('batch', {
      object: 'crm_project', record: { id: 'p1' }, params: { items: [{ id: 't1' }, { id: 't2' }] },
    } as never);
    const [first] = parkedOf(engine, 'leaf');
    expect(((await store.load(first!.runId))!.context as any).object, 'the item run names its own item').toBe('crm_task');

    await engine.resume(first!.runId, {});
    const [second] = parkedOf(engine, 'leaf');
    expect(second!.runId).not.toBe(first!.runId);

    const roots = seen.map(s => s.root);
    expect(seen.map(s => s.runId)).toEqual([first!.runId, first!.runId, second!.runId]);
    for (const root of roots) {
      expect(root).toMatchObject({ runId: batch.runId, flowName: 'batch', object: 'crm_project' });
    }
  });

  it('a child parked before root runs were stamped gets its root run when it is resumed, on an engine that did not park it', async () => {
    const parker = makeEngine();
    const outer = await parker.execute('outer', { object: 'crm_deal', record: { id: 'd1' } } as never);
    const [leaf] = parkedOf(parker, 'leaf');
    const [middle] = parkedOf(parker, 'middle');
    await forgetRootRuns([outer.runId!, middle!.runId, leaf!.runId]);
    const outerRow = await store.load(outer.runId!);

    const resumer = makeEngine();
    seen = [];
    await resumer.resume(leaf!.runId, {});

    expect(seen).toEqual([{
      runId: leaf!.runId, nodeId: 'see_after',
      root: { runId: outer.runId, flowName: 'outer', object: 'crm_deal', startedAt: outerRow!.startedAt },
    }]);
    expect(logger.lines.filter((l: any) => l.level === 'warn' && l.msg.includes('root run'))).toEqual([]);
  });

  it('a root run parked before the stamp derives itself', async () => {
    const parker = makeEngine();
    const started = await parker.execute('top', { object: 'crm_deal', record: { id: 'd1' } } as never);
    await forgetRootRuns([started.runId!]);
    const row = await store.load(started.runId!);

    seen = [];
    await makeEngine().resume(started.runId!, {});
    expect(seen).toEqual([{
      runId: started.runId, nodeId: 'see_after',
      root: { runId: started.runId, flowName: 'top', object: 'crm_deal', startedAt: row!.startedAt },
    }]);
  });

  it('a child a resumed pre-change parent starts carries the derived root over', async () => {
    const parker = makeEngine();
    const parent = await parker.execute('late_parent', { object: 'crm_deal', record: { id: 'd1' } } as never);
    await forgetRootRuns([parent.runId!]);

    const resumer = makeEngine();
    await resumer.resume(parent.runId!, {});
    const [leaf] = parkedOf(resumer, 'leaf');

    expect(seen).toEqual([{
      runId: leaf!.runId, nodeId: 'see', root: expect.objectContaining({ runId: parent.runId, flowName: 'late_parent', object: 'crm_deal' }),
    }]);
    expect((await store.load(leaf!.runId))!.context, 'and parks with it').toMatchObject({
      [ROOT_RUN_CONTEXT_KEY]: { runId: parent.runId },
    });
  });

  it('a chain that cannot be read whole leaves the run with no root run, said once at warn, and the run goes on', async () => {
    const parker = makeEngine();
    const outer = await parker.execute('outer', { object: 'crm_deal', record: { id: 'd1' } } as never);
    const [leaf] = parkedOf(parker, 'leaf');
    const [middle] = parkedOf(parker, 'middle');
    await forgetRootRuns([outer.runId!, middle!.runId, leaf!.runId]);
    await store.delete(middle!.runId);

    seen = []; records = [];
    const resumed = await makeEngine().resume(leaf!.runId, {});

    expect(resumed.success, 'the leaf itself continues').toBe(true);
    expect(seen).toEqual([{ runId: leaf!.runId, nodeId: 'see_after', root: undefined }]);
    expect(records.map(r => r.record), 'nor a record run').toEqual([undefined]);
    expect((await store.load(leaf!.runId)), 'the leaf completed').toBeNull();
    const warns = logger.lines.filter((l: any) => l.level === 'warn' && l.msg.includes('could not be derived'));
    expect(warns).toHaveLength(1);
    expect(warns[0].msg).toContain(middle!.runId);
  });

  it('a parent the store cannot read refuses the resume before it consumes anything, and a retry continues', async () => {
    const parker = makeEngine();
    const outer = await parker.execute('outer', { object: 'crm_deal', record: { id: 'd1' } } as never);
    const [leaf] = parkedOf(parker, 'leaf');
    const [middle] = parkedOf(parker, 'middle');
    await forgetRootRuns([outer.runId!, middle!.runId, leaf!.runId]);

    let down = true;
    const realLoad = store.load.bind(store);
    store.load = async (id: string) => {
      if (down && id === middle!.runId) throw new Error('connection refused');
      return realLoad(id);
    };

    seen = [];
    const resumer = makeEngine();
    const refused = await resumer.resume(leaf!.runId, {});
    expect(refused).toMatchObject({ success: false, code: 'STORE_UNAVAILABLE' });
    expect(seen, 'nothing past the pause ran').toEqual([]);
    expect(await realLoad(leaf!.runId), 'the suspension was not consumed').toBeTruthy();
    expect(logger.lines.filter((l: any) => l.level === 'error' && l.msg.includes('derive its root run'))).toHaveLength(1);

    down = false;
    const retried = await resumer.resume(leaf!.runId, {});
    expect(retried.success).toBe(true);
    expect(seen).toEqual([{ runId: leaf!.runId, nodeId: 'see_after', root: expect.objectContaining({ runId: outer.runId }) }]);
  });

  describe('the record run: the highest run, from this one up, over which the record does not change', () => {
    const recordOfLast = (runId: string) => [...records].reverse().find(r => r.runId === runId)?.record;

    it('a root run is its own record run', async () => {
      const engine = makeEngine();
      const started = await engine.execute('top', { object: 'crm_deal', record: { id: 'd1' } } as never);
      expect(recordOfLast(started.runId!)).toEqual({ runId: started.runId, object: 'crm_deal', recordId: 'd1' });
    });

    it('a subflow child two levels down inherits the record, so the root carries it', async () => {
      const engine = makeEngine();
      const outer = await engine.execute('outer', { object: 'crm_deal', record: { id: 'd1' } } as never);
      const [leaf] = parkedOf(engine, 'leaf');
      expect(recordOfLast(leaf!.runId)).toEqual({ runId: outer.runId, object: 'crm_deal', recordId: 'd1' });
    });

    it('a map item that is a record is its own record run, under the parent\'s root', async () => {
      const engine = makeEngine();
      const batch = await engine.execute('batch', {
        object: 'crm_project', record: { id: 'p1' }, params: { items: [{ id: 't1' }] },
      } as never);
      const [item] = parkedOf(engine, 'leaf');
      expect(recordOfLast(item!.runId)).toEqual({ runId: item!.runId, object: 'crm_task', recordId: 't1' });
      expect(seen[seen.length - 1]!.root).toMatchObject({ runId: batch.runId, object: 'crm_project' });
      expect((await store.load(item!.runId))!.context, 'and parks with it').toMatchObject({
        [RECORD_RUN_CONTEXT_KEY]: { runId: item!.runId, recordId: 't1' },
      });
    });

    it('a map item that is not a record carries the parent\'s record, so the parent\'s record run', async () => {
      const engine = makeEngine();
      const batch = await engine.execute('batch', {
        object: 'crm_project', record: { id: 'p1' }, params: { items: [{ name: 'not a record' }] },
      } as never);
      const [item] = parkedOf(engine, 'leaf');
      expect(item!.runId).not.toBe(batch.runId);
      expect(recordOfLast(item!.runId)).toEqual({ runId: batch.runId, object: 'crm_project', recordId: 'p1' });
    });

    it('a subflow under a map item that is a record inherits the item run', async () => {
      const engine = makeEngine();
      await engine.execute('batch_wrapped', { params: { items: [{ id: 't1' }] } } as never);
      const [item] = parkedOf(engine, 'middle');
      const [leaf] = parkedOf(engine, 'leaf');
      expect(recordOfLast(leaf!.runId)).toEqual({ runId: item!.runId, object: 'crm_task', recordId: 't1' });
    });

    it('a pre-change map item is derived its own record run, in the same walk as its root run', async () => {
      const parker = makeEngine();
      const batch = await parker.execute('batch', {
        object: 'crm_project', record: { id: 'p1' }, params: { items: [{ id: 't1' }] },
      } as never);
      const [item] = parkedOf(parker, 'leaf');
      await forgetRootRuns([batch.runId!, item!.runId]);

      records = []; seen = [];
      await makeEngine().resume(item!.runId, {});
      expect(records).toEqual([{ runId: item!.runId, nodeId: 'see_after', record: { runId: item!.runId, object: 'crm_task', recordId: 't1' } }]);
      expect(seen[0]!.root).toMatchObject({ runId: batch.runId, flowName: 'batch', object: 'crm_project' });
    });

    it('a pre-change subflow under a map item is derived the item run, the root above it', async () => {
      const parker = makeEngine();
      const batch = await parker.execute('batch_wrapped', { params: { items: [{ id: 't1' }] } } as never);
      const [item] = parkedOf(parker, 'middle');
      const [leaf] = parkedOf(parker, 'leaf');
      await forgetRootRuns([batch.runId!, item!.runId, leaf!.runId]);

      records = []; seen = [];
      await makeEngine().resume(leaf!.runId, {});
      expect(records).toEqual([{ runId: leaf!.runId, nodeId: 'see_after', record: { runId: item!.runId, object: 'crm_task', recordId: 't1' } }]);
      expect(seen[0]!.root).toMatchObject({ runId: batch.runId, flowName: 'batch_wrapped', object: null });
    });

    it('a pre-change subflow child is derived the root as its record run', async () => {
      const parker = makeEngine();
      const outer = await parker.execute('outer', { object: 'crm_deal', record: { id: 'd1' } } as never);
      const [leaf] = parkedOf(parker, 'leaf');
      const [middle] = parkedOf(parker, 'middle');
      await forgetRootRuns([outer.runId!, middle!.runId, leaf!.runId]);

      records = [];
      await makeEngine().resume(leaf!.runId, {});
      expect(records).toEqual([{ runId: leaf!.runId, nodeId: 'see_after', record: { runId: outer.runId, object: 'crm_deal', recordId: 'd1' } }]);
    });

    it('a child started under a run that carries no root run is stamped null on both, and never walked', async () => {
      const engine = makeEngine();
      const started = await engine.execute('leaf', { object: 'crm_deal', record: { id: 'd1' }, $parentRunId: 'run_gone' } as never);
      const row = await store.load(started.runId!);
      expect([(row!.context as any)[ROOT_RUN_CONTEXT_KEY], (row!.context as any)[RECORD_RUN_CONTEXT_KEY]]).toEqual([null, null]);
      expect(seen[0]).toEqual({ runId: started.runId, nodeId: 'see', root: undefined });

      // Were the resume to walk the chain, this parent's unreadable row would
      // refuse it with STORE_UNAVAILABLE before the claim.
      const realLoad = store.load.bind(store);
      store.load = async (id: string) => {
        if (id === 'run_gone') throw new Error('connection refused');
        return realLoad(id);
      };
      const resumed = await engine.resume(started.runId!, {});
      expect(resumed.code).not.toBe('STORE_UNAVAILABLE');
      expect(seen[seen.length - 1], 'the segment after the pause ran').toEqual({ runId: started.runId, nodeId: 'see_after', root: undefined });
      expect(logger.lines.filter((l: any) => l.msg.includes('could not be derived') || l.msg.includes('derive its root run'))).toEqual([]);
    });
  });
});
