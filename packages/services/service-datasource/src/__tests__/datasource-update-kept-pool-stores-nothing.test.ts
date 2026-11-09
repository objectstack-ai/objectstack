// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #29879 — a datasource PATCH whose new configuration fails to connect
 * answers that the previous pool was kept and the new configuration is NOT in
 * force; nothing of the new configuration may then be stored, so the next
 * restart connects the configuration that was serving.
 *
 * The defect: `updateDatasource` stored the merged record, repointed
 * `external.credentialsRef` at the newly sealed secret and removed the
 * working one BEFORE the rebuild. The rebuild failed and the previous pool
 * kept serving, so the answer read "nothing changed", but the restart read
 * the failing credential and the datasource could no longer connect, with
 * the working credential already gone.
 *
 * The rig boots the REAL `DatasourceAdminServicePlugin` and
 * `ExternalDatasourceServicePlugin` behind the REAL admin routes, with the
 * REAL `sys_secret` binder, over one in-memory store (`sys_metadata` and
 * `sys_secret`) that outlives a boot. A restart is a second boot over the
 * same store: fresh registries, fresh pools, the stored rows only. The
 * driver factory's pool connects only with the database's real password,
 * the one fact a wrong secret changes.
 */

import { describe, it, expect, vi } from 'vitest';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import {
  assertEngineDeleteDispatch,
  assertEngineFindOnePredicate,
  assertEngineUpdateDispatch,
  walledCatalogWriteVerdict,
} from '@objectstack/metadata-core';
import type { CryptoContext, CryptoHandle, ICryptoProvider, IDataDriver } from '@objectstack/spec/contracts';
import { DatasourceAdminServicePlugin } from '../datasource-admin-plugin.js';
import { ExternalDatasourceServicePlugin } from '../plugin.js';
import { registerDatasourceAdminRoutes } from '../admin-routes.js';
import { createDatasourceSecretBinder } from '../datasource-secret-binder.js';
import type { IDatasourceDriverFactory, DatasourceConnectionSpec } from '../contracts/datasource-driver-factory.js';
import { ENTITLED_CREDENTIAL, createSessionAuthService, createGrantsEngine } from './entitled-caller.fixture.js';
// Pay the first transform of the dist-resolved driver at module load, not
// inside a clocked `it()` (see `scripts/check-test-source-alias.mjs`).
import '@objectstack/driver-sql';
// This suite hands the admin plugin its own driver factory, so the default
// factory's `memory` arm is never called. The mock answers its static reach
// without loading the in-memory driver (scripts/driver-memory-census.ledger.json).
vi.mock('@objectstack/driver-memory', () => ({
  InMemoryDriver: class {
    constructor() {
      throw new Error('the in-memory driver is not used by this suite');
    }
  },
}));

type Row = Record<string, unknown>;

/** The database's real password: the only secret its pool connects with. */
const REAL_PASSWORD = 'placeholder-real-password';
const WRONG_PASSWORD = 'placeholder-wrong-password';
const NEW_PASSWORD = 'placeholder-new-password';

/** The store a restart keeps: `sys_metadata` and `sys_secret`, by table. */
function makeStore() {
  return { tables: new Map<string, Row[]>(), seq: 0 };
}
type Store = ReturnType<typeof makeStore>;

function rowsOf(store: Store, table: string): Row[] {
  if (!store.tables.has(table)) store.tables.set(table, []);
  return store.tables.get(table)!;
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k.startsWith('$')) throw new Error(`fake engine: unsupported operator ${k}`);
    if (v === undefined) continue;
    if (row[k] !== v) return false;
  }
  return true;
}

