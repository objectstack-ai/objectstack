// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #30892 — a record's files, read and attached for a caller the host has
 * resolved (the MCP door's `read_file` and `create_upload_link`).
 *
 * The pins the card names, each through the doors as they ship — one real
 * `ObjectQL` over sqlite `:memory:`, `StorageServicePlugin` on the local
 * adapter booted through `kernel:ready` and `kernel:bootstrapped`, the
 * upload-link doors called as routes:
 *
 *  - access follows the record, for reading and for attaching: a record the
 *    caller cannot read answers `RECORD_NOT_FOUND` exactly as reading it does,
 *    and a link needs a record the caller may edit;
 *  - the size cap: bytes come back only within `maxBytes`, the link always;
 *  - single use and expiry, with one same-shaped answer for a used, an
 *    expired and an unknown link (page and `PUT` alike);
 *  - the binding to one record and one field (or the attachments list);
 *  - the upload counts: it meets `max_upload_mb` before the link is spent,
 *    and lands as the minting user's committed `sys_file` of its byte size.
 *
 * Record access is the fixture's stand-in for row-level security: a
 * middleware scopes every non-system read of `claim` to the caller's own rows
 * (the reviewer reads every claim), and a `sharing` service's `checkEdit`
 * lets only a claim's owner edit it.
 */

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RouteHandler } from '@objectstack/spec/contracts';
import { RAW_FILE_VALUES_CONTEXT_KEY, type EngineQueryOptions } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { StorageServicePlugin } from './storage-service-plugin.js';
import type { SwappableStorageService } from './swappable-storage-service.js';
import type { FileAttachmentService } from './file-attachment-service.js';
import { installDefaultOrganization, DEFAULT_ORGANIZATION_ID } from './default-organization.testkit.js';
import { UPLOAD_LINK_TTL_SECONDS } from './record-file-access.js';
import { UPLOAD_LINK_UNUSABLE_MESSAGE } from './upload-link-wire.js';

const BASE = '/api/v1/storage';
const SYS = { isSystem: true };
const SYS_RAW = { isSystem: true, [RAW_FILE_VALUES_CONTEXT_KEY]: true };
const ORG = DEFAULT_ORGANIZATION_ID;
const OWNER = { userId: 'u_owner', tenantId: ORG };
const REVIEWER = { userId: 'u_reviewer', tenantId: ORG };
const OUTSIDER = { userId: 'u_outsider', tenantId: ORG };
const READ_OPS = new Set(['find', 'findOne', 'count', 'aggregate']);
const MIB = 1024 * 1024;

const silentLogger = () => ({
  info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(),
  trace: vi.fn(), fatal: vi.fn(), child() { return this; },
});

type Res = { _status: number; _json: any; _sent: unknown; _headers: Record<string, string> };

const refusalOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: any) => ({ code: e?.code as string | undefined, status: e?.status as number | undefined, message: String(e?.message) }),
  );

