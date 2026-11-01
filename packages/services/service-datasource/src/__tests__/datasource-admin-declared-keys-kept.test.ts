// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { DatasourceSchema } from '@objectstack/spec/data';
import { MetadataProtectionFields } from '@objectstack/spec/kernel';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { registerDatasourceAdminRoutes } from '../admin-routes.js';
import {
  DatasourceAdminService,
  type DatasourceAdminServiceConfig,
  type ProbeInput,
  type StoredDatasource,
} from '../datasource-admin-service.js';
import { DatasourceAdminServicePlugin } from '../datasource-admin-plugin.js';
import type {
  DatasourceConnectionSpec,
  IDatasourceAdminService,
  IDatasourceDriverFactory,
} from '../contracts/index.js';
import {
  ENTITLED_CREDENTIAL,
  createSessionAuthService,
  createGrantsEngine,
} from './entitled-caller.fixture.js';

/**
 * #28633 — the datasource admin doors keep every top-level key
 * `DatasourceSchema` declares, `ssl`, `autoConnect` and `description` among
 * them.
 *
 * `POST /api/v1/datasources` and `PATCH /api/v1/datasources/:name` built the
 * stored record from a hand list of eight keys, so these three passed the
 * undeclared-key refusal (the schema declares them) and were then dropped: a
 * datasource saved with a TLS block was stored, and connected, without one.
 * `POST /api/v1/datasources/test` probed the same short projection.
 *
 * Driven through the REAL routes over the REAL service on in-memory stores,
 * reading the stored record, the record the pool seam is handed, the probe
 * input and the read answer. The plugin's own probe is read through a fake
 * driver factory, for the hand-over to the driver.
 *
 * Every certificate and key below is an obvious placeholder.
 */

const authService = createSessionAuthService();
const grantsEngine = createGrantsEngine();

const PLACEHOLDER_CA = 'PLACEHOLDER_CA_CERTIFICATE';
const PLACEHOLDER_KEY = 'PLACEHOLDER_NOT_A_PRIVATE_KEY';
const SSL = { enabled: true, rejectUnauthorized: true, ca: PLACEHOLDER_CA };
const BASE = { driver: 'postgres', config: { host: 'db.example.invalid', database: 'analytics' } };

