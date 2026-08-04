// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { AuditPlugin } from './audit-plugin.js';

/**
 * Regression coverage: a freshly provisioned env READS sys_activity (the home
 * page's recent-activity feed) before anything has WRITTEN to it. The plugin's
 * objects are otherwise lazy-created on first write, so the read used to hit
 * SQLite "no such table" — logged by the engine as a `Find operation failed`
 * ERROR on every load. AuditPlugin now provisions its system tables at
 * kernel:ready so a new env is consistent from the start.
 */

/**
 * A fake engine that models the lazy-table behavior: `find()` throws
 * "no such table" until `syncObjectSchema()` has created it. No `registerHook`,
 * so `installAuditWriters()` early-returns and we stay focused on provisioning.
 */
function makeFakeEngine() {
  const tables = new Set<string>();
  const synced: string[] = [];
  const engine = {
    async syncObjectSchema(name: string) {
      synced.push(name);
      tables.add(name);
    },
    async find(object: string) {
      if (!tables.has(object)) throw new Error(`no such table: ${object}`);
      return [] as unknown[];
    },
  };
  return { engine, synced };
}

function makeCtx(engine: unknown) {
  const services = new Map<string, unknown>([
    ['objectql', engine],
    ['manifest', { register() {} }],
  ]);
  const readyHooks: Array<() => Promise<void> | void> = [];
  // #4887 — the log IS the deliverable for the provisioning path: its silence
  // is what made a working-but-elsewhere table read as a never-created one.
  // Capture info/warn so the tests can assert on what an operator would see.
  const logs = { info: [] as string[], warn: [] as string[] };
  const logger = {
    info(msg: string) { logs.info.push(String(msg)); },
    warn(msg: string) { logs.warn.push(String(msg)); },
    error() {}, debug() {},
    child() { return logger; },
  };
  const ctx = {
    logger,
    getService(name: string) { return services.get(name); },
    registerService(name: string, svc: unknown) { services.set(name, svc); },
    hook(event: string, fn: () => Promise<void> | void) {
      if (event === 'kernel:ready') readyHooks.push(fn);
    },
  } as any;
  return { ctx, logs, fireReady: async () => { for (const fn of readyHooks) await fn(); } };
}

describe('AuditPlugin — system table provisioning', () => {
  it('creates sys_audit_log / sys_activity / sys_comment on kernel:ready', async () => {
    const { engine, synced } = makeFakeEngine();
    const { ctx, fireReady } = makeCtx(engine);

    const plugin = new AuditPlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);

    // Before kernel:ready the table is absent — the read that the activity feed
    // performs would throw the "no such table" the engine logs as an ERROR.
    await expect(engine.find('sys_activity')).rejects.toThrow(/no such table/);

    await fireReady();

    expect(synced).toEqual(
      expect.arrayContaining(['sys_audit_log', 'sys_activity', 'sys_comment']),
    );
    // The activity-feed read now degrades to empty instead of throwing.
    await expect(engine.find('sys_activity')).resolves.toEqual([]);
  });

  it('skips provisioning gracefully when the engine has no syncObjectSchema', async () => {
    // An engine/driver without on-demand DDL (e.g. a federated-only kernel)
    // must not blow up start().
    const engine = { async find() { return []; } };
    const { ctx, fireReady } = makeCtx(engine);

    const plugin = new AuditPlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);
    await expect(fireReady()).resolves.toBeUndefined();
  });
});

/**
 * #4887 — provisioning must SAY what it did.
 *
 * `syncObjectSchema` returns `void` and has three silent exits of its own
 * (object not registered / no driver / driver without `syncSchema`), so a
 * caller that only catches throws cannot distinguish "created the table" from
 * "did nothing". Combined with a silent `typeof sync !== 'function'` bail on
 * this side, a boot where provisioning was skipped WHOLESALE logged exactly
 * the same thing as a boot where it worked: nothing.
 *
 * #4887 is what that costs. `sys_audit_log` / `sys_activity` were reported as
 * "never provisioned" because they were absent from the primary SQLite file —
 * but ADR-0057 §3.6 routes both (lifecycle classes `audit` / `telemetry`) to
 * the `telemetry` datasource when one is registered, and `os dev` registers one
 * by default as a sibling file. The tables existed; the log just never said
 * where. These tests pin the three statements an operator now gets.
 */
