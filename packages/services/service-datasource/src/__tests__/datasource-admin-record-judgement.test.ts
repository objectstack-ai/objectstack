// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { DatasourceSchema } from '@objectstack/spec/data';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { registerDatasourceAdminRoutes } from '../admin-routes.js';
import {
  DatasourceAdminService,
  type DatasourceAdminServiceConfig,
  type StoredDatasource,
  type ProbeInput,
} from '../datasource-admin-service.js';
import {
  ENTITLED_CREDENTIAL,
  createSessionAuthService,
  createGrantsEngine,
} from './entitled-caller.fixture.js';

/**
 * #21058 — the datasource admin door judges the record it will persist against
 * `DatasourceSchema`, the contract `os build` and `PUT /api/v1/meta/datasource`
 * already enforce.
 *
 * Before, the door ran the driver's `config` contract alone, so every
 * refinement reading two fields at once was skipped: a mongo `config.url` that
 * names no user (or a composed config with no `username`) beside the
 * `credentialsRef` a supplied secret binds was accepted 201 — the factory never
 * reads that secret, so the datasource connected anonymously — and
 * `schemaMode: 'external'` with no `external` block was accepted too. The meta
 * read path then reported each stored row `valid: false`.
 *
 * Driven through the REAL routes over the REAL service, so each pin reads the
 * HTTP envelope a caller sees (status + `error.code`) and the store behind it
 * (nothing written, no secret minted or unbound). The refusal message is the
 * one `DatasourceSchema` itself produces for the same record — derived here
 * from the schema, never restated.
 */

const authService = createSessionAuthService();
const grantsEngine = createGrantsEngine();

