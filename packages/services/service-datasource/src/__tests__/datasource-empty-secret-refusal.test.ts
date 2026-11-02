// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { registerDatasourceAdminRoutes } from '../admin-routes.js';
import {
  DatasourceAdminService,
  type DatasourceAdminServiceConfig,
  type ProbeInput,
  type StoredDatasource,
} from '../datasource-admin-service.js';
import {
  ENTITLED_CREDENTIAL,
  createSessionAuthService,
  createGrantsEngine,
} from './entitled-caller.fixture.js';

/**
 * #28928 — an empty `secret` is refused at the datasource admin doors, never
 * sealed as the credential.
 *
 * `POST /api/v1/datasources` and `PATCH /api/v1/datasources/:name` take a
 * door-only `secret` and seal it into the secret store. `"secret": ""` was
 * read as a value: the create sealed an empty credential, and an update
 * minted a new `sys_secret` holding an empty value, repointed
 * `external.credentialsRef` at it and removed the working one. The pool in
 * service kept running, so the datasource broke only at the next connect.
 *
 * Now both doors refuse it `400` naming `secret`, before any write: no secret
 * is written, the stored record and its `credentialsRef` are unchanged, and no
 * secret is removed. `null`, an absent `secret` and a real one are unchanged.
 *
 * Driven through the REAL routes over the REAL service on in-memory stores
 * (the harness of `datasource-admin-declared-keys-kept.test.ts`). Every
 * secret below is an obvious placeholder.
 */

const authService = createSessionAuthService();
const grantsEngine = createGrantsEngine();

const BASE = { driver: 'postgres', config: { host: 'db.example.invalid', database: 'analytics', username: 'qa' } };
const WORKING_REF = 'sys_secret:sec_working';
const PLACEHOLDER_SECRET = 'dummy-rotated-password';

/** In-memory stores behind a real {@link DatasourceAdminService}, recording every seam call. */
function makeDoor(seed: StoredDatasource[] = []) {
  const records = new Map<string, StoredDatasource>(seed.map((r) => [r.name, structuredClone(r)]));
  const ops: string[] = [];
  const pooled: StoredDatasource[] = [];
  const probes: ProbeInput[] = [];
  const written: string[] = [];

  const config: DatasourceAdminServiceConfig = {
    probe: async (input) => {
      ops.push('probe');
      probes.push(structuredClone(input));
      return { ok: true, latencyMs: 1 };
    },
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
      written.push(input.value);
      return `sys_secret:sec_${hint.name}_${written.length}`;
    },
    removeSecret: async (ref) => {
      ops.push(`removeSecret:${ref}`);
    },
    countBoundObjects: async () => 0,
    listObjectsBoundTo: async () => [],
    registerPool: (record) => {
      ops.push('registerPool');
      pooled.push(structuredClone(record));
    },
    unregisterPool: () => {
      ops.push('unregisterPool');
    },
    reregisterPool: (_previous, next) => {
      ops.push('reregisterPool');
      pooled.push(structuredClone(next));
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

  const send = (method: string, path: string, body?: unknown) =>
    app.fetch(
      new Request(`http://local/api/v1${path}`, {
        method,
        headers: { 'content-type': 'application/json', authorization: ENTITLED_CREDENTIAL },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );

  return { send, records, ops, pooled, probes, written };
}

/** A runtime datasource bound to a working credential. */
const STORED: StoredDatasource = {
  name: 'wh',
  ...BASE,
  origin: 'runtime',
  external: { credentialsRef: WORKING_REF },
} as StoredDatasource;

async function expectSecretRefusal(res: Response): Promise<string> {
  const body = (await res.json()) as { success: boolean; error?: { code: string; message: string } };
  expect({ status: res.status, success: body.success, code: body.error?.code }).toEqual({
    status: 400,
    success: false,
    code: 'DATASOURCE_ADMIN_ERROR',
  });
  expect(body.error!.message).toContain('`secret`');
  return body.error!.message;
}

describe('PATCH /api/v1/datasources/:name — an empty secret (#28928)', () => {
  for (const [label, secret] of [['an empty string', ''], ['an empty `value` object', { value: '' }]] as const) {
    it(`${label} is refused 400 naming \`secret\`; the credential, its ref and the record are unchanged`, async () => {
      const { send, records, ops, written } = makeDoor([STORED]);
      await expectSecretRefusal(await send('PATCH', '/datasources/wh', { secret }));
      expect(records.get('wh')).toEqual(STORED);
      expect(written).toEqual([]);
      expect(ops).toEqual([]);
    });
  }

  it('control: a real secret still rotates (a new ref, the old one removed)', async () => {
    const { send, records, ops, written } = makeDoor([STORED]);
    expect((await send('PATCH', '/datasources/wh', { secret: PLACEHOLDER_SECRET })).status).toBe(200);
    expect(written).toEqual([PLACEHOLDER_SECRET]);
    expect(records.get('wh')?.external?.credentialsRef).toBe('sys_secret:sec_wh_1');
    expect(ops).toContain(`removeSecret:${WORKING_REF}`);
  });

  for (const [label, body] of [['`secret: null`', { secret: null, label: 'Warehouse' }], ['no `secret`', { label: 'Warehouse' }]] as const) {
    it(`control: ${label} changes no credential`, async () => {
      const { send, records, ops, written } = makeDoor([STORED]);
      expect((await send('PATCH', '/datasources/wh', body)).status).toBe(200);
      expect(written).toEqual([]);
      expect(records.get('wh')?.external?.credentialsRef).toBe(WORKING_REF);
      expect(ops.some((op) => op.startsWith('removeSecret'))).toBe(false);
    });
  }
});

describe('POST /api/v1/datasources — an empty secret (#28928)', () => {
  it('is refused 400 naming `secret`; nothing is stored and no secret is written', async () => {
    const { send, records, ops, written } = makeDoor();
    await expectSecretRefusal(await send('POST', '/datasources', { name: 'wh', ...BASE, secret: '' }));
    expect(records.has('wh')).toBe(false);
    expect(written).toEqual([]);
    expect(ops).toEqual([]);
  });

  it('control: a real secret is sealed and bound', async () => {
    const { send, records, written } = makeDoor();
    expect((await send('POST', '/datasources', { name: 'wh', ...BASE, secret: PLACEHOLDER_SECRET })).status).toBe(201);
    expect(written).toEqual([PLACEHOLDER_SECRET]);
    expect(records.get('wh')?.external?.credentialsRef).toBe('sys_secret:sec_wh_1');
  });

  it('control: `secret: null` creates the datasource with no credential', async () => {
    const { send, records, written } = makeDoor();
    expect((await send('POST', '/datasources', { name: 'wh', ...BASE, secret: null })).status).toBe(201);
    expect(written).toEqual([]);
    expect(records.get('wh')?.external?.credentialsRef).toBeUndefined();
  });
});