/** AAD-binding crypto double, a fresh handle id per seal (as the shipped provider mints). */
function fakeCrypto(store: Store): ICryptoProvider {
  const aadOf = (ctx: CryptoContext) => JSON.stringify([ctx.scope, ctx.namespace, ctx.key]);
  return {
    async encrypt(plain: string, ctx: CryptoContext): Promise<CryptoHandle> {
      return {
        id: `sec_${++store.seq}`,
        kmsKeyId: 'local:test:v1',
        alg: 'aes-256-gcm',
        version: 1,
        ciphertext: Buffer.from(JSON.stringify([aadOf(ctx), plain]), 'utf8').toString('base64'),
      };
    },
    async decrypt(handle: CryptoHandle, ctx: CryptoContext): Promise<string> {
      const [aad, plain] = JSON.parse(Buffer.from(handle.ciphertext, 'base64').toString('utf8'));
      if (aad !== aadOf(ctx)) throw new Error('AAD mismatch');
      return plain;
    },
    async rotateKey(handle: CryptoHandle): Promise<CryptoHandle> {
      return handle;
    },
    digest: (plain: string) => `sha256:${plain.length}`,
    keyedDigest: async (plain: string) => `k:${plain.length}`,
  };
}

/** A pool: it connects only to database `qa` with the real password; its health is its connection. */
function passwordFactory(): IDatasourceDriverFactory & { built: string[] } {
  const built: string[] = [];
  return {
    built,
    supports: () => true,
    create: async (spec: DatasourceConnectionSpec) => {
      built.push(spec.secret ?? '');
      let connected = false;
      const driver = {
        name: 'com.fake.postgres',
        checkHealth: async () => connected,
        disconnect: async () => {
          connected = false;
        },
      };
      return {
        driver: driver as unknown as IDataDriver,
        connect: async () => {
          if ((spec.config as { database?: unknown })?.database !== 'qa') throw new Error('database does not exist');
          if (spec.secret !== REAL_PASSWORD) throw new Error('password authentication failed');
          connected = true;
        },
      };
    },
  };
}

/**
 * One boot over `store`: the real plugins, the real routes, a driver registry of its own.
 * `tenancy` registers a `tenancy` service answering that posture (none by default).
 */
