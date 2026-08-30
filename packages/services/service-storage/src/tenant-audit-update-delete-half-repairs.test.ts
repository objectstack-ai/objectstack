// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #13178 — the four HALF-REPAIRS: the `update` / `delete` siblings of the two
// inserts #12745 and #12928 repaired.
//
// ## What was half-repaired
//
// `StorageMetadataStore` issues eight engine calls. #12745 gave `createFile`
// an execution context and #12928 gave `createSession` one, so both INSERTS
// carry the acting organization. Their `update` and `delete` siblings — same
// two tables, same store, twenty lines apart — were left passing no context at
// all. The tenant-audit census counted 175 service write call sites against a
// tenancy-enabled object and found 24 carrying no context whatever; four of
// those 24 are these, and the maintainer's 2026-08-30 ruling (第 5 场总监席决裁
// 批 #7, verbatim 「批 #7 同意」) narrowed this card to exactly them:
//
//   > D(即刻入队,本卡范围):先修已知的 4 处半修复 …… 同表同类有先例,修法
//   > 不需要新裁决。⛔ 本卡范围就此收窄到这 4 处。
//
// ⛔ The class-level device (a CI gate / a throwing audit / a boot report) is
// 暂缓 behind design card #13491 and no part of it is built or prepared here.
// ⛔ The guard ORDER inside `auditMissingTenant` is untouched — that reading is
// #13491's too.
//
// ## Why the repair is NOT a copy of the insert halves
//
// Write-side tenancy in the SQL driver is two mechanisms wearing one option.
// On insert `injectTenantOnInsert` STAMPS the column from `options.tenantId`;
// on update / delete `applyTenantScope` SCOPES the statement with it. So the
// same `{ context: { tenantId } }` bag buys a VALUE on one verb and a REACH on
// the other, and this file measures the second rather than assuming it reads
// like the first.
//
// ## Three altitudes, because a pin at one of them proves nothing about the
// ## other two
//
//   A. THE STORE — the four repaired call sites put the context on the engine
//      options bag, and put nothing there when the caller has no organization.
//   B. THE ROUTES — the production doors actually pass one. Two of them had
//      already resolved the session and discarded it, which is what made the
//      store's new parameter worth having.
//   C. THE SIGNAL — the two legs that carry the context from the store's bag to
//      the audit's guard, each driven against the REAL producer:
//        C1. real `ObjectQL` over a recording driver — `context.tenantId`
//            becomes `DriverOptions.tenantId` on `update` and on `delete`.
//        C2. real `SqlDriver` over live SQLite — that `DriverOptions.tenantId`
//            silences `[tenant-audit]` on those two verbs, narrows the
//            statement away from another organization's row, and (the half
//            that keeps this safe) leaves an `organization_id IS NULL` row
//            reachable, which is the entire pre-#12928 population the ruling
//            deliberately did not backfill.
//
// ⚠️ A test that asserted only "the call still succeeds" would pass against
// the unrepaired code, since the defect never threw anything. C2 is therefore
// written as a two-sided reading: the pre-fix call shape must WARN.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  ObjectQL,
  assertEngineDeleteDispatch,
  assertEngineFindOnePredicate,
  assertEngineUpdateDispatch,
} from '@objectstack/objectql';
import type {
  DriverQuery,
  IHttpRequest,
  IHttpResponse,
  RouteHandler,
} from '@objectstack/spec/contracts';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { StorageMetadataStore } from './metadata-store.js';
import type { FileRecord, UploadSessionRecord } from './metadata-store.js';
import { registerStorageRoutes } from './storage-routes.js';
import { SystemFile } from './objects/system-file.object.js';
import { SystemUploadSession } from './objects/system-upload-session.object.js';

const fileRec = (id: string): FileRecord => ({
  id,
  key: `user/${id}.bin`,
  name: `${id}.bin`,
  status: 'pending',
});

const sessionRec = (id: string): UploadSessionRecord => ({
  id,
  file_id: `f_${id}`,
  key: `user/${id}.bin`,
  filename: `${id}.bin`,
  total_size: 10,
  chunk_size: 5,
  total_chunks: 2,
  status: 'in_progress',
});

// ---------------------------------------------------------------------------
// A. THE STORE — the four repaired call sites
// ---------------------------------------------------------------------------

