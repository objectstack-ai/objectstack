// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { DatasourceSchema } from '@objectstack/spec/data';
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
 * #28549 — a credential written at the TOP level of a datasource body is
 * refused by name at the admin write doors, as the build door refuses it.
 *
 * `os compile` judges a datasource against `DatasourceSchema`, whose strict
 * shape refuses a top-level `password` ("must never be inlined", bind it
 * through `external.credentialsRef`) and a top-level `connectionString`
 * ("belongs inside `config`"). `POST /api/v1/datasources` and
 * `PATCH /api/v1/datasources/:name` projected the body onto the record's known
 * keys first, so both keys vanished and the write answered success: the
 * author got a datasource that could not connect and no explanation.
 *
 * Driven through the REAL routes over the REAL service. Each refusal reads the
 * envelope (status + `error.code`), the message (the heading plus the spec's
 * own refusal for that key, derived here from `DatasourceSchema`, never
 * restated), the absence of the value from the answer, and the store behind
 * it: nothing stored, minted or registered.
 *
 * Every credential below is an obvious placeholder.
 */

const authService = createSessionAuthService();
const grantsEngine = createGrantsEngine();

const PLACEHOLDER_PASSWORD = 'PLACEHOLDER_NOT_A_SECRET';
const PLACEHOLDER_DSN = `postgres://app:${PLACEHOLDER_PASSWORD}@db.example.invalid:5432/analytics`;

/** In-memory datasource store and secret store behind a real {@link DatasourceAdminService}. */
function makeDoor(seed: StoredDatasource[] = []) {
  const records = new Map<string, StoredDatasource>(seed.map((r) => [r.name, structuredClone(r)]));
  const secrets = new Map<string, string>();
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
      const ref = `sys_secret:sec_${hint.name}_${++seq}`;
      secrets.set(ref, input.value);
      return ref;
    },
    removeSecret: async (ref) => {
      ops.push('removeSecret');
      secrets.delete(ref);
    },
    countBoundObjects: async () => 0,
    listObjectsBoundTo: async () => [],
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
 * The build door's refusal of `keys` at the top level of a datasource:
 * `DatasourceSchema`'s own `unrecognized_keys` message. Throws when the spec
 * makes no such refusal, so a pin can never pass on a premise the spec no
 * longer holds.
 */
function specRefusal(keys: string[]): string {
  const result = DatasourceSchema.safeParse(Object.fromEntries(keys.map((k) => [k, null])));
  const issue = result.success
    ? undefined
    : result.error.issues.find((i) => i.code === 'unrecognized_keys' && i.path.length === 0);
  if (!issue) throw new Error(`fixture premise broken: DatasourceSchema does not refuse ${keys.join(', ')}`);
  return issue.message;
}

async function expectRefusal(res: Response): Promise<string> {
  const body = (await res.json()) as { success: boolean; error?: { code: string; message: string } };
  expect({ status: res.status, success: body.success, code: body.error?.code }).toEqual({
    status: 400,
    success: false,
    code: 'DATASOURCE_ADMIN_ERROR',
  });
  return body.error!.message;
}

const BASE = { driver: 'postgres', config: { host: 'db.example.invalid', database: 'analytics' } };
const STORED: StoredDatasource = { name: 'wh', ...BASE, origin: 'runtime' };

