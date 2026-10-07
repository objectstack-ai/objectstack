// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21913] The runtime-datasource persistence this package owns carries the
 * explicit system opt-in (`isSystem: true`) on every engine call:
 *
 *  - the `sys_metadata` helpers behind `DatasourceAdminServicePlugin` —
 *    `persistDatasourceRow` (existence probe + insert, or probe + update),
 *    `deleteDatasourceRow` (probe + delete), `loadDatasourceRows` (boot
 *    restore) and `loadDatasourceRow` (cluster convergence);
 *  - the `sys_secret` binder — `bind` (insert), `unbind` (delete) and
 *    `resolve` (read).
 *
 * They used to reach the data engine with no context at all — no principal
 * and no system opt-in — and passed the security middleware only through its
 * principal-less hand-off (ADR-0096 E1), which D5 closes. The helpers are
 * module-private, so they are driven through the plugin's own doors; the
 * convergence read is reached through `convergePool`, the receive half of the
 * cluster bridge, called directly because a pin about the read it makes does
 * not need a second replica.
 */

import { describe, it, expect } from 'vitest';
import type { CryptoContext, CryptoHandle, ICryptoProvider } from '@objectstack/spec/contracts';
import { DatasourceAdminServicePlugin } from '../datasource-admin-plugin.js';
import { createDatasourceSecretBinder } from '../datasource-secret-binder.js';
import {
  assertEngineDeleteDispatch,
  assertEngineFindOnePredicate,
  assertEngineUpdateDispatch,
} from '@objectstack/metadata-core';
// Pay the dist-resolved spec subpath's first transform at module load, as the
// sibling plugin suite does (`check-test-source-alias`, clocked-window rule).
import '@objectstack/spec/kernel';

type Call = { verb: string; object: string; context: unknown };

/** An in-memory store that records the context each engine call carried. */
function recordingStore() {
  const rows: Array<Record<string, unknown>> = [];
  const calls: Call[] = [];
  const ctxOf = (query: any, options: any) => options?.context ?? query?.context;
  const match = (r: Record<string, unknown>, w: Record<string, unknown> = {}) =>
    Object.entries(w).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`recording store: unsupported operator ${k}`);
      return r[k] === v;
    });
  return {
    rows,
    calls,
    registerDriver() {},
    registerDatasourceDef() {},
    getDriverByName() { return undefined; },
    async findOne(object: string, query: any, options?: any) {
      assertEngineFindOnePredicate(object, query);
      calls.push({ verb: 'findOne', object, context: ctxOf(query, options) });
      return rows.find((r) => match(r, query?.where)) ?? null;
    },
    async find(object: string, query: any, options?: any) {
      calls.push({ verb: 'find', object, context: ctxOf(query, options) });
      const hits = rows.filter((r) => match(r, query?.where));
      return typeof query?.limit === 'number' ? hits.slice(0, query.limit) : hits;
    },
    async insert(object: string, row: Record<string, unknown>, options?: any) {
      calls.push({ verb: 'insert', object, context: options?.context });
      rows.push({ ...row });
      return row;
    },
    async update(object: string, row: Record<string, unknown>, options?: any) {
      assertEngineUpdateDispatch(row, options);
      calls.push({ verb: 'update', object, context: options?.context });
      const i = rows.findIndex((r) => r.id === options?.where?.id);
      if (i >= 0) rows[i] = { ...rows[i], ...row };
      return 1;
    },
    async delete(object: string, options?: any) {
      assertEngineDeleteDispatch(options);
      calls.push({ verb: 'delete', object, context: options?.context });
      const i = rows.findIndex((r) => r.id === options?.where?.id);
      if (i >= 0) rows.splice(i, 1);
      return true;
    },
  };
}

function expectAllSystem(calls: Call[]): void {
  for (const call of calls) {
    expect(call.context, `${call.verb} on ${call.object}`).toEqual({ isSystem: true });
  }
}

