// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #26533 — the pending-upload retention never reaps a file a record holds.
 *
 * `sys_file` declares a 7-day retention on `status: pending` rows: a presigned
 * upload nobody completed is reclaimed, row and bytes, by the platform sweep
 * through {@link createSysFileReapGuard}. Before #26531 a signed-in record
 * write could claim such a file: the record kept the id, and the row was
 * stamped with `ref_*` while it stayed `pending`. A system write still leaves
 * that state today (the seed loader writes the record before `claimFiles`
 * commits the row). The guard's pending branch deleted the bytes without
 * asking whether anything held the file, so seven days later the record named
 * an id whose bytes were gone.
 *
 * Now the pending branch asks the one hold question the `deleted` branch asks
 * ({@link findFileHolder}): a held pending file is kept and named in a warning
 * for an operator, and stays `pending` (committing it would skip the byte
 * check `/upload/complete` makes, #24548). An unheld pending file of the same
 * age is reaped as before.
 *
 * Driven as it ships: one real `ObjectQL` engine over sqlite `:memory:`,
 * `StorageServicePlugin` booted on the local adapter (its own reap guard,
 * registered with a real `LifecycleService`), the upload doors called as
 * routes, and the sweep run with its clock past the retention.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RouteHandler } from '@objectstack/spec/contracts';
import type { IStorageService } from '@objectstack/spec/contracts';
import { RAW_FILE_VALUES_CONTEXT_KEY, type EngineQueryOptions } from '@objectstack/spec/data';
import { ObjectQL, LifecycleService } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { StorageServicePlugin } from './storage-service-plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const BASE = '/api/v1/storage';
const SYS = { isSystem: true };
const SYS_RAW = { isSystem: true, [RAW_FILE_VALUES_CONTEXT_KEY]: true };
const WRITER = 'u_writer';
const DAY_MS = 24 * 60 * 60 * 1000;

const recordingLogger = () => ({
  info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(),
  trace: vi.fn(), fatal: vi.fn(), child() { return this; },
});

type Res = { _status: number; _json: any };

describe('#26533 — the pending-upload retention never reaps a file a record holds', () => {
  let rootDir: string;
  let engine: ObjectQL;
  let lifecycle: LifecycleService;
  let storage: IStorageService;
  const logger = recordingLogger();
  const routes = new Map<string, RouteHandler>();

  beforeAll(async () => {
    rootDir = join(tmpdir(), `os-26533-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(rootDir, { recursive: true });

    engine = new ObjectQL({ logger: recordingLogger() } as any);
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

    // The sweep's clock stands eight days ahead: every row created below is
    // past the 7-day pending-upload retention.
    lifecycle = new LifecycleService({
      getEngine: () => engine as any,
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
      now: () => Date.now() + 8 * DAY_MS,
      referenceAudit: { enabled: false },
    });

    const services = new Map<string, unknown>();
    const ready: Array<() => Promise<void> | void> = [];
    const mount = (m: string) => (path: string, handler: RouteHandler) => { routes.set(`${m}:${path}`, handler); };
    const ctx = {
      logger,
      registerService: (name: string, svc: unknown) => { services.set(name, svc); },
      getService: <T>(name: string): T => {
        if (!services.has(name)) throw new Error(`service '${name}' not registered`);
        return services.get(name) as T;
      },
      hook: (event: string, fn: () => Promise<void> | void) => { if (event === 'kernel:ready') ready.push(fn); },
    };
    ctx.registerService('objectql', dataEngine);
    ctx.registerService('lifecycle', lifecycle);
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

    engine.registerApp({
      id: 'com.objectstack.test.pending-claimed-file-reap',
      name: 'Pending claimed file reap',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      objects: [{
        name: 'media',
        label: 'Media',
        fields: {
          name: { name: 'name', type: 'text' },
          poster: { name: 'poster', label: 'Poster', type: 'image' },
        },
      }],
    } as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);
    await plugin.start(ctx as any);
    for (const fn of ready) await fn();
    storage = services.get('storage') as IStorageService;
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

  /** Presign, then PUT the bytes. `/upload/complete` is never called, so the row stays `pending`. */
  const pendingUpload = async (filename: string) => {
    const bytes = Buffer.alloc(100, 1);
    const presigned = await call('POST', `${BASE}/upload/presigned`, {
      body: { filename, mimeType: 'image/png', size: bytes.byteLength },
    });
    expect(presigned._status, JSON.stringify(presigned._json)).toBe(200);
    const { fileId, uploadUrl } = presigned._json.data as { fileId: string; uploadUrl: string };
    const token = uploadUrl.slice(uploadUrl.lastIndexOf('/') + 1);
    const put = await call('PUT', `${BASE}/_local/raw/:token`, { params: { token }, rawBody: async () => bytes });
    expect(put._status, JSON.stringify(put._json)).toBe(200);
    return fileId;
  };

  const fileRow = async (id: string) =>
    ((await engine.find('sys_file', { where: { id }, context: SYS })) as Array<Record<string, any>>)[0] ?? null;
  const record = async (id: string) =>
    ((await engine.find('media', { where: { id }, context: SYS_RAW })) as Array<Record<string, any>>)[0];

  it('past the retention, a pending file a record holds keeps its bytes and row; an unheld one is reaped', async () => {
    const claimed = await pendingUpload('claimed.png');
    const abandoned = await pendingUpload('abandoned.png');
    // The state a signed-in write left before #26531 (and a system write
    // still leaves): the record holds the id, and the row carries `ref_*`
    // while it stays `pending`.
    await engine.insert('media', { id: 'm_1', name: 'm_1', poster: claimed } as any, { context: SYS });
    const before = await fileRow(claimed);
    expect(before).toMatchObject({ status: 'pending', ref_object: 'media', ref_id: 'm_1', ref_field: 'poster' });
    const claimedKey = before!.key as string;
    const abandonedKey = (await fileRow(abandoned))!.key as string;
    expect(await storage.exists(claimedKey)).toBe(true);
    expect(await storage.exists(abandonedKey)).toBe(true);

    const report = await lifecycle.sweep();

    expect(report.errors, JSON.stringify(report.errors)).toEqual([]);
    // The held file: bytes and row kept, still `pending`, still owned.
    expect(await storage.exists(claimedKey), 'the held file keeps its bytes').toBe(true);
    expect(await fileRow(claimed)).toMatchObject({
      status: 'pending', ref_object: 'media', ref_id: 'm_1', ref_field: 'poster',
    });
    expect((await record('m_1'))?.poster).toBe(claimed);
    // Flagged for an operator, naming the file and its holder.
    const warned = logger.warn.mock.calls.map((c) => String(c[0])).filter((line) => line.includes(claimed));
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('media/m_1.poster');
    // The unheld file of the same age: reaped, bytes and row.
    expect(await fileRow(abandoned), 'the abandoned upload is reaped').toBeNull();
    expect(await storage.exists(abandonedKey)).toBe(false);
  });
});