describe('#28549 — POST /api/v1/datasources refuses a top-level credential by name', () => {
  it('refuses a top-level `password` with the build door\'s prescription, storing nothing', async () => {
    const { send, records, secrets, ops } = makeDoor();

    const message = await expectRefusal(
      await send('POST', '/datasources', { name: 'r7p_top', ...BASE, password: PLACEHOLDER_PASSWORD }),
    );

    expect(message).toBe(`Invalid datasource 'r7p_top'.\n${specRefusal(['password'])}`);
    expect(message).toContain('`password`');
    expect(message).toContain('external.credentialsRef');
    expect(message).not.toContain(PLACEHOLDER_PASSWORD);
    expect(records.has('r7p_top')).toBe(false);
    expect(secrets.size).toBe(0);
    expect(ops).toEqual([]);
  });

  it('refuses a top-level `connectionString` carrying URL userinfo, storing nothing', async () => {
    const { send, records, secrets, ops } = makeDoor();

    const message = await expectRefusal(
      await send('POST', '/datasources', { name: 'r7p_top2', ...BASE, connectionString: PLACEHOLDER_DSN }),
    );

    expect(message).toBe(`Invalid datasource 'r7p_top2'.\n${specRefusal(['connectionString'])}`);
    expect(message).toContain('`connectionString`');
    expect(message).not.toContain(PLACEHOLDER_PASSWORD);
    expect(message).not.toContain('db.example.invalid');
    expect(records.has('r7p_top2')).toBe(false);
    expect(secrets.size).toBe(0);
    expect(ops).toEqual([]);
  });

  it('names both keys in one answer when both are written', async () => {
    const { send, records } = makeDoor();

    const message = await expectRefusal(
      await send('POST', '/datasources', {
        name: 'r7p_both',
        ...BASE,
        password: PLACEHOLDER_PASSWORD,
        connectionString: PLACEHOLDER_DSN,
      }),
    );

    expect(message).toBe(`Invalid datasource 'r7p_both'.\n${specRefusal(['password', 'connectionString'])}`);
    expect(records.has('r7p_both')).toBe(false);
  });

  it('refuses it beside a supplied `secret` too: the secret field is the one credential channel', async () => {
    const { send, records, secrets, ops } = makeDoor();

    await expectRefusal(
      await send('POST', '/datasources', {
        name: 'r7p_secret',
        ...BASE,
        password: PLACEHOLDER_PASSWORD,
        secret: PLACEHOLDER_PASSWORD,
      }),
    );

    expect(records.has('r7p_secret')).toBe(false);
    expect(secrets.size).toBe(0);
    expect(ops).toEqual([]);
  });
});

describe('#28549 — PATCH /api/v1/datasources/:name refuses a top-level credential by name', () => {
  it.each([
    ['password', { password: PLACEHOLDER_PASSWORD }],
    ['connectionString', { connectionString: PLACEHOLDER_DSN }],
  ])('refuses a top-level `%s`, leaving the stored record as it was', async (key, extra) => {
    const { send, records, ops } = makeDoor([STORED]);

    const message = await expectRefusal(await send('PATCH', '/datasources/wh', { config: BASE.config, ...extra }));

    expect(message).toBe(`Invalid datasource 'wh'.\n${specRefusal([key])}`);
    expect(message).not.toContain(PLACEHOLDER_PASSWORD);
    expect(records.get('wh')).toEqual(STORED);
    expect(ops).toEqual([]);
  });

  it('refuses it on a `label`-only edit too: the exemption covers a stored row, not a credential in the body', async () => {
    const { send, records, ops } = makeDoor([STORED]);

    await expectRefusal(await send('PATCH', '/datasources/wh', { label: 'Warehouse', password: PLACEHOLDER_PASSWORD }));

    expect(records.get('wh')).toEqual(STORED);
    expect(ops).toEqual([]);
  });
});

describe('#28549 — controls: the doors keep their other answers', () => {
  it('still creates a datasource whose credential arrives as `secret`, bound at `external.credentialsRef`', async () => {
    const { send, records, secrets } = makeDoor();

    const res = await send('POST', '/datasources', { name: 'wh_ok', ...BASE, secret: PLACEHOLDER_PASSWORD });

    expect(res.status).toBe(201);
    const ref = records.get('wh_ok')?.external?.credentialsRef;
    expect(ref).toMatch(/^sys_secret:/);
    expect(secrets.get(ref!)).toBe(PLACEHOLDER_PASSWORD);
    expect(JSON.stringify(records.get('wh_ok'))).not.toContain(PLACEHOLDER_PASSWORD);
  });

  it('still answers an edit that keeps the bound `external.credentialsRef`', async () => {
    const bound: StoredDatasource = { ...STORED, external: { credentialsRef: 'sys_secret:sec_wh_own' } };
    const { send, records } = makeDoor([bound]);

    const res = await send('PATCH', '/datasources/wh', { label: 'Warehouse' });

    expect(res.status).toBe(200);
    expect(records.get('wh')?.external?.credentialsRef).toBe('sys_secret:sec_wh_own');
  });

  it('keeps the driver contract\'s refusal of `config.password`', async () => {
    const { send, records, ops } = makeDoor();

    const message = await expectRefusal(
      await send('POST', '/datasources', {
        name: 'wh_cfg',
        ...BASE,
        config: { ...BASE.config, password: PLACEHOLDER_PASSWORD },
      }),
    );

    expect(message.split('\n')[0]).toBe("Invalid configuration for driver 'postgres'.");
    expect(message).toContain('config.password');
    expect(message).not.toContain(PLACEHOLDER_PASSWORD);
    expect(records.has('wh_cfg')).toBe(false);
    expect(ops).toEqual([]);
  });
});
