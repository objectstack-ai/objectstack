// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #33125 — a file uploaded through an upload link that names no record, and
 * that no record took, is reclaimed by the platform sweep (ruling A, record
 * 6868819455: only these files; the console's own never-saved uploads are not
 * touched).
 *
 * Such a file lands `committed` with `deleted_at` stamped at the upload: the
 * stamp is what puts it on the `sys_file` lifecycle's one existing `ttl`
 * (30 days from `deleted_at`), so no sweeper is added (ADR-0057 §3.3). A
 * record write that names it clears the stamp, and the reap guard asks the
 * one hold question again at sweep time, so a file a record names is never
 * reclaimed. The byte delete stays behind the file-as-reference gate every
 * non-attachments reclaim is behind.
 *
 * Driven as it ships: one real `ObjectQL` over sqlite `:memory:`,
 * `StorageServicePlugin` on the local adapter booted through `kernel:ready`
 * and `kernel:bootstrapped` (its own reap guard, registered with a real
 * `LifecycleService`), the upload link minted through the file-attachments
 * service and used through its route, and the sweep run with its clock moved
 * past the window.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IStorageService, RouteHandler } from '@objectstack/spec/contracts';
import { RAW_FILE_VALUES_CONTEXT_KEY, type EngineQueryOptions } from '@objectstack/spec/data';
import { FILE_REFERENCES_MIGRATION_ID } from '@objectstack/spec/system';
import { ObjectQL, LifecycleService } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { StorageServicePlugin } from './storage-service-plugin.js';
import type { FileAttachmentService } from './file-attachment-service.js';
import { installDefaultOrganization, DEFAULT_ORGANIZATION_ID } from './default-organization.testkit.js';

const BASE = '/api/v1/storage';
const SYS = { isSystem: true };
const SYS_RAW = { isSystem: true, [RAW_FILE_VALUES_CONTEXT_KEY]: true };
const ORG = DEFAULT_ORGANIZATION_ID;
const OWNER = { userId: 'u_owner', tenantId: ORG };
const DAY_MS = 24 * 60 * 60 * 1000;
/** The `sys_file` ttl: a stamped row is a sweep candidate this long after its stamp. */
const TTL_MS = 30 * DAY_MS;

const silentLogger = () => ({
  info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(),
  trace: vi.fn(), fatal: vi.fn(), child() { return this; },
});

type Res = { _status: number; _json: any };

