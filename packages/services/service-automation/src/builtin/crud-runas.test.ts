// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #1888 — the automation engine MUST switch the execution identity of a flow's
 * data nodes based on `flow.runAs`, and pass it to ObjectQL as `options.context`:
 *   • runAs:'system' → an elevated, RLS-bypassing system principal ({ isSystem: true }),
 *   • runAs:'user'   → the triggering user ({ userId, roles, … }) so RLS applies.
 *
 * Before the fix the CRUD nodes passed NO context at all (the security middleware
 * was skipped), so runAs was inert in both directions. These tests capture the
 * exact `context` each data op receives, proving the switch — and the regression
 * test fails loudly if the threading is ever removed (so it can't go dead again).
 */
import { describe, it, expect } from 'vitest';
import { AutomationEngine } from '../engine.js';
import { registerCrudNodes } from './crud-nodes.js';
import {
  resolveRunDataContext,
  runIsUnscopedUserMode,
  flowTouchesData,
  UnscopedRunDataAccessError,
} from '../runtime-identity.js';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';

function makeLogger(): any {
  const l: any = { info() {}, warn() {}, error() {}, debug() {} };
  l.child = () => l;
  return l;
}

/** A data engine that records the `context` every op was called with. */
function fakeData() {
  const calls: Array<{ op: string; obj: string; ctx: any }> = [];
  const data: any = {
    async find(obj: string, q: any) { calls.push({ op: 'find', obj, ctx: q?.context }); return [{ id: 'r1' }]; },
    async findOne(obj: string, q: any) {
                                         assertEngineFindOnePredicate(obj, q); calls.push({ op: 'findOne', obj, ctx: q?.context }); return { id: 'r1' }; },
    async insert(obj: string, _f: any, opts: any) { calls.push({ op: 'insert', obj, ctx: opts?.context }); return { id: `${obj}_1` }; },
    async update(obj: string, _f: any, opts: any) { calls.push({ op: 'update', obj, ctx: opts?.context }); return { ok: true }; },
    async delete(obj: string, opts: any) { calls.push({ op: 'delete', obj, ctx: opts?.context }); return { ok: true }; },
  };
  return { data, calls };
}

const ctxWith = (data: any): any => ({
  logger: makeLogger(),
  getService: (n: string) => (n === 'data' ? data : undefined),
});

/** A flow exercising all five data ops, parameterized by runAs. */
function allOpsFlow(name: string, runAs?: 'system' | 'user') {
  return {
    name,
    label: name,
    type: 'autolaunched',
    ...(runAs ? { runAs } : {}),
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'thing', fields: { a: 1 } } },
      { id: 'up', type: 'update_record', label: 'Update', config: { objectName: 'thing', filter: { id: 'x' }, fields: { a: 2 } } },
      { id: 'g1', type: 'get_record', label: 'GetOne', config: { objectName: 'thing', filter: { id: 'x' } } },
      { id: 'gN', type: 'get_record', label: 'GetMany', config: { objectName: 'thing', filter: {}, limit: 5 } },
      { id: 'del', type: 'delete_record', label: 'Delete', config: { objectName: 'thing', filter: { id: 'x' } } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'mk' },
      { id: 'e2', source: 'mk', target: 'up' },
      { id: 'e3', source: 'up', target: 'g1' },
      { id: 'e4', source: 'g1', target: 'gN' },
      { id: 'e5', source: 'gN', target: 'del' },
      { id: 'e6', source: 'del', target: 'end' },
    ],
  } as any;
}