/**
 * Records the OPTIONS bag of every write. Each verb opens with the producer's
 * OWN dispatch predicate, exactly as the #12745 / #12928 doubles next door do,
 * so this fake can never accept a call shape the real `ObjectQL` refuses —
 * which is what makes "the store now sends `{ where, context }`" a claim about
 * a legal call rather than about a shape only this file tolerates.
 */
function createRecordingEngine(seed: Array<{ object: string; data: any }> = []) {
  const rows = seed.map((s) => ({ ...s, data: { ...s.data } }));
  const updates: Array<{ object: string; data: any; options: any }> = [];
  const deletes: Array<{ object: string; options: any }> = [];
  const engine: any = {
    async insert(object: string, data: any) {
      rows.push({ object, data: { ...data } });
      return { ...data };
    },
    async findOne(object: string, query?: any) {
      assertEngineFindOnePredicate(object, query);
      const hit = rows.find(
        (r) => r.object === object && String(r.data.id) === String(query?.where?.id),
      );
      return hit ? { ...hit.data } : null;
    },
    async update(object: string, data: any, options?: any) {
      assertEngineUpdateDispatch(data, options);
      updates.push({ object, data: { ...data }, options });
      return { ...data };
    },
    async delete(object: string, options?: any) {
      assertEngineDeleteDispatch(options);
      deletes.push({ object, options });
      return 1;
    },
    async find() {
      return [];
    },
    async count() {
      return 0;
    },
    async aggregate() {
      return [];
    },
    _updates: updates,
    _deletes: deletes,
  };
  return engine;
}

describe('[#13178] the store: the four half-repaired sites carry the acting organization', () => {
  it('updateFile threads the organization as an execution context', async () => {
    const engine = createRecordingEngine([{ object: 'sys_file', data: fileRec('f1') }]);
    const store = new StorageMetadataStore(engine);

    await store.updateFile('f1', { status: 'committed' }, { organizationId: 'org_A' });

    expect(engine._updates).toHaveLength(1);
    expect(engine._updates[0].object).toBe('sys_file');
    // `where` keeps ONLY the id — the tenant term is `applyTenantScope`'s to
    // compose, not this store's (composing it here would re-decide whether the
    // object has a tenant column, one package away from the schema).
    expect(engine._updates[0].options).toEqual({
      where: { id: 'f1' },
      context: { tenantId: 'org_A' },
    });
  });

  it('deleteFile threads it too', async () => {
    const engine = createRecordingEngine();
    const store = new StorageMetadataStore(engine);

    await store.deleteFile('f1', { organizationId: 'org_A' });

    expect(engine._deletes).toEqual([
      { object: 'sys_file', options: { where: { id: 'f1' }, context: { tenantId: 'org_A' } } },
    ]);
  });

  it('updateSession threads the organization as an execution context', async () => {
    const engine = createRecordingEngine([
      { object: 'sys_upload_session', data: sessionRec('s1') },
    ]);
    const store = new StorageMetadataStore(engine);

    await store.updateSession('s1', { status: 'completed' }, { organizationId: 'org_A' });

    expect(engine._updates).toHaveLength(1);
    expect(engine._updates[0].object).toBe('sys_upload_session');
    expect(engine._updates[0].options).toEqual({
      where: { id: 's1' },
      context: { tenantId: 'org_A' },
    });
  });

  it('deleteSession threads it too', async () => {
    const engine = createRecordingEngine();
    const store = new StorageMetadataStore(engine);

    await store.deleteSession('s1', { organizationId: 'org_A' });

    expect(engine._deletes).toEqual([
      {
        object: 'sys_upload_session',
        options: { where: { id: 's1' }, context: { tenantId: 'org_A' } },
      },
    ]);
  });

  it('⛔ does NOT stamp the tenant column onto the update payload', async () => {
    const engine = createRecordingEngine([{ object: 'sys_file', data: fileRec('f1') }]);
    const store = new StorageMetadataStore(engine);

    await store.updateFile('f1', { status: 'committed' }, { organizationId: 'org_A' });

    // Same division of labour the insert halves settled: whether the object HAS
    // the column, and whether an explicit value wins, are the driver's answers.
    // On this verb the driver does not stamp at all — it scopes — so a payload
    // carrying the column would not merely duplicate a decision, it would
    // invent a write nothing asked for.
    expect(engine._updates[0].data).not.toHaveProperty('organization_id');
  });

  it('a caller with no organization produces the pre-#13178 call shape exactly', async () => {
    const engine = createRecordingEngine([
      { object: 'sys_file', data: fileRec('f1') },
      { object: 'sys_upload_session', data: sessionRec('s1') },
    ]);
    const store = new StorageMetadataStore(engine);

    await store.updateFile('f1', { status: 'committed' });
    await store.updateFile('f1', { status: 'committed' }, {});
    await store.updateFile('f1', { status: 'committed' }, { organizationId: '' });
    await store.updateFile('f1', { status: 'committed' }, { organizationId: null });
    await store.updateSession('s1', { status: 'completed' });
    await store.deleteFile('f1');
    await store.deleteSession('s1', { organizationId: '' });

    // ⛔ No `context` key at all, not `context: {}`. An empty context is still a
    // context and changes what every other option resolver on the call sees —
    // the reason `writeOptionsFor` answers `undefined` rather than an empty bag.
    for (const u of engine._updates) expect(u.options).not.toHaveProperty('context');
    for (const d of engine._deletes) expect(d.options).not.toHaveProperty('context');
    expect(engine._updates.map((u: any) => u.options.where)).toEqual([
      { id: 'f1' },
      { id: 'f1' },
      { id: 'f1' },
      { id: 'f1' },
      { id: 's1' },
    ]);
    expect(engine._deletes.map((d: any) => d.options)).toEqual([
      { where: { id: 'f1' } },
      { where: { id: 's1' } },
    ]);
  });
});

