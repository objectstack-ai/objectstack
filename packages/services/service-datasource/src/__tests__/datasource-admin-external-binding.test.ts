// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { externalBindingDatasourceRefusal } from '@objectstack/spec/data';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { registerDatasourceAdminRoutes } from '../admin-routes.js';
import {
  DatasourceAdminService,
  type DatasourceAdminServiceConfig,
  type StoredDatasource,
} from '../datasource-admin-service.js';
import {
  ENTITLED_CREDENTIAL,
  createSessionAuthService,
  createGrantsEngine,
} from './entitled-caller.fixture.js';

/**
 * #25277 — ADR-0015 §4.2 at the datasource admin door.
 *
 * The metadata save door refuses a datasource saved or changed to `managed`
 * (or with no `schemaMode`, the spec default) while objects bind it with
 * `external`. `POST /api/v1/datasources` and `PATCH /api/v1/datasources/:name`
 * write the datasource without entering that door, so they stored the pair
 * the save door refuses: the runtime then skips the bound objects' DDL as
 * federated while the boot validation and the write gate judge them managed.
 *
 * Driven through the REAL routes over the REAL service. Each refusal pin reads
 * the envelope a caller sees (status + `error.code`), the bound objects the
 * message names, and the store behind it: nothing stored, registered or
 * minted. The expected message is the spec predicate's own for the same pair,
 * derived here, never restated.
 */

const authService = createSessionAuthService();
const grantsEngine = createGrantsEngine();

interface BoundObject {
  name: string;
  datasource?: string;
  external?: unknown;
}

/** In-memory datasource store, secret store and object set behind a real {@link DatasourceAdminService}. */
function makeDoor(opts: { seed?: StoredDatasource[]; objects?: BoundObject[] } = {}) {
  const records = new Map<string, StoredDatasource>((opts.seed ?? []).map((r) => [r.name, structuredClone(r)]));
  const secrets = new Map<string, string>();
  const objects = opts.objects ?? [];
  let seq = 0;
  const ops: string[] = [];

  const config: DatasourceAdminServiceConfig = {
    probe: async () => ({ ok: true, latencyMs: 1 }),
    listDatasourceRecords: async () => [...records.values()].map((r) => structuredClone(r)),
    getDatasourceRecord: async (name) => {
      const r = records.get(name);
      return r ? structuredClone(r) : undefined;
    },
    putDatasourceRecord: async (record) => {
      ops.push(`put:${record.name}`);
      records.set(record.name, structuredClone(record));
    },
    deleteDatasourceRecord: async (name) => {
      records.delete(name);
    },
    writeSecret: async (input, hint) => {
      ops.push('writeSecret');
      const ref = `sys_secret://datasource/${hint.name}#${++seq}`;
      secrets.set(ref, input.value);
      return ref;
    },
    removeSecret: async (ref) => {
      ops.push('removeSecret');
      secrets.delete(ref);
    },
    countBoundObjects: async (name) => objects.filter((o) => o.datasource === name).length,
    listObjectsBoundTo: async (name) =>
      objects.filter((o) => o.datasource === name).map((o) => ({ name: o.name, external: o.external })),
    registerPool: () => {
      ops.push('registerPool');
    },
    unregisterPool: () => {
      ops.push('unregisterPool');
    },
    reregisterPool: () => {
      ops.push('reregisterPool');
    },
  };

  const service = new DatasourceAdminService(config);
  const server = new HonoHttpServer(0);
  const ctx = {
    getService: vi.fn((name: string) =>
      name === 'auth'
        ? authService
        : name === 'objectql' || name === 'data'
          ? grantsEngine
          : name === 'datasource-admin'
            ? service
            : undefined,
    ),
  } as any;
  registerDatasourceAdminRoutes(server, ctx, '/api/v1');
  const app = server.getRawApp();

  const send = (method: string, path: string, body: unknown) =>
    app.fetch(
      new Request(`http://local/api/v1${path}`, {
        method,
        headers: { 'content-type': 'application/json', authorization: ENTITLED_CREDENTIAL },
        body: JSON.stringify(body),
      }),
    );

  return { send, records, secrets, ops };
}

/**
 * The spec predicate's message for `object` bound with `external` to a
 * datasource declared `declared`. Throws when the predicate makes no `managed`
 * refusal, so a pin can never pass on a premise the spec no longer holds.
 */
function predicateMessage(object: BoundObject, declared: { schemaMode?: unknown }): string {
  const refusal = externalBindingDatasourceRefusal(object.name, object.external, object.datasource, declared);
  if (refusal?.shape !== 'managed') throw new Error(`fixture premise broken: no managed refusal for '${object.name}'`);
  return `schemaMode: ${refusal.message}`;
}

async function expectRefusal(res: Response, expected: string[]): Promise<string> {
  expect(res.status).toBe(400);
  const body = (await res.json()) as { success: boolean; error: { code: string; message: string } };
  expect(body.success).toBe(false);
  expect(body.error.code).toBe('DATASOURCE_ADMIN_ERROR');
  for (const line of expected) expect(body.error.message).toContain(line);
  return body.error.message;
}

const PG = { database: 'analytics' };
const ORDERS: BoundObject = { name: 'wh_orders', datasource: 'wh', external: { remoteName: 'orders' } };
const ITEMS: BoundObject = { name: 'wh_items', datasource: 'wh', external: { remoteName: 'items' } };
/** Names `wh` as its datasource with no `external` binding: a managed object on it. */
const LOCAL: BoundObject = { name: 'wh_local', datasource: 'wh' };
/** Bound `external` to ANOTHER datasource: never part of `wh`'s verdict. */
const ELSEWHERE: BoundObject = { name: 'lake_events', datasource: 'lake', external: { remoteName: 'events' } };

