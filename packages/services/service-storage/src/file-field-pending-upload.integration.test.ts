// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #26479 — a file field takes only a file whose upload was completed.
 *
 * A presigned upload is a `pending` `sys_file` row until `POST
 * …/upload/complete` commits it, and that door is the one that asks the
 * backend whether it holds the bytes the row declares (#24548). A record write
 * used to take a `pending` file as it takes a committed one: `201`, the
 * record held the id, and the row was stamped with `ref_*` while it stayed
 * `pending` — a field that reads as attached, a download door that answers
 * `404` for it, and bytes nobody ever measured.
 *
 * Now a write whose caller names such a file is refused at the field, with the
 * envelope #26043 gives a file the caller may not read: one `400
 * VALIDATION_FAILED` with an ADR-0114 `invalid_value` entry per field. It
 * names the file too, because the caller may read it and the remedy is to
 * complete that upload. Nothing is written, and the row is not stamped. Once
 * `/upload/complete` has run, the same write is taken.
 *
 * Every write door that resolves a file field's `sys_file` is the engine's
 * `beforeInsert` / `beforeUpdate` pass, so the doors pinned here are its
 * shapes: a single insert, a batch insert, a single update, and a
 * `multiple: true` field. (A predicate update naming a file id is refused
 * before this judgement, #7102.) A system write — the seed loader, which
 * writes a record over the `pending` row `storeFile` made and commits it with
 * `claimFiles` after — is not judged.
 *
 * Driven through the doors as they ship: one real `ObjectQL` engine over
 * sqlite `:memory:`, `StorageServicePlugin` booted on the local adapter, the
 * upload doors called as routes, and the write as the uploader.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RouteHandler } from '@objectstack/spec/contracts';
import { RAW_FILE_VALUES_CONTEXT_KEY, type EngineQueryOptions } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveThrownHttpError } from '@objectstack/types';
import { StorageServicePlugin } from './storage-service-plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const BASE = '/api/v1/storage';
const SYS = { isSystem: true };
const SYS_RAW = { isSystem: true, [RAW_FILE_VALUES_CONTEXT_KEY]: true };
const WRITER = 'u_writer';
const WRITER_CTX = { userId: WRITER };
const MIB = 1024 * 1024;

const silentLogger = () => ({
  info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(),
  trace: vi.fn(), fatal: vi.fn(), child() { return this; },
});

type Res = { _status: number; _json: any };

describe('#26479 — a file field takes only a file whose upload was completed', () => {
  let rootDir: string;
  let engine: ObjectQL;
  const routes = new Map<string, RouteHandler>();
  let seq = 0;

  beforeAll(async () => {
    rootDir = join(tmpdir(), `os-26479-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(rootDir, { recursive: true });

    engine = new ObjectQL({ logger: silentLogger() } as any);
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }) as any, true);
    await engine.init();

    // The real engine, except that a read of an object this fixture never
    // registered — the permission store the door's context resolution
    // consults — answers empty.
    const dataEngine = new Proxy(engine, {
      get(target, prop) {
        if (prop === 'find') {
          return (object: string, query?: EngineQueryOptions) =>
            target.getSchema(object) ? target.find(object, query) : Promise.resolve([]);
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    const services = new Map<string, unknown>();
    const ready: Array<() => Promise<void> | void> = [];
    const mount = (m: string) => (path: string, handler: RouteHandler) => { routes.set(`${m}:${path}`, handler); };
    const ctx = {
      logger: silentLogger(),
      registerService: (name: string, svc: unknown) => { services.set(name, svc); },
      getService: <T>(name: string): T => {
        if (!services.has(name)) throw new Error(`service '${name}' not registered`);
        return services.get(name) as T;
      },
      hook: (event: string, fn: () => Promise<void> | void) => { if (event === 'kernel:ready') ready.push(fn); },
    };
    ctx.registerService('objectql', dataEngine);
    ctx.registerService('http-server', {
      get: mount('GET'), post: mount('POST'), put: mount('PUT'),
      delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
      listen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    });
    ctx.registerService('manifest', { register: (manifest: any) => engine.registerApp(manifest) });
    ctx.registerService('auth', {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const userId = headers.get('x-test-user');
          return userId ? { user: { id: userId }, session: {} } : undefined;
        },
      },
    });

    const plugin = new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false });
    await plugin.init(ctx as any);

    // The card's scratch object: `poster` accepts PNG/JPEG up to 1 MiB.
    engine.registerApp({
      id: 'com.objectstack.test.file-field-pending-upload',
      name: 'File field pending upload',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      objects: [{
        name: 'media',
        label: 'Media',
        fields: {
          name: { name: 'name', type: 'text' },
          poster: { name: 'poster', label: 'Poster', type: 'image', accept: ['image/png', 'image/jpeg'], maxSize: MIB },
          gallery: { name: 'gallery', label: 'Gallery', type: 'image', multiple: true },
        },
      }],
    } as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);
    await plugin.start(ctx as any);
    for (const fn of ready) await fn();
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* already torn down */ }
    if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
  });

  /** Call a storage route as the writer. */
  const call = async (method: string, path: string, req: Record<string, unknown>): Promise<Res> => {
    const res: any = {
      _status: 200, _json: null,
      json(data: any) { res._json = data; return res; },
      send() { return res; },
      status(code: number) { res._status = code; return res; },
      header() { return res; },
    };
    const handler = routes.get(`${method}:${path}`);
    if (!handler) throw new Error(`no route ${method} ${path}`);
    await handler({ params: {}, query: {}, headers: { 'x-test-user': WRITER }, method, path, ...req } as any, res);
    return res;
  };

  /** The card's steps 1–2: presign, then PUT `bytes` to the URL. `/upload/complete` is not called. */
  const pendingUpload = async (bytes: Buffer = Buffer.alloc(100, 1), declaredSize = bytes.byteLength) => {
    const presigned = await call('POST', `${BASE}/upload/presigned`, {
      body: { filename: 'pend.png', mimeType: 'image/png', size: declaredSize },
    });
    expect(presigned._status, JSON.stringify(presigned._json)).toBe(200);
    const { fileId, uploadUrl } = presigned._json.data as { fileId: string; uploadUrl: string };
    const token = uploadUrl.slice(uploadUrl.lastIndexOf('/') + 1);
    const put = await call('PUT', `${BASE}/_local/raw/:token`, { params: { token }, rawBody: async () => bytes });
    expect(put._status, JSON.stringify(put._json)).toBe(200);
    return fileId;
  };

  const complete = (fileId: string) => call('POST', `${BASE}/upload/complete`, { body: { fileId } });

  const fileRow = async (id: string) =>
    ((await engine.find('sys_file', { where: { id }, context: SYS })) as Array<Record<string, any>>)[0];
  const ownerOf = async (id: string) => {
    const row = await fileRow(id);
    return { status: row?.status, ref: [row?.ref_object ?? null, row?.ref_id ?? null, row?.ref_field ?? null] };
  };
  const record = async (id: string) =>
    ((await engine.find('media', { where: { id }, context: SYS_RAW })) as Array<Record<string, any>>)[0];
  const failureOf = (write: Promise<unknown>) =>
    write.then(() => null, (e: unknown) => resolveThrownHttpError(e));

  /** The refusal, as the HTTP boundary answers it: one located entry naming the field and the file. */
  const refusedBody = (field: string, label: string, fileIds: string[]) => {
    const named = fileIds.length === 1
      ? `file ${fileIds[0]}: its upload was`
      : `files ${fileIds.join(', ')}: their uploads were`;
    const message = `${label} cannot reference ${named} never completed. Complete the upload, then save again.`;
    return {
      status: 400,
      code: 'VALIDATION_FAILED',
      declaredStatus: 400,
      declaredCode: 'VALIDATION_FAILED',
      message,
      details: { fields: [{ field, code: 'invalid_value', message, label }] },
    };
  };

  const UNCLAIMED = [null, null, null];

  it('the card\'s steps 1–4: the write is refused at the field, and nothing is stamped on the pending row', async () => {
    const fileId = await pendingUpload();
    const id = `m_${++seq}`;

    const failure = await failureOf(
      engine.insert('media', { id, name: id, poster: fileId } as any, { context: WRITER_CTX }),
    );

    expect(failure).toEqual(refusedBody('poster', 'Poster', [fileId]));
    expect(await record(id)).toBeUndefined();
    expect(await ownerOf(fileId)).toEqual({ status: 'pending', ref: UNCLAIMED });
  });

  it('the same write is taken once /upload/complete has run', async () => {
    const fileId = await pendingUpload();
    const refusedId = `m_${++seq}`;
    expect(await failureOf(
      engine.insert('media', { id: refusedId, name: refusedId, poster: fileId } as any, { context: WRITER_CTX }),
    )).toEqual(refusedBody('poster', 'Poster', [fileId]));

    const done = await complete(fileId);
    expect(done._status, JSON.stringify(done._json)).toBe(200);

    const id = `m_${++seq}`;
    await engine.insert('media', { id, name: id, poster: fileId } as any, { context: WRITER_CTX });
    expect((await record(id))?.poster).toBe(fileId);
    expect(await ownerOf(fileId)).toEqual({ status: 'committed', ref: ['media', id, 'poster'] });
  });

  it('bytes the backend holds beyond the declared size are never claimed: the write and the commit both refuse', async () => {
    // Declared 100 bytes; 2 MiB PUT, over `poster`'s 1 MiB. The declared size
    // passes `maxSize`, so only the commit door's byte check could catch it.
    const fileId = await pendingUpload(Buffer.alloc(2 * MIB, 1), 100);
    const id = `m_${++seq}`;

    expect(await failureOf(
      engine.insert('media', { id, name: id, poster: fileId } as any, { context: WRITER_CTX }),
    )).toEqual(refusedBody('poster', 'Poster', [fileId]));
    const commit = await complete(fileId);

    expect(commit._status, JSON.stringify(commit._json)).toBe(409);
    expect(await ownerOf(fileId)).toEqual({ status: 'pending', ref: UNCLAIMED });
  });

  it('an update naming a pending file is refused, and the record keeps what it held', async () => {
    const id = `m_${++seq}`;
    await engine.insert('media', { id, name: id } as any, { context: WRITER_CTX });
    const fileId = await pendingUpload();

    const failure = await failureOf(engine.update('media', { id, poster: fileId } as any, { context: WRITER_CTX }));

    expect(failure).toEqual(refusedBody('poster', 'Poster', [fileId]));
    expect((await record(id))?.poster ?? null).toBeNull();
    expect(await ownerOf(fileId)).toEqual({ status: 'pending', ref: UNCLAIMED });
  });

  it('a batch insert with one row naming a pending file is refused whole', async () => {
    const fileId = await pendingUpload();
    const clean = `m_${++seq}`;
    const named = `m_${++seq}`;

    const failure = await failureOf(engine.insert('media', [
      { id: clean, name: clean },
      { id: named, name: named, poster: fileId },
    ] as any, { context: WRITER_CTX }));

    expect(failure).toEqual(refusedBody('poster', 'Poster', [fileId]));
    expect(await record(clean)).toBeUndefined();
    expect(await record(named)).toBeUndefined();
    expect(await ownerOf(fileId)).toEqual({ status: 'pending', ref: UNCLAIMED });
  });

  it('a multiple field names only its pending files, and its committed file is not claimed either', async () => {
    const committed = await pendingUpload();
    expect((await complete(committed))._status).toBe(200);
    const pendingA = await pendingUpload();
    const pendingB = await pendingUpload();
    const id = `m_${++seq}`;

    const failure = await failureOf(engine.insert(
      'media', { id, name: id, gallery: [committed, pendingA, pendingB] } as any, { context: WRITER_CTX },
    ));

    expect(failure).toEqual(refusedBody('gallery', 'Gallery', [pendingA, pendingB]));
    expect(await ownerOf(committed)).toEqual({ status: 'committed', ref: UNCLAIMED });
    expect(await ownerOf(pendingA)).toEqual({ status: 'pending', ref: UNCLAIMED });
  });

  it('a system write is not judged: the seed loader writes over a pending row it commits after', async () => {
    const fileId = await pendingUpload();
    const id = `m_${++seq}`;

    await engine.insert('media', { id, name: id, poster: fileId } as any, { context: SYS });

    expect((await record(id))?.poster).toBe(fileId);
    expect(await ownerOf(fileId)).toEqual({ status: 'pending', ref: ['media', id, 'poster'] });
  });

  it('a record already holding a pending file can still be edited, resending the value it holds', async () => {
    // The state a write left before this refusal existed.
    const fileId = await pendingUpload();
    const id = `m_${++seq}`;
    await engine.insert('media', { id, name: id, poster: fileId } as any, { context: SYS });

    await engine.update('media', { id, name: 'renamed', poster: fileId } as any, { context: WRITER_CTX });

    expect(await record(id)).toMatchObject({ name: 'renamed', poster: fileId });
    expect(await ownerOf(fileId)).toEqual({ status: 'pending', ref: ['media', id, 'poster'] });
  });
});
