// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
// Pay the driver's first load at collection, not inside a clocked `it()`
// (`check:test-source-alias`).
import '@objectstack/driver-sql';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { registerDatasourceAdminRoutes } from '../admin-routes.js';
import {
  DatasourceAdminService,
  type DatasourceAdminServiceConfig,
  type StoredDatasource,
} from '../datasource-admin-service.js';
import { DATASOURCE_REFUSAL_MESSAGE_MAX } from '../datasource-refusal.js';
import {
  ENTITLED_CREDENTIAL,
  createSessionAuthService,
  createGrantsEngine,
} from './entitled-caller.fixture.js';

/** One entry of `listObjectsBoundTo`, as the service config declares it. */
type BoundObject = Awaited<ReturnType<DatasourceAdminServiceConfig['listObjectsBoundTo']>>[number] & { datasource?: string };

/**
 * Every refusal of the datasource-admin doors names its reason.
 *
 * Each one answered `400 DATASOURCE_ADMIN_ERROR` with the whole account in
 * `message` (up to 1,300 characters, measured on a showcase boot: the
 * top-level `password` refusal), so a client could branch on nothing and a
 * toast could show nothing useful. Each now answers, under the SAME status and
 * code:
 *
 *  - `details.reason`: the condition, one snake_case value each;
 *  - `message`: one line, at most {@link DATASOURCE_REFUSAL_MESSAGE_MAX}
 *    characters, naming the datasource and the refused key;
 *  - `details.hint`: the rationale and the remedy the message used to carry,
 *    where there is more to say than the line does.
 *
 * Driven through the REAL routes over the REAL service. Each case reads the
 * status and code (the CONTROL: neither moves), the reason, the line's length
 * and shape, and one phrase of the old rationale in the hint.
 *
 * Every credential below is an obvious placeholder.
 */

const authService = createSessionAuthService();
const grantsEngine = createGrantsEngine();

const PLACEHOLDER = 'PLACEHOLDER_NOT_A_SECRET';
const SQLITE = { driver: 'sqlite', config: { filename: ':memory:' } };
const PG = { driver: 'postgres', config: { host: 'db.example.invalid', database: 'analytics' } };