// ---------------------------------------------------------------------------
// B. THE ROUTES — the production doors
// ---------------------------------------------------------------------------

function createMockHttpServer() {
  const routes = new Map<string, RouteHandler>();
  return {
    get: vi.fn((path: string, handler: RouteHandler) => {
      routes.set(`GET:${path}`, handler);
    }),
    post: vi.fn((path: string, handler: RouteHandler) => {
      routes.set(`POST:${path}`, handler);
    }),
    put: vi.fn((path: string, handler: RouteHandler) => {
      routes.set(`PUT:${path}`, handler);
    }),
    delete: vi.fn(),
    patch: vi.fn(),
    use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    _getHandler(method: string, path: string): RouteHandler | undefined {
      return routes.get(`${method}:${path}`);
    },
  };
}

function createMockReq(overrides: Partial<IHttpRequest> = {}): IHttpRequest {
  return {
    params: {},
    query: {},
    body: undefined,
    headers: {},
    method: 'POST',
    path: '/',
    ...overrides,
  } as IHttpRequest;
}

function createMockRes(): IHttpResponse & { _status: number; _json: any } {
  const res: any = {
    _status: 200,
    _json: null,
    json(data: any) {
      res._json = data;
    },
    send(data: any) {
      res._sent = data;
    },
    status(code: number) {
      res._status = code;
      return res;
    },
    header() {
      return res;
    },
  };
  return res;
}

const BASE = '/api/v1/storage';