describe('flow.runAs identity enforcement at the data layer (#1888)', () => {
  it("runAs:'system' runs every data op as an elevated (isSystem) principal", async () => {
    const engine = new AutomationEngine(makeLogger());
    const { data, calls } = fakeData();
    registerCrudNodes(engine, ctxWith(data));
    engine.registerFlow('sys', allOpsFlow('sys', 'system'));

    // Triggered by a normal user — `runAs:'system'` must still elevate.
    const res = await engine.execute('sys', { userId: 'u1', tenantId: 'org1' });
    expect(res.success).toBe(true);

    expect(calls.map((c) => c.op).sort()).toEqual(['delete', 'find', 'findOne', 'insert', 'update']);
    for (const c of calls) {
      expect(c.ctx, `${c.op} got no context`).toBeTruthy();
      expect(c.ctx.isSystem, `${c.op} not elevated`).toBe(true);
      // #5494 — elevation is not anonymity: the triggering user and org are
      // CARRIED THROUGH (attribution: created_by/updated_by stamps, audit
      // actor, downstream record-change identity; the org drives the driver's
      // organization_id fill on born rows), while `isSystem` alone decides
      // authorization. Dropping them here is what inserted rows with all
      // three platform columns NULL — untouchable even by the triggering
      // member, and outside the org partition.
      expect(c.ctx.userId, `${c.op} lost the acting user (#5494)`).toBe('u1');
      expect(c.ctx.tenantId, `${c.op} lost the trigger org (#5494)`).toBe('org1');
      // …and it stays attributed to the flow as well, so audit rows name
      // WHICH automation wrote them (ADR-0014 D2, #4366; ADR-0118 D5).
      expect(c.ctx.actor, `${c.op} lost the service-principal label`).toBe('svc:flow:sys');
    }
  });

  it("runAs:'user' runs every data op as the triggering user (RLS-respecting)", async () => {
    const engine = new AutomationEngine(makeLogger());
    const { data, calls } = fakeData();
    registerCrudNodes(engine, ctxWith(data));
    engine.registerFlow('usr', allOpsFlow('usr', 'user'));

    const res = await engine.execute('usr', { userId: 'u1', positions: ['sales'], tenantId: 'org1' });
    expect(res.success).toBe(true);

    for (const c of calls) {
      expect(c.ctx, `${c.op} got no context`).toBeTruthy();
      expect(c.ctx.isSystem, `${c.op} wrongly elevated`).toBe(false);
      expect(c.ctx.userId, `${c.op} lost the user identity`).toBe('u1');
      expect(c.ctx.positions).toEqual(['sales']);
      expect(c.ctx.tenantId).toBe('org1');
    }
  });

  it('defaults to user identity when runAs is omitted', async () => {
    const engine = new AutomationEngine(makeLogger());
    const { data, calls } = fakeData();
    registerCrudNodes(engine, ctxWith(data));
    engine.registerFlow('def', allOpsFlow('def')); // no runAs → default 'user'

    await engine.execute('def', { userId: 'u2' });
    for (const c of calls) {
      expect(c.ctx.userId).toBe('u2');
      expect(c.ctx.isSystem).toBe(false);
    }
  });

  it('restores the caller context: execute() never mutates the passed AutomationContext', async () => {
    const engine = new AutomationEngine(makeLogger());
    const { data } = fakeData();
    registerCrudNodes(engine, ctxWith(data));
    engine.registerFlow('sys2', allOpsFlow('sys2', 'system'));

    const trigger: AutomationContext = { userId: 'u1' };
    await engine.execute('sys2', trigger);

    // The run elevated internally, but the caller's object is untouched — the
    // elevation is scoped to the run (no `runAs` leaked onto the trigger, userId intact).
    expect(Object.prototype.hasOwnProperty.call(trigger, 'runAs')).toBe(false);
    expect(trigger.userId).toBe('u1');
  });

  it('does not leak elevation across runs (a system run then a user run)', async () => {
    const engine = new AutomationEngine(makeLogger());
    const { data, calls } = fakeData();
    registerCrudNodes(engine, ctxWith(data));
    engine.registerFlow('sys3', allOpsFlow('sys3', 'system'));
    engine.registerFlow('usr3', allOpsFlow('usr3', 'user'));

    await engine.execute('sys3', { userId: 'u1' });
    const afterSystem = calls.length;
    await engine.execute('usr3', { userId: 'u3' });

    for (const c of calls.slice(0, afterSystem)) expect(c.ctx.isSystem).toBe(true);
    for (const c of calls.slice(afterSystem)) {
      expect(c.ctx.isSystem).toBe(false);
      expect(c.ctx.userId).toBe('u3');
    }
  });

  it("REGRESSION: a runAs:'system' flow must reach the data layer elevated (fails if runAs is ignored)", async () => {
    const engine = new AutomationEngine(makeLogger());
    const { data, calls } = fakeData();
    registerCrudNodes(engine, ctxWith(data));
    engine.registerFlow('reg', {
      name: 'reg', label: 'reg', type: 'autolaunched', runAs: 'system',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'thing', fields: { a: 1 } } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'mk' }, { id: 'e2', source: 'mk', target: 'end' }],
    } as any);

    // Trigger as a restricted user. If the engine ignored runAs, the insert
    // would run under that user's AUTHORIZATION (isSystem false) instead of the
    // elevated principal. Since #5494 the user still rides the context — as
    // attribution, which grants nothing under the isSystem short-circuit — so
    // the regression tell is the `isSystem` flag, never the userId's absence.
    await engine.execute('reg', { userId: 'restricted' });
    const insert = calls.find((c) => c.op === 'insert');
    expect(insert?.ctx?.isSystem, 'runAs:system did not elevate the data op (#1888 regressed)').toBe(true);
    expect(insert?.ctx?.userId, 'the acting user must ride the elevated context (#5494)').toBe('restricted');
  });
});

