// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
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
 * An unknown datasource name answers the SAME `404 RESOURCE_NOT_FOUND` at
 * every `datasource-admin` door that takes `:name`.
 *
 * `GET /datasources/:name` already answered 404 for a name that resolves no
 * stored datasource, while `PATCH`, `DELETE` and `POST …/migrate-credential`
 * answered the identical name `400 DATASOURCE_ADMIN_ERROR` — the service threw
 * a plain `Error` and the route rendered every plain throw as a malformed
 * request. An SDK or AI caller could not tell "no such datasource" from "your
 * request was refused".
 *
 * Driven through the REAL routes over the REAL service, so each pin reads the
 * envelope a caller sees, and the parity case reads all four doors side by
 * side: a future door that diverges from its siblings fails here, not in QA.
 */

const authService = createSessionAuthService();
const grantsEngine = createGrantsEngine();

const WAREHOUSE: StoredDatasource = {
  name: 'warehouse',
  driver: 'sqlite',
  origin: 'runtime',
  config: { filename: ':memory:' },
};

function makeDoor(seed: StoredDatasource[] = [WAREHOUSE]) {
  const records = new Map<string, StoredDatasource>(seed.map((r) => [r.name, structuredClone(r)]));
  const writes: string[] = [];
  const config: DatasourceAdminServiceConfig = {
    probe: async () => ({ ok: true, latencyMs: 1 }),
    listDatasourceRecords: async () => [...records.values()].map((r) => structuredClone(r)),
    getDatasourceRecord: async (name) => {
      const r = records.get(name);
      return r ? structuredClone(r) : undefined;
    },
    putDatasourceRecord: async (record) => {
      writes.push(`put:${record.name}`);
      records.set(record.name, structuredClone(record));
    },
    deleteDatasourceRecord: async (name) => {
      writes.push(`delete:${name}`);
      records.delete(name);
    },
    writeSecret: async () => {
      writes.push('writeSecret');
      return 'sys_secret://datasource/x#1';
    },
    removeSecret: async () => {
      writes.push('removeSecret');
    },
    countBoundObjects: async () => 0,
    listObjectsBoundTo: async () => [],
    registerPool: () => {},
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

  const send = (method: string, path: string, body?: unknown) =>
    app.fetch(
      new Request(`http://local/api/v1${path}`, {
        method,
        headers: { 'content-type': 'application/json', authorization: ENTITLED_CREDENTIAL },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );

  return { send, records, writes };
}

/** Every `datasource-admin` door that takes `:name`, the read sibling first. */
const BY_NAME_DOORS: ReadonlyArray<{ door: string; method: string; path: (name: string) => string; body?: unknown }> = [
  { door: 'GET /datasources/:name', method: 'GET', path: (n) => `/datasources/${n}` },
  { door: 'PATCH /datasources/:name', method: 'PATCH', path: (n) => `/datasources/${n}`, body: { config: {} } },
  { door: 'DELETE /datasources/:name', method: 'DELETE', path: (n) => `/datasources/${n}` },
  { door: 'POST /datasources/:name/migrate-credential', method: 'POST', path: (n) => `/datasources/${n}/migrate-credential`, body: {} },
];

describe('an unknown datasource name is 404 RESOURCE_NOT_FOUND at every by-name admin door', () => {
  for (const d of BY_NAME_DOORS) {
    it(`${d.door} → 404 RESOURCE_NOT_FOUND naming the datasource, nothing written`, async () => {
      const door = makeDoor();
      const res = await door.send(d.method, d.path('no_such_ds'), d.body);
      const body = (await res.json()) as { success: boolean; error: { code: string; message: string } };

      expect({ status: res.status, success: body.success, code: body.error.code }).toEqual({
        status: 404,
        success: false,
        code: 'RESOURCE_NOT_FOUND',
      });
      expect(body.error.message).toContain('no_such_ds');
      expect(door.writes).toEqual([]);
      expect([...door.records.keys()]).toEqual(['warehouse']);
    });
  }

  it('all four doors give one answer for the same unknown name — the sibling read is the reference', async () => {
    const door = makeDoor();
    const answers: Array<{ door: string; status: number; code: string }> = [];
    for (const d of BY_NAME_DOORS) {
      const res = await door.send(d.method, d.path('no_such_ds'), d.body);
      const body = (await res.json()) as { error: { code: string } };
      answers.push({ door: d.door, status: res.status, code: body.error.code });
    }
    const [reference] = answers;
    expect(reference).toMatchObject({ status: 404, code: 'RESOURCE_NOT_FOUND' });
    for (const a of answers) {
      expect({ status: a.status, code: a.code }, a.door).toEqual({ status: reference.status, code: reference.code });
    }
  });

  it('control: a datasource that exists is still patched, and a code-defined one is still refused 400', async () => {
    const door = makeDoor([WAREHOUSE, { name: 'crm', driver: 'sqlite', origin: 'code', config: { filename: ':memory:' } }]);

    const patched = await door.send('PATCH', '/datasources/warehouse', { label: 'Warehouse' });
    expect(patched.status).toBe(200);
    expect(door.records.get('warehouse')?.label).toBe('Warehouse');

    const refused = await door.send('PATCH', '/datasources/crm', { label: 'Edited' });
    const body = (await refused.json()) as { error: { code: string } };
    expect({ status: refused.status, code: body.error.code }).toEqual({ status: 400, code: 'DATASOURCE_ADMIN_ERROR' });
  });
});