describe('AuditPlugin — provisioning is audible (#4887)', () => {
  /** Engine whose datasource routing mirrors ADR-0057 §3.6 in `os dev`. */
  function makeRoutingEngine(routes: Record<string, string | undefined>, defaultName = 'sqlite') {
    return {
      async syncObjectSchema(_name: string) { /* DDL issued on the resolved driver */ },
      getDriverForObject(name: string) {
        const ds = routes[name];
        return ds === undefined ? undefined : { name: ds };
      },
      getDefaultDriverName() { return defaultName; },
    };
  }

  it('warns — instead of returning silently — when the engine has no syncObjectSchema', async () => {
    const { ctx, logs, fireReady } = makeCtx({ async find() { return []; } });
    const plugin = new AuditPlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);
    await fireReady();

    const warned = logs.warn.find((m) => m.includes('no syncObjectSchema'));
    expect(warned).toBeDefined();
    // The warning must name the CONSEQUENCE, not just the missing method:
    // nothing is provisioned and a read-first env logs "no such table".
    expect(warned).toMatch(/sys_activity/);
    expect(warned).toMatch(/no such table/);
  });

  it('reports the datasource each system table was provisioned into', async () => {
    // The exact `os dev` shape: audit + activity split off to `telemetry`,
    // comment stays on the primary.
    const engine = makeRoutingEngine({
      sys_audit_log: 'telemetry',
      sys_activity: 'telemetry',
      sys_comment: 'sqlite',
    });
    const { ctx, logs, fireReady } = makeCtx(engine);
    const plugin = new AuditPlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);
    await fireReady();

    const placement = logs.info.find((m) => m.includes('system tables provisioned'));
    expect(placement).toBeDefined();
    expect(placement).toContain('sys_audit_log→telemetry');
    expect(placement).toContain('sys_activity→telemetry');
    expect(placement).toContain('sys_comment→sqlite');

    // …and the split itself is called out, because "absent from the database I
    // am looking at" is not "never created".
    const split = logs.info.find((m) => m.includes('NON-default datasource'));
    expect(split).toBeDefined();
    expect(split).toContain('ADR-0057');
    expect(split).toContain('sys_audit_log→telemetry');
    expect(split).toContain('sys_activity→telemetry');
    // sys_comment is ON the default datasource — it must not be listed as split.
    expect(split).not.toContain('sys_comment');
  });

  it('says nothing about a split when every table is on the default datasource', async () => {
    const engine = makeRoutingEngine({
      sys_audit_log: 'sqlite',
      sys_activity: 'sqlite',
      sys_comment: 'sqlite',
    });
    const { ctx, logs, fireReady } = makeCtx(engine);
    const plugin = new AuditPlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);
    await fireReady();

    expect(logs.info.find((m) => m.includes('system tables provisioned'))).toBeDefined();
    expect(logs.info.some((m) => m.includes('NON-default datasource'))).toBe(false);
    expect(logs.warn.some((m) => m.includes('NO datasource driver'))).toBe(false);
  });

  it("warns when an object resolves to no driver — syncObjectSchema's own silent exit", async () => {
    // `syncObjectSchema` returns without issuing DDL when no driver backs the
    // object. It throws nothing, so the per-object catch never fires: the only
    // way this is ever visible is from the outside, here.
    const engine = makeRoutingEngine({
      sys_audit_log: undefined,
      sys_activity: 'sqlite',
      sys_comment: 'sqlite',
    });
    const { ctx, logs, fireReady } = makeCtx(engine);
    const plugin = new AuditPlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);
    await fireReady();

    const warned = logs.warn.find((m) => m.includes('NO datasource driver'));
    expect(warned).toBeDefined();
    expect(warned).toContain('sys_audit_log');
    // The other two still provisioned — one unroutable object does not stop them.
    const placement = logs.info.find((m) => m.includes('system tables provisioned'));
    expect(placement).toContain('sys_activity→sqlite');
    expect(placement).toContain('sys_comment→sqlite');
    expect(placement).not.toContain('sys_audit_log');
  });

  it('keeps reporting placements when one object fails to sync', async () => {
    const engine = {
      async syncObjectSchema(name: string) {
        if (name === 'sys_activity') throw new Error('disk I/O error');
      },
      getDriverForObject() { return { name: 'sqlite' }; },
      getDefaultDriverName() { return 'sqlite'; },
    };
    const { ctx, logs, fireReady } = makeCtx(engine);
    const plugin = new AuditPlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);
    await fireReady();

    expect(logs.warn.some((m) => m.includes('could not provision sys_activity'))).toBe(true);
    const placement = logs.info.find((m) => m.includes('system tables provisioned'));
    expect(placement).toContain('sys_audit_log→sqlite');
    expect(placement).toContain('sys_comment→sqlite');
    expect(placement).not.toContain('sys_activity');
  });
});

