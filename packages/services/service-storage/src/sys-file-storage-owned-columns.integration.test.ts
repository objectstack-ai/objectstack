// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_file`'s storage-owned columns (`key`, `mime_type`, `size`, `status`,
 * `etag`) cannot be set or changed by a write that does not come from the
 * storage service.
 *
 * Two checks trust them: a file field refuses a file whose upload never
 * completed by reading `status`, and judges `accept` / `maxSize` by
 * `mime_type` / `size`. They were plain writable columns, so a data-door
 * `PATCH` of a presigned upload that never received its bytes could set it
 * `committed` (and its `size` to anything), and a record's file field then
 * claimed it.
 *
 * On an UPDATE the engine's static readonly strip now takes the caller's value
 * back out, by id and by predicate, and the rest of the write lands. On a
 * CREATE the storage service's own guard drops them and starts the row
 * `pending`. Neither refuses the write. The service's own writes, all under
 * the system context, still move every column: presign, complete, claim.
 *
 * The file-reference columns (`ref_object`, `ref_id`, `ref_field`,
 * `released_ref_object`, `released_ref_id`) take the same form: the
 * file-reference lifecycle owns them, so they are `readonly` and the same
 * create-side guard drops them from a non-system create, while the lifecycle's
 * claim, release and copy, all under the system context, still write them.
 *
 * Driven through the doors as they ship, as the #26479 rig is: one real
 * `ObjectQL` engine over sqlite `:memory:`, `StorageServicePlugin` booted on
 * the local adapter, the upload doors called as routes, and the data writes
 * made as a signed-in caller with no system context.
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
import {
  SystemFile,
  SYS_FILE_REFERENCE_COLUMNS,
  SYS_FILE_STORAGE_OWNED_COLUMNS,
} from './objects/system-file.object.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const BASE = '/api/v1/storage';
const SYS = { isSystem: true };
const SYS_RAW = { isSystem: true, [RAW_FILE_VALUES_CONTEXT_KEY]: true };
const WRITER = 'u_writer';
const WRITER_CTX = { userId: WRITER };
const DECLARED = 100;

const silentLogger = () => ({
  info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(),
  trace: vi.fn(), fatal: vi.fn(), child() { return this; },
});

type Res = { _status: number; _json: any };

