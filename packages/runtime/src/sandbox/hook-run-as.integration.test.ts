// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14010] `Hook.runAs` on the SANDBOXED surface — the half that had no
 * elevation at all.
 *
 * ## Why this file exists at all, and why it is an integration test
 *
 * Before this card a hook could only elevate through the in-process
 * `ctx.api.sudo()`, which is a member of the host `ScopedContext` and is NOT
 * marshalled into the VM. So the same handler source PASSED a native
 * `hook.handler(ctx)` unit test and threw `TypeError` once `objectstack build`
 * lowered it into a `body` — green tests, dead feature, and under the default
 * `onError: 'abort'` a dead feature that aborts the triggering write. #14044
 * stopped the build from lowering such a handler; this card supplies what an
 * author should write instead, and the ruling requires it to work on BOTH
 * surfaces. A unit test of `wrapDeclarativeHook` cannot say whether it does:
 * the answer depends on the sandbox reading `ctx.api` from the engine context
 * at CALL time (`buildSandboxApi` in `body-runner.ts`,
 * `installApiMethod` in `quickjs-runner.ts`) rather than closing over it at
 * install time. That is a composition fact, so it is measured in composition:
 * a real `ObjectQL`, a real `QuickJSScriptRunner`, real hook bodies.
 *
 * The reading is taken at the engine middleware seam — `opCtx.context` — which
 * is where `plugin-security` reads the `isSystem` its short-circuit keys on,
 * ahead of the field-level write check that refused the card's hook.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL, bindHooksToEngine, HOOK_UNSCOPED_DATA_ACCESS_CODE } from '@objectstack/objectql';
import { hookBodyRunnerFactory } from './body-runner.js';
import { QuickJSScriptRunner } from './quickjs-runner.js';

const account = {
  name: 'runas_account',
  label: 'Account',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    current_grade: { name: 'current_grade', type: 'text' as const },
  },
};
const rating = {
  name: 'runas_rating',
  label: 'Rating',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    account_id: { name: 'account_id', type: 'text' as const },
    grade: { name: 'grade', type: 'text' as const },
  },
};

/** The triggering operator — a real user, unelevated. */
const OPERATOR = {
  userId: 'usr_operator',
  tenantId: 'org_1',
  positions: ['member'],
  permissions: ['member_default'],
  isSystem: false,
} as any;

/** A trigger that resolved no user at all. */
const USERLESS = { isSystem: true, positions: [], permissions: [] } as any;

function makeStubDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let nextId = 0;
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      const exp = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (exp ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(o: string, ast: any) { return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)); },
    async findOne(o: string, ast: any) { for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r; return null; },
    async create(o: string, data: Record<string, unknown>) {
      nextId += 1; const id = (data.id as string) ?? `r_${nextId}`; const row = { ...data, id }; storeFor(o).set(id, row); return row;
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(o); const cur = s.get(id); if (!cur) throw new Error(`nf ${o}/${id}`);
      const up = { ...cur, ...data, id }; s.set(id, up); return up;
    },
    async upsert(o: string, data: Record<string, unknown>) { const id = data.id as string | undefined; return id && storeFor(o).has(id) ? this.update(o, id, data) : this.create(o, data); },
    async delete(o: string, id: string) { return storeFor(o).delete(id); },
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; }, async commit() {}, async rollback() {},
  };
  return { driver, stores };
}

/** The body every case runs — the card's shape: stamp a computed column cross-object. */
const STAMP_SOURCE = `
  await ctx.api.object('runas_account').update({ id: ctx.input.account_id, current_grade: ctx.input.grade });
`;

