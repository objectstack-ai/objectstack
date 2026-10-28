// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22801 → A, C3 stage 6b-2] Every landed `permission` mutation derives the
 * `everyone` anchor again, off `onMetadataMutation` (the publish materializer
 * it rode retired with the seeder, ADR-0131 D3). Pinned at the wiring: which
 * events re-derive, and that a bootstrap re-run never adds a second listener.
 * What a derivation declares is U2's own suite.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { assertEngineFindOnePredicate, assertEngineUpdateDispatch, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
import { SecurityPlugin } from './security-plugin.js';

afterEach(() => { vi.restoreAllMocks(); });

type MutationListener = (evt: { type: string; name: string; state: 'active' | 'draft' | 'deleted' }) => void;

/** Field equality plus `$in`; anything else is REFUSED, never read as "no rows". */
function rowMatches(row: any, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k.startsWith('$')) throw new Error(`this double cannot answer '${k}'`);
    const actual = row?.[k] ?? null;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const ops = Object.keys(v as Record<string, unknown>);
      if (ops.length === 1 && ops[0] === '$in') return ((v as any).$in as unknown[]).some((m) => (m ?? null) === actual);
      throw new Error(`this double cannot answer ${JSON.stringify(ops)}`);
    }
    return actual === (v ?? null);
  });
}

/** Boot the real plugin over an in-memory engine, with a protocol that exposes the mutation signal. */
async function boot() {
  const tables: Record<string, any[]> = {};
  const ql: any = {
    registerMiddleware: () => {},
    // Only the identity objects the plugin's boot gate requires.
    getSchema: (name: string) => (name === 'sys_user' || name === 'sys_member' ? { name, fields: {} } : undefined),
    registry: { listItems: () => [] },
    find: async (object: string, opts?: any) => {
      const matched = (tables[object] ?? []).filter((r) => rowMatches(r, opts?.where ?? {}));
      // The caller's bound, by presence, after the filter (`check:objectql-double-limit`).
      return (typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched).map((r) => ({ ...r }));
    },
    findOne: async (object: string, query?: EngineFindOneQueryInput) => { assertEngineFindOnePredicate(object, query); return null; },
    count: async () => 0,
    insert: async (object: string, data: any) => {
      const row = { id: data?.id ?? `${object}_${(tables[object] ?? []).length + 1}`, ...data };
      (tables[object] ??= []).push(row);
      return { ...row };
    },
    update: async (_object: string, data: any, options?: any) => { assertEngineUpdateDispatch(data, options); return 0; },
  };
  const listeners: MutationListener[] = [];
  const protocol = {
    // Present so the projection wiring adds no listener of its own.
    registerMutationProjector: vi.fn(),
    onMetadataMutation: (listener: MutationListener) => { listeners.push(listener); return () => {}; },
  };
  const services: Record<string, any> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    metadata: { get: async () => null, list: async () => [] },
    protocol,
  };
  const hook = vi.fn();
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => { if (!(name in services)) throw new Error(`no service: ${name}`); return services[name]; },
    hook,
  };
  const derive = vi.spyOn(SecurityPlugin.prototype as any, 'declareEveryone').mockResolvedValue(undefined);
  const plugin = new SecurityPlugin();
  await plugin.init(ctx);
  await plugin.start(ctx);
  // [#26596, #26698] `start()` itself subscribes the metadata-derived cache
  // invalidation; the listeners this suite pins are the ones the bootstrap
  // adds after it, at `kernel:ready`.
  const atStart = listeners.length;
  const bootstrapListeners = () => listeners.slice(atStart);
  const fire = async (event: string) => {
    for (const [, cb] of hook.mock.calls.filter((c: any[]) => c[0] === event)) await cb();
  };
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
  return { ctx, fire, settle, bootstrapListeners, derive };
}

describe('[#22801 → A] a landed permission mutation re-derives everyone', () => {
  it('registers ONE listener, and a bootstrap re-run never adds a second', async () => {
    const { ctx, fire, bootstrapListeners } = await boot();
    await fire('kernel:ready');
    // Positive control: the bootstrap really completed.
    expect(ctx.logger.info.mock.calls.filter((c: any[]) => String(c[0]).includes('platform bootstrap complete'))).toHaveLength(1);
    expect(bootstrapListeners()).toHaveLength(1);
    await fire('kernel:ready');
    expect(bootstrapListeners()).toHaveLength(1);
  });

  it('a published or deleted permission derives everyone again — whatever the body said', async () => {
    const { fire, settle, bootstrapListeners, derive } = await boot();
    await fire('kernel:ready');
    const listeners = bootstrapListeners();
    const before = derive.mock.calls.length;

    listeners[0]!({ type: 'permission', name: 'crm_sales_user', state: 'active' });
    await settle();
    expect(derive.mock.calls.length - before).toBe(1);

    listeners[0]!({ type: 'permission', name: 'crm_sales_user', state: 'deleted' });
    await settle();
    expect(derive.mock.calls.length - before).toBe(2);
  });

  it('a draft, or a mutation of another type, derives nothing', async () => {
    const { fire, settle, bootstrapListeners, derive } = await boot();
    await fire('kernel:ready');
    const listeners = bootstrapListeners();
    const before = derive.mock.calls.length;

    listeners[0]!({ type: 'permission', name: 'crm_sales_user', state: 'draft' });
    listeners[0]!({ type: 'position', name: 'sales_rep', state: 'active' });
    listeners[0]!({ type: 'object', name: 'crm_lead', state: 'active' });
    await settle();
    expect(derive.mock.calls.length - before).toBe(0);
  });
});