describe('resolveRunDataContext (#1888 unit)', () => {
  it("maps runAs:'system' to an elevated context attributed to the flow AND the acting user (#4366, #5494)", () => {
    expect(resolveRunDataContext({ runAs: 'system', userId: 'u1', flowName: 'mirror_status' })).toEqual({
      isSystem: true, actor: 'svc:flow:mirror_status', userId: 'u1', positions: [], permissions: [],
    });
  });

  it("labels a system run without a flow name as the generic automation principal (#4366)", () => {
    expect(resolveRunDataContext({ runAs: 'system' })).toEqual({
      isSystem: true, actor: 'svc:flow:automation', positions: [], permissions: [],
    });
  });

  it("maps runAs:'user' to the triggering user's identity", () => {
    expect(resolveRunDataContext({ runAs: 'user', userId: 'u1', positions: ['r'], tenantId: 't' })).toEqual({
      isSystem: false, userId: 'u1', positions: ['r'], permissions: [], tenantId: 't',
    });
  });

  // #3760 — a user-mode run with NO user is REFUSED, not resolved. Previously
  // this returned `undefined` (or, after #3712, a provenance-only envelope) and
  // let the op proceed with no principal — which the data security middleware
  // waves straight through, running it UNSCOPED. That was the #1888 fail-open.
  it('THROWS for a user-mode run with no user (with or without a run id)', () => {
    for (const ctx of [{ runAs: 'user' as const }, { runAs: 'user' as const, flowRunId: 'run_1' }, undefined]) {
      expect(() => resolveRunDataContext(ctx)).toThrow(UnscopedRunDataAccessError);
    }
  });

  it('the refusal names the fix, so the author can act on it without reading the source', () => {
    let err: Error | undefined;
    try {
      resolveRunDataContext({ runAs: 'user', object: 'invoice', event: 'record-after-update', flowRunId: 'run_1' });
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeInstanceOf(UnscopedRunDataAccessError);
    expect((err as UnscopedRunDataAccessError & { code: string }).code).toBe('AUTOMATION_UNSCOPED_RUN_DATA_ACCESS');
    expect(err!.message).toMatch(/runAs: 'system'/);
    expect(err!.message).toMatch(/UNSCOPED/);
    // Names WHERE, so a refusal in a busy log is traceable to a flow + record.
    expect(err!.message).toContain("object 'invoice'");
    expect(err!.message).toContain("run 'run_1'");
  });

  // The refusal is deliberately NOT an elevation to isSystem. The security
  // middleware's isSystem short-circuit fires BEFORE its package-managed-row,
  // system-row, audience-anchor and delegated-admin gates, so re-badging these
  // runs as system would GRANT them powers a principal-less run never had.
  it("refuses rather than elevating — runAs:'system' stays the only route to isSystem", () => {
    expect(() => resolveRunDataContext({ runAs: 'user', flowRunId: 'r' })).toThrow();
    expect(resolveRunDataContext({ runAs: 'system', flowRunId: 'r' })).toEqual({
      isSystem: true, actor: 'svc:flow:automation', positions: [], permissions: [], flowRunId: 'r',
    });
  });
});

/**
 * #1888 FOLLOW-UP, CLOSED BY #3760 — the user-less fail-open. A run with no
 * trigger user and an effective `runAs:'user'` (the default) resolves no
 * identity → CRUD nodes present no principal → the data security middleware
 * skips → the run used to execute UNSCOPED (effectively elevated).
 *
 * #2308 made that AUDIBLE (a warning) but left it working, on the grounds that
 * denying would break legitimate scheduled CRUD. That rationale expired: the
 * example flows it protected now declare `runAs:'system'`, and #3760 showed the
 * dominant shape is not a schedule at all but a record-change flow fired by a
 * system write — reachable by ordinary users and not decidable at authoring
 * time. So the run is now REFUSED. These tests pin the refusal, the warning that
 * precedes it, and the fact that refusing is NOT elevating.
 */

/**
 * The op must never have reached the data engine at all. A refused run produces
 * NO calls — asserting on a captured context would be vacuously true once the
 * throw lands, so the meaningful assertion is that nothing was dispatched.
 */
function expectNoDataOps(calls: Array<{ op: string }>, why: string): void {
  expect(calls.map((c) => c.op), why).toEqual([]);
}

function recordingLogger(): { logger: any; warns: string[] } {
  const warns: string[] = [];
  const l: any = { info() {}, warn: (m: string) => warns.push(m), error() {}, debug() {} };
  l.child = () => l;
  return { logger: l, warns };
}
const runAsWarns = (warns: string[]) => warns.filter((w) => w.includes('[runAs]'));

describe('user-less runs are refused, not run unscoped (#1888 / #3760)', () => {
  it('REFUSES every data op when a user-mode run has no trigger user, and warns once first', async () => {
    const { logger, warns } = recordingLogger();
    const engine = new AutomationEngine(logger);
    const { data, calls } = fakeData();
    registerCrudNodes(engine, ctxWith(data));
    engine.registerFlow('sched', allOpsFlow('sched')); // no runAs → default 'user'

    // Simulate a user-less trigger's context: an event, but NO userId.
    const res = await engine.execute('sched', { event: 'schedule', params: { jobId: 'j1' } });

    // The whole point: NOTHING reached the data engine. Before #3760 every op
    // here ran, each one unscoped.
    expectNoDataOps(calls, 'a user-less run must not reach the data engine at all');
    expect(res.success, 'the run must fail rather than silently do nothing').toBe(false);

    // ...and it was diagnosable BEFORE the failure: exactly one runAs warning at
    // run setup, naming the flow + the fix.
    const w = runAsWarns(warns);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("flow 'sched'");
    expect(w[0]).toMatch(/REFUSED/);
    expect(w[0]).toMatch(/runAs:'system'/);
  });

  // The regression that motivated #3760: this is NOT a schedule. It is the
  // ordinary record-change shape, fired by a write that carried no user (any
  // isSystem plugin/service write — `isSystem` does not suppress dispatch).
  // Nothing flags it at authoring time, so the runtime refusal is the only net.
  it('refuses a RECORD-CHANGE run fired by a user-less write, exactly like a schedule', async () => {
    const { logger, warns } = recordingLogger();
    const engine = new AutomationEngine(logger);
    const { data, calls } = fakeData();
    registerCrudNodes(engine, ctxWith(data));
    engine.registerFlow('on_change', allOpsFlow('on_change')); // default runAs:'user'

    const res = await engine.execute('on_change', {
      event: 'record-after-update',
      object: 'invoice',
      record: { id: 'inv_1' },
      // no userId — the triggering write was a system write
    });

    expectNoDataOps(calls, 'a record-change run with no trigger user must be refused too');
    expect(res.success).toBe(false);
    expect(runAsWarns(warns)).toHaveLength(1);
  });

  it("does NOT warn when a user-less run declares runAs:'system' (explicit elevation)", async () => {
    const { logger, warns } = recordingLogger();
    const engine = new AutomationEngine(logger);
    const { data, calls } = fakeData();
    registerCrudNodes(engine, ctxWith(data));
    engine.registerFlow('sys', allOpsFlow('sys', 'system'));

    await engine.execute('sys', { event: 'schedule', params: {} });
    expect(runAsWarns(warns)).toHaveLength(0);
    // Elevation is REAL + explicit (isSystem), not the accidental no-context skip.
    for (const c of calls) expect(c.ctx?.isSystem).toBe(true);
  });

  it('does NOT warn when a user IS present (a normal REST/record trigger), even in user mode', async () => {
    const { logger, warns } = recordingLogger();
    const engine = new AutomationEngine(logger);
    const { data } = fakeData();
    registerCrudNodes(engine, ctxWith(data));
    engine.registerFlow('usr', allOpsFlow('usr', 'user'));
    await engine.execute('usr', { userId: 'u1' });
    expect(runAsWarns(warns)).toHaveLength(0);
  });

  it('does NOT warn for a user-less run when the flow touches NO data (runAs is moot)', async () => {
    const { logger, warns } = recordingLogger();
    const engine = new AutomationEngine(logger);
    const { data } = fakeData();
    registerCrudNodes(engine, ctxWith(data));
    engine.registerFlow('noop', {
      name: 'noop', label: 'noop', type: 'schedule',
      nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'end', type: 'end', label: 'End' }],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
    } as any);
    await engine.execute('noop', { event: 'schedule' });
    expect(runAsWarns(warns)).toHaveLength(0);
  });
});