async function boot(data: ReturnType<typeof recordingStore>) {
  const registry = new Map<string, Map<string, unknown>>();
  const metadata = {
    get: async (t: string, n: string) => registry.get(t)?.get(n),
    list: async (t: string) => [...(registry.get(t)?.values() ?? [])],
    register: async (t: string, n: string, d: unknown) => {
      if (!registry.has(t)) registry.set(t, new Map());
      registry.get(t)!.set(n, d);
    },
    unregister: async (t: string, n: string) => { registry.get(t)?.delete(n); },
    listObjects: async () => [...(registry.get('object')?.values() ?? [])],
  };
  const services: Record<string, unknown> = { metadata, data };
  let service: any;
  const ctx: any = {
    getService: (name: string) => {
      if (name in services) return services[name];
      throw new Error(`no service ${name}`);
    },
    registerService: (name: string, svc: unknown) => { if (name === 'datasource-admin') service = svc; },
    trigger: async () => {},
    logger: { warn() {}, info() {}, error() {}, debug() {} },
  };
  const plugin = new DatasourceAdminServicePlugin({});
  await plugin.init(ctx);
  return { plugin, ctx, service };
}

describe('[#21913] runtime-datasource sys_metadata helpers carry the explicit system opt-in', () => {
  it('persist (insert and update branches), boot restore, convergence read and delete', async () => {
    const data = recordingStore();
    const first = await boot(data);
    await first.service.createDatasource({ name: 'pin_ds', driver: 'sqlite', active: false, config: { filename: '/tmp/pin.db' } });
    await first.service.updateDatasource('pin_ds', { label: 'Pin' });

    // A "restart" over the same store: start() restores runtime rows from it.
    const second = await boot(data);
    await second.plugin.start(second.ctx);
    expect((await second.service.listDatasources()).map((d: any) => d.name)).toContain('pin_ds');
    await (second.plugin as any).convergePool(second.ctx, 'pin_ds', () => data);

    await second.service.removeDatasource('pin_ds');
    expect(data.rows.some((r) => r.name === 'pin_ds')).toBe(false);

    const onMetadata = data.calls.filter((c) => c.object === 'sys_metadata');
    // The population first: every helper this pin names actually ran.
    const verbs = onMetadata.map((c) => c.verb);
    expect(verbs.filter((v) => v === 'insert')).toHaveLength(1);
    expect(verbs.filter((v) => v === 'update')).toHaveLength(1);
    expect(verbs.filter((v) => v === 'delete')).toHaveLength(1);
    expect(verbs.filter((v) => v === 'find').length).toBeGreaterThanOrEqual(1);
    expect(verbs.filter((v) => v === 'findOne').length).toBeGreaterThanOrEqual(4);
    expect(onMetadata).toHaveLength(data.calls.length);
    expectAllSystem(onMetadata);
  });
});

describe('[#21913] the sys_secret binder carries the explicit system opt-in', () => {
  it('bind, resolve and unbind', async () => {
    const data = recordingStore();
    const crypto: ICryptoProvider = {
      async encrypt(plain: string, ctx: CryptoContext): Promise<CryptoHandle> {
        return { id: `sec_${ctx.key}`, kmsKeyId: 'k', alg: 'a', version: 1, ciphertext: plain };
      },
      async decrypt(handle: CryptoHandle): Promise<string> { return handle.ciphertext; },
      async rotateKey(handle: CryptoHandle): Promise<CryptoHandle> { return handle; },
      digest: (plain: string) => `sha256:${plain}`,
      keyedDigest: async (plain: string) => `k:${plain.length}`,
    };
    const binder = createDatasourceSecretBinder({ engine: data as any, cryptoProvider: crypto });

    const ref = await binder.bind({ value: 's3cret' }, { name: 'pin_ds' });
    expect(await binder.resolve(ref)).toBe('s3cret');
    await binder.unbind(ref);

    expect(data.calls.map((c) => `${c.verb}:${c.object}`)).toEqual([
      'insert:sys_secret',
      'find:sys_secret',
      'delete:sys_secret',
    ]);
    expectAllSystem(data.calls);
  });
});
