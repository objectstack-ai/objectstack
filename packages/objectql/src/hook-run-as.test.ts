// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14010] `Hook.runAs` — the declared execution identity of a hook's `ctx.api`
 * data operations. Ruling 2026-09-01 (director batch #22, maintainer 「同意」):
 * `'system' | 'user' | 'inherit'`, default `'inherit'`.
 *
 * ## What the card measured, and what these pins therefore have to say
 *
 * An app wanted a column COMPUTED and never hand-written. Authoring
 * `editable: false` for the persona refuses the direct `PATCH` — and refuses
 * the cross-object hook that maintains the column, because the hook's
 * `ctx.api` is a `ScopedContext` over the TRIGGERING write's context. The
 * guard and the legitimate writer were the same door. So the pins below are
 * about ONE question: **what execution context does a hook's `ctx.api` present
 * to the middleware chain?** They read it where `plugin-security` reads it —
 * `opCtx.context` at the engine middleware seam — rather than at the driver,
 * because that is the seam whose `isSystem` short-circuit precedes the
 * field-level write check (`security-plugin.ts`, step 2.5).
 *
 * ## Two layers, deliberately
 *
 *  1. `wrapDeclarativeHook` over a REAL `ScopedContext` whose engine is a
 *     recorder — the surgical layer, where "the engine was never called" is
 *     assertable, which is the whole point of the `'user'` refusal.
 *  2. A real `ObjectQL` + stub driver dispatch — the assembly layer, which is
 *     what proves `buildHookApi` produces an api the wrapper can derive from
 *     at all. Without it every pin in layer 1 could pass while every real hook
 *     that declared `runAs` threw.
 *
 * The scope fence (ruling item 5) is measured, not asserted in prose: the
 * TRIGGERING operation's own context is read back at the same seam and shown
 * unchanged under `runAs: 'system'`.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL, ScopedContext } from './engine.js';
import { bindHooksToEngine } from './hook-binder.js';
import { wrapDeclarativeHook } from './hook-wrappers.js';
import {
  HookUnscopedDataAccessError,
  HOOK_UNSCOPED_DATA_ACCESS_CODE,
  HOOK_UNSCOPED_DATA_ACCESS_STATUS,
  hookRunAs,
} from './hook-run-as.js';
import type { Hook, HookContext } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** The triggering operator: a real user, no elevation — the card's persona. */
const OPERATOR: ExecutionContext = {
  userId: 'usr_operator',
  tenantId: 'org_1',
  positions: ['member'],
  permissions: ['member_default'],
  isSystem: false,
} as ExecutionContext;

/** A trigger that resolved NO user: an `isSystem` service write, a system flow node. */
const USERLESS: ExecutionContext = { isSystem: true, positions: [], permissions: [] } as ExecutionContext;

// ---------------------------------------------------------------------------
// Layer 1 — the wrapper over a real ScopedContext whose engine records.
// ---------------------------------------------------------------------------

/** Records the `context` every data operation carries — the security seam's input. */
function recordingEngine() {
  const seen: Array<{ method: string; context: unknown }> = [];
  const engine: any = {
    seen,
    async insert(_o: string, _d: unknown, options: any) { seen.push({ method: 'insert', context: options?.context }); return { id: 'r1' }; },
    async update(_o: string, _d: unknown, options: any) { seen.push({ method: 'update', context: options?.context }); return { id: 'r1' }; },
    async find(_o: string, query: any) { seen.push({ method: 'find', context: query?.context }); return []; },
    async delete(_o: string, options: any) { seen.push({ method: 'delete', context: options?.context }); return true; },
  };
  return engine;
}

function makeCtx(execCtx: ExecutionContext, engine: any, overrides: Partial<HookContext> = {}): HookContext {
  return {
    object: 'account',
    event: 'afterInsert',
    input: { data: { name: 'acme' } },
    session: { userId: execCtx.userId, organizationId: execCtx.tenantId },
    api: new ScopedContext(execCtx, engine),
    ql: undefined,
    ...overrides,
  } as unknown as HookContext;
}

function hookOf(runAs: unknown, extra: Partial<Hook> = {}): Hook {
  return {
    name: 'stamp_grade',
    object: 'account',
    events: ['afterInsert'],
    priority: 100,
    ...(runAs === undefined ? {} : { runAs }),
    ...extra,
  } as unknown as Hook;
}