/** In-memory stores behind a real {@link DatasourceAdminService}, recording every seam call. */
function makeDoor(seed: StoredDatasource[] = []) {
  const records = new Map<string, StoredDatasource>(seed.map((r) => [r.name, structuredClone(r)]));
  const ops: string[] = [];
  const pooled: StoredDatasource[] = [];
  const probes: ProbeInput[] = [];

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
    writeSecret: async (_input, hint) => {
      ops.push('writeSecret');
      return `sys_secret:sec_${hint.name}`;
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

  return { send, records, ops, pooled, probes };
}

const STORED: StoredDatasource = { name: 'wh', ...BASE, origin: 'runtime' };

async function expectRefusal(res: Response): Promise<string> {
  const raw = await res.text();
  const body = JSON.parse(raw) as { success: boolean; error?: { code: string; message: string } };
  expect({ status: res.status, success: body.success, code: body.error?.code }).toEqual({
    status: 400,
    success: false,
    code: 'DATASOURCE_ADMIN_ERROR',
  });
  // Named, never echoed.
  expect(raw).not.toContain(PLACEHOLDER_KEY);
  return body.error!.message;
}

describe('#28633 premise — the keys this card is about are declared by DatasourceSchema', () => {
  it('declares ssl, autoConnect and description (so the undeclared-key refusal lets them through)', () => {
    const shape = Object.keys((DatasourceSchema as unknown as { shape: object }).shape);
    expect(shape).toEqual(expect.arrayContaining(['ssl', 'autoConnect', 'description']));
  });
});

describe('POST /api/v1/datasources — create keeps every declared key (#28633)', () => {
  it('stores ssl, autoConnect and description, and the pool is opened from a record carrying ssl', async () => {
    const { send, records, pooled } = makeDoor();
    const res = await send('POST', '/datasources', {
      name: 'wh',
      ...BASE,
      ssl: SSL,
      autoConnect: true,
      description: 'Analytics warehouse',
    });
    expect(res.status).toBe(201);
    expect(records.get('wh')).toMatchObject({ ssl: SSL, autoConnect: true, description: 'Analytics warehouse' });
    expect(pooled).toHaveLength(1);
    expect(pooled[0].ssl).toEqual(SSL);
  });

  it('a read returns them', async () => {
    const { send } = makeDoor();
    await send('POST', '/datasources', { name: 'wh', ...BASE, ssl: SSL, autoConnect: true, description: 'd' });
    const res = await send('GET', '/datasources/wh');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { datasource: Record<string, unknown> } };
    expect(body.data.datasource).toMatchObject({ ssl: SSL, autoConnect: true, description: 'd' });
  });

  it('a stored TLS block is still judged by the schema: an unknown ssl key is refused, nothing stored', async () => {
    const { send, records, ops } = makeDoor();
    const message = await expectRefusal(
      await send('POST', '/datasources', { name: 'wh', ...BASE, ssl: { enabled: true, insecure: true } }),
    );
    expect(message).toContain('ssl');
    expect(records.has('wh')).toBe(false);
    expect(ops).toEqual([]);
  });

  it('control: a draft without these keys stores none of them, as before', async () => {
    const { send, records } = makeDoor();
    expect((await send('POST', '/datasources', { name: 'wh', ...BASE })).status).toBe(201);
    const stored = records.get('wh')!;
    expect(Object.keys(stored).sort()).toEqual(['config', 'driver', 'name', 'origin']);
  });

  it('server-stamped keys are not taken from the body: origin is stamped runtime, the protection envelope is not stored', async () => {
    const { send, records } = makeDoor();
    const res = await send('POST', '/datasources', {
      name: 'wh',
      ...BASE,
      origin: 'code',
      _lock: 'full',
      _lockReason: 'locked by the author',
      _provenance: 'package',
      _packageId: 'com.example.pkg',
    });
    expect(res.status).toBe(201);
    const stored = records.get('wh')!;
    expect(stored.origin).toBe('runtime');
    for (const key of Object.keys(MetadataProtectionFields)) expect(stored).not.toHaveProperty(key);
  });
});

describe('PATCH /api/v1/datasources/:name — edit keeps every declared key (#28633)', () => {
  it('stores a new ssl block and rebuilds the pool from a record carrying it', async () => {
    const { send, records, ops, pooled } = makeDoor([STORED]);
    const res = await send('PATCH', '/datasources/wh', { ssl: SSL });
    expect(res.status).toBe(200);
    expect(records.get('wh')?.ssl).toEqual(SSL);
    expect(ops).toContain('reregisterPool');
    expect(pooled.at(-1)?.ssl).toEqual(SSL);
  });

  it('stores autoConnect and description', async () => {
    const { send, records } = makeDoor([STORED]);
    expect((await send('PATCH', '/datasources/wh', { autoConnect: true, description: 'Moved' })).status).toBe(200);
    expect(records.get('wh')).toMatchObject({ autoConnect: true, description: 'Moved' });
  });

  it('control: a description-only edit does not churn the live connection', async () => {
    const { send, ops } = makeDoor([STORED]);
    expect((await send('PATCH', '/datasources/wh', { description: 'Moved' })).status).toBe(200);
    expect(ops).toContain('registerPool');
    expect(ops).not.toContain('reregisterPool');
  });

  it('control: a label-only edit leaves a stored ssl block as it was', async () => {
    const { send, records } = makeDoor([{ ...STORED, ssl: SSL }]);
    expect((await send('PATCH', '/datasources/wh', { label: 'Warehouse' })).status).toBe(200);
    expect(records.get('wh')?.ssl).toEqual(SSL);
  });
});