/**
 * #4630 — the sys_comment record-level gates are only worth as much as their
 * MOUNTING: `comment-access-hooks.test.ts` proves what the hooks decide, this
 * proves the plugin actually installs them on a real kernel:ready, on the right
 * object, alongside (not instead of) the audit writers. "Who mounts this" is a
 * question about the composed runtime, and a gate that silently stops being
 * registered fails exactly like a gate that was never written.
 */
describe('AuditPlugin — sys_comment access gates are mounted', () => {
  function makeGateEngine() {
    const hooks: Array<{ event: string; object?: string; packageId?: string; handler: (ctx: any) => Promise<void> }> = [];
    const middlewares: Array<{ object?: string }> = [];
    const engine = {
      registerHook(event: string, handler: any, options?: { object?: string; packageId?: string }) {
        hooks.push({ event, handler, ...options });
      },
      registerMiddleware(_fn: any, options?: { object?: string }) {
        middlewares.push({ ...options });
      },
      async find() { return [] as unknown[]; },
      async findOne() { return null; },
      async syncObjectSchema() {},
    };
    return { engine, hooks, middlewares };
  }

  it('registers the write hooks + the read middleware on sys_comment at kernel:ready', async () => {
    const { engine, hooks, middlewares } = makeGateEngine();
    const { ctx, fireReady } = makeCtx(engine);
    const plugin = new AuditPlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);
    await fireReady();

    const commentHooks = hooks.filter((h) => h.object === 'sys_comment');
    for (const event of ['beforeInsert', 'beforeUpdate', 'beforeDelete']) {
      expect(commentHooks.some((h) => h.event === event)).toBe(true);
    }
    expect(middlewares).toContainEqual({ object: 'sys_comment' });
    // The audit writers are still installed — the gates are additive.
    expect(hooks.some((h) => h.event === 'afterInsert' && !h.object)).toBe(true);
  });

  it('the mounted beforeInsert actually refuses a comment on an unreadable record', async () => {
    const { engine, hooks } = makeGateEngine();
    const { ctx, fireReady } = makeCtx(engine);
    const plugin = new AuditPlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);
    await fireReady();

    // Caller-scoped api that can read nothing — the #4630 rep2 situation.
    const hookCtx = {
      object: 'sys_comment',
      event: 'beforeInsert',
      input: {
        data: { thread_id: 'crm_opportunity:1A7nlQpfEhWxIaeX', body: 'rep2 should not be here' },
        options: { context: { userId: 'rep2' } },
      },
      session: { userId: 'rep2' },
      api: { object: () => ({ findOne: async () => null }) },
    };
    const insertHooks = hooks.filter((h) => h.object === 'sys_comment' && h.event === 'beforeInsert');
    const results = await Promise.allSettled(insertHooks.map((h) => h.handler(hookCtx)));
    const denials = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(denials).toHaveLength(1);
    expect(denials[0].reason).toMatchObject({ code: 'RECORD_NOT_ACCESSIBLE', status: 403 });
  });
});