async function boot(store: Store, options: { tenancy?: 'single' | 'group' | 'isolated' } = {}) {
  const drivers = new Map<string, IDataDriver>();
  const data = {
    findOne: async (table: string, q: { where: Record<string, unknown> }) => {
      assertEngineFindOnePredicate(table, q);
      return rowsOf(store, table).find((r) => matches(r, q.where)) ?? null;
    },
    find: async (table: string, q?: { where?: Record<string, unknown>; limit?: number }) => {
      const all = rowsOf(store, table).filter((r) => matches(r, q?.where ?? {}));
      return typeof q?.limit === 'number' ? all.slice(0, q.limit) : all;
    },
    insert: async (table: string, row: Row) => {
      const stored = { ...row, id: row.id ?? `r_${++store.seq}` };
      rowsOf(store, table).push(stored);
      return { id: stored.id };
    },
    update: async (table: string, row: Row, q: { where: Record<string, unknown> }) => {
      assertEngineUpdateDispatch(row, q);
      for (const r of rowsOf(store, table)) if (matches(r, q.where)) Object.assign(r, row);
      return {};
    },
    delete: async (table: string, q: { where: Record<string, unknown> }) => {
      assertEngineDeleteDispatch(q);
      const rows = rowsOf(store, table);
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], q.where)) rows.splice(i, 1);
      return { deleted: before - rows.length };
    },
    registerDriver: (driver: IDataDriver) => {
      if (!drivers.has(driver.name)) drivers.set(driver.name, driver);
    },
    unregisterDriver: (name: string) => drivers.delete(name),
    getDriverByName: (name: string) => drivers.get(name),
    registerDatasourceDef: () => {},
    markDatasourceUnavailable: () => {},
    clearDatasourceUnavailable: () => {},
  };

  const registry = new Map<string, Map<string, unknown>>();
  const metadata = {
    get: async (t: string, n: string) => registry.get(t)?.get(n),
    list: async (t: string) => [...(registry.get(t)?.values() ?? [])],
    register: async (t: string, n: string, d: unknown) => {
      if (!registry.has(t)) registry.set(t, new Map());
      registry.get(t)!.set(n, d);
    },
    unregister: async (t: string, n: string) => {
      registry.get(t)?.delete(n);
    },
    listObjects: async () => [],
  };

  const services = new Map<string, unknown>([
    ['data', data],
    ['metadata', metadata],
    ['auth', createSessionAuthService()],
    // The routes resolve the caller's grants from `objectql` first.
    ['objectql', createGrantsEngine()],
    ...(options.tenancy ? [['tenancy', { posture: options.tenancy }] as [string, unknown]] : []),
  ]);
  const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };
  const ctx: any = {
    getService: (name: string) => {
      if (services.has(name)) return services.get(name);
      throw new Error(`no service ${name}`);
    },
    registerService: (name: string, svc: unknown) => {
      services.set(name, svc);
    },
    trigger: async () => {},
    logger,
  };

  const secrets = createDatasourceSecretBinder({ engine: data as never, cryptoProvider: fakeCrypto(store) });
  const factory = passwordFactory();
  const admin = new DatasourceAdminServicePlugin({ driverFactory: factory, secrets, logger });
  const external = new ExternalDatasourceServicePlugin();
  await admin.init(ctx);
  await external.init(ctx);
  await admin.start(ctx);
  await external.start(ctx);

  const server = new HonoHttpServer(0);
  registerDatasourceAdminRoutes(server, ctx, '/api/v1');
  const app = server.getRawApp();
  const send = async (method: string, path: string, body?: unknown) => {
    const res = await app.fetch(
      new Request(`http://local/api/v1${path}`, {
        method,
        headers: { 'content-type': 'application/json', authorization: ENTITLED_CREDENTIAL },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    return { status: res.status, body: (await res.json()) as any };
  };
  return { send, factory, logger };
}

const CREATE = {
  name: 'r7pg3',
  driver: 'postgres',
  schemaMode: 'external',
  external: {},
  config: { host: '127.0.0.1', port: 5432, database: 'qa', username: 'qa' },
};

/** The stored datasource record and the `sys_secret` ids, as a restart will read them. */
function atRest(store: Store) {
  const row = rowsOf(store, 'sys_metadata').find((r) => r.type === 'datasource' && r.name === CREATE.name);
  return {
    record: row ? JSON.parse(String(row.metadata)) : undefined,
    secretIds: rowsOf(store, 'sys_secret').map((r) => r.id).sort(),
  };
}

async function created(store: Store) {
  const first = await boot(store);
  const res = await first.send('POST', '/datasources', { ...CREATE, secret: REAL_PASSWORD });
  expect({ status: res.status, dsStatus: res.body.data?.datasource?.status }).toEqual({ status: 201, dsStatus: 'ok' });
  return first;
}

describe('PATCH /api/v1/datasources/:name — a new secret that fails to connect (#29879)', () => {
  it('answers NOT in force, stores nothing of it, and the restart still connects', async () => {
    const store = makeStore();
    const first = await created(store);
    const before = atRest(store);
    expect(before.record.external.credentialsRef).toMatch(/^sys_secret:/);
    expect(before.secretIds).toHaveLength(1);

    const res = await first.send('PATCH', `/datasources/${CREATE.name}`, {
      secret: WRONG_PASSWORD,
      label: 'Renamed in the same patch',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.datasource.status).toBe('error');
    expect(res.body.data.datasource.statusReason).toContain('the new configuration is NOT in force');

    // Nothing of the patch is at rest: not the new binding, not the other key,
    // and the secret sealed for it is gone again.
    expect(atRest(store)).toEqual(before);
    // The kept pool still serves.
    expect((await first.send('POST', `/datasources/${CREATE.name}/test`)).body.data).toMatchObject({ ok: true });

    const restarted = await boot(store);
    expect((await restarted.send('POST', `/datasources/${CREATE.name}/test`)).body.data).toMatchObject({ ok: true });
    expect(restarted.factory.built).toEqual([REAL_PASSWORD]);
  });

  it('the same for a failing config change: the stored config is the one serving', async () => {
    const store = makeStore();
    const first = await created(store);
    const before = atRest(store);

    const res = await first.send('PATCH', `/datasources/${CREATE.name}`, {
      config: { ...CREATE.config, database: 'qa_other' },
    });
    expect(res.body.data.datasource.statusReason).toContain('the new configuration is NOT in force');
    expect(atRest(store)).toEqual(before);
    expect((await boot(store)).factory.built).toEqual([REAL_PASSWORD]);
  });

  it('control: a secret that connects is in force and stored, and the one it replaces is retired', async () => {
    const store = makeStore();
    const first = await created(store);
    const before = atRest(store);

    const res = await first.send('PATCH', `/datasources/${CREATE.name}`, { secret: REAL_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.datasource.status).toBe('ok');

    const after = atRest(store);
    expect(after.record.external.credentialsRef).not.toBe(before.record.external.credentialsRef);
    expect(after.secretIds).toHaveLength(1);
    expect(after.secretIds).not.toEqual(before.secretIds);

    const restarted = await boot(store);
    expect((await restarted.send('POST', `/datasources/${CREATE.name}/test`)).body.data).toMatchObject({ ok: true });
  });

  it('a second failing PATCH after a first stores nothing either', async () => {
    // The first leaves the previous pool serving under a FAILED verdict, so
    // "kept" cannot be read off the verdict the rebuild started from.
    const store = makeStore();
    const first = await created(store);
    const before = atRest(store);
    for (const secret of [WRONG_PASSWORD, NEW_PASSWORD]) {
      const res = await first.send('PATCH', `/datasources/${CREATE.name}`, { secret });
      expect(res.body.data.datasource.statusReason).toContain('the new configuration is NOT in force');
    }
    expect(atRest(store)).toEqual(before);
    expect((await boot(store)).factory.built).toEqual([REAL_PASSWORD]);
  });
});

// [ADR-0131 D3 · D12 items 7–8 · D11] Under a walled tenancy posture a datasource
// write is the platform operator's. The entitled caller holds the capability and
// is not the operator, so the PATCH is refused before the service runs: the
// stored record, the bound secret and the serving pool are the ones it found.
describe.each(['isolated', 'group'] as const)('PATCH /api/v1/datasources/:name under `%s`, by a caller below the platform operator', (posture) => {
  it('is refused with the walled-catalog verdict, and the stored record and the pool are untouched', async () => {
    const store = makeStore();
    // Created before the wall stands, by the same caller: the record a walled
    // deployment carries from the posture it ran before.
    await created(store);
    const before = atRest(store);
    const walled = await boot(store, { tenancy: posture });
    // The restart's pool is the only one this boot builds before the PATCH.
    expect((await walled.send('POST', `/datasources/${CREATE.name}/test`)).body.data).toMatchObject({ ok: true });
    const builtBefore = [...walled.factory.built];

    const res = await walled.send('PATCH', `/datasources/${CREATE.name}`, {
      secret: REAL_PASSWORD,
      config: { ...CREATE.config, host: '10.0.0.9' },
    });
    const verdict = walledCatalogWriteVerdict({ type: 'datasource', tenancyPosture: posture });
    expect(verdict.allowed).toBe(false);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
    expect(res.body.error.message).toBe(verdict.allowed ? undefined : verdict.message);

    expect(atRest(store)).toEqual(before);
    expect(walled.factory.built).toEqual(builtBefore);
    expect((await walled.send('POST', `/datasources/${CREATE.name}/test`)).body.data).toMatchObject({ ok: true });
    expect(walled.factory.built).toEqual(builtBefore);
  });

  it('control: the same PATCH under `single` rebuilds the pool and stores the new configuration', async () => {
    const store = makeStore();
    await created(store);
    const before = atRest(store);
    const single = await boot(store, { tenancy: 'single' });
    expect((await single.send('POST', `/datasources/${CREATE.name}/test`)).body.data).toMatchObject({ ok: true });
    const builtBefore = single.factory.built.length;

    const res = await single.send('PATCH', `/datasources/${CREATE.name}`, {
      secret: REAL_PASSWORD,
      config: { ...CREATE.config, host: '10.0.0.9' },
    });
    expect(res.status).toBe(200);
    expect(atRest(store).record.config.host).toBe('10.0.0.9');
    expect(atRest(store)).not.toEqual(before);
    expect(single.factory.built.length).toBe(builtBefore + 1);
  });
});
