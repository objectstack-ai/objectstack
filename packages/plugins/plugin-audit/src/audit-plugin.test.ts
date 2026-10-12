// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { ObjectQLPlugin } from '@objectstack/objectql';
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
  // [#22913] …and every `error` call whole, in the contract's
  // `error(message, error?, meta?)` shape, so a pin can count them.
  const logs = {
    info: [] as string[],
    warn: [] as string[],
    error: [] as Array<{ message: string; error: unknown; meta: Record<string, unknown> | undefined }>,
  };
  const logger = {
    info(msg: string) { logs.info.push(String(msg)); },
    warn(msg: string) { logs.warn.push(String(msg)); },
    error(msg: string, error?: unknown, meta?: Record<string, unknown>) {
      logs.error.push({ message: String(msg), error, meta });
    },
    debug() {},
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
 * [#22913] A failed provision is a DURABILITY degradation, so it is reported at
 * `error` — once per object, never per write — and the boot is not failed.
 *
 * When an object's DDL throws, the boot still completes and the deployment
 * serves as healthy while the table does not exist; for `sys_audit_log` /
 * `sys_activity`, audited writes keep succeeding while their audit rows have
 * nowhere to land. AGENTS.md "Degradation log levels" sends that class to
 * `error`, with the consequence and the fix in the first line. The wording is
 * not pinned: the pins hold the level, the count, the named object, the named
 * remedy command and the driver's refusal in meta.
 */
describe('AuditPlugin — a failed provision is an error, once per object (#22913)', () => {
  const OBJECTS = ['sys_audit_log', 'sys_activity', 'sys_comment', 'sys_comment_reaction'];

  /** Every DDL succeeds except the named object's, which the driver refuses. */
  function makeEngine(refused?: string) {
    return {
      async syncObjectSchema(name: string) {
        if (name === refused) throw new Error(`there is already an index named ${name}`);
      },
      getDriverForObject() { return { name: 'sqlite' }; },
      getDefaultDriverName() { return 'sqlite'; },
    };
  }

  async function boot(refused?: string) {
    const { ctx, logs, fireReady } = makeCtx(makeEngine(refused));
    const plugin = new AuditPlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);
    // The boot is NOT failed: kernel:ready resolves.
    await expect(fireReady()).resolves.toBeUndefined();
    return logs;
  }

  it.each(OBJECTS)('a refused DDL for %s logs exactly one error line naming it, the remedy and the refusal', async (name) => {
    const logs = await boot(name);

    expect(logs.error).toHaveLength(1);
    const [line] = logs.error;
    expect(line.message).toContain(name);
    // ② the fix, by its named subject: the command measured to create it.
    expect(line.message).toContain('os migrate apply');
    // One line: the first line carries both halves.
    expect(line.message).not.toContain('\n');
    // The driver's refusal travels in meta, never interpolated into the line.
    expect(line.meta).toEqual({ object: name, error: `there is already an index named ${name}` });
    // …and it is not ALSO reported at a quieter level.
    expect(logs.warn.filter((m) => m.includes('could not provision'))).toEqual([]);
    // The other three objects still provisioned.
    const placement = logs.info.find((m) => m.includes('system tables provisioned'));
    for (const other of OBJECTS.filter((o) => o !== name)) expect(placement).toContain(`${other}→sqlite`);
    expect(placement).not.toContain(`${name}→`);
  });

  it('CONTROL: a clean provision logs no error at all', async () => {
    const logs = await boot();

    expect(logs.error).toEqual([]);
    const placement = logs.info.find((m) => m.includes('system tables provisioned'));
    for (const name of OBJECTS) expect(placement).toContain(`${name}→sqlite`);
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
      sys_comment_reaction: 'sqlite',
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
    expect(placement).toContain('sys_comment_reaction→sqlite');

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
      sys_comment_reaction: 'sqlite',
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
      sys_comment_reaction: 'sqlite',
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

    expect(logs.error.some((e) => e.message.includes('could not provision sys_activity'))).toBe(true);
    const placement = logs.info.find((m) => m.includes('system tables provisioned'));
    expect(placement).toContain('sys_audit_log→sqlite');
    expect(placement).toContain('sys_comment→sqlite');
    expect(placement).not.toContain('sys_activity');
  });
});

/**
 * [#22984] `skipSchemaSync` / `OS_SKIP_SCHEMA_SYNC=1` declares a deployment's
 * DDL managed out-of-band. The engine's boot honours it, and this plugin's
 * boot-time provisioning is DDL too, so it honours the same declaration: no
 * DDL, no probe, one `info` line naming what it skipped. The wording is not
 * pinned; the level, the count and the named subjects are.
 */
describe('AuditPlugin — boot provisioning honours skipSchemaSync (#22984)', () => {
  const OBJECTS = ['sys_audit_log', 'sys_activity', 'sys_comment', 'sys_comment_reaction'];
  const SKIP = 'NOT provisioned at boot';

  /**
   * Records every provisioning-relevant call (the DDL and each probe the loop
   * makes) over the lazy-table model: `find()` throws "no such table" until
   * `syncObjectSchema()` created it. `published` is what `ObjectQLPlugin`
   * would have put on the engine.
   */
  function makeRecordingEngine(published: boolean) {
    const tables = new Set<string>();
    const calls: string[] = [];
    const engine = {
      skipSchemaSync: published,
      async syncObjectSchema(name: string) { calls.push(`syncObjectSchema:${name}`); tables.add(name); },
      getDriverForObject(name: string) { calls.push(`getDriverForObject:${name}`); return { name: 'sqlite' }; },
      getDefaultDriverName() { calls.push('getDefaultDriverName'); return 'sqlite'; },
      async find(object: string) {
        calls.push(`find:${object}`);
        if (!tables.has(object)) throw new Error(`no such table: ${object}`);
        return [] as unknown[];
      },
    };
    return { engine, calls };
  }

  async function boot(engine: unknown) {
    const { ctx, logs, fireReady } = makeCtx(engine);
    const plugin = new AuditPlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);
    await fireReady();
    return logs;
  }

  it('flag set: no DDL and no probe, the tables stay absent, and ONE info line names the skip', async () => {
    const { engine, calls } = makeRecordingEngine(true);
    const logs = await boot(engine);

    expect(calls).toEqual([]);
    // The triage pin in this model: a table that was not there stays not there.
    await expect(engine.find('sys_comment_reaction')).rejects.toThrow(/no such table/);

    const skip = logs.info.filter((m) => m.includes(SKIP));
    expect(skip).toHaveLength(1);
    for (const name of OBJECTS) expect(skip[0]).toContain(name);
    expect(skip[0]).toContain('OS_SKIP_SCHEMA_SYNC');
    expect(skip[0]).toContain('os migrate apply');
    // `info`, because nothing is degraded: it is not ALSO said louder, and no
    // provisioning line claims a table. (This fake engine has no middleware
    // seam, so the read-visibility warn is expected and is not about this.)
    expect(logs.warn.filter((m) => /provision|syncObjectSchema/.test(m))).toEqual([]);
    expect(logs.error).toEqual([]);
    expect(logs.info.some((m) => m.includes('system tables provisioned'))).toBe(false);
  });

  it('CONTROL: flag published as false, every table is provisioned exactly as before', async () => {
    const { engine, calls } = makeRecordingEngine(false);
    const logs = await boot(engine);

    expect(calls.filter((c) => c.startsWith('syncObjectSchema:'))).toEqual(OBJECTS.map((n) => `syncObjectSchema:${n}`));
    await expect(engine.find('sys_comment_reaction')).resolves.toEqual([]);
    expect(logs.info.some((m) => m.includes(SKIP))).toBe(false);
    const placement = logs.info.find((m) => m.includes('system tables provisioned'));
    for (const name of OBJECTS) expect(placement).toContain(`${name}→sqlite`);
  });

  /** Construct under a given `OS_SKIP_SCHEMA_SYNC`, which `ObjectQLPlugin` reads in its constructor. */
  function withSkipEnv<T>(value: string | undefined, build: () => T): T {
    const previous = process.env.OS_SKIP_SCHEMA_SYNC;
    try {
      if (value === undefined) delete process.env.OS_SKIP_SCHEMA_SYNC;
      else process.env.OS_SKIP_SCHEMA_SYNC = value;
      return build();
    } finally {
      if (previous === undefined) delete process.env.OS_SKIP_SCHEMA_SYNC;
      else process.env.OS_SKIP_SCHEMA_SYNC = previous;
    }
  }

  /**
   * The value read is the one the REAL `ObjectQLPlugin` resolved and published
   * on its engine: the producer here is not a stand-in, so the undeclared
   * engine property both sides spell is pinned end to end. The last row
   * discriminates: an explicit `skipSchemaSync: false` beats
   * `OS_SKIP_SCHEMA_SYNC=1`, so a reader that consulted the environment itself
   * would skip there. `registerProtocol: false` only keeps protocol assembly,
   * which this fake context cannot host, out of `init()`.
   */
  it.each([
    { label: 'option true', option: true, env: undefined, skips: true },
    { label: 'option unset, OS_SKIP_SCHEMA_SYNC=1', option: undefined, env: '1', skips: true },
    { label: 'option unset, env unset', option: undefined, env: undefined, skips: false },
    { label: 'option false beats OS_SKIP_SCHEMA_SYNC=1', option: false, env: '1', skips: false },
  ])('real ObjectQLPlugin, $label ⇒ skips: $skips', async ({ option, env, skips }) => {
    const qlPlugin = withSkipEnv(env, () =>
      new ObjectQLPlugin({ registerProtocol: false, ...(option === undefined ? {} : { skipSchemaSync: option }) }),
    );
    const { ctx, logs, fireReady } = makeCtx(undefined);
    await qlPlugin.init(ctx);
    const engine = ctx.getService('objectql') as { syncObjectSchema(name: string): Promise<void> };
    const sync = vi.spyOn(engine, 'syncObjectSchema').mockResolvedValue(undefined);

    const plugin = new AuditPlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);
    await fireReady();

    const skip = logs.info.filter((m) => m.includes(SKIP));
    if (skips) {
      expect(sync).not.toHaveBeenCalled();
      expect(skip).toHaveLength(1);
    } else {
      for (const name of OBJECTS) expect(sync).toHaveBeenCalledWith(name);
      expect(skip).toEqual([]);
    }
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

  it('registers the sys_activity parent-record read middleware at kernel:ready', async () => {
    const { engine, middlewares } = makeGateEngine();
    const { ctx, fireReady } = makeCtx(engine);
    const plugin = new AuditPlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);
    await fireReady();

    expect(middlewares).toContainEqual({ object: 'sys_activity' });
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