/** In-memory store + secret store behind a real {@link DatasourceAdminService}. */
function makeDoor(seed: StoredDatasource[] = []) {
  const records = new Map<string, StoredDatasource>(seed.map((r) => [r.name, structuredClone(r)]));
  const secrets = new Map<string, string>();
  let seq = 0;
  const ops: string[] = [];
  const probed: ProbeInput[] = [];

  const config: DatasourceAdminServiceConfig = {
    probe: async (input) => {
      probed.push(input);
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
      const ref = `sys_secret://datasource/${hint.name}#${++seq}`;
      secrets.set(ref, input.value);
      return ref;
    },
    removeSecret: async (ref) => {
      ops.push('removeSecret');
      secrets.delete(ref);
    },
    countBoundObjects: async () => 0,
    registerPool: () => {
      ops.push('registerPool');
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

  return { send, records, secrets, ops, probed };
}

/**
 * `<path>: <message>` exactly as `DatasourceSchema` words the issue at `path`
 * for `record` — the build door's own message. Throws when the schema raises
 * no issue there, so a pin can never pass on a premise the spec no longer
 * holds.
 */
function schemaIssue(record: Record<string, unknown>, path: string): string {
  const result = DatasourceSchema.safeParse(record);
  const issue = result.success ? undefined : result.error.issues.find((i) => i.path.join('.') === path);
  if (!issue) throw new Error(`fixture premise broken: DatasourceSchema raises no issue at '${path}'`);
  return `${path}: ${issue.message}`;
}

/** The binding a supplied secret creates, as the schema sees it (any non-empty ref). */
const BOUND = { credentialsRef: 'sys_secret://datasource/any#1' };

const USERLESS_URL = 'mongodb://127.0.0.1:27017/qa';
const USER_URL = 'mongodb://app@127.0.0.1:27017/qa';

async function expectRefusal(res: Response, expected: string): Promise<void> {
  expect(res.status).toBe(400);
  const body = (await res.json()) as { success: boolean; error: { code: string; message: string } };
  expect(body.success).toBe(false);
  expect(body.error.code).toBe('DATASOURCE_ADMIN_ERROR');
  expect(body.error.message).toContain(expected);
}

describe('POST /api/v1/datasources judges the record it will persist (#21058)', () => {
  it('refuses a mongo url that names no user beside a supplied secret — nothing persisted, no secret written', async () => {
    const door = makeDoor();
    const res = await door.send('POST', '/datasources', {
      name: 'r19b_mg_nouser',
      driver: 'mongodb',
      config: { url: USERLESS_URL },
      secret: 'any-secret',
    });

    await expectRefusal(
      res,
      schemaIssue({ name: 'r19b_mg_nouser', driver: 'mongodb', config: { url: USERLESS_URL }, external: BOUND }, 'config.url'),
    );
    expect(door.records.size).toBe(0);
    expect(door.secrets.size).toBe(0);
    expect(door.ops).toEqual([]);
  });

  it('refuses a composed mongo config with no username beside a supplied secret', async () => {
    const door = makeDoor();
    const config = { host: '127.0.0.1', database: 'qa' };
    const res = await door.send('POST', '/datasources', {
      name: 'r19b_mg_composed',
      driver: 'mongodb',
      config,
      secret: 'any',
    });

    await expectRefusal(
      res,
      schemaIssue({ name: 'r19b_mg_composed', driver: 'mongodb', config, external: BOUND }, 'config.username'),
    );
    expect(door.records.size).toBe(0);
    expect(door.ops).toEqual([]);
  });

  it('refuses schemaMode external with no external block', async () => {
    const door = makeDoor();
    const config = { filename: ':memory:' };
    const res = await door.send('POST', '/datasources', {
      name: 'ext_no_block',
      driver: 'sqlite',
      schemaMode: 'external',
      config,
    });

    await expectRefusal(
      res,
      schemaIssue({ name: 'ext_no_block', driver: 'sqlite', schemaMode: 'external', config }, 'external'),
    );
    expect(door.records.size).toBe(0);
    expect(door.ops).toEqual([]);
  });

  it('control: a url that names a user, with a secret, is created and bound', async () => {
    const door = makeDoor();
    const res = await door.send('POST', '/datasources', {
      name: 'mg_app',
      driver: 'mongodb',
      config: { url: USER_URL },
      secret: 'any-secret',
    });

    expect(res.status).toBe(201);
    expect(door.records.get('mg_app')?.external?.credentialsRef).toMatch(/^sys_secret:/);
    expect(door.secrets.size).toBe(1);
  });

  it('control: a user-less url with NO secret is an unbound, anonymous datasource and is created', async () => {
    const door = makeDoor();
    const res = await door.send('POST', '/datasources', {
      name: 'mg_anon',
      driver: 'mongodb',
      config: { url: USERLESS_URL },
    });

    expect(res.status).toBe(201);
    expect(door.records.get('mg_anon')?.external).toBeUndefined();
  });

  it('control: schemaMode external WITH an external block is created', async () => {
    const door = makeDoor();
    const res = await door.send('POST', '/datasources', {
      name: 'ext_with_block',
      driver: 'sqlite',
      schemaMode: 'external',
      config: { filename: ':memory:' },
      external: {},
    });

    expect(res.status).toBe(201);
  });
});

describe('PATCH /api/v1/datasources/:name judges the merged record (#21058)', () => {
  const boundRow = (): StoredDatasource => ({
    name: 'mg',
    driver: 'mongodb',
    origin: 'runtime',
    config: { url: USER_URL },
    external: { credentialsRef: 'sys_secret://datasource/mg#0' },
  });

  it('refuses a config that drops the url user while the existing binding stays — record and secret untouched', async () => {
    const door = makeDoor([boundRow()]);
    const before = structuredClone(door.records.get('mg'));

    const res = await door.send('PATCH', '/datasources/mg', { config: { url: USERLESS_URL } });

    await expectRefusal(
      res,
      schemaIssue({ name: 'mg', driver: 'mongodb', config: { url: USERLESS_URL }, external: BOUND }, 'config.url'),
    );
    expect(door.records.get('mg')).toEqual(before);
    expect(door.ops).toEqual([]);
  });

  it('refuses a secret supplied for a user-less url — no secret minted', async () => {
    const door = makeDoor([{ name: 'mg', driver: 'mongodb', origin: 'runtime', config: { url: USERLESS_URL } }]);

    const res = await door.send('PATCH', '/datasources/mg', { secret: 'any-secret' });

    await expectRefusal(
      res,
      schemaIssue({ name: 'mg', driver: 'mongodb', config: { url: USERLESS_URL }, external: BOUND }, 'config.url'),
    );
    expect(door.records.get('mg')?.external).toBeUndefined();
    expect(door.ops).toEqual([]);
  });

  it('refuses a composed config with no username beside a supplied secret', async () => {
    const door = makeDoor([
      { name: 'mg', driver: 'mongodb', origin: 'runtime', config: { host: '127.0.0.1', database: 'qa', username: 'app' } },
    ]);
    const config = { host: '127.0.0.1', database: 'qa' };

    const res = await door.send('PATCH', '/datasources/mg', { config, secret: 'any' });

    await expectRefusal(res, schemaIssue({ name: 'mg', driver: 'mongodb', config, external: BOUND }, 'config.username'));
    expect(door.ops).toEqual([]);
  });

  it('refuses switching to schemaMode external with no external block', async () => {
    const door = makeDoor([{ name: 'lite', driver: 'sqlite', origin: 'runtime', config: { filename: ':memory:' } }]);

    const res = await door.send('PATCH', '/datasources/lite', { schemaMode: 'external' });

    await expectRefusal(
      res,
      schemaIssue({ name: 'lite', driver: 'sqlite', schemaMode: 'external', config: { filename: ':memory:' } }, 'external'),
    );
    expect(door.records.get('lite')?.schemaMode).toBeUndefined();
  });

  it('control: a url that names a user, with a secret, is accepted and bound', async () => {
    const door = makeDoor([{ name: 'mg', driver: 'mongodb', origin: 'runtime', config: { url: USERLESS_URL } }]);

    const res = await door.send('PATCH', '/datasources/mg', { config: { url: USER_URL }, secret: 'any-secret' });

    expect(res.status).toBe(200);
    expect(door.records.get('mg')?.external?.credentialsRef).toMatch(/^sys_secret:/);
  });

  // The exemption: a row stored with the pair before this door judged it must
  // still be renamable and — the point — takeable out of service.
  it('keeps a label/active-only edit of an already-stored invalid row writable', async () => {
    const door = makeDoor([
      { ...boundRow(), config: { url: USERLESS_URL } },
    ]);

    const off = await door.send('PATCH', '/datasources/mg', { active: false });
    expect(off.status).toBe(200);
    expect(door.records.get('mg')?.active).toBe(false);

    const renamed = await door.send('PATCH', '/datasources/mg', { label: 'Legacy' });
    expect(renamed.status).toBe(200);
    expect(door.records.get('mg')?.label).toBe('Legacy');
  });
});

describe('POST /api/v1/datasources/test judges the draft a Save would persist (#21058)', () => {
  it('refuses to probe a user-less url beside a secret the probe would never use', async () => {
    const door = makeDoor();
    const res = await door.send('POST', '/datasources/test', {
      driver: 'mongodb',
      config: { url: USERLESS_URL },
      secret: 'any-secret',
    });

    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { result: { ok: boolean; error?: string } } };
    expect(data.result.ok).toBe(false);
    // Built from the same record the create door judges; the test door's own
    // identity stand-in is irrelevant to the issue at `config.url`.
    expect(data.result.error).toContain(
      schemaIssue({ name: 'probe', driver: 'mongodb', config: { url: USERLESS_URL }, external: BOUND }, 'config.url'),
    );
    expect(door.probed).toHaveLength(0);
  });

  it('control: the console-shaped draft (no name) with a url that names a user is probed', async () => {
    const door = makeDoor();
    const res = await door.send('POST', '/datasources/test', {
      driver: 'mongodb',
      config: { url: USER_URL },
      secret: 'any-secret',
    });

    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { result: { ok: boolean } } };
    expect(data.result.ok).toBe(true);
    expect(door.probed).toHaveLength(1);
    expect(door.probed[0].secret).toBe('any-secret');
  });
});