describe('POST /api/v1/datasources refuses a managed datasource under objects bound external (#25277)', () => {
  it("refuses schemaMode 'managed' — nothing stored, registered or minted", async () => {
    const door = makeDoor({ objects: [ORDERS] });
    const res = await door.send('POST', '/datasources', {
      name: 'wh',
      driver: 'postgres',
      schemaMode: 'managed',
      config: PG,
      secret: 'any-secret',
    });

    const message = await expectRefusal(res, [predicateMessage(ORDERS, { schemaMode: 'managed' })]);
    expect(message.startsWith("Invalid datasource 'wh'.")).toBe(true);
    expect(door.records.size).toBe(0);
    expect(door.secrets.size).toBe(0);
    expect(door.ops).toEqual([]);
  });

  it('refuses no schemaMode (managed by the spec default)', async () => {
    const door = makeDoor({ objects: [ORDERS] });
    const res = await door.send('POST', '/datasources', { name: 'wh', driver: 'postgres', config: PG });

    await expectRefusal(res, [predicateMessage(ORDERS, {})]);
    expect(door.records.size).toBe(0);
    expect(door.ops).toEqual([]);
  });

  it('names every object bound external, and only those', async () => {
    const door = makeDoor({ objects: [ORDERS, ITEMS, LOCAL, ELSEWHERE] });
    const res = await door.send('POST', '/datasources', { name: 'wh', driver: 'postgres', config: PG });

    const message = await expectRefusal(res, [
      predicateMessage(ORDERS, {}),
      predicateMessage(ITEMS, {}),
    ]);
    expect(message).not.toContain("'wh_local'");
    expect(message).not.toContain("'lake_events'");
    expect(door.records.size).toBe(0);
  });

  it('control: the same POST with no object bound external is created', async () => {
    const door = makeDoor({ objects: [LOCAL, ELSEWHERE] });
    const res = await door.send('POST', '/datasources', { name: 'wh', driver: 'postgres', config: PG });

    expect(res.status).toBe(201);
    expect(door.records.get('wh')?.schemaMode).toBeUndefined();
    expect(door.ops).toEqual(['put:wh', 'registerPool']);
  });

  it.each(['external', 'validate-only'] as const)(
    "control: a federated datasource (schemaMode '%s') under objects bound external is created",
    async (schemaMode) => {
      const door = makeDoor({ objects: [ORDERS] });
      const res = await door.send('POST', '/datasources', {
        name: 'wh',
        driver: 'postgres',
        schemaMode,
        config: PG,
        external: {},
      });

      expect(res.status).toBe(201);
      expect(door.records.get('wh')?.schemaMode).toBe(schemaMode);
    },
  );
});

describe('PATCH /api/v1/datasources/:name refuses making a bound datasource managed (#25277)', () => {
  const federated = (): StoredDatasource => ({
    name: 'wh',
    driver: 'postgres',
    origin: 'runtime',
    schemaMode: 'external',
    config: PG,
    external: {},
  });

  it("refuses schemaMode 'managed' — record, pool and secrets untouched", async () => {
    const door = makeDoor({ seed: [federated()], objects: [ORDERS, ITEMS] });
    const before = structuredClone(door.records.get('wh'));

    const res = await door.send('PATCH', '/datasources/wh', { schemaMode: 'managed', secret: 'rotated' });

    await expectRefusal(res, [
      predicateMessage(ORDERS, { schemaMode: 'managed' }),
      predicateMessage(ITEMS, { schemaMode: 'managed' }),
    ]);
    expect(door.records.get('wh')).toEqual(before);
    expect(door.secrets.size).toBe(0);
    expect(door.ops).toEqual([]);
  });

  it('control: the same PATCH with no object bound external is applied', async () => {
    const door = makeDoor({ seed: [federated()], objects: [LOCAL, ELSEWHERE] });
    const res = await door.send('PATCH', '/datasources/wh', { schemaMode: 'managed' });

    expect(res.status).toBe(200);
    expect(door.records.get('wh')?.schemaMode).toBe('managed');
  });

  it("control: a federated PATCH (schemaMode 'validate-only') under objects bound external is applied", async () => {
    const door = makeDoor({ seed: [federated()], objects: [ORDERS] });
    const res = await door.send('PATCH', '/datasources/wh', { schemaMode: 'validate-only' });

    expect(res.status).toBe(200);
    expect(door.records.get('wh')?.schemaMode).toBe('validate-only');
  });

  it('refuses a config edit on a managed row that objects already bind external', async () => {
    const managed: StoredDatasource = { name: 'wh', driver: 'postgres', origin: 'runtime', config: PG };
    const door = makeDoor({ seed: [managed], objects: [ORDERS] });

    const res = await door.send('PATCH', '/datasources/wh', { config: { database: 'warehouse' } });

    await expectRefusal(res, [predicateMessage(ORDERS, {})]);
    expect(door.records.get('wh')).toEqual(managed);
    expect(door.ops).toEqual([]);
  });

  it('control: a label/active-only PATCH on that row is applied, so it can still be taken out of service', async () => {
    const managed: StoredDatasource = { name: 'wh', driver: 'postgres', origin: 'runtime', config: PG };
    const door = makeDoor({ seed: [managed], objects: [ORDERS] });

    const res = await door.send('PATCH', '/datasources/wh', { label: 'Warehouse', active: false });

    expect(res.status).toBe(200);
    expect(door.records.get('wh')).toMatchObject({ label: 'Warehouse', active: false });
  });
});
