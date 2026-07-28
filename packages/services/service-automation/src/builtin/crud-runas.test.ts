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
import { resolveRunDataContext, runIsUnscopedUserMode, flowTouchesData } from '../runtime-identity.js';
import type { AutomationContext } from '@objectstack/spec/contracts';

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
    async findOne(obj: string, q: any) { calls.push({ op: 'findOne', obj, ctx: q?.context }); return { id: 'r1' }; },
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
    const res = await engine.execute('sys', { userId: 'u1' });
    expect(res.success).toBe(true);

    expect(calls.map((c) => c.op).sort()).toEqual(['delete', 'find', 'findOne', 'insert', 'update']);
    for (const c of calls) {
      expect(c.ctx, `${c.op} got no context`).toBeTruthy();
      expect(c.ctx.isSystem, `${c.op} not elevated`).toBe(true);
      // An elevated run is NOT attributed to the triggering user.
      expect(c.ctx.userId).toBeUndefined();
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

    // Trigger as a restricted user. If the engine ignored runAs, the insert would
    // carry that user's identity (or none) instead of the elevated principal.
    await engine.execute('reg', { userId: 'restricted' });
    const insert = calls.find((c) => c.op === 'insert');
    expect(insert?.ctx?.isSystem, 'runAs:system did not elevate the data op (#1888 regressed)').toBe(true);
    expect(insert?.ctx?.userId).not.toBe('restricted');
  });
});

describe('resolveRunDataContext (#1888 unit)', () => {
  it("maps runAs:'system' to an elevated context", () => {
    expect(resolveRunDataContext({ runAs: 'system', userId: 'u1' })).toEqual({
      isSystem: true, positions: [], permissions: [],
    });
  });

  it("maps runAs:'user' to the triggering user's identity", () => {
    expect(resolveRunDataContext({ runAs: 'user', userId: 'u1', positions: ['r'], tenantId: 't' })).toEqual({
      isSystem: false, userId: 'u1', positions: ['r'], permissions: [], tenantId: 't',
    });
  });

  it('returns undefined for a user-mode run with no user AND no run id', () => {
    expect(resolveRunDataContext({ runAs: 'user' })).toBeUndefined();
    expect(resolveRunDataContext(undefined)).toBeUndefined();
  });

  // #3712 — a user-mode run with no user still HAS a run. It carries the run id
  // and nothing else, so it becomes attributable without acquiring a principal.
  it('maps a user-less run WITH a run id to a provenance-only context', () => {
    const ctx = resolveRunDataContext({ runAs: 'user', flowRunId: 'run_1' });
    expect(ctx).toEqual({ flowRunId: 'run_1' });
    // Exhaustive on purpose: every field below is one the security middleware
    // keys on. Any of them appearing here would change the run's authorization,
    // which this fix must not do — the #1888 unscoped posture is unchanged.
    expect(Object.keys(ctx!)).toEqual(['flowRunId']);
    for (const key of ['isSystem', 'userId', 'positions', 'permissions', 'tenantId']) {
      expect(ctx, `provenance-only context leaked '${key}' — it now presents a principal`)
        .not.toHaveProperty(key);
    }
  });
});

/**
 * #1888 FOLLOW-UP — the user-less fail-open. A schedule-triggered run carries no
 * trigger user, so an effective `runAs:'user'` (the default) resolves no identity
 * → CRUD nodes present no principal → the data security middleware skips → the
 * run executes UNSCOPED (effectively elevated). Denying would break legitimate
 * scheduled CRUD and silently elevating would hide the author's intent, so the
 * engine keeps the run working but makes the fail-open AUDIBLE: one clear warning
 * per run, recommending `runAs:'system'` (ADR-0049). These tests pin both the
 * (unchanged, non-breaking) data behavior AND the new warning.
 */

/**
 * The op ran with NO principal — the #1888 unscoped posture. Since #3712 such a
 * run DOES carry a context, but a provenance-only one: the run id and nothing
 * the security middleware keys on. Asserting "no context at all" would pin the
 * transport instead of the property that matters.
 */
function expectUnscoped(ctx: any, op: string): void {
  for (const key of ['isSystem', 'userId', 'positions', 'permissions', 'tenantId']) {
    expect(ctx?.[key], `${op} should be unscoped — it presented '${key}'`).toBeUndefined();
  }
}

function recordingLogger(): { logger: any; warns: string[] } {
  const warns: string[] = [];
  const l: any = { info() {}, warn: (m: string) => warns.push(m), error() {}, debug() {} };
  l.child = () => l;
  return { logger: l, warns };
}
const runAsWarns = (warns: string[]) => warns.filter((w) => w.includes('[runAs]'));

describe('schedule/user-less runs surface the unscoped fail-open (#1888 follow-up)', () => {
  it('warns ONCE when a user-mode run has no trigger user and the flow touches data', async () => {
    const { logger, warns } = recordingLogger();
    const engine = new AutomationEngine(logger);
    const { data, calls } = fakeData();
    registerCrudNodes(engine, ctxWith(data));
    engine.registerFlow('sched', allOpsFlow('sched')); // no runAs → default 'user'

    // Simulate a schedule trigger's context: an event, but NO userId.
    const res = await engine.execute('sched', { event: 'schedule', params: { jobId: 'j1' } });
    expect(res.success).toBe(true);

    // Non-breaking: the run still executes, and every data op is UNSCOPED — it
    // presents no principal, only its own run id (#3712).
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expectUnscoped(c.ctx, c.op);
      expect(c.ctx?.flowRunId, `${c.op} carried no run provenance`).toBeTruthy();
    }

    // ...and the fail-open is AUDIBLE: exactly one runAs warning, naming the flow + the fix.
    const w = runAsWarns(warns);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("flow 'sched'");
    expect(w[0]).toMatch(/UNSCOPED/);
    expect(w[0]).toMatch(/runAs:'system'/);
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

  it('does NOT resolve when there is no trigger user (stays the unscoped fail-open)', async () => {
    const engine = new AutomationEngine(makeLogger());
    const { data, calls } = fakeData();
    registerCrudNodes(engine, ctxWith(data));
    engine.registerFlow('sched', allOpsFlow('sched')); // default user, no userId
    let called = 0;
    engine.setUserGrantsResolver(() => { called++; return { positions: [], permissions: [] }; });
    await engine.execute('sched', { event: 'schedule' });
    expect(called).toBe(0);
    for (const c of calls) expectUnscoped(c.ctx, c.op);
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