describe('sys_file storage-owned columns are not writable outside the storage service', () => {
  let rootDir: string;
  let engine: ObjectQL;
  const routes = new Map<string, RouteHandler>();
  let seq = 0;

  beforeAll(async () => {
    rootDir = join(tmpdir(), `os-sysfile-owned-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(rootDir, { recursive: true });

    engine = new ObjectQL({ logger: silentLogger() } as any);
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }) as any, true);
    await engine.init();

    // The real engine, except that a read of an object this fixture never
    // registered (the permission store the door's context resolution
    // consults) answers empty.
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

    // The card's file field: `poster` accepts PNG/JPEG up to 1 KiB.
    engine.registerApp({
      id: 'com.objectstack.test.sys-file-storage-owned-columns',
      name: 'sys_file storage-owned columns',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      objects: [{
        name: 'media',
        label: 'Media',
        fields: {
          name: { name: 'name', type: 'text' },
          poster: { name: 'poster', label: 'Poster', type: 'image', accept: ['image/png', 'image/jpeg'], maxSize: 1024 },
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

  /** The card's step 1: presign, and send no bytes. */
  const presign = async () => {
    const presigned = await call('POST', `${BASE}/upload/presigned`, {
      body: { filename: 'ghost.png', mimeType: 'image/png', size: DECLARED },
    });
    expect(presigned._status, JSON.stringify(presigned._json)).toBe(200);
    return presigned._json.data as { fileId: string; uploadUrl: string };
  };

  /** Presign, PUT the declared bytes and complete: the service's own upload → commit path. */
  const committedUpload = async () => {
    const { fileId, uploadUrl } = await presign();
    const token = uploadUrl.slice(uploadUrl.lastIndexOf('/') + 1);
    const put = await call('PUT', `${BASE}/_local/raw/:token`, {
      params: { token }, rawBody: async () => Buffer.alloc(DECLARED, 1),
    });
    expect(put._status, JSON.stringify(put._json)).toBe(200);
    const done = await call('POST', `${BASE}/upload/complete`, { body: { fileId, eTag: 'etag-from-complete' } });
    expect(done._status, JSON.stringify(done._json)).toBe(200);
    return fileId;
  };

  const fileRow = async (id: string) =>
    ((await engine.find('sys_file', { where: { id }, context: SYS })) as Array<Record<string, any>>)[0];
  const owned = async (id: string) => {
    const row = await fileRow(id);
    return Object.fromEntries(SYS_FILE_STORAGE_OWNED_COLUMNS.map((c) => [c, row?.[c] ?? null]));
  };
  const record = async (id: string) =>
    ((await engine.find('media', { where: { id }, context: SYS_RAW })) as Array<Record<string, any>>)[0];
  const failureOf = (write: Promise<unknown>) =>
    write.then(() => null, (e: unknown) => resolveThrownHttpError(e));

  /** The file field's refusal of a file whose upload never completed (#26479), as the HTTP boundary answers it. */
  const neverCompleted = (fileId: string) => {
    const message = `Poster cannot reference file ${fileId}: its upload was never completed. Complete the upload, then save again.`;
    return {
      status: 400,
      code: 'VALIDATION_FAILED',
      declaredStatus: 400,
      declaredCode: 'VALIDATION_FAILED',
      message,
      details: { fields: [{ field: 'poster', code: 'invalid_value', message, label: 'Poster' }] },
    };
  };

  const FORGED = {
    key: 'tenant/someone-else.png',
    mime_type: 'image/jpeg',
    size: 999,
    status: 'committed',
    etag: 'forged-etag',
  } as const;
  /** What a caller would write over a COMMITTED file: every value differs from the one the service wrote. */
  const FORGED_OVER_COMMITTED = { ...FORGED, status: 'pending' } as const;

  it('declares exactly the five storage-owned columns, each readonly on sys_file', () => {
    expect([...SYS_FILE_STORAGE_OWNED_COLUMNS].sort()).toEqual(['etag', 'key', 'mime_type', 'size', 'status']);
    for (const column of SYS_FILE_STORAGE_OWNED_COLUMNS) {
      expect((SystemFile.fields as Record<string, { readonly?: boolean }>)[column]?.readonly, column).toBe(true);
    }
  });

  it('the card\'s steps 1–5: a never-uploaded file stays pending after the PATCH, and a file field still refuses it', async () => {
    const { fileId } = await presign();
    const before = await owned(fileId);
    expect(before.status).toBe('pending');

    await engine.update('sys_file', { id: fileId, status: 'committed', size: 999 } as any, { context: WRITER_CTX });

    expect(await owned(fileId)).toEqual(before);
    const id = `m_${++seq}`;
    expect(await failureOf(
      engine.insert('media', { id, name: 'ghost', poster: fileId } as any, { context: WRITER_CTX }),
    )).toEqual(neverCompleted(fileId));
    expect(await record(id)).toBeUndefined();
  });

  it.each(SYS_FILE_STORAGE_OWNED_COLUMNS)('an update by id cannot change %s, and the rest of the write lands', async (column) => {
    const fileId = await committedUpload();
    const before = await owned(fileId);

    await engine.update('sys_file', { id: fileId, name: 'renamed.png', [column]: FORGED_OVER_COMMITTED[column] } as any, { context: WRITER_CTX });

    expect(await owned(fileId)).toEqual(before);
    expect((await fileRow(fileId))?.name).toBe('renamed.png');
  });

  it('a predicate update cannot change any of them either', async () => {
    const fileId = await committedUpload();
    const before = await owned(fileId);

    await engine.update('sys_file', { ...FORGED_OVER_COMMITTED, acl: 'private' } as any, { where: { id: fileId }, context: WRITER_CTX } as any);

    expect(await owned(fileId)).toEqual(before);
    expect((await fileRow(fileId))?.acl).toBe('private');
  });

  it('a create cannot set any of them: the row starts pending with none of the caller\'s values, and a file field refuses it', async () => {
    const fileId = `f_forged_${++seq}`;

    await engine.insert('sys_file', { id: fileId, name: 'forged.png', owner_id: WRITER, ...FORGED } as any, { context: WRITER_CTX });

    expect(await owned(fileId)).toEqual({ key: null, mime_type: null, size: null, status: 'pending', etag: null });
    expect((await fileRow(fileId))?.name).toBe('forged.png');
    const id = `m_${++seq}`;
    expect(await failureOf(
      engine.insert('media', { id, name: 'forged', poster: fileId } as any, { context: WRITER_CTX }),
    )).toEqual(neverCompleted(fileId));
  });

  it('a batch create cannot set them on any row', async () => {
    const a = `f_forged_${++seq}`;
    const b = `f_forged_${++seq}`;

    await engine.insert('sys_file', [
      { id: a, name: 'a.png', ...FORGED },
      { id: b, name: 'b.png', status: 'committed' },
    ] as any, { context: WRITER_CTX });

    const startsPending = { key: null, mime_type: null, size: null, status: 'pending', etag: null };
    expect(await owned(a)).toEqual(startsPending);
    expect(await owned(b)).toEqual(startsPending);
  });

  it('the service\'s own upload → commit → claim path still writes every column', async () => {
    const fileId = await committedUpload();

    const row = await owned(fileId);
    expect(row).toMatchObject({ mime_type: 'image/png', size: DECLARED, status: 'committed', etag: 'etag-from-complete' });
    expect(typeof row.key).toBe('string');
    expect(row.key).toContain(fileId);

    const id = `m_${++seq}`;
    await engine.insert('media', { id, name: 'real', poster: fileId } as any, { context: WRITER_CTX });
    expect((await record(id))?.poster).toBe(fileId);
    expect((await fileRow(fileId))?.ref_id).toBe(id);
  });

  it('a system create keeps the values it writes', async () => {
    const fileId = `f_system_${++seq}`;

    await engine.insert('sys_file', { id: fileId, name: 'copy.png', ...FORGED } as any, { context: SYS });

    expect(await owned(fileId)).toEqual({ ...FORGED });
  });

  // ── The file-reference columns ────────────────────────────────────

  const references = async (id: string) => {
    const row = await fileRow(id);
    return Object.fromEntries(SYS_FILE_REFERENCE_COLUMNS.map((c) => [c, row?.[c] ?? null]));
  };
  const UNREFERENCED = { ref_object: null, ref_id: null, ref_field: null, released_ref_object: null, released_ref_id: null };
  /** A value for every reference column that differs from any the lifecycle writes in this file. */
  const NAMED = {
    ref_object: 'named_object',
    ref_id: 'r_named',
    ref_field: 'named_field',
    released_ref_object: 'named_released_object',
    released_ref_id: 'r_named_released',
  } as const;

  /** A committed upload claimed by a fresh `media` record's `poster`: the lifecycle's own claim. */
  const claimedUpload = async () => {
    const fileId = await committedUpload();
    const recordId = `m_${++seq}`;
    await engine.insert('media', { id: recordId, name: 'owner', poster: fileId } as any, { context: WRITER_CTX });
    return { fileId, recordId };
  };

  it('declares exactly the five file-reference columns, each readonly on sys_file', () => {
    expect([...SYS_FILE_REFERENCE_COLUMNS].sort()).toEqual([
      'ref_field', 'ref_id', 'ref_object', 'released_ref_id', 'released_ref_object',
    ]);
    for (const column of SYS_FILE_REFERENCE_COLUMNS) {
      expect((SystemFile.fields as Record<string, { readonly?: boolean }>)[column]?.readonly, column).toBe(true);
    }
  });

  it.each(SYS_FILE_REFERENCE_COLUMNS)('an update by id cannot change %s, and the rest of the write lands', async (column) => {
    const { fileId } = await claimedUpload();
    const before = await references(fileId);
    expect(before.ref_object).toBe('media');

    await engine.update('sys_file', { id: fileId, name: 'renamed.png', [column]: NAMED[column] } as any, { context: WRITER_CTX });

    expect(await references(fileId)).toEqual(before);
    expect((await fileRow(fileId))?.name).toBe('renamed.png');
  });

  it('a predicate update cannot change any of them either', async () => {
    const fileId = await committedUpload();

    await engine.update('sys_file', { ...NAMED, acl: 'private' } as any, { where: { id: fileId }, context: WRITER_CTX } as any);

    expect(await references(fileId)).toEqual(UNREFERENCED);
    expect((await fileRow(fileId))?.acl).toBe('private');
  });

  it('a create cannot set any of them: the row is written with none of the caller\'s values', async () => {
    const fileId = `f_named_${++seq}`;

    await engine.insert('sys_file', { id: fileId, name: 'named.png', owner_id: WRITER, ...NAMED } as any, { context: WRITER_CTX });

    expect(await references(fileId)).toEqual(UNREFERENCED);
    expect((await fileRow(fileId))?.name).toBe('named.png');
  });

  it('a batch create cannot set them on any row', async () => {
    const a = `f_named_${++seq}`;
    const b = `f_named_${++seq}`;

    await engine.insert('sys_file', [
      { id: a, name: 'a.png', ...NAMED },
      { id: b, name: 'b.png', ref_object: 'media', ref_id: 'm_other', ref_field: 'poster' },
    ] as any, { context: WRITER_CTX });

    expect(await references(a)).toEqual(UNREFERENCED);
    expect(await references(b)).toEqual(UNREFERENCED);
  });

  it('the lifecycle\'s claim, release and copy still write them', async () => {
    const { fileId, recordId } = await claimedUpload();
    expect(await references(fileId)).toEqual({ ...UNREFERENCED, ref_object: 'media', ref_id: recordId, ref_field: 'poster' });

    // Writing the owned id into a second slot copies the file into a fresh row the second slot owns.
    const second = `m_${++seq}`;
    await engine.insert('media', { id: second, name: 'second', poster: fileId } as any, { context: WRITER_CTX });
    const copyId = (await record(second))?.poster as string;
    expect(copyId).not.toBe(fileId);
    expect(await references(copyId)).toEqual({ ...UNREFERENCED, ref_object: 'media', ref_id: second, ref_field: 'poster' });

    // Clearing the field releases the file and keeps the record that let it go.
    await engine.update('media', { id: recordId, poster: null } as any, { context: WRITER_CTX });
    expect(await references(fileId)).toEqual({ ...UNREFERENCED, released_ref_object: 'media', released_ref_id: recordId });
  });

  it('a system create and a system update keep the values they write', async () => {
    const fileId = `f_system_${++seq}`;

    await engine.insert('sys_file', { id: fileId, name: 'system.png', ...NAMED } as any, { context: SYS });
    expect(await references(fileId)).toEqual({ ...NAMED });

    await engine.update('sys_file', { id: fileId, ...UNREFERENCED, ref_object: 'media', ref_id: 'm_system' } as any, { context: SYS });
    expect(await references(fileId)).toEqual({ ...UNREFERENCED, ref_object: 'media', ref_id: 'm_system' });
  });

  // ── The presence of `key` and `status` (#27778) ───────────────────

  it('every storage writer sets key and status: presign, complete and the field copy', async () => {
    const { fileId: presigned } = await presign();
    const pendingRow = await owned(presigned);
    expect(pendingRow.status).toBe('pending');
    expect(typeof pendingRow.key === 'string' && pendingRow.key.length > 0, JSON.stringify(pendingRow)).toBe(true);

    const { fileId } = await claimedUpload();
    const committedRow = await owned(fileId);
    expect(committedRow.status).toBe('committed');
    expect(typeof committedRow.key === 'string' && committedRow.key.length > 0, JSON.stringify(committedRow)).toBe(true);

    const second = `m_${++seq}`;
    await engine.insert('media', { id: second, name: 'copy', poster: fileId } as any, { context: WRITER_CTX });
    const copyRow = await owned((await record(second))?.poster as string);
    expect(copyRow.status).toBe('committed');
    expect(typeof copyRow.key === 'string' && copyRow.key.length > 0, JSON.stringify(copyRow)).toBe(true);
    expect(copyRow.key).not.toBe(committedRow.key);
  });
});