describe('#33125 — an upload for a record that was never created is reclaimed by the platform sweep', () => {
  let rootDir: string;
  let engine: ObjectQL;
  let lifecycle: LifecycleService;
  let files: FileAttachmentService;
  let storage: IStorageService;
  const routes = new Map<string, RouteHandler>();
  /** How far ahead of the wall clock the sweep stands. */
  let sweepAhead = 0;
  /** Whether the file-as-reference migration answers verified with no deviation. */
  let migrationVerified = true;

  beforeAll(async () => {
    rootDir = join(tmpdir(), `os-33125-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(rootDir, { recursive: true });

    engine = new ObjectQL({ logger: silentLogger() } as any);
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }) as any, true);
    await engine.init();

    // The real engine, except that a read of an object this fixture never
    // registered (the permission store the grant resolution consults) answers
    // empty, and the migration ledger answers `migrationVerified`.
    const migrationRow = () => ({
      id: FILE_REFERENCES_MIGRATION_ID,
      last_run_at: new Date().toISOString(),
      verified_at: migrationVerified ? new Date().toISOString() : null,
      blocking: 0,
      deviation_observed_at: null,
    });
    const dataEngine = new Proxy(engine, {
      get(target, prop) {
        if (prop === 'find') {
          return (object: string, query?: EngineQueryOptions, options?: unknown) =>
            target.getSchema(object) ? target.find(object, query, options as never) : Promise.resolve([]);
        }
        if (prop === 'getObject') {
          return (name: string) => (name === 'sys_migration' ? { name } : target.getObject(name));
        }
        if (prop === 'findOne') {
          return (object: string, ...rest: unknown[]) =>
            object === 'sys_migration'
              ? Promise.resolve(migrationRow())
              : (target.findOne as (...a: unknown[]) => unknown)(object, ...rest);
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    lifecycle = new LifecycleService({
      getEngine: () => engine as any,
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
      now: () => Date.now() + sweepAhead,
      referenceAudit: { enabled: false },
    });

    const services = new Map<string, unknown>();
    const phases = new Map<string, Array<() => unknown>>();
    const mount = (m: string) => (path: string, handler: RouteHandler) => { routes.set(`${m}:${path}`, handler); };
    const ctx = {
      logger: silentLogger(),
      registerService: (name: string, svc: unknown) => { services.set(name, svc); },
      getService: <T>(name: string): T => {
        if (!services.has(name)) throw new Error(`service '${name}' not registered`);
        return services.get(name) as T;
      },
      hook: (event: string, fn: () => unknown) => { phases.set(event, [...(phases.get(event) ?? []), fn]); },
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
      id: 'com.objectstack.test.pre-record-upload-reclaim',
      name: 'Pre-record upload reclaim',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      objects: [{
        name: 'expense_line',
        label: 'Expense line',
        enable: { files: true },
        fields: {
          invoice_no: { name: 'invoice_no', type: 'text' },
          invoice: { name: 'invoice', label: 'E-invoice', type: 'file' },
          photos: { name: 'photos', label: 'Photos', type: 'image', multiple: true },
        },
      }],
    } as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);
    // The uploader is a current member of the organization the links are
    // minted in (ADR-0093 D8.1). Data at rest, seeded through the driver.
    engine.registry.registerObject(
      {
        name: 'sys_member', label: 'Member', managedBy: 'better-auth',
        fields: { user_id: { type: 'text', label: 'User' }, organization_id: { type: 'text', label: 'Organization' }, role: { type: 'text', label: 'Role' } },
      },
      '@objectstack/service-storage',
    );
    await engine.syncSchemas();
    await engine.getDriverForObject('sys_member')!.create('sys_member', { id: `mem_${OWNER.userId}`, user_id: OWNER.userId, organization_id: ORG, role: 'member' });

    await plugin.start(ctx as any);
    for (const fn of phases.get('kernel:ready') ?? []) await fn();
    for (const fn of phases.get('kernel:bootstrapped') ?? []) await fn();

    files = ctx.getService<FileAttachmentService>('file-attachments');
    storage = ctx.getService<IStorageService>('storage');
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* already torn down */ }
    if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
  });

  const call = async (method: string, path: string, req: Record<string, unknown> = {}): Promise<Res> => {
    const res: any = {
      _status: 200, _json: null,
      json(data: any) { res._json = data; return res; },
      send() { return res; },
      status(code: number) { res._status = code; return res; },
      header() { return res; },
    };
    const handler = routes.get(`${method}:${path}`);
    if (!handler) throw new Error(`no route ${method} ${path}`);
    await handler({ params: {}, query: {}, headers: {}, method, path, ...req } as any, res);
    return res;
  };
  const tokenOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

  /** Mint a link for `expense_line`.`field` naming no record, and upload `count` files through it. */
  const uploadForNewRecord = async (field: 'invoice' | 'photos' = 'invoice', count = 1): Promise<string[]> => {
    const grant = await files.createUploadLinkForNewRecordAs(
      'expense_line', { field, ...(count > 1 ? { count } : {}) } as never, OWNER as never,
    );
    const token = tokenOf(grant.path);
    const headers: Record<string, string> = { 'x-test-user': OWNER.userId };
    let res: Res;
    if (count > 1) {
      // The page's several-file submit: `count` and `file0` … `fileN-1`.
      const body: Record<string, unknown> = { count: String(count) };
      for (let i = 0; i < count; i++) {
        body[`file${i}`] = new File([new Uint8Array([137, 80, 78, 71, i])], `p${i}.png`, { type: 'image/png' });
      }
      res = await call('PUT', `${BASE}/upload-links/:token`, {
        params: { token },
        headers: { ...headers, 'content-type': 'multipart/form-data; boundary=----os', 'x-upload-link-form': 'several' },
        body,
        rawBody: async () => Buffer.from('------os--\r\n'),
      });
    } else {
      res = await call('PUT', `${BASE}/upload-links/:token`, {
        params: { token },
        headers: { ...headers, 'content-type': 'application/pdf', 'x-file-name': encodeURIComponent('invoice.pdf') },
        rawBody: async () => Buffer.from('%PDF-1.4 taxi receipt'),
      });
    }
    expect(res._status, JSON.stringify(res._json)).toBe(200);
    return grant.fileIds as string[];
  };

  const fileRow = async (id: string) =>
    ((await engine.find('sys_file', { where: { id }, context: SYS } as never)) as Array<Record<string, any>>)[0] ?? null;
  const record = async (id: string) =>
    ((await engine.find('expense_line', { where: { id }, context: SYS_RAW } as never)) as Array<Record<string, any>>)[0];
  /** Run the platform sweep with its clock `aheadMs` past now. */
  const sweepAt = async (aheadMs: number) => {
    sweepAhead = aheadMs;
    try {
      const report = await lifecycle.sweep();
      expect(report.errors, JSON.stringify(report.errors)).toEqual([]);
      return report;
    } finally {
      sweepAhead = 0;
    }
  };
  const bytesOf = async (id: string) => {
    const row = await fileRow(id);
    return row?.key ? storage.exists(row.key as string) : false;
  };

  it('measured: an upload no record took is reclaimed past the window, row and bytes', async () => {
    const [fileId] = await uploadForNewRecord();
    const landed = await fileRow(fileId);
    expect(landed).toMatchObject({ status: 'committed', ref_id: null });
    // The upload is what starts the window: `deleted_at` is stamped as it lands.
    expect(landed.deleted_at, 'the upload stamps deleted_at').toBeTruthy();
    const key = landed.key as string;
    expect(await storage.exists(key)).toBe(true);

    await sweepAt(TTL_MS + DAY_MS);

    expect(await fileRow(fileId), 'the abandoned upload is reaped').toBeNull();
    expect(await storage.exists(key), 'and its bytes reclaimed').toBe(false);
  });

  it('inside the window it is untouched: committed, stamped, bytes kept', async () => {
    const [fileId] = await uploadForNewRecord();
    await sweepAt(TTL_MS - DAY_MS);
    const row = await fileRow(fileId);
    expect(row).toMatchObject({ status: 'committed', ref_id: null });
    expect(row.deleted_at).toBeTruthy();
    expect(await bytesOf(fileId)).toBe(true);
  });

  it('named by its file field: the creating write clears the stamp, and the sweep past the window keeps it', async () => {
    const [fileId] = await uploadForNewRecord();
    const line = await engine.insert('expense_line', { invoice_no: 'INV-1', invoice: fileId }, { context: OWNER } as never);
    const claimed = await fileRow(fileId);
    expect(claimed).toMatchObject({ status: 'committed', ref_object: 'expense_line', ref_id: String(line.id), ref_field: 'invoice' });
    expect(claimed.deleted_at, 'the claim clears the stamp').toBeNull();

    await sweepAt(TTL_MS + DAY_MS);

    expect(await fileRow(fileId)).toMatchObject({ status: 'committed', ref_id: String(line.id), deleted_at: null });
    expect(await bytesOf(fileId)).toBe(true);
    expect((await record(String(line.id))).invoice).toBe(fileId);
  });

  it('named by an update of an existing record: the stamp clears as on a create', async () => {
    const line = await engine.insert('expense_line', { invoice_no: 'INV-2' }, { context: SYS } as never);
    const [fileId] = await uploadForNewRecord();
    await engine.update('expense_line', { invoice: fileId }, { where: { id: line.id }, context: OWNER } as never);
    expect(await fileRow(fileId)).toMatchObject({ ref_id: String(line.id), deleted_at: null });
    await sweepAt(TTL_MS + DAY_MS);
    expect(await bytesOf(fileId)).toBe(true);
  });

  it('named by a multi-file field: every file of the submit is claimed and kept', async () => {
    const ids = await uploadForNewRecord('photos', 3);
    for (const id of ids) expect((await fileRow(id)).deleted_at).toBeTruthy();
    const line = await engine.insert('expense_line', { invoice_no: 'INV-3', photos: ids }, { context: OWNER } as never);
    await sweepAt(TTL_MS + DAY_MS);
    for (const id of ids) {
      expect(await fileRow(id)).toMatchObject({ ref_id: String(line.id), ref_field: 'photos', deleted_at: null });
      expect(await bytesOf(id)).toBe(true);
    }
  });

  it('named by an attachment row the lifecycle did not see: the sweep keeps it and clears the stamp', async () => {
    const [fileId] = await uploadForNewRecord();
    const line = await engine.insert('expense_line', { invoice_no: 'INV-4' }, { context: SYS } as never);
    // A join row written straight through the driver: no hook saw it, so only
    // the sweep's own hold question can find it.
    await engine.getDriverForObject('sys_attachment')!.create('sys_attachment', {
      id: `att_${fileId}`, file_id: fileId, parent_object: 'expense_line', parent_id: String(line.id), organization_id: ORG,
    });

    await sweepAt(TTL_MS + DAY_MS);

    expect(await fileRow(fileId)).toMatchObject({ status: 'committed', deleted_at: null });
    expect(await bytesOf(fileId)).toBe(true);
  });

  it('a file uploaded before this change carries no stamp and is never a sweep candidate', async () => {
    const [fileId] = await uploadForNewRecord();
    // The row as an upload before the change left it: committed, unclaimed, no stamp.
    await engine.update('sys_file', { deleted_at: null }, { where: { id: fileId }, context: SYS } as never);
    await sweepAt(10 * TTL_MS);
    expect(await fileRow(fileId)).toMatchObject({ status: 'committed', ref_id: null, deleted_at: null });
    expect(await bytesOf(fileId)).toBe(true);
  });

  it('control: a console upload that no record took is not touched (ruling A)', async () => {
    const headers = { 'x-test-user': OWNER.userId };
    const presigned = await call('POST', `${BASE}/upload/presigned`, {
      headers, body: { filename: 'form.pdf', mimeType: 'application/pdf', size: 8 },
    });
    expect(presigned._status, JSON.stringify(presigned._json)).toBe(200);
    const { fileId, uploadUrl } = presigned._json.data as { fileId: string; uploadUrl: string };
    const put = await call('PUT', `${BASE}/_local/raw/:token`, {
      params: { token: tokenOf(uploadUrl) }, rawBody: async () => Buffer.from('%PDF-1.4'),
    });
    expect(put._status, JSON.stringify(put._json)).toBe(200);
    const done = await call('POST', `${BASE}/upload/complete`, { headers, body: { fileId } });
    expect(done._status, JSON.stringify(done._json)).toBe(200);
    expect(await fileRow(fileId)).toMatchObject({ status: 'committed', ref_id: null, deleted_at: null });

    await sweepAt(10 * TTL_MS);

    expect(await fileRow(fileId)).toMatchObject({ status: 'committed', deleted_at: null });
    expect(await bytesOf(fileId)).toBe(true);
  });

  it('the file-as-reference gate closed: past the window the row and bytes stay, and go once it opens', async () => {
    const [fileId] = await uploadForNewRecord();
    migrationVerified = false;
    try {
      await sweepAt(TTL_MS + DAY_MS);
      expect(await fileRow(fileId)).toMatchObject({ status: 'committed', ref_id: null });
      expect((await fileRow(fileId)).deleted_at).toBeTruthy();
      expect(await bytesOf(fileId)).toBe(true);
    } finally {
      migrationVerified = true;
    }
    await sweepAt(TTL_MS + DAY_MS);
    expect(await fileRow(fileId)).toBeNull();
  });
});