describe('runtime-identity unscoped-run predicates (#1888 follow-up unit)', () => {
  it('runIsUnscopedUserMode: true ONLY for a non-system run with no user', () => {
    expect(runIsUnscopedUserMode({ runAs: 'user' })).toBe(true);   // explicit user, no userId
    expect(runIsUnscopedUserMode({})).toBe(true);                  // unset runAs, no userId
    expect(runIsUnscopedUserMode(undefined)).toBe(true);
    expect(runIsUnscopedUserMode({ runAs: 'user', userId: 'u1' })).toBe(false); // has a user
    expect(runIsUnscopedUserMode({ runAs: 'system' })).toBe(false);            // elevated
    expect(runIsUnscopedUserMode({ runAs: 'system', userId: 'u1' })).toBe(false);
  });

  it('flowTouchesData: true iff the flow contains a data-op node', () => {
    expect(flowTouchesData({ nodes: [{ type: 'start' }, { type: 'create_record' }] })).toBe(true);
    expect(flowTouchesData({ nodes: [{ type: 'get_record' }] })).toBe(true);
    expect(flowTouchesData({ nodes: [{ type: 'start' }, { type: 'notify' }, { type: 'script' }] })).toBe(false);
    expect(flowTouchesData({ nodes: [] })).toBe(false);
    expect(flowTouchesData(undefined)).toBe(false);
  });
});