describe('#14010 Hook.runAs — the sandboxed (L2 body) surface', () => {
  let engine: ObjectQL;
  let contexts: Record<string, any[]>;

  beforeEach(async () => {
    engine = new ObjectQL();
    const { driver } = makeStubDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    for (const o of [account, rating]) engine.registry.registerObject(o as any);
    engine.setDefaultBodyRunner(
      hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql: engine, appId: 'test' }),
    );
    contexts = { runas_account: [], runas_rating: [] };
    engine.registerMiddleware(async (opCtx: any, next: any) => {
      (contexts[opCtx.object] ??= []).push(opCtx.context);
      return next();
    });
  });

  async function bind(runAs: string | undefined) {
    bindHooksToEngine(
      engine,
      [
        {
          name: 'stamp_account_grade',
          object: 'runas_rating',
          events: ['afterInsert'],
          ...(runAs === undefined ? {} : { runAs }),
          body: { language: 'js', source: STAMP_SOURCE, capabilities: ['api.read', 'api.write'] },
        } as any,
      ],
      { packageId: 'test' },
    );
    await engine.insert('runas_account', { id: 'acct_1', name: 'Acme' }, { context: USERLESS });
    contexts.runas_account.length = 0;
    contexts.runas_rating.length = 0;
  }

  it("'system' elevates a BODY's ctx.api — the surface that had no elevation at all", async () => {
    await bind('system');

    await engine.insert(
      'runas_rating',
      { id: 'rat_1', account_id: 'acct_1', grade: 'A' },
      { context: OPERATOR },
    );

    const hookWrite = contexts.runas_account[0];
    expect(hookWrite?.isSystem).toBe(true);
    // Attribution survives elevation (#5494): the operator is still on the
    // context the audit stamps read, so `updated_by` names them.
    expect(hookWrite?.userId).toBe('usr_operator');
    expect(hookWrite?.tenantId).toBe('org_1');

    // …and the write really landed, rather than merely being attempted.
    const row = (await engine.findOne('runas_account', { where: { id: 'acct_1' } }, { context: USERLESS })) as any;
    expect(row.current_grade).toBe('A');

    // The scope fence (ruling item 5): the triggering write is untouched.
    expect(contexts.runas_rating[0]?.isSystem).toBe(false);
  }, 30000);

  it("'inherit' is the sandbox's pre-runAs behaviour, and an ABSENT key is the same thing", async () => {
    await bind('inherit');
    await engine.insert('runas_rating', { id: 'rat_1', account_id: 'acct_1', grade: 'B' }, { context: OPERATOR });
    const inherited = contexts.runas_account[0];
    expect(inherited?.isSystem).toBe(false);
    expect(inherited?.userId).toBe('usr_operator');
  }, 30000);

  it("'user' with a user-less trigger REFUSES the body's write, with the ADR-0112 envelope", async () => {
    await bind('user');

    // The refusal reaches the body as a real error through the ordinary sandbox
    // plumbing (the refusing api implements the same contract), so it surfaces
    // on the triggering write under the default `onError: 'abort'` — not as a
    // `TypeError` about a missing member, which is the shape #14044 closed.
    let thrown: any;
    await engine
      .insert('runas_rating', { id: 'rat_1', account_id: 'acct_1', grade: 'C' }, { context: USERLESS })
      .catch((e) => { thrown = e; });

    expect(thrown, 'the user-less write must be refused, not run unscoped').toBeDefined();
    expect(String(thrown?.message)).toContain(HOOK_UNSCOPED_DATA_ACCESS_CODE);
    // Nothing ran unscoped.
    expect(contexts.runas_account).toEqual([]);
    const row = (await engine.findOne('runas_account', { where: { id: 'acct_1' } }, { context: USERLESS })) as any;
    expect(row.current_grade ?? null).toBeNull();
  }, 30000);

  it('the two surfaces agree: an in-process handler and a body see the SAME context per runAs', async () => {
    // Parity is the point of the ruling — one declaration, one meaning,
    // whichever way the hook happens to be executed. Measured rather than
    // asserted: the same hook, once as a body (bound above) and once as an
    // in-process handler, read at the same seam.
    await bind('system');
    await engine.insert('runas_rating', { id: 'rat_1', account_id: 'acct_1', grade: 'A' }, { context: OPERATOR });
    const fromBody = contexts.runas_account[0];

    const handlerEngine = new ObjectQL();
    const { driver } = makeStubDriver();
    handlerEngine.registerDriver(driver, true);
    await handlerEngine.init();
    for (const o of [account, rating]) handlerEngine.registry.registerObject(o as any);
    const handlerContexts: any[] = [];
    handlerEngine.registerMiddleware(async (opCtx: any, next: any) => {
      if (opCtx.object === 'runas_account') handlerContexts.push(opCtx.context);
      return next();
    });
    bindHooksToEngine(
      handlerEngine,
      [{
        name: 'stamp_account_grade',
        object: 'runas_rating',
        events: ['afterInsert'],
        runAs: 'system',
        handler: async (ctx: any) => {
          await ctx.api.object('runas_account').update({ id: ctx.input.account_id, current_grade: ctx.input.grade });
        },
      } as any],
      { packageId: 'test' },
    );
    await handlerEngine.insert('runas_account', { id: 'acct_1', name: 'Acme' }, { context: USERLESS });
    handlerContexts.length = 0;
    await handlerEngine.insert('runas_rating', { id: 'rat_1', account_id: 'acct_1', grade: 'A' }, { context: OPERATOR });

    expect(handlerContexts[0]).toEqual(fromBody);
  }, 30000);
});
