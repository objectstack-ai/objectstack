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
  const logger = {
    info() {}, warn() {}, error() {}, debug() {},
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
  return { ctx, fireReady: async () => { for (const fn of readyHooks) await fn(); } };
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