describe('#14010 Hook.runAs — the identity a hook\'s ctx.api presents', () => {
  it("'inherit' hands the engine-built api through BY REFERENCE — the default is today's behaviour", async () => {
    const engine = recordingEngine();
    const ctx = makeCtx(OPERATOR, engine);
    const original = ctx.api;
    let seenInside: unknown;

    const wrapped = wrapDeclarativeHook(hookOf('inherit'), async (c) => {
      seenInside = c.api;
      await (c.api as any).object('grade').insert({ v: 1 });
    }, { logger: silentLogger });
    await wrapped(ctx);

    // Reference equality, not deep equality: "byte-identical to today" is a
    // claim about the object the handler is handed, and a structurally equal
    // copy would satisfy a deep comparison while being a new derivation.
    expect(seenInside).toBe(original);
    expect(engine.seen).toEqual([{ method: 'insert', context: OPERATOR }]);
  });

  it('an ABSENT runAs behaves exactly as `inherit` — an existing hook is unaffected', async () => {
    const engine = recordingEngine();
    const ctx = makeCtx(OPERATOR, engine);
    const original = ctx.api;
    let seenInside: unknown;

    const wrapped = wrapDeclarativeHook(hookOf(undefined), async (c) => { seenInside = c.api; }, { logger: silentLogger });
    await wrapped(ctx);

    expect(hookRunAs({ name: 'stamp_grade' })).toBe('inherit');
    expect(seenInside).toBe(original);
  });

  it("'system' ELEVATES the hook's data operations — and carries the operator through (#5494)", async () => {
    const engine = recordingEngine();
    const ctx = makeCtx(OPERATOR, engine);

    const wrapped = wrapDeclarativeHook(hookOf('system'), async (c) => {
      await (c.api as any).object('account').update({ current_grade: 'A' });
    }, { logger: silentLogger });
    await wrapped(ctx);

    const context = engine.seen[0]!.context as ExecutionContext;
    // The flag the security middleware short-circuits on, BEFORE its
    // field-level write check — which is what makes `editable: false` and a
    // hook-maintained column able to coexist at all.
    expect(context.isSystem).toBe(true);
    // Elevation is authorization, not anonymity: the operator rides along, so
    // the audit stamps (which gate on `session.userId`, never on `isSystem`)
    // still name them. `updated_by` does not become a system principal.
    expect(context.userId).toBe('usr_operator');
    expect(context.tenantId).toBe('org_1');
  });

  it("'user' DE-ELEVATES — a hook fired by an elevated write is pinned to the trigger's user", async () => {
    const engine = recordingEngine();
    // The realistic shape: an elevated service write that still names its
    // operator (the #3783 approvals mirror's `{ isSystem: true, userId }`).
    const elevatedButAttributed = { ...OPERATOR, isSystem: true } as ExecutionContext;
    const ctx = makeCtx(elevatedButAttributed, engine);

    const wrapped = wrapDeclarativeHook(hookOf('user'), async (c) => {
      await (c.api as any).object('account').update({ current_grade: 'A' });
    }, { logger: silentLogger });
    await wrapped(ctx);

    const context = engine.seen[0]!.context as ExecutionContext;
    expect(context.isSystem).toBe(false);
    expect(context.userId).toBe('usr_operator');
  });

  describe("'user' with NO trigger user — the refusal, not a fall-open (#3760's posture)", () => {
    it('refuses the data operation with the ADR-0112 envelope, and the engine is never called', async () => {
      const engine = recordingEngine();
      const ctx = makeCtx(USERLESS, engine);
      let thrown: any;

      const wrapped = wrapDeclarativeHook(hookOf('user', { onError: 'abort' }), async (c) => {
        await (c.api as any).object('account').update({ current_grade: 'A' });
      }, { logger: silentLogger });
      await wrapped(ctx).catch((e) => { thrown = e; });

      // Envelope first: code AND status, per the standard clause. A bare
      // "it threw" would pass for a TypeError from a missing member, which is
      // exactly the failure shape this card exists to end.
      expect(thrown).toBeInstanceOf(HookUnscopedDataAccessError);
      expect(thrown.code).toBe(HOOK_UNSCOPED_DATA_ACCESS_CODE);
      expect(thrown.status).toBe(HOOK_UNSCOPED_DATA_ACCESS_STATUS);
      expect(thrown.hook).toBe('stamp_grade');
      // The remedy the author can act on, and the reason.
      expect(thrown.message).toContain("runAs: 'system'");
      expect(thrown.message).toContain('UNSCOPED');
      // The decisive half: refusing means the operation did NOT run unscoped.
      expect(engine.seen).toEqual([]);
    });

    it('refuses `transaction()` too — both doors, not just `object()`', async () => {
      const engine = recordingEngine();
      const ctx = makeCtx(USERLESS, engine);
      let thrown: any;

      const wrapped = wrapDeclarativeHook(hookOf('user'), async (c) => {
        await (c.api as any).transaction(async () => 'never');
      }, { logger: silentLogger });
      await wrapped(ctx).catch((e) => { thrown = e; });

      expect(thrown?.code).toBe(HOOK_UNSCOPED_DATA_ACCESS_CODE);
      expect(engine.seen).toEqual([]);
    });

    it('a `user` hook that touches NO data still runs — the refusal is at the data door', async () => {
      const engine = recordingEngine();
      const ctx = makeCtx(USERLESS, engine);
      let ran = false;

      const wrapped = wrapDeclarativeHook(hookOf('user'), async () => { ran = true; }, { logger: silentLogger });
      await expect(wrapped(ctx)).resolves.toBeUndefined();
      expect(ran).toBe(true);
    });
  });

  describe('the swap is scoped to the handler call', () => {
    it('restores ctx.api after the handler returns, and after it throws', async () => {
      const engine = recordingEngine();
      const ctx = makeCtx(OPERATOR, engine);
      const original = ctx.api;

      await wrapDeclarativeHook(hookOf('system'), async () => {}, { logger: silentLogger })(ctx);
      expect(ctx.api).toBe(original);

      const boom = wrapDeclarativeHook(hookOf('system'), async () => { throw new Error('boom'); }, { logger: silentLogger });
      await expect(boom(ctx)).rejects.toThrow('boom');
      expect(ctx.api).toBe(original);
    });

    it('a fire-and-forget after* hook keeps its derived api past the synchronous restore', async () => {
      // The restore runs in a `finally` that fires before an async handler's
      // first `await` resumes, so a shared ctx would silently un-elevate the
      // very writes an author declared `runAs` for.
      const engine = recordingEngine();
      const ctx = makeCtx(OPERATOR, engine);
      const original = ctx.api;
      let resolveGate: () => void = () => {};
      const gate = new Promise<void>((r) => { resolveGate = r; });
      let done: () => void = () => {};
      const finished = new Promise<void>((r) => { done = r; });

      const wrapped = wrapDeclarativeHook(hookOf('system', { async: true }), async (c) => {
        await gate;
        await (c.api as any).object('account').update({ current_grade: 'A' });
        done();
      }, { logger: silentLogger });

      await wrapped(ctx);
      // The engine's own api is already back on the shared context…
      expect(ctx.api).toBe(original);
      resolveGate();
      await finished;

      // …and the detached handler still wrote elevated.
      expect(engine.seen).toHaveLength(1);
      expect((engine.seen[0]!.context as ExecutionContext).isSystem).toBe(true);
    });
  });

  it('a runAs value outside the enum is refused LOUDLY at bind time, never silently ignored', () => {
    // Declared ≠ enforced is the defect this key exists to end, so a hook that
    // reached the engine without going through `HookSchema` cannot declare an
    // identity the engine then drops on the floor.
    expect(() => wrapDeclarativeHook(hookOf('elevated'), async () => {}, { logger: silentLogger }))
      .toThrow(/not one of 'system' \| 'user' \| 'inherit'/);
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — a real ObjectQL dispatch, read at the middleware seam.
// ---------------------------------------------------------------------------

const FIELDS = {
  id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
  name: { name: 'name', label: 'Name', type: 'text' as const },
  current_grade: { name: 'current_grade', label: 'Grade', type: 'text' as const },
};
const accountObject = { name: 'runas_account', label: 'Account', fields: FIELDS };
const ratingObject = { name: 'runas_rating', label: 'Rating', fields: FIELDS };

function stubDriver() {
  const store = new Map<string, Map<string, any>>();
  const storeFor = (o: string) => { if (!store.has(o)) store.set(o, new Map()); return store.get(o)!; };
  let nextId = 0;
  const d: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; }, async syncSchema() {},
    async find(o: string) { return Array.from(storeFor(o).values()); },
    async findOne(o: string, ast: any) {
      for (const r of storeFor(o).values()) if (!ast?.where?.id || r.id === ast.where.id) return r;
      return null;
    },
    async create(o: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id }; storeFor(o).set(id, row); return row;
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(o); const cur = s.get(id) ?? { id };
      const u = { ...cur, ...data, id }; s.set(id, u); return u;
    },
    async upsert(o: string, data: any) { return data.id ? this.update(o, data.id, data) : this.create(o, data); },
    async delete(o: string, id: string) { return storeFor(o).delete(id); },
    async count(o: string) { return storeFor(o).size; },
    async bulkCreate(o: string, rows: any[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async updateMany() { return 0; }, async deleteMany() { return 0; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return d;
}

/**
 * A real dispatch: inserting a `runas_rating` fires a hook that writes the
 * computed column on `runas_account` through `ctx.api`. Every context that
 * reaches the middleware chain is recorded, per object — which is where
 * `plugin-security` reads the flag its short-circuit keys on.
 */
async function bootReal(runAs: string | undefined) {
  const engine = new ObjectQL();
  engine.registerDriver(stubDriver(), true);
  await engine.init();
  engine.registry.registerObject(accountObject as any);
  engine.registry.registerObject(ratingObject as any);

  const contexts: Record<string, any[]> = { runas_account: [], runas_rating: [] };
  engine.registerMiddleware(async (opCtx: any, next: any) => {
    (contexts[opCtx.object] ??= []).push(opCtx.context);
    return next();
  });

  const hook = {
    name: 'stamp_account_grade',
    object: 'runas_rating',
    events: ['afterInsert'],
    priority: 100,
    ...(runAs === undefined ? {} : { runAs }),
    handler: async (ctx: any) => {
      await ctx.api.object('runas_account').update({ id: 'acct_1', current_grade: 'A' });
    },
  } as unknown as Hook;
  bindHooksToEngine(engine, [hook], { packageId: 'app:test', logger: silentLogger });

  // The row the hook maintains has to exist: the engine's write-not-found gate
  // refuses an update to a missing id, and that refusal would read exactly like
  // a `runAs` failure. Seeded elevated, then the recording is cleared so every
  // context read below belongs to the dispatch under test.
  await engine.insert('runas_account', { id: 'acct_1', name: 'Acme' }, { context: { isSystem: true } as any });
  contexts.runas_account.length = 0;
  contexts.runas_rating.length = 0;
  return { engine, contexts };
}

describe('#14010 Hook.runAs — through a real ObjectQL dispatch', () => {
  it("'system' reaches the middleware seam elevated, while the TRIGGERING write does not (scope fence)", async () => {
    const { engine, contexts } = await bootReal('system');

    await engine.insert('runas_rating', { name: 'r1' }, { context: OPERATOR });

    // The hook's own write — elevated, and attributed.
    const hookWrite = contexts.runas_account[0];
    expect(hookWrite?.isSystem).toBe(true);
    expect(hookWrite?.userId).toBe('usr_operator');

    // Ruling item 5: the fence. The write that FIRED the hook keeps its own
    // context — `runAs` elevates the hook's api, never the triggering
    // operation, so the readonly strip, the field-level check and the RLS
    // filter on that operation are exactly what they were.
    const triggering = contexts.runas_rating[0];
    expect(triggering?.isSystem).toBe(false);
    expect(triggering?.userId).toBe('usr_operator');
  });

  it("'inherit' presents the triggering context unchanged — the pre-runAs behaviour, measured", async () => {
    const { engine, contexts } = await bootReal('inherit');
    await engine.insert('runas_rating', { name: 'r1' }, { context: OPERATOR });
    expect(contexts.runas_account[0]?.isSystem).toBe(false);
    expect(contexts.runas_account[0]?.userId).toBe('usr_operator');
  });

  it('an UNDECLARED hook is byte-identical to `inherit` — the zero-migration claim', async () => {
    const declared = await bootReal('inherit');
    await declared.engine.insert('runas_rating', { name: 'r1' }, { context: OPERATOR });
    const absent = await bootReal(undefined);
    await absent.engine.insert('runas_rating', { name: 'r1' }, { context: OPERATOR });
    expect(absent.contexts.runas_account[0]).toEqual(declared.contexts.runas_account[0]);
  });

  it("'user' with a user-less trigger refuses the hook's write, and the trigger keeps its own context", async () => {
    const { engine, contexts } = await bootReal('user');

    await expect(engine.insert('runas_rating', { name: 'r1' }, { context: USERLESS }))
      .rejects.toMatchObject({ code: HOOK_UNSCOPED_DATA_ACCESS_CODE, status: HOOK_UNSCOPED_DATA_ACCESS_STATUS });

    // Nothing ran unscoped: no account write reached the chain at all.
    expect(contexts.runas_account).toEqual([]);
    expect(contexts.runas_rating[0]?.isSystem).toBe(true);
  });
});