describe('#30892 — a record\'s files for a resolved caller: read one, attach one through a single-use link', () => {
  let rootDir: string;
  let engine: ObjectQL;
  let files: FileAttachmentService;
  let storage: SwappableStorageService;
  const routes = new Map<string, RouteHandler>();
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    rootDir = join(tmpdir(), `os-30892-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
    // empty.
    const dataEngine = new Proxy(engine, {
      get(target, prop) {
        if (prop === 'find') {
          return (object: string, query?: EngineQueryOptions, options?: unknown) =>
            target.getSchema(object) ? target.find(object, query, options as never) : Promise.resolve([]);
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
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
    // Only a claim's owner may edit it (the attach rule's parent-EDIT verdict).
    ctx.registerService('sharing', {
      checkEdit: async (object: string, id: string, context: { userId?: string }) => {
        if (object !== 'claim') return 'abstain';
        const row = await engine.findOne('claim', { where: { id } }, { context: SYS } as never);
        return row && row.owner === context.userId ? 'allow' : 'deny';
      },
    });

    const plugin = new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false });
    await plugin.init(ctx as any);

    engine.registerApp({
      id: 'com.objectstack.test.record-file-access',
      name: 'Record file access',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      objects: [{
        name: 'claim',
        label: 'Claim',
        enable: { files: true },
        fields: {
          name: { name: 'name', type: 'text' },
          owner: { name: 'owner', type: 'text' },
          policy: { name: 'policy', label: 'Policy', type: 'file' },
          photos: { name: 'photos', label: 'Photos', type: 'image', multiple: true },
          receipt: { name: 'receipt', label: 'Receipt', type: 'file', maxSize: 64 },
        },
      }],
    } as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);

    // Row-level security, as the fixture stands it in: a caller reads its own
    // claims; the reviewer reads every claim.
    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      const c = op.context;
      if (READ_OPS.has(op.operation) && c && !c.isSystem && c.userId !== REVIEWER.userId && op.ast) {
        const mine = { owner: c.userId ?? '__nobody__' };
        op.ast.where = op.ast.where ? { $and: [op.ast.where, mine] } : mine;
      }
      // The write side: a by-id update of a claim the caller does not own is
      // refused, as the security service refuses a write it does not admit.
      if (op.operation === 'update' && c && !c.isSystem) {
        const id = op.options?.where?.id;
        const row = id ? await engine.findOne('claim', { where: { id } }, { context: SYS } as never) : null;
        if (!row || row.owner !== c.userId) {
          throw Object.assign(new Error(`You cannot edit claim ${String(id)}`), { code: 'PERMISSION_DENIED', status: 403 });
        }
      }
      return next();
    }, { object: 'claim' });

    await plugin.start(ctx as any);
    for (const fn of phases.get('kernel:ready') ?? []) await fn();
    for (const fn of phases.get('kernel:bootstrapped') ?? []) await fn();

    files = ctx.getService<FileAttachmentService>('file-attachments');
    storage = ctx.getService<SwappableStorageService>('storage');

    ids.claimA = (await engine.insert('claim', { name: 'A', owner: OWNER.userId, organization_id: ORG }, { context: SYS } as never)).id;
    ids.claimB = (await engine.insert('claim', { name: 'B', owner: OWNER.userId, organization_id: ORG }, { context: SYS } as never)).id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* already torn down */ }
    if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
  });

  /** Call a storage route; a session is whatever `x-test-user` the request carries. */
  const call = async (method: string, path: string, req: Record<string, unknown> = {}): Promise<Res> => {
    const res: any = {
      _status: 200, _json: null, _sent: undefined, _headers: {},
      json(data: any) { res._json = data; return res; },
      send(body: unknown) { res._sent = body; return res; },
      status(code: number) { res._status = code; return res; },
      header(name: string, value: string) { res._headers[name.toLowerCase()] = value; return res; },
    };
    const handler = routes.get(`${method}:${path}`);
    if (!handler) throw new Error(`no route ${method} ${path}`);
    await handler({ params: {}, query: {}, headers: {}, method, path, ...req } as any, res);
    return res;
  };
  const tokenOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
  /** The session a link request carries: the minting owner's unless named, none for `null`. */
  const sessionOf = (user: string | null): Record<string, string> => (user === null ? {} : { 'x-test-user': user });
  const openLink = (token: string, user: string | null = OWNER.userId) =>
    call('GET', `${BASE}/upload-links/:token`, { params: { token }, headers: sessionOf(user) });
  const useLink = (token: string, bytes: Buffer, headers: Record<string, string> = {}, user: string | null = OWNER.userId) =>
    call('PUT', `${BASE}/upload-links/:token`, {
      params: { token },
      headers: { 'content-type': 'application/pdf', 'x-file-name': encodeURIComponent('scan 1.pdf'), ...headers, ...sessionOf(user) },
      rawBody: async () => bytes,
    });

  const fileRow = async (id: string) =>
    ((await engine.find('sys_file', { where: { id }, context: SYS } as never)) as Array<Record<string, any>>)[0];
  const claim = async (id: string) =>
    ((await engine.find('claim', { where: { id }, context: SYS_RAW } as never)) as Array<Record<string, any>>)[0];

  /** A link minted by the owner, used once with `bytes`; answers the landed file id. */
  const uploadThroughLink = async (target: { field: string } | { attachments: true }, bytes: Buffer, recordId = ids.claimA) => {
    const grant = await files.createUploadLinkAs('claim', recordId, target, OWNER as never);
    const res = await useLink(tokenOf(grant.path), bytes);
    expect(res._status, JSON.stringify(res._json)).toBe(200);
    return res._json.data as { fileId: string; size: number; field?: string; attachmentId?: string };
  };

  describe('reading', () => {
    it('reads a field\'s file as the owner: its bytes within the cap, its size, the cap, and a short-lived link', async () => {
      const landed = await uploadThroughLink({ field: 'policy' }, Buffer.from('%PDF-1.4 policy'));
      const read = await files.readRecordFileAs('claim', ids.claimA, { field: 'policy' }, OWNER as never, { maxBytes: 1024 });
      expect(read).toMatchObject({ fileId: landed.fileId, name: 'scan 1.pdf', mimeType: 'application/pdf', size: 15, field: 'policy', maxBytes: 1024 });
      expect(read.bytes?.toString()).toBe('%PDF-1.4 policy');
      expect(read.download?.url).toContain(`${BASE}/_local/raw/`);
      const ttl = Date.parse(read.download!.expiresAt) - Date.now();
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(300_000);
    });

    it('answers no bytes over the cap, and still the size, the cap and the link', async () => {
      const read = await files.readRecordFileAs('claim', ids.claimA, { field: 'policy' }, OWNER as never, { maxBytes: 4 });
      expect(read.bytes).toBeUndefined();
      expect(read).toMatchObject({ size: 15, maxBytes: 4 });
      expect(read.download?.url).toContain(`${BASE}/_local/raw/`);
    });

    it('access follows the record: a record the caller cannot read answers RECORD_NOT_FOUND, as reading it does', async () => {
      const asRecordRead = await refusalOf(
        engine.findOne('claim', { where: { id: ids.claimA } }, { context: OUTSIDER } as never).then((row) => {
          if (!row) throw Object.assign(new Error('none'), { code: 'RECORD_NOT_FOUND', status: 404 });
        }),
      );
      expect(asRecordRead).toMatchObject({ code: 'RECORD_NOT_FOUND', status: 404 });
      const read = await refusalOf(files.readRecordFileAs('claim', ids.claimA, { field: 'policy' }, OUTSIDER as never, { maxBytes: MIB }));
      expect(read).toMatchObject({ code: 'RECORD_NOT_FOUND', status: 404, message: `Record "${ids.claimA}" not found in "claim"` });
      const listed = await refusalOf(files.listRecordFilesAs('claim', ids.claimA, OUTSIDER as never));
      expect(listed).toMatchObject({ code: 'RECORD_NOT_FOUND', status: 404 });
      // A caller who reads the record reads its file.
      const reviewer = await files.readRecordFileAs('claim', ids.claimA, { field: 'policy' }, REVIEWER as never, { maxBytes: MIB });
      expect(reviewer.bytes?.toString()).toBe('%PDF-1.4 policy');
    });

    it('refuses the system context and a context with no user', async () => {
      for (const context of [SYS, {}]) {
        const r = await refusalOf(files.readRecordFileAs('claim', ids.claimA, { field: 'policy' }, context as never, { maxBytes: MIB }));
        expect(r).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
      }
    });

    it('names a multi-file field\'s files when none is chosen, and reads the one named', async () => {
      const first = await uploadThroughLink({ field: 'photos' }, Buffer.from('one'));
      const second = await uploadThroughLink({ field: 'photos' }, Buffer.from('two'));
      expect((await claim(ids.claimA)).photos).toEqual([first.fileId, second.fileId]);
      const unnamed = await refusalOf(files.readRecordFileAs('claim', ids.claimA, { field: 'photos' }, OWNER as never, { maxBytes: MIB }));
      expect(unnamed).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      expect(unnamed?.message).toContain(first.fileId);
      const named = await files.readRecordFileAs('claim', ids.claimA, { field: 'photos', fileId: second.fileId }, OWNER as never, { maxBytes: MIB });
      expect(named.bytes?.toString()).toBe('two');
      const notHeld = await refusalOf(
        files.readRecordFileAs('claim', ids.claimA, { field: 'photos', fileId: 'not-held' }, OWNER as never, { maxBytes: MIB }),
      );
      expect(notHeld).toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    });

    it('refuses a field that is not a file field, naming the object\'s file fields', async () => {
      const r = await refusalOf(files.readRecordFileAs('claim', ids.claimA, { field: 'name' }, OWNER as never, { maxBytes: MIB }));
      expect(r).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      expect(r?.message).toContain('policy, photos, receipt');
    });

    it('reads an attachment by its id, and lists the record\'s files with their ids', async () => {
      const landed = await uploadThroughLink({ attachments: true }, Buffer.from('attached bytes'));
      expect(landed.attachmentId).toBeTruthy();
      const read = await files.readRecordFileAs('claim', ids.claimA, { attachmentId: landed.attachmentId! }, OWNER as never, { maxBytes: MIB });
      expect(read).toMatchObject({ fileId: landed.fileId, attachmentId: landed.attachmentId, size: 14 });
      expect(read.bytes?.toString()).toBe('attached bytes');
      const listed = await files.listRecordFilesAs('claim', ids.claimA, OWNER as never);
      expect(listed).toEqual(expect.arrayContaining([
        expect.objectContaining({ field: 'policy' }),
        expect.objectContaining({ attachmentId: landed.attachmentId, fileId: landed.fileId }),
      ]));
      // An attachment of another record is not this record's.
      const elsewhere = await refusalOf(
        files.readRecordFileAs('claim', ids.claimB, { attachmentId: landed.attachmentId! }, OWNER as never, { maxBytes: MIB }),
      );
      expect(elsewhere).toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    });
  });

  describe('minting a link', () => {
    it('answers a token, its path under the storage base, and an expiry ten minutes out', async () => {
      const before = Date.now();
      const grant = await files.createUploadLinkAs('claim', ids.claimA, { field: 'policy' }, OWNER as never);
      expect(grant.path).toBe(`${BASE}/upload-links/${grant.token}`);
      expect(grant.token).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
      const ttl = Date.parse(grant.expiresAt) - before;
      expect(ttl).toBeGreaterThan(UPLOAD_LINK_TTL_SECONDS * 1000 - 5_000);
      expect(ttl).toBeLessThanOrEqual(UPLOAD_LINK_TTL_SECONDS * 1000 + 1_000);
      // The secret is never stored: the link row carries its SHA-256 alone.
      const row = await fileRow(grant.token.split('.')[0]);
      expect(row.status).toBe('pending');
      expect(row.owner_id).toBe(OWNER.userId);
      expect(String(row.metadata)).not.toContain(grant.token.split('.')[1]);
      expect(row.name).toBe('upload-link');
      expect(JSON.parse(row.metadata)).toMatchObject({ kind: 'upload_link', object: 'claim', record_id: ids.claimA, field: 'policy', user_id: OWNER.userId });
    });

    it('access follows the record: unreadable answers RECORD_NOT_FOUND; readable but not editable is refused 403', async () => {
      for (const target of [{ field: 'policy' }, { attachments: true as const }]) {
        const outsider = await refusalOf(files.createUploadLinkAs('claim', ids.claimA, target, OUTSIDER as never));
        expect(outsider).toMatchObject({ code: 'RECORD_NOT_FOUND', status: 404 });
      }
      const field = await refusalOf(files.createUploadLinkAs('claim', ids.claimA, { field: 'policy' }, REVIEWER as never));
      expect(field).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
      const attachments = await refusalOf(files.createUploadLinkAs('claim', ids.claimA, { attachments: true }, REVIEWER as never));
      expect(attachments).toMatchObject({ code: 'ATTACHMENT_PARENT_ACCESS', status: 403 });
    });

    it('refuses a field that is not a file field', async () => {
      const r = await refusalOf(files.createUploadLinkAs('claim', ids.claimA, { field: 'owner' }, OWNER as never));
      expect(r).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    });
  });

  describe('using a link', () => {
    it('serves the picker page: no record named, never cached, never framed, scripts only by nonce', async () => {
      const grant = await files.createUploadLinkAs('claim', ids.claimB, { field: 'policy' }, OWNER as never);
      const page = await openLink(tokenOf(grant.path));
      expect(page._status).toBe(200);
      expect(page._headers['content-type']).toBe('text/html; charset=utf-8');
      expect(page._headers['cache-control']).toBe('no-store');
      expect(page._headers['referrer-policy']).toBe('no-referrer');
      expect(page._headers['content-security-policy']).toMatch(/default-src 'none'; script-src 'nonce-[^']+'/);
      expect(page._headers['content-security-policy']).toContain("frame-ancestors 'none'");
      const html = String(page._sent);
      expect(html).toContain('<input id="file" type="file">');
      expect(html).not.toContain(ids.claimB);
      expect(html).not.toContain('claim');
      expect(html).not.toContain(OWNER.userId);
    });

    it('lands the upload on exactly the record and field it was minted for, as the minting user\'s committed file', async () => {
      const grant = await files.createUploadLinkAs('claim', ids.claimB, { field: 'policy' }, OWNER as never);
      // Nothing the request says moves the binding: no record, field or user is read from it.
      const res = await useLink(tokenOf(grant.path), Buffer.from('bound bytes'), {
        'x-object': 'claim', 'x-record-id': ids.claimA, 'x-field': 'photos', 'x-user-id': OUTSIDER.userId,
      });
      expect(res._status, JSON.stringify(res._json)).toBe(200);
      expect(res._json).toEqual({ success: true, data: { fileId: expect.any(String), size: 11, field: 'policy' } });
      const fileId = res._json.data.fileId as string;
      expect((await claim(ids.claimB)).policy).toBe(fileId);
      expect((await claim(ids.claimA)).policy).not.toBe(fileId);
      expect((await claim(ids.claimA)).photos).not.toContain(fileId);
      const row = await fileRow(fileId);
      expect(row).toMatchObject({
        status: 'committed', owner_id: OWNER.userId, size: 11, name: 'scan 1.pdf', mime_type: 'application/pdf',
        ref_object: 'claim', ref_id: ids.claimB, ref_field: 'policy',
      });
      expect((await storage.download(row.key)).toString()).toBe('bound bytes');
    });

    it('an attachments link lands a sys_attachment on its record, uploaded by the minting user', async () => {
      const landed = await uploadThroughLink({ attachments: true }, Buffer.from('attachment'), ids.claimB);
      const link = ((await engine.find('sys_attachment', { where: { id: landed.attachmentId }, context: SYS } as never)) as any[])[0];
      expect(link).toMatchObject({ parent_object: 'claim', parent_id: ids.claimB, file_id: landed.fileId, uploaded_by: OWNER.userId });
    });

    it('works once: a second use, a used link\'s page, an unknown and a forged token answer one same-shaped 404', async () => {
      const grant = await files.createUploadLinkAs('claim', ids.claimB, { field: 'policy' }, OWNER as never);
      const token = tokenOf(grant.path);
      expect((await useLink(token, Buffer.from('first')))._status).toBe(200);
      const [id, secret] = token.split('.');
      const forged = `${id}.${secret.slice(0, -1)}${secret.endsWith('A') ? 'B' : 'A'}`;
      const unknown = `00000000-0000-4000-8000-000000000000.${secret}`;
      const answers = [];
      for (const t of [token, forged, unknown, 'not-a-token']) {
        const put = await useLink(t, Buffer.from('again'));
        answers.push({ status: put._status, body: put._json });
        const page = await openLink(t);
        expect(page._status).toBe(404);
        expect(String(page._sent)).toContain('This upload link cannot be used');
      }
      for (const a of answers) {
        expect(a).toEqual({ status: 404, body: { success: false, error: expect.objectContaining({ code: 'RESOURCE_NOT_FOUND', message: UPLOAD_LINK_UNUSABLE_MESSAGE }) } });
      }
      // The used link's row is gone; the field holds the first upload only.
      expect(await fileRow(id)).toBeUndefined();
    });

    it('needs the minting user signed in: no session answers 401 AUTH_REQUIRED on the page and the PUT, and spends nothing', async () => {
      const grant = await files.createUploadLinkAs('claim', ids.claimB, { field: 'policy' }, OWNER as never);
      const token = tokenOf(grant.path);
      const before = (await claim(ids.claimB)).policy;
      const page = await openLink(token, null);
      expect(page._status).toBe(401);
      expect(page._json.error).toMatchObject({ code: 'AUTH_REQUIRED' });
      expect(page._sent).toBeUndefined();
      const put = await useLink(token, Buffer.from('anonymous'), {}, null);
      expect(put._status).toBe(401);
      expect(put._json.error).toMatchObject({ code: 'AUTH_REQUIRED' });
      expect((await claim(ids.claimB)).policy).toBe(before);
      // Still open: the owner, signed in, uses it once.
      expect((await useLink(token, Buffer.from('owner, signed in')))._status).toBe(200);
    });

    it('another signed-in user gets the one unusable-link 404 and spends nothing; the minting user then uses it', async () => {
      const grant = await files.createUploadLinkAs('claim', ids.claimB, { attachments: true }, OWNER as never);
      const token = tokenOf(grant.path);
      for (const user of [REVIEWER.userId, OUTSIDER.userId]) {
        const page = await openLink(token, user);
        expect(page._status).toBe(404);
        expect(String(page._sent)).toContain('This upload link cannot be used');
        const put = await useLink(token, Buffer.from('not mine'), {}, user);
        expect(put._status).toBe(404);
        expect(put._json.error).toMatchObject({ code: 'RESOURCE_NOT_FOUND', message: UPLOAD_LINK_UNUSABLE_MESSAGE });
      }
      const own = await useLink(token, Buffer.from('mine'));
      expect(own._status, JSON.stringify(own._json)).toBe(200);
      expect(own._json.data.attachmentId).toEqual(expect.any(String));
    });

    it('of two concurrent uses exactly one lands', async () => {
      const grant = await files.createUploadLinkAs('claim', ids.claimB, { attachments: true }, OWNER as never);
      const token = tokenOf(grant.path);
      const [a, b] = await Promise.all([useLink(token, Buffer.from('racer a')), useLink(token, Buffer.from('racer b'))]);
      expect([a._status, b._status].sort()).toEqual([200, 404]);
    });

    it('expires: past its expiry the page and the PUT answer the same 404, and nothing lands', async () => {
      const grant = await files.createUploadLinkAs('claim', ids.claimB, { field: 'policy' }, OWNER as never);
      const token = tokenOf(grant.path);
      const before = (await claim(ids.claimB)).policy;
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now + (UPLOAD_LINK_TTL_SECONDS + 1) * 1000);
      expect((await openLink(token))._status).toBe(404);
      const put = await useLink(token, Buffer.from('late'));
      expect(put._status).toBe(404);
      expect(put._json.error).toMatchObject({ code: 'RESOURCE_NOT_FOUND', message: UPLOAD_LINK_UNUSABLE_MESSAGE });
      vi.restoreAllMocks();
      expect((await claim(ids.claimB)).policy).toBe(before);
    });

    it('counts against the upload limit before the link is spent: 413, then a smaller file lands through the same link', async () => {
      const grant = await files.createUploadLinkAs('claim', ids.claimB, { attachments: true }, OWNER as never);
      const token = tokenOf(grant.path);
      storage.setLimitsSnapshot({ maxUploadMb: { value: 1, authored: true } } as never);
      try {
        const over = await useLink(token, Buffer.alloc(MIB + 1, 7));
        expect(over._status).toBe(413);
        expect(over._json.error.code).toBe('PAYLOAD_TOO_LARGE');
        const declared = await useLink(token, Buffer.alloc(10, 7), { 'content-length': String(MIB + 1) });
        expect(declared._status).toBe(413);
        const ok = await useLink(token, Buffer.alloc(1024, 7));
        expect(ok._status, JSON.stringify(ok._json)).toBe(200);
        expect((await fileRow(ok._json.data.fileId)).size).toBe(1024);
      } finally {
        storage.setLimitsSnapshot({} as never);
      }
    });

    it('acts as the minting user at use: a record they can no longer reach refuses the upload, and nothing lands', async () => {
      const id = (await engine.insert('claim', { name: 'C', owner: OWNER.userId, organization_id: ORG }, { context: SYS } as never)).id;
      const grant = await files.createUploadLinkAs('claim', id, { field: 'policy' }, OWNER as never);
      await engine.update('claim', { owner: OUTSIDER.userId }, { where: { id }, context: SYS } as never);
      const put = await useLink(tokenOf(grant.path), Buffer.from('too late'));
      expect(put._status).toBe(403);
      expect(put._json.error.code).toBe('PERMISSION_DENIED');
      expect((await claim(id)).policy ?? null).toBeNull();
      const stray = (await engine.find('sys_file', { where: { name: 'scan 1.pdf', size: 8 }, context: SYS } as never)) as any[];
      expect(stray).toEqual([]);
    });

    it('the field\'s own constraints judge the upload: over its maxSize is refused, and the stored bytes are removed', async () => {
      const grant = await files.createUploadLinkAs('claim', ids.claimB, { field: 'receipt' }, OWNER as never);
      const put = await useLink(tokenOf(grant.path), Buffer.alloc(65, 1));
      expect(put._status).toBeGreaterThanOrEqual(400);
      expect(put._status).toBeLessThan(500);
      expect((await claim(ids.claimB)).receipt ?? null).toBeNull();
      const stray = (await engine.find('sys_file', { where: { size: 65 }, context: SYS } as never)) as any[];
      expect(stray).toEqual([]);
    });
  });
});