describe('POST /api/v1/datasources/test — the probe reads the record a Save stores (#28633)', () => {
  it('hands the draft ssl block to the probe', async () => {
    const { send, probes } = makeDoor();
    const res = await send('POST', '/datasources/test', { ...BASE, ssl: SSL });
    expect(res.status).toBe(200);
    expect(probes).toHaveLength(1);
    expect(probes[0].ssl).toEqual(SSL);
  });

  it('control: a draft without ssl probes without it, as before', async () => {
    const { send, probes } = makeDoor();
    expect((await send('POST', '/datasources/test', BASE)).status).toBe(200);
    expect(probes[0]).not.toHaveProperty('ssl');
  });

  it('the plugin probe hands ssl to the driver factory', async () => {
    const created: DatasourceConnectionSpec[] = [];
    const factory: IDatasourceDriverFactory = {
      supports: () => true,
      create: async (spec) => {
        created.push(structuredClone(spec));
        return { connect: async () => {}, ping: async () => {}, disconnect: async () => {} } as any;
      },
    } as IDatasourceDriverFactory;
    let admin: IDatasourceAdminService | undefined;
    const ctx: any = {
      getService: (name: string) => {
        if (name === 'metadata') return { get: async () => undefined, list: async () => [] };
        throw new Error(`no service ${name}`);
      },
      registerService: (name: string, svc: unknown) => {
        if (name === 'datasource-admin') admin = svc as IDatasourceAdminService;
      },
      trigger: async () => {},
      logger: { warn() {}, info() {} },
    };
    await new DatasourceAdminServicePlugin({ driverFactory: factory }).init(ctx);
    const result = await admin!.testConnection({ name: 'x', ...BASE, ssl: SSL });
    expect(result.ok).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0].ssl).toEqual(SSL);
  });
});

describe('ssl.key — a TLS client private key is never stored in cleartext or served (#28633)', () => {
  it('create refuses an inline ssl.key by name: nothing stored, minted or opened', async () => {
    const { send, records, ops } = makeDoor();
    const message = await expectRefusal(
      await send('POST', '/datasources', { name: 'wh', ...BASE, ssl: { ...SSL, key: PLACEHOLDER_KEY } }),
    );
    expect(message.split('\n')[0]).toBe("Invalid datasource 'wh'.");
    expect(message).toContain('`ssl.key`');
    expect(records.has('wh')).toBe(false);
    expect(ops).toEqual([]);
  });

  it('edit refuses an inline ssl.key by name: the stored record is unchanged', async () => {
    const { send, records, ops } = makeDoor([STORED]);
    const message = await expectRefusal(
      await send('PATCH', '/datasources/wh', { ssl: { ...SSL, key: PLACEHOLDER_KEY } }),
    );
    expect(message).toContain('`ssl.key`');
    expect(records.get('wh')).toEqual(STORED);
    expect(ops).toEqual([]);
  });

  it('the test door refuses it the same way, as a failed probe that never ran', async () => {
    const { send, probes } = makeDoor();
    const res = await send('POST', '/datasources/test', { ...BASE, ssl: { ...SSL, key: PLACEHOLDER_KEY } });
    const raw = await res.text();
    expect(raw).not.toContain(PLACEHOLDER_KEY);
    const body = JSON.parse(raw) as { data: { result: { ok: boolean; error: string } } };
    expect(res.status).toBe(200);
    expect(body.data.result.ok).toBe(false);
    expect(body.data.result.error).toContain('`ssl.key`');
    expect(probes).toEqual([]);
  });

  it('a read withholds a private key a stored row already holds', async () => {
    const { send } = makeDoor([{ ...STORED, ssl: { ...SSL, key: PLACEHOLDER_KEY } }]);
    const res = await send('GET', '/datasources/wh');
    const raw = await res.text();
    expect(res.status).toBe(200);
    expect(raw).not.toContain(PLACEHOLDER_KEY);
    const body = JSON.parse(raw) as { data: { datasource: { ssl: Record<string, unknown> } } };
    expect(body.data.datasource.ssl).toEqual(SSL);
  });

  it('an edit sending back the served ssl block keeps the stored key', async () => {
    const { send, records } = makeDoor([{ ...STORED, ssl: { ...SSL, key: PLACEHOLDER_KEY } }]);
    expect((await send('PATCH', '/datasources/wh', { ssl: { ...SSL, rejectUnauthorized: false } })).status).toBe(200);
    expect(records.get('wh')?.ssl).toEqual({ ...SSL, rejectUnauthorized: false, key: PLACEHOLDER_KEY });
  });
});