async function withRoutes(
  session: { userId?: string; organizationId?: string } | null,
  seed: Array<{ object: string; data: any }>,
  drive: (server: ReturnType<typeof createMockHttpServer>) => Promise<void>,
) {
  const rootDir = join(tmpdir(), `os-13178-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(rootDir, { recursive: true });
  try {
    const adapter = new LocalStorageAdapter({ rootDir, signingSecret: 'test-secret' });
    const engine = createRecordingEngine(seed);
    const store = new StorageMetadataStore(engine);
    const httpServer = createMockHttpServer();
    registerStorageRoutes(httpServer as any, adapter, store, {
      basePath: BASE,
      resolveSession: async () => session,
    });
    await drive(httpServer);
    return engine;
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

const committedFile = (id: string): FileRecord => ({ ...fileRec(id), status: 'pending' });

describe('[#13178] the routes: the upload doors pass the session organization on their writes', () => {
  it('POST /upload/complete scopes the sys_file commit — the session it used to discard', async () => {
    const engine = await withRoutes(
      { userId: 'u1', organizationId: 'org_A' },
      [{ object: 'sys_file', data: committedFile('f1') }],
      async (server) => {
        const res = createMockRes();
        await server._getHandler('POST', `${BASE}/upload/complete`)!(
          createMockReq({ body: { fileId: 'f1', eTag: 'e1' } }),
          res,
        );
        expect(res._status).toBe(200);
      },
    );

    const update = engine._updates.find((u: any) => u.object === 'sys_file');
    expect(update).toBeTruthy();
    expect(update.options).toEqual({ where: { id: 'f1' }, context: { tenantId: 'org_A' } });
  });

  it('the chunked completion scopes BOTH of its writes from the same session value', async () => {
    // Driven as the real sequence — init, then complete — rather than over a
    // seeded row: the completion hands the session id straight to the backend
    // (`completeChunkedUpload(uploadId, …)`), so only a session the init door
    // actually created exists on both sides. A seeded row makes this handler
    // answer 500 down its `markSessionFailed` arm, which would have measured
    // the failure path while reading like the happy one.
    const engine = await withRoutes(
      { userId: 'u1', organizationId: 'org_A' },
      [],
      async (server) => {
        const initRes = createMockRes();
        await server._getHandler('POST', `${BASE}/upload/chunked`)!(
          createMockReq({
            body: { filename: 'c.bin', mimeType: 'application/octet-stream', totalSize: 10 },
          }),
          initRes,
        );
        expect(initRes._status).toBe(200);
        const uploadId = initRes._json?.data?.uploadId ?? initRes._json?.uploadId;
        expect(uploadId).toBeTruthy();

        const res = createMockRes();
        await server._getHandler('POST', `${BASE}/upload/chunked/:uploadId/complete`)!(
          createMockReq({ params: { uploadId }, body: { parts: [] } }),
          res,
        );
        expect(res._status).toBe(200);
      },
    );

    // The asymmetry this card records, asserted as a pair so the two halves
    // cannot drift apart again: the file row and the session row are updated
    // from ONE resolved organization.
    const file = engine._updates.find((u: any) => u.object === 'sys_file');
    const session = engine._updates.find((u: any) => u.object === 'sys_upload_session');
    expect(file.options.context).toEqual({ tenantId: 'org_A' });
    expect(session.options.context).toEqual({ tenantId: 'org_A' });
    expect(engine._updates.every((u: any) => u.options.context?.tenantId === 'org_A')).toBe(true);
  });

  it('the chunk door scopes its progress write', async () => {
    const engine = await withRoutes(
      { userId: 'u1', organizationId: 'org_A' },
      [{ object: 'sys_upload_session', data: sessionRec('s1') }],
      async (server) => {
        const res = createMockRes();
        await server._getHandler('PUT', `${BASE}/upload/chunked/:uploadId/chunk/:chunkIndex`)!(
          createMockReq({
            method: 'PUT',
            params: { uploadId: 's1', chunkIndex: '0' },
            body: Buffer.from('12345'),
          }),
          res,
        );
        expect(res._status).toBe(200);
      },
    );

    const update = engine._updates.find((u: any) => u.object === 'sys_upload_session');
    expect(update).toBeTruthy();
    expect(update.options).toEqual({ where: { id: 's1' }, context: { tenantId: 'org_A' } });
  });

  it('the progress door — which WRITES when it expires a row — scopes that write too', async () => {
    const engine = await withRoutes(
      { userId: 'u1', organizationId: 'org_A' },
      [
        {
          object: 'sys_upload_session',
          // Past its own declared deadline, so `expireIfPastDeadline` statuses
          // it `expired`. A GET that writes is exactly the door most likely to
          // be missed when threading a write context by hand.
          data: { ...sessionRec('s1'), expires_at: new Date(Date.now() - 60_000).toISOString() },
        },
      ],
      async (server) => {
        const res = createMockRes();
        await server._getHandler('GET', `${BASE}/upload/chunked/:uploadId/progress`)!(
          createMockReq({ method: 'GET', params: { uploadId: 's1' } }),
          res,
        );
        expect(res._status).toBe(200);
      },
    );

    const update = engine._updates.find((u: any) => u.object === 'sys_upload_session');
    expect(update).toBeTruthy();
    expect(update.data.status).toBe('expired');
    expect(update.options.context).toEqual({ tenantId: 'org_A' });
  });

  it('a session with no active organization still stamps nothing — ⛔ no guess is substituted', async () => {
    const engine = await withRoutes(
      { userId: 'u1' },
      [{ object: 'sys_file', data: committedFile('f1') }],
      async (server) => {
        const res = createMockRes();
        await server._getHandler('POST', `${BASE}/upload/complete`)!(
          createMockReq({ body: { fileId: 'f1' } }),
          res,
        );
        expect(res._status).toBe(200);
      },
    );

    const update = engine._updates.find((u: any) => u.object === 'sys_file');
    expect(update.options).toEqual({ where: { id: 'f1' } });
  });
});

// ---------------------------------------------------------------------------
// C1. THE ENGINE LEG — `context.tenantId` reaches `DriverOptions.tenantId`
//     on `update` and `delete`, driven through the REAL ObjectQL.
// ---------------------------------------------------------------------------

interface DriverCall {
  object: string;
  method: string;
  options: Record<string, unknown> | undefined;
}

function recordingDriver(calls: DriverCall[]) {
  const record = (object: string, method: string, options: any) => {
    calls.push({ object, method, options });
  };
  const row = (id: string) => ({ id, key: `user/${id}.bin`, name: `${id}.bin`, status: 'pending' });
  const driver: any = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {},
    async disconnect() {},
    async checkHealth() {
      return true;
    },
    async execute() {
      return null;
    },
    async find(object: string, _ast: any, options: any) {
      record(object, 'find', options);
      return [];
    },
    async findOne(object: string, _ast: any, options: any) {
      record(object, 'findOne', options);
      return row('f1');
    },
    async count(object: string, _ast: any, options: any) {
      record(object, 'count', options);
      return 0;
    },
    async create(object: string, data: any, options: any) {
      record(object, 'create', options);
      return { ...data };
    },
    async update(object: string, id: string, data: any, options: any) {
      record(object, 'update', options);
      return { id, ...data };
    },
    async delete(object: string, _id: string, options: any) {
      record(object, 'delete', options);
      return true;
    },
    async bulkCreate() {
      return [];
    },
    async bulkUpdate() {
      return [];
    },
    async bulkDelete() {
      return 0;
    },
    async syncSchema() {},
  };
  return driver;
}

async function makeEngine() {
  const calls: DriverCall[] = [];
  const engine = new ObjectQL();
  engine.registerDriver(recordingDriver(calls), true);
  await engine.init();
  engine.registry.registerObject(SystemFile as any, 'com.objectstack.storage');
  engine.registry.registerObject(SystemUploadSession as any, 'com.objectstack.storage');
  return { engine, calls };
}

describe('[#13178] the engine leg: the store’s context becomes DriverOptions.tenantId', () => {
  it('the premise — the registry gives both objects a tenant column', async () => {
    // If this ever stopped holding the card would be moot, so it is asserted
    // rather than assumed: neither declaration carries a `tenancy` key, and the
    // provisioning pass injects the column on every install.
    const { engine } = await makeEngine();
    expect((engine.registry.getObject('sys_file') as any).fields.organization_id).toBeDefined();
    expect(
      (engine.registry.getObject('sys_upload_session') as any).fields.organization_id,
    ).toBeDefined();
  });

  it('update carries it', async () => {
    const { engine, calls } = await makeEngine();
    const store = new StorageMetadataStore(engine as any);

    await store.updateFile('f1', { status: 'committed' }, { organizationId: 'org_A' });

    const update = calls.find((c) => c.method === 'update');
    expect(update).toBeTruthy();
    expect(update!.options?.tenantId).toBe('org_A');
  });

  it('delete carries it', async () => {
    const { engine, calls } = await makeEngine();
    const store = new StorageMetadataStore(engine as any);

    await store.deleteSession('s1', { organizationId: 'org_A' });

    const del = calls.find((c) => c.method === 'delete');
    expect(del).toBeTruthy();
    expect(del!.options?.tenantId).toBe('org_A');
  });

  it('and WITHOUT the repair’s context there is none — the shape the audit exists to catch', async () => {
    const { engine, calls } = await makeEngine();
    const store = new StorageMetadataStore(engine as any);

    await store.updateFile('f1', { status: 'committed' });
    await store.deleteSession('s1');

    for (const c of calls.filter((x) => x.method === 'update' || x.method === 'delete')) {
      expect(c.options?.tenantId ?? undefined).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// C2. THE DRIVER LEG — what that `DriverOptions.tenantId` buys, measured
//     against a real `SqlDriver` on live SQLite.
// ---------------------------------------------------------------------------

const OLD_POSTURE = process.env.OS_TENANCY_POSTURE;
const openDrivers: SqlDriver[] = [];

/** The object as a walled install registers it, tenant column and all. */
const AUDITED_OBJECT = {
  name: 'sys_file',
  fields: {
    organization_id: { type: 'string' },
    key: { type: 'string' },
    status: { type: 'string' },
  },
};

let driver: SqlDriver;
let warns: Array<{ msg: string; meta: any }>;

const tenantAudit = (op: string) =>
  warns.filter((w) => w.msg.includes('[tenant-audit]') && w.meta?.op === op);

beforeEach(async () => {
  // A WALLED deployment — the only posture under which the signal is reachable
  // at all (the card's property 3). ⛔ Not a claim that the `single`-posture
  // early-out is wrong; it is fenced out of this card and untouched.
  process.env.OS_TENANCY_POSTURE = 'isolated';
  driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  openDrivers.push(driver);
  warns = [];
  (driver as any).logger = { warn: (msg: string, meta: any) => warns.push({ msg, meta }) };
  await driver.initObjects([AUDITED_OBJECT]);
  await driver.create('sys_file', { id: 'own', key: 'a', status: 'pending', organization_id: 'org_A' }, { tenantId: 'org_A' });
  await driver.create('sys_file', { id: 'other', key: 'b', status: 'pending', organization_id: 'org_B' }, { tenantId: 'org_B' });
  await driver.create('sys_file', { id: 'legacy', key: 'c', status: 'pending', organization_id: null }, { tenantId: 'org_A' });
  warns = [];
});

afterEach(async () => {
  while (openDrivers.length) {
    try {
      await openDrivers.pop()?.disconnect();
    } catch {
      /* noop */
    }
  }
  if (OLD_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = OLD_POSTURE;
});

const readStatus = async (id: string) => {
  // Typed rather than erased to `any`: the driver silently DROPS an
  // unrecognised query key, so `tsc` is the only channel that can reject a
  // misspelt one here (the same reasoning `sys-upload-session-ttl-sweep.test.ts`
  // states next door).
  const query: DriverQuery = { where: { id } };
  return ((await driver.findOne('sys_file', query)) as any)?.status ?? null;
};

describe('[#13178] the driver leg: what the threaded tenantId actually buys', () => {
  it('the unrepaired UPDATE call shape raises [tenant-audit] — the two-sided half', async () => {
    await driver.update('sys_file', 'own', { status: 'committed' });
    expect(tenantAudit('update')).toHaveLength(1);
    expect(tenantAudit('update')[0].meta).toMatchObject({
      object: 'sys_file',
      tenantField: 'organization_id',
    });
  });

  it('the unrepaired DELETE call shape raises it too', async () => {
    await driver.delete('sys_file', 'own');
    expect(tenantAudit('delete')).toHaveLength(1);
  });

  it('the repaired shape is silent on both verbs', async () => {
    await driver.update('sys_file', 'own', { status: 'committed' }, { tenantId: 'org_A' });
    await driver.delete('sys_file', 'own', { tenantId: 'org_A' });
    expect(warns.filter((w) => w.msg.includes('[tenant-audit]'))).toEqual([]);
  });

  it('the scope narrows: another organization’s row is no longer reachable', async () => {
    await driver.update('sys_file', 'other', { status: 'committed' }, { tenantId: 'org_A' });
    expect(await readStatus('other')).toBe('pending');

    await driver.delete('sys_file', 'other', { tenantId: 'org_A' });
    expect(await readStatus('other')).toBe('pending');
  });

  it('and the caller’s OWN row still updates', async () => {
    await driver.update('sys_file', 'own', { status: 'committed' }, { tenantId: 'org_A' });
    expect(await readStatus('own')).toBe('committed');
  });

  it('an organization-less row stays reachable — the pre-#12928 population is NOT stranded', async () => {
    // This is the load-bearing one. #12928 was ruled FORWARD STAMP ONLY, so
    // every session row written before it carries NULL by decision, and #12745's
    // backfill did not claim to reach every `sys_file` row either. Strict
    // equality here would have stranded exactly those rows mid-upload; the
    // driver's `OR … IS NULL` arm (#2734's global-row fail-open) is why it does
    // not. ⛔ This asserts that behaviour, it does not change or re-decide it.
    await driver.update('sys_file', 'legacy', { status: 'committed' }, { tenantId: 'org_A' });
    expect(await readStatus('legacy')).toBe('committed');

    await driver.delete('sys_file', 'legacy', { tenantId: 'org_A' });
    expect(await readStatus('legacy')).toBeNull();
  });
});