function makeDoor(opts: { seed?: StoredDatasource[]; bound?: BoundObject[]; boundCount?: number } = {}) {
  const records = new Map<string, StoredDatasource>((opts.seed ?? []).map((r) => [r.name, structuredClone(r)]));
  const config: DatasourceAdminServiceConfig = {
    probe: async () => ({ ok: true, latencyMs: 1 }),
    listDatasourceRecords: async () => [...records.values()].map((r) => structuredClone(r)),
    getDatasourceRecord: async (name) => {
      const r = records.get(name);
      return r ? structuredClone(r) : undefined;
    },
    putDatasourceRecord: async (record) => {
      records.set(record.name, structuredClone(record));
    },
    deleteDatasourceRecord: async (name) => {
      records.delete(name);
    },
    writeSecret: async (_input, hint) => `sys_secret:sec_${hint.name}`,
    removeSecret: async () => {},
    countBoundObjects: async () => opts.boundCount ?? 0,
    listObjectsBoundTo: async (name) => (opts.bound ?? []).filter((o) => o.datasource === name),
    registerPool: () => {},
    unregisterPool: () => {},
    reregisterPool: () => {},
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
  return { send, records };
}

interface Refusal {
  message: string;
  details: { reason: string; hint?: string } & Record<string, unknown>;
  raw: string;
}

/** The CONTROL and the shape every refusal shares; answers the envelope's error. */
async function refusalOf(res: Response, reason: string): Promise<Refusal> {
  const raw = await res.text();
  const body = JSON.parse(raw) as { success: boolean; error: { code: string; message: string; details: Refusal['details'] } };
  // CONTROL: the status and the code a client already branches on do not move.
  expect({ status: res.status, success: body.success, code: body.error.code }).toEqual({
    status: 400,
    success: false,
    code: 'DATASOURCE_ADMIN_ERROR',
  });
  expect(body.error.details.reason).toBe(reason);
  expect(body.error.message.length).toBeLessThanOrEqual(DATASOURCE_REFUSAL_MESSAGE_MAX);
  expect(body.error.message).not.toContain('\n');
  expect(raw).not.toContain(PLACEHOLDER);
  return { message: body.error.message, details: body.error.details, raw };
}

describe('every datasource-admin refusal names its reason, keeps its status and code, and answers one short line', () => {
  it('invalid_name', async () => {
    const { send } = makeDoor();
    const r = await refusalOf(await send('POST', '/datasources', { name: 'Bad-Name', ...SQLITE }), 'invalid_name');
    expect(r.message).toBe("Invalid datasource name 'Bad-Name': must match /^[a-z_][a-z0-9_]*$/.");
  });

  it('reserved_name: the primary datasource', async () => {
    const { send } = makeDoor();
    const r = await refusalOf(await send('POST', '/datasources', { name: 'default', ...SQLITE }), 'reserved_name');
    expect(r.message).toContain("'default' is reserved");
  });

  it('reserved_name: a literal route of the admin API, the rationale in the hint', async () => {
    const { send } = makeDoor();
    const r = await refusalOf(await send('POST', '/datasources', { name: 'drivers', ...SQLITE }), 'reserved_name');
    expect(r.message).toBe("Datasource name 'drivers' is reserved by the datasource admin API. Pick another name.");
    expect(r.details.hint).toContain("serves its own route at '/datasources/drivers'");
    expect(r.details.hint).toContain('could never be read by name');
  });

  it('already_exists', async () => {
    const { send } = makeDoor({ seed: [{ name: 'dup', ...SQLITE, origin: 'runtime' }] });
    const r = await refusalOf(await send('POST', '/datasources', { name: 'dup', ...SQLITE }), 'already_exists');
    expect(r.message).toBe("Datasource 'dup' already exists.");
  });

  it('code_defined: create over, edit and remove a code-defined datasource', async () => {
    const { send } = makeDoor({ seed: [{ name: 'code_db', ...SQLITE, origin: 'code' }] });
    const created = await refusalOf(await send('POST', '/datasources', { name: 'code_db', ...SQLITE }), 'code_defined');
    expect(created.message).toContain('a code-defined datasource owns this name');
    const edited = await refusalOf(await send('PATCH', '/datasources/code_db', { label: 'x' }), 'code_defined');
    expect(edited.message).toContain('cannot be edited at runtime');
    const removed = await refusalOf(await send('DELETE', '/datasources/code_db'), 'code_defined');
    expect(removed.message).toContain('cannot be removed at runtime');
  });

  it('driver_required', async () => {
    const { send } = makeDoor();
    const r = await refusalOf(await send('POST', '/datasources', { name: 'nd', config: {} }), 'driver_required');
    expect(r.message).toBe('A driver is required to create a datasource.');
  });

  it('invalid_config: one issue that fits rides in the line', async () => {
    const { send } = makeDoor();
    const r = await refusalOf(
      await send('POST', '/datasources', { name: 'ic', driver: 'postgres', config: { port: 'abc' } }),
      'invalid_config',
    );
    expect(r.message).toMatch(/^Invalid configuration for driver 'postgres': config\.port: /);
  });

  it('invalid_record: the record as it would be stored fails DatasourceSchema', async () => {
    const { send, records } = makeDoor();
    const r = await refusalOf(
      await send('POST', '/datasources', {
        name: 'mg',
        driver: 'mongodb',
        config: { url: 'mongodb://127.0.0.1:27017/qa' },
        secret: PLACEHOLDER,
      }),
      'invalid_record',
    );
    expect(r.message).toMatch(/^Invalid datasource 'mg'/);
    expect(records.has('mg')).toBe(false);
  });

  it('undeclared_key: names the key in the line and in details.keys, the spec prescription in the hint', async () => {
    const { send } = makeDoor();
    const r = await refusalOf(
      await send('POST', '/datasources', { name: 'tk', ...PG, password: PLACEHOLDER }),
      'undeclared_key',
    );
    expect(r.message).toBe("Invalid datasource 'tk': unrecognized key(s) `password`.");
    expect(r.details.keys).toEqual(['password']);
    expect(r.details.hint).toContain('must never be inlined on a datasource');
  });

  it('empty_secret', async () => {
    const { send } = makeDoor();
    const r = await refusalOf(await send('POST', '/datasources', { name: 'es', ...PG, secret: '' }), 'empty_secret');
    expect(r.message).toBe("Invalid datasource 'es': the `secret` is empty. Nothing was written.");
    expect(r.details.hint).toContain('leave `secret` out (or null) to keep the stored one');
  });

  it('credentials_ref_on_create', async () => {
    const { send } = makeDoor();
    const r = await refusalOf(
      await send('POST', '/datasources', { name: 'cr', ...PG, external: { credentialsRef: 'sys_secret:other' } }),
      'credentials_ref_on_create',
    );
    expect(r.message).toContain('`external.credentialsRef` is not accepted on create');
    expect(r.details.hint).toContain('It names a credential already stored');
    expect(r.raw).not.toContain('sys_secret:other');
  });

  it('inline_ssl_key', async () => {
    const { send } = makeDoor();
    const r = await refusalOf(
      await send('POST', '/datasources', { name: 'sk', ...PG, ssl: { enabled: true, key: PLACEHOLDER } }),
      'inline_ssl_key',
    );
    expect(r.message).toContain('`ssl.key` (a TLS client private key) is not accepted through this door');
    expect(r.details.hint).toContain('It would be stored in cleartext in the datasource record');
  });

  it('pool_unsupported: the pool module account in the hint', async () => {
    const { send } = makeDoor();
    const r = await refusalOf(
      await send('POST', '/datasources', { name: 'pl', ...SQLITE, pool: { max: 5 } }),
      'pool_unsupported',
    );
    expect(r.message).toBe("Invalid datasource 'pl': its `pool` declares what the 'sqlite' driver does not read.");
    expect(r.details.hint).toContain('declares a `pool` block');
  });

  it('external_binding_conflict: the bound objects in details.objects', async () => {
    const bound: BoundObject[] = [{ name: 'wh_orders', datasource: 'wh', external: { remoteName: 'orders' } }];
    const { send } = makeDoor({ bound });
    const r = await refusalOf(
      await send('POST', '/datasources', { name: 'wh', ...PG, secret: PLACEHOLDER }),
      'external_binding_conflict',
    );
    expect(r.message).toBe("Invalid datasource 'wh': it is managed, and 1 object(s) bind it with `external`.");
    expect(r.details.objects).toEqual(['wh_orders']);
    expect(r.details.hint).toContain("Object 'wh_orders' declares `external`");
  });

  it('connector_not_lendable', async () => {
    const { send } = makeDoor();
    const r = await refusalOf(
      await send('POST', '/datasources', {
        name: 'cn',
        driver: 'odata',
        schemaMode: 'external',
        config: { serviceUrl: 'https://sap.example.test/odata/v4/' },
        external: { connector: 'sap_s4' },
      }),
      'connector_not_lendable',
    );
    expect(r.message).toContain("connector instance 'sap_s4'");
    expect(r.details.connector).toBe('sap_s4');
    expect(r.details.hint).toContain('external.connector:');
  });

  it('objects_bound: unchanged facts, through the same helper', async () => {
    const { send } = makeDoor({ seed: [{ name: 'parts_db', ...SQLITE, origin: 'runtime' }], boundCount: 2 });
    const r = await refusalOf(await send('DELETE', '/datasources/parts_db'), 'objects_bound');
    expect(r.message).toBe("Cannot remove datasource 'parts_db': 2 object(s) are still bound to it.");
    expect(r.details.count).toBe(2);
  });
});

describe('the connection test keeps the whole account in its text answer', () => {
  it('an inline ssl.key answers the line and the hint as `error`', async () => {
    const { send } = makeDoor();
    const res = await send('POST', '/datasources/test', { ...PG, ssl: { key: PLACEHOLDER } });
    const body = (await res.json()) as { success: boolean; data?: { result?: { ok: boolean; error?: string } } };
    const result = body.data?.result;
    expect(result?.ok).toBe(false);
    expect(result?.error).toContain('`ssl.key` (a TLS client private key) is not accepted');
    expect(result?.error).toContain('It would be stored in cleartext');
    expect(result?.error).not.toContain(PLACEHOLDER);
  });
});