/**
 * #3356 (follow-up to #1888) — a `runAs:'user'` run's data ops must enforce the
 * TRIGGERING user's real authorization. The record-change hook session carries
 * only a `userId` (never the writer's positions/permission sets), so the engine
 * resolves the user's full grants at run setup via an injected resolver
 * (bridged to `@objectstack/core`'s `resolveUserAuthzGrants` by the plugin).
 * These tests pin the resolve-at-setup behavior and its guardrails.
 */
describe("runAs:'user' resolves the triggering user's grants at run setup (#3356)", () => {
  it('resolves positions + permission sets and threads them to EVERY data op', async () => {
    const engine = new AutomationEngine(makeLogger());
    const { data, calls } = fakeData();
    registerCrudNodes(engine, ctxWith(data));
    engine.registerFlow('usr', allOpsFlow('usr', 'user'));

    const seen: Array<{ userId: string; tenantId?: string }> = [];
    engine.setUserGrantsResolver((userId, tenantId) => {
      seen.push({ userId, tenantId });
      return { positions: ['approver', 'everyone'], permissions: ['ehr_all'], tenantId: 'org1' };
    });

    // The record-change hook shape: ONLY a userId (no positions/permissions).
    const res = await engine.execute('usr', { userId: 'u1' });
    expect(res.success).toBe(true);

    // Resolver invoked exactly once per run, for the triggering user.
    expect(seen).toEqual([{ userId: 'u1', tenantId: undefined }]);

    for (const c of calls) {
      expect(c.ctx.isSystem, `${c.op} wrongly elevated`).toBe(false);
      expect(c.ctx.userId).toBe('u1');
      expect(c.ctx.positions).toEqual(['approver', 'everyone']);
      expect(c.ctx.permissions, `${c.op} lost the resolved permission sets`).toEqual(['ehr_all']);
      expect(c.ctx.tenantId).toBe('org1');
    }
  });

  it('does NOT re-resolve when the trigger already carried permissions (agent/REST envelope preserved)', async () => {
    const engine = new AutomationEngine(makeLogger());
    const { data, calls } = fakeData();
    registerCrudNodes(engine, ctxWith(data));
    engine.registerFlow('usr', allOpsFlow('usr', 'user'));

    let called = 0;
    engine.setUserGrantsResolver(() => {
      called++;
      return { positions: ['SHOULD_NOT_APPLY'], permissions: ['SHOULD_NOT_APPLY'] };
    });

    // An already-resolved envelope — e.g. an ADR-0090 agent ceiling acting
    // on-behalf-of a user (always non-empty). Must be honored verbatim, NOT
    // re-broadened to the human's full grants.
    await engine.execute('usr', { userId: 'u1', positions: ['agent'], permissions: ['mcp_agent_read'], tenantId: 't1' });
    expect(called).toBe(0);
    for (const c of calls) {
      expect(c.ctx.permissions).toEqual(['mcp_agent_read']);
      expect(c.ctx.positions).toEqual(['agent']);
    }
  });

  it("does NOT resolve for runAs:'system' (explicit elevation wins)", async () => {
    const engine = new AutomationEngine(makeLogger());
    const { data, calls } = fakeData();
    registerCrudNodes(engine, ctxWith(data));
    engine.registerFlow('sys', allOpsFlow('sys', 'system'));
    let called = 0;
    engine.setUserGrantsResolver(() => { called++; return { positions: [], permissions: [] }; });
    await engine.execute('sys', { userId: 'u1' });
    expect(called).toBe(0);
    for (const c of calls) expect(c.ctx.isSystem).toBe(true);
  });

  it('does NOT resolve when there is no trigger user — the run is refused instead (#3760)', async () => {
    const engine = new AutomationEngine(makeLogger());
    const { data, calls } = fakeData();
    registerCrudNodes(engine, ctxWith(data));
    engine.registerFlow('sched', allOpsFlow('sched')); // default user, no userId
    let called = 0;
    engine.setUserGrantsResolver(() => { called++; return { positions: [], permissions: [] }; });
    const res = await engine.execute('sched', { event: 'schedule' });
    // There is no user to resolve grants FOR, so the resolver is never consulted…
    expect(called).toBe(0);
    // …and the run does not fall through to an unscoped op. (Asserting over
    // `calls` alone would pass vacuously now that the list is empty, so pin the
    // emptiness AND the failure explicitly.)
    expect(calls).toHaveLength(0);
    expect(res.success).toBe(false);
  });

  it('fail-safe: a resolver error warns and keeps the bare user — never elevates', async () => {
    const { logger, warns } = recordingLogger();
    const engine = new AutomationEngine(logger);
    const { data, calls } = fakeData();
    registerCrudNodes(engine, ctxWith(data));
    engine.registerFlow('usr', allOpsFlow('usr', 'user'));
    engine.setUserGrantsResolver(() => { throw new Error('db down'); });

    const res = await engine.execute('usr', { userId: 'u1' });
    expect(res.success).toBe(true);
    // The degraded resolution is AUDIBLE, and the run is NOT elevated.
    expect(runAsWarns(warns).some((w) => w.includes('could not resolve grants'))).toBe(true);
    for (const c of calls) {
      expect(c.ctx.isSystem, `${c.op} wrongly elevated on resolver failure`).toBe(false);
      expect(c.ctx.userId).toBe('u1');
      expect(c.ctx.permissions).toEqual([]); // unresolved → data middleware applies its baseline
    }
  });
});
