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
 *
 * #32734 — a link is not issued for a field the caller's write could not
 * change, and an upload the field does not take is refused, never answered as
 * attached. The approval lock is the fixture's stand-in for
 * `@objectstack/plugin-approvals`, in its two shapes: an `approvals` service
 * whose `getRecordLock` answers for the claims in `locked`, and a
 * `beforeUpdate` hook refusing an edit of one as the record-lock hook does
 * (`RECORD_LOCKED`, its status declared as `statusCode: 409`).
 *
 * #32686 — a link that names no record (ruling A): the user uploads, then
 * the creating write names the file id the link answered. Pinned through
 * the same doors: an expense line with a required e-invoice is refused
 * without it and taken with it; the id goes only into the uploader's write,
 * into the object and field it was uploaded for, into one record, within its
 * window; only the uploader downloads it until a record holds it; and a
 * console-style upload and save is taken as before. The create verdict is a
 * `security` service stood in for the span of the case that asks it.
 *
 * #32747 — one link, several files (ruling A): a link for a multi-file field
 * takes up to the cap in one submit, a form of `file0` … `fileN-1` and
 * `count`; every file is judged before the link is spent, and the submit
 * lands all or nothing. A link that names no record answers every id when it
 * is minted, reserving the later ones as rows no write takes before the
 * upload. A single-file field link and an attachments link still take one.
 *
 * #32712 — the page, and the refusals it shows, in the request's language:
 * `Accept-Language`, else the workspace default, else English. The workspace
 * default is the fixture's `settings` service, answering the `localization`
 * namespace's `locale` from `workspaceLocale` and announcing a change to it
 * as the real service does (`subscribe`), so the one resolver's cache drops
 * the earlier answer.
 *
 * #32712 (b) — ruling B′: the page names the record and the field for the
 * link's own user, read as that user when the page opens. Pinned through the
 * page route: both rows in English and Chinese, labels through an `i18n`
 * service stood in for the case, a masked or hidden title degrading to the
 * object's label with the value in no byte of the page, an unreadable field
 * losing its row, a record the owner can no longer read answering the
 * stranger's 404 byte for byte (nonce aside), and opening writing nothing.
 * The field-level answers are a `security` service stood in for the case.
 * The expiry is rewritten in the reader's time zone and checked on the
 * server's clock by the page's own script, run on a stubbed DOM.
 */

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import type { RouteHandler } from '@objectstack/spec/contracts';
import { RAW_FILE_VALUES_CONTEXT_KEY, type EngineQueryOptions } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { StorageServicePlugin } from './storage-service-plugin.js';
import type { SwappableStorageService } from './swappable-storage-service.js';
import type { FileAttachmentService } from './file-attachment-service.js';
import { installDefaultOrganization, DEFAULT_ORGANIZATION_ID } from './default-organization.testkit.js';
import { UPLOAD_LINK_TTL_SECONDS } from './record-file-access.js';
import { PRE_RECORD_CLAIM_WINDOW_SECONDS } from './pre-record-upload.js';
import { resolveThrownHttpError } from '@objectstack/types';
import { UPLOAD_LINK_MAX_FILES, UPLOAD_LINK_UNUSABLE_MESSAGE } from './upload-link-wire.js';
import { uploadSizeRefusal } from './storage-limits.js';
import { UPLOAD_LINK_COPY } from './upload-link-copy.js';
import { sendUploadLinkPage } from './upload-link-page.js';

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
  /** The kernel's services; [#32686] a case may add a `security` service for its own span. */
  const services = new Map<string, unknown>();
  const ids: Record<string, string> = {};
  /** [#32734] The claims a pending approval locks. */
  const locked = new Set<string>();
  /** [#32712] The workspace's default locale, as the `localization` settings answer it; none unless a case sets one. */
  let workspaceLocale: string | undefined;
  const localizationChanged: Array<() => void> = [];
  const setWorkspaceLocale = (locale: string | undefined) => {
    workspaceLocale = locale;
    for (const fn of localizationChanged) fn();
  };

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

    // [#32712] The settings service's `localization` namespace, as the one
    // localization resolver reads it: a grouped read, and a change announced.
    ctx.registerService('settings', {
      get: async (ns: string, key: string) =>
        ns === 'localization' && key === 'locale' && workspaceLocale ? { value: workspaceLocale } : undefined,
      getMany: async (ns: string) =>
        ns === 'localization' && workspaceLocale ? { locale: { value: workspaceLocale } } : {},
      subscribe: (ns: string, fn: () => void) => {
        if (ns === 'localization') localizationChanged.push(fn);
      },
    });

    // [#32734] The approvals service's record-anchored lock answer: for a
    // caller who reads the record, whether a pending approval locks it.
    ctx.registerService('approvals', {
      getRecordLock: async (object: string, id: string, context: unknown) => {
        const row = await engine.findOne(object, { where: { id } }, { context } as never);
        return row ? { locked: locked.has(id) } : null;
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
          // [#32734] A claim's state, a field it locks once approved, and one
          // no user's write changes.
          status: { name: 'status', type: 'text' },
          invoices: { name: 'invoices', label: 'Invoices', type: 'file', multiple: true, readonlyWhen: "record.status == 'approved'" },
          stamp: { name: 'stamp', label: 'Stamp', type: 'file', readonly: true },
          // [#32747] A multi-file field that takes only PDFs: invoices for one claim.
          scans: { name: 'scans', label: 'Scans', type: 'file', multiple: true, accept: ['application/pdf', '.pdf'] },
        },
      }, {
        // [#32686] The measured case: an expense line whose e-invoice is required.
        name: 'expense_line',
        label: 'Expense line',
        fields: {
          invoice_no: { name: 'invoice_no', type: 'text' },
          invoice: { name: 'invoice', label: 'E-invoice', type: 'file', required: true },
        },
      }, {
        // [#32712] A display field that is not title-typed: an explicit
        // `nameField` on a lookup, whose served value is the claim's id.
        name: 'trip',
        label: 'Trip',
        nameField: 'claim_ref',
        fields: {
          claim_ref: { name: 'claim_ref', label: 'For claim', type: 'lookup', reference: 'claim' },
          ticket: { name: 'ticket', label: 'Ticket', type: 'file' },
        },
      }],
    } as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);
    // The callers are current members of the organization their links are
    // minted in: a person's data access requires one, under every posture
    // (ADR-0093 D8.1, as amended). Data at rest, seeded through the driver.
    engine.registry.registerObject(
      {
        name: 'sys_member', label: 'Member', managedBy: 'better-auth',
        fields: { user_id: { type: 'text', label: 'User' }, organization_id: { type: 'text', label: 'Organization' }, role: { type: 'text', label: 'Role' } },
      },
      '@objectstack/service-storage',
    );
    await engine.syncSchemas();
    for (const { userId } of [OWNER, REVIEWER, OUTSIDER]) {
      await engine.getDriverForObject('sys_member')!.create('sys_member', { id: `mem_${userId}`, user_id: userId, organization_id: ORG, role: 'member' });
    }

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
    // [#32734] The record-lock hook's shape: an edit of a locked claim is
    // refused `RECORD_LOCKED`, its status declared as `statusCode`.
    engine.registerHook('beforeUpdate', async (hook: any) => {
      const id = String(hook?.input?.id ?? '');
      if (!locked.has(id) || hook?.session?.isSystem) return;
      const err: any = new Error(`RECORD_LOCKED: Claim '${id}' is locked while an approval is in progress`);
      err.code = 'RECORD_LOCKED';
      err.statusCode = 409;
      throw err;
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
      expect(res._json).toEqual({
        success: true,
        data: { fileId: expect.any(String), fileIds: [expect.any(String)], size: 11, field: 'policy' },
      });
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

    it('a row whose binding names another user than its stamped uploader is no link: the one 404 for both, nothing spent', async () => {
      const grant = await files.createUploadLinkAs('claim', ids.claimB, { attachments: true }, OWNER as never);
      const token = tokenOf(grant.path);
      const [id] = token.split('.');
      const row = await fileRow(id);
      expect(row.owner_id).toBe(OWNER.userId);
      // The binding rewritten through the data door, as a `sys_file` edit grant could: the user is now the reviewer.
      const rewritten = JSON.stringify({ ...JSON.parse(String(row.metadata)), user_id: REVIEWER.userId });
      await engine.update('sys_file', { id, metadata: rewritten } as never, { context: SYS } as never);
      const attachmentsBefore = await engine.count('sys_attachment', { where: { parent_id: ids.claimB }, context: SYS } as never);
      for (const user of [REVIEWER.userId, OWNER.userId]) {
        const page = await openLink(token, user);
        expect(page._status).toBe(404);
        expect(String(page._sent)).toContain('This upload link cannot be used');
        const put = await useLink(token, Buffer.from('rebound'), {}, user);
        expect(put._status).toBe(404);
        expect(put._json.error).toMatchObject({ code: 'RESOURCE_NOT_FOUND', message: UPLOAD_LINK_UNUSABLE_MESSAGE });
      }
      // Not spent: the row is still the open, pending link, and the record gained no attachment.
      expect(await fileRow(id)).toMatchObject({ status: 'pending', name: 'upload-link', owner_id: OWNER.userId });
      expect(await engine.count('sys_attachment', { where: { parent_id: ids.claimB }, context: SYS } as never)).toBe(attachmentsBefore);
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

  describe('#32734 — a field the write cannot change: no link, and never "attached"', () => {
    const openLinkRows = async () =>
      engine.count('sys_file', { where: { name: 'upload-link', status: 'pending' }, context: SYS } as never);
    const filesNamed = async (name: string) =>
      (await engine.find('sys_file', { where: { name }, context: SYS } as never)) as any[];
    const draftClaim = async (name: string) =>
      (await engine.insert('claim', { name, owner: OWNER.userId, status: 'draft', organization_id: ORG }, { context: SYS } as never)).id as string;

    /** Run the picker page's own script against a stubbed DOM and `fetch` answer; resolves the status line it shows. */
    const pageSays = async (html: string, answer: { ok: boolean; body: unknown }): Promise<string> => {
      const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)?.[1];
      expect(script, 'the page carries its upload script').toBeTruthy();
      const handlers: Record<string, () => void> = {};
      const el = (id: string) => ({
        id, disabled: id === 'send', textContent: '',
        files: id === 'file' ? [{ name: 'scan.pdf', type: 'application/pdf' }] : undefined,
        addEventListener: (event: string, fn: () => void) => { handlers[`${id}:${event}`] = fn; },
      });
      const els: Record<string, ReturnType<typeof el>> = { file: el('file'), send: el('send'), status: el('status') };
      runInNewContext(script!, {
        document: { getElementById: (id: string) => els[id] },
        location: { pathname: '/api/v1/storage/upload-links/t' },
        fetch: async () => ({ ok: answer.ok, json: async () => answer.body }),
      });
      handlers['send:click']!();
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
      return els.status.textContent;
    };

    it('minting refuses a readonly field 403 FIELD_NOT_ACCESSIBLE, and writes no link', async () => {
      const before = await openLinkRows();
      const r = await refusalOf(files.createUploadLinkAs('claim', ids.claimA, { field: 'stamp' }, OWNER as never));
      expect(r).toMatchObject({ code: 'FIELD_NOT_ACCESSIBLE', status: 403 });
      expect(r?.message).toContain('claim.stamp');
      expect(await openLinkRows()).toBe(before);
    });

    // [#32768] The issue-time half of the `readonlyWhen` refusal: the engine's
    // own write-free verdict (`judgeFieldWriteLock`), asked before any link row
    // is written, in the words the update's strict refusal uses for the lock.
    it('minting refuses a field whose readonlyWhen holds now 403 FIELD_NOT_ACCESSIBLE, in the update\'s words, and writes no link', async () => {
      const id = await draftClaim('approved before mint');
      await engine.update('claim', { status: 'approved' }, { where: { id }, context: SYS } as never);
      const before = await openLinkRows();
      const r = await refusalOf(files.createUploadLinkAs('claim', id, { field: 'invoices' }, OWNER as never));
      expect(r).toMatchObject({ code: 'FIELD_NOT_ACCESSIBLE', status: 403 });
      expect(r?.message).toBe(
        "You cannot attach a file to claim.invoices: the field is read-only in the target record's current state " +
          '(a TRUE `readonlyWhen` predicate).',
      );
      expect(await openLinkRows()).toBe(before);
    });

    it('the same field while its readonlyWhen is false gets a link; a static readonly field keeps its refusal; the attachments list is not judged', async () => {
      const draft = await draftClaim('draft at mint');
      const grant = await files.createUploadLinkAs('claim', draft, { field: 'invoices' }, OWNER as never);
      expect(grant.path).toBe(`${BASE}/upload-links/${grant.token}`);

      const r = await refusalOf(files.createUploadLinkAs('claim', draft, { field: 'stamp' }, OWNER as never));
      expect(r).toMatchObject({ code: 'FIELD_NOT_ACCESSIBLE', status: 403 });
      expect(r?.message).toBe('You cannot attach a file to claim.stamp: the field is read-only.');

      const approved = await draftClaim('approved, attachments');
      await engine.update('claim', { status: 'approved' }, { where: { id: approved }, context: SYS } as never);
      const attach = await files.createUploadLinkAs('claim', approved, { attachments: true }, OWNER as never);
      expect(attach.path).toBe(`${BASE}/upload-links/${attach.token}`);
    });

    it('minting refuses a record a pending approval locks 409 RECORD_LOCKED and writes no link; once unlocked, it mints', async () => {
      const id = await draftClaim('locked at mint');
      locked.add(id);
      try {
        const before = await openLinkRows();
        const r = await refusalOf(files.createUploadLinkAs('claim', id, { field: 'invoices' }, OWNER as never));
        expect(r).toMatchObject({ code: 'RECORD_LOCKED', status: 409 });
        expect(await openLinkRows()).toBe(before);
      } finally {
        locked.delete(id);
      }
      const grant = await files.createUploadLinkAs('claim', id, { field: 'invoices' }, OWNER as never);
      expect(grant.path).toBe(`${BASE}/upload-links/${grant.token}`);
    });

    it('a draft takes the upload; once its readonlyWhen holds, an upload through a link minted before is refused 403 with the reason, attaching and keeping nothing', async () => {
      const id = await draftClaim('approved after mint');
      const first = await uploadThroughLink({ field: 'invoices' }, Buffer.from('invoice one'), id);
      expect((await claim(id)).invoices).toEqual([first.fileId]);

      const grant = await files.createUploadLinkAs('claim', id, { field: 'invoices' }, OWNER as never);
      await engine.update('claim', { status: 'approved' }, { where: { id }, context: SYS } as never);
      const put = await useLink(tokenOf(grant.path), Buffer.from('invoice two'), { 'x-file-name': 'late-invoice.pdf' });

      expect(put._status, JSON.stringify(put._json)).toBe(403);
      expect(put._json).toEqual({
        success: false,
        error: expect.objectContaining({ code: 'FIELD_NOT_ACCESSIBLE', message: expect.stringContaining('claim.invoices') }),
      });
      expect(put._json.error.message).toMatch(/^Nothing was attached: /);
      expect((await claim(id)).invoices).toEqual([first.fileId]);
      expect(await filesNamed('late-invoice.pdf')).toEqual([]);
      expect(await fileRow(tokenOf(grant.path).split('.')[0])).toBeUndefined();
    });

    it('a record locked after the link was minted refuses the upload 409 RECORD_LOCKED, not 500, keeping nothing', async () => {
      const id = await draftClaim('locked after mint');
      const grant = await files.createUploadLinkAs('claim', id, { field: 'policy' }, OWNER as never);
      locked.add(id);
      try {
        const put = await useLink(tokenOf(grant.path), Buffer.from('locked claim'), { 'x-file-name': 'locked-claim.pdf' });
        expect(put._status, JSON.stringify(put._json)).toBe(409);
        expect(put._json.error).toMatchObject({ code: 'RECORD_LOCKED' });
        expect(put._json.error.message).toContain('locked while an approval is in progress');
        // [#32712] The producer's code prefix is off the text; `code` carries the token.
        expect(put._json.error.message).not.toMatch(/^RECORD_LOCKED/);
        expect((await claim(id)).policy ?? null).toBeNull();
        expect(await filesNamed('locked-claim.pdf')).toEqual([]);
      } finally {
        locked.delete(id);
      }
    });

    it('the page says attached only for an answer naming the stored file; a refusal shows the text written for its user', async () => {
      const grant = await files.createUploadLinkAs('claim', ids.claimB, { field: 'policy' }, OWNER as never);
      const html = String((await openLink(tokenOf(grant.path)))._sent);
      expect(await pageSays(html, { ok: true, body: { success: true, data: { fileId: 'f1', size: 3, field: 'policy' } } }))
        .toBe('Done. The file was attached; you can close this page.');
      expect(await pageSays(html, { ok: true, body: { success: true, data: {} } })).toBe('The upload failed.');
      const reason = 'Nothing was attached: the field this link was made for is read-only on this record, so it cannot take a file.';
      const diagnostic = 'Nothing was attached: claim.invoices is read-only on this record in its current state, so it cannot take a file.';
      expect(await pageSays(html, {
        ok: false,
        body: { success: false, error: { code: 'FIELD_NOT_ACCESSIBLE', message: diagnostic, userMessage: reason } },
      })).toBe(reason);
      // [#32712] An answer carrying no text for its user shows the page's own sentence, never the diagnostic.
      expect(await pageSays(html, { ok: false, body: { success: false, error: { code: 'INTERNAL', message: 'Upload failed' } } }))
        .toBe('The upload failed.');
    });
  });

  describe('#32712 — the page and its refusals in the request\'s language', () => {
    const zh = UPLOAD_LINK_COPY['zh-CN'];
    const en = UPLOAD_LINK_COPY.en;
    const ZH = { 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' };
    const openLinkIn = (token: string, headers: Record<string, string>, user: string | null = OWNER.userId) =>
      call('GET', `${BASE}/upload-links/:token`, { params: { token }, headers: { ...headers, ...sessionOf(user) } });
    const draftClaim = async (name: string) =>
      (await engine.insert('claim', { name, owner: OWNER.userId, status: 'draft', organization_id: ORG }, { context: SYS } as never)).id as string;

    afterEach(() => setWorkspaceLocale(undefined));

    /**
     * No id and no API name of the record, object, field or user, whatever the
     * language. [#32712 (b)] The page names the record and field by their
     * labels and title for the link's own user (ruling B′), pinned below; a
     * refusal still names nothing.
     */
    const expectNamesNothing = (text: string, recordId: string) => {
      for (const named of [recordId, 'claim', 'policy', 'invoices', OWNER.userId]) expect(text).not.toContain(named);
    };

    it('serves the picker page in the request\'s language: lang, every sentence, the expiry', async () => {
      const grant = await files.createUploadLinkAs('claim', ids.claimB, { field: 'policy' }, OWNER as never);
      const page = await openLinkIn(tokenOf(grant.path), ZH);
      expect(page._status).toBe(200);
      const html = String(page._sent);
      expect(html).toContain('<html lang="zh-CN" dir="ltr">');
      expect(html).toContain(`<title>${zh.pageTitle}</title>`);
      for (const sentence of [zh.wanted('field'), zh.once, zh.fileLabel, zh.send]) expect(html).toContain(sentence);
      // The expiry, written the Chinese way and named as UTC [#32712 (b): inside the
      // time element the page's script rewrites in the reader's own time zone].
      expect(html).toMatch(/链接将于 <time id="expires" datetime="[^"]+">\d{4}年\d{1,2}月\d{1,2}日 UTC \d{2}:\d{2}<\/time> 失效。/);
      for (const english of ['Upload a file', 'A file was asked for', 'This link works once', 'It stops working']) {
        expect(html).not.toContain(english);
      }
      expectNamesNothing(html, ids.claimB);
    });

    it('with no language of its own, the request gets the workspace default; a language it names wins over the default', async () => {
      setWorkspaceLocale('zh-CN');
      const grant = await files.createUploadLinkAs('claim', ids.claimB, { attachments: true }, OWNER as never);
      const token = tokenOf(grant.path);
      const byDefault = String((await openLinkIn(token, {}))._sent);
      expect(byDefault).toContain('<html lang="zh-CN" dir="ltr">');
      expect(byDefault).toContain(zh.wanted('attachments'));
      const asked = String((await openLinkIn(token, { 'accept-language': 'en-US,en;q=0.9' }))._sent);
      expect(asked).toContain('<html lang="en" dir="ltr">');
      expect(asked).toContain(en.wanted('attachments'));
      // No default and no language asked: English, as every page was before.
      setWorkspaceLocale(undefined);
      expect(String((await openLinkIn(token, {}))._sent)).toContain('<html lang="en" dir="ltr">');
    });

    it('the unusable-link page, and the PUT\'s unusable and sign-in refusals, speak the request\'s language', async () => {
      const page = await openLinkIn('not-a-token', ZH);
      expect(page._status).toBe(404);
      expect(String(page._sent)).toContain(`<h1>${zh.unusableHeading}</h1><p>${zh.unusable}</p>`);
      const put = await call('PUT', `${BASE}/upload-links/:token`, {
        params: { token: 'not-a-token' }, headers: { ...ZH, ...sessionOf(OWNER.userId) }, rawBody: async () => Buffer.from('x'),
      });
      expect(put._status).toBe(404);
      // `message` keeps its diagnostic wording; `userMessage` is the page's.
      expect(put._json.error).toMatchObject({ code: 'RESOURCE_NOT_FOUND', message: UPLOAD_LINK_UNUSABLE_MESSAGE, userMessage: zh.unusable });
      const anonymous = await call('PUT', `${BASE}/upload-links/:token`, {
        params: { token: 'not-a-token' }, headers: ZH, rawBody: async () => Buffer.from('x'),
      });
      expect(anonymous._status).toBe(401);
      expect(anonymous._json.error).toMatchObject({ code: 'AUTH_REQUIRED', userMessage: zh.signInRequired });
    });

    it('a record locked after minting: the PUT answers the page\'s lock sentence, with no code prefix and no record named', async () => {
      const id = await draftClaim('locked, zh');
      const grantZh = await files.createUploadLinkAs('claim', id, { field: 'policy' }, OWNER as never);
      const grantEn = await files.createUploadLinkAs('claim', id, { field: 'policy' }, OWNER as never);
      locked.add(id);
      try {
        const put = await useLink(tokenOf(grantZh.path), Buffer.from('locked'), ZH);
        expect(put._status, JSON.stringify(put._json)).toBe(409);
        expect(put._json.error).toMatchObject({ code: 'RECORD_LOCKED', userMessage: zh.recordLocked });
        expect(put._json.error.message).not.toMatch(/^RECORD_LOCKED/);
        expectNamesNothing(put._json.error.userMessage, id);
        const putEn = await useLink(tokenOf(grantEn.path), Buffer.from('locked'));
        expect(putEn._json.error).toMatchObject({ code: 'RECORD_LOCKED', userMessage: en.recordLocked });
        expect(putEn._json.error.userMessage).not.toMatch(/RECORD_LOCKED/);
        expectNamesNothing(putEn._json.error.userMessage, id);
      } finally {
        locked.delete(id);
      }
    });

    it('a field read-only once its readonlyWhen holds: the page\'s sentence, naming neither object nor field', async () => {
      const id = await draftClaim('approved, zh');
      const grant = await files.createUploadLinkAs('claim', id, { field: 'invoices' }, OWNER as never);
      await engine.update('claim', { status: 'approved' }, { where: { id }, context: SYS } as never);
      const put = await useLink(tokenOf(grant.path), Buffer.from('late invoice'), ZH);
      expect(put._status, JSON.stringify(put._json)).toBe(403);
      expect(put._json.error).toMatchObject({ code: 'FIELD_NOT_ACCESSIBLE', userMessage: zh.fieldReadOnly });
      expectNamesNothing(put._json.error.userMessage, id);
    });

    it('over the upload limit: the page\'s sentence in the workspace default, the link still usable', async () => {
      setWorkspaceLocale('zh-CN');
      const grant = await files.createUploadLinkAs('claim', ids.claimB, { attachments: true }, OWNER as never);
      const token = tokenOf(grant.path);
      storage.setLimitsSnapshot({ maxUploadMb: { value: 1, authored: true } } as never);
      try {
        const declared = await useLink(token, Buffer.alloc(10, 7), { 'content-length': String(MIB + 1) });
        expect(declared._status).toBe(413);
        expect(declared._json.error).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', userMessage: zh.tooLarge });
        const read = await useLink(token, Buffer.alloc(MIB + 1, 7));
        expect(read._status).toBe(413);
        expect(read._json.error).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', userMessage: zh.tooLarge });
        expect((await useLink(token, Buffer.alloc(16, 7)))._status).toBe(200);
      } finally {
        storage.setLimitsSnapshot({} as never);
      }
    });

    it('the page\'s script writes its status lines in its language and shows the refusal the door wrote', async () => {
      const grant = await files.createUploadLinkAs('claim', ids.claimB, { field: 'policy' }, OWNER as never);
      const html = String((await openLinkIn(tokenOf(grant.path), ZH))._sent);
      const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
      const says = async (answer: { ok: boolean; body: unknown }) => {
        const handlers: Record<string, () => void> = {};
        const el = (id: string) => ({
          id, disabled: id === 'send', textContent: '',
          files: id === 'file' ? [{ name: 'scan.pdf', type: 'application/pdf' }] : undefined,
          addEventListener: (event: string, fn: () => void) => { handlers[`${id}:${event}`] = fn; },
        });
        const els: Record<string, ReturnType<typeof el>> = { file: el('file'), send: el('send'), status: el('status') };
        runInNewContext(script, {
          document: { getElementById: (id: string) => els[id] },
          location: { pathname: '/api/v1/storage/upload-links/t' },
          fetch: async () => ({ ok: answer.ok, json: async () => answer.body }),
        });
        handlers['send:click']!();
        const uploading = els.status.textContent;
        for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
        return { uploading, after: els.status.textContent };
      };
      const done = await says({ ok: true, body: { success: true, data: { fileId: 'f1', size: 3, field: 'policy' } } });
      expect(done).toEqual({ uploading: zh.uploading, after: zh.attached });
      expect((await says({ ok: false, body: { success: false, error: { code: 'INTERNAL', message: 'Upload failed' } } })).after)
        .toBe(zh.failed);
      expect((await says({ ok: false, body: { success: false, error: { code: 'RECORD_LOCKED', message: 'x', userMessage: zh.recordLocked } } })).after)
        .toBe(zh.recordLocked);
    });
  });

  describe('#32712 (b) — ruling B′: the page names the record and the field for the link\'s own user', () => {
    const zh = UPLOAD_LINK_COPY['zh-CN'];
    const en = UPLOAD_LINK_COPY.en;
    const ZH = { 'accept-language': 'zh-CN,zh;q=0.9' };
    const EN = { 'accept-language': 'en-US,en;q=0.9' };
    const TITLE = 'Taxi 11-12 to the airport';
    const openIn = (token: string, headers: Record<string, string>, user: string | null = OWNER.userId) =>
      call('GET', `${BASE}/upload-links/:token`, { params: { token }, headers: { ...headers, ...sessionOf(user) } });
    const titledClaim = async (name = TITLE) =>
      (await engine.insert('claim', { name, owner: OWNER.userId, organization_id: ORG }, { context: SYS } as never)).id as string;
    /** The page's own escaping, to match a row as the HTML carries it. */
    const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const row = (term: string, value: string) => `<dt>${esc(term)}</dt><dd>${esc(value)}</dd>`;
    /** No id and no API name anywhere in the page, the tab title generic. */
    const expectNoIdOrApiName = (html: string, recordId: string, copy: typeof en, token: string) => {
      for (const id of [recordId, token.split('.')[0], OWNER.userId, ORG]) expect(html, id).not.toContain(id);
      // An API name only as a word of its own: a label may contain one ("E-invoice").
      for (const apiName of ['claim', 'policy', 'photos', 'expense_line', 'invoice']) {
        expect(html, apiName).not.toMatch(new RegExp(`(?<![\\w-])${apiName}(?![\\w-])`));
      }
      expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe(copy.pageTitle);
    };
    /** Stand services in for the span of `fn`. */
    const withServices = async (stand: Record<string, unknown>, fn: () => Promise<void>) => {
      for (const [name, svc] of Object.entries(stand)) services.set(name, svc);
      try {
        await fn();
      } finally {
        for (const name of Object.keys(stand)) services.delete(name);
      }
    };
    /** A security service answering every claim field readable and queryable except those named. */
    const securityHiding = (opts: { unreadable?: string[]; masked?: string[]; noQueryable?: boolean }) => {
      const all = Object.keys((engine.getSchema('claim') as any).fields);
      return {
        getReadableFields: async (object: string) =>
          object === 'claim' ? all.filter((f) => !(opts.unreadable ?? []).includes(f)) : undefined,
        ...(opts.noQueryable
          ? {}
          : {
              getQueryableFields: async (object: string) =>
                object === 'claim'
                  ? all.filter((f) => !(opts.unreadable ?? []).includes(f) && !(opts.masked ?? []).includes(f))
                  : undefined,
            }),
      };
    };
    /** The unusable-link page with its per-response nonce taken out, for a byte comparison. */
    const unusableBytes = (res: Res) => ({
      status: res._status,
      body: String(res._sent).replace(/nonce="[^"]+"/g, 'nonce="N"'),
      headers: { ...res._headers, 'content-security-policy': res._headers['content-security-policy'].replace(/'nonce-[^']+'/g, "'nonce-N'") },
    });

    it('the owner sees both rows, in English and in Chinese, and nothing else that names', async () => {
      const id = await titledClaim();
      const grant = await files.createUploadLinkAs('claim', id, { field: 'policy' }, OWNER as never);
      const token = tokenOf(grant.path);
      const html = String((await openIn(token, EN))._sent);
      expect(html).toContain(`<dl>${row(en.recordRow, en.recordTitled('Claim', TITLE))}${row(en.goesIntoRow, en.intoField('Policy'))}</dl>`);
      expect(html).toContain('<dd>Claim &quot;Taxi 11-12 to the airport&quot;</dd>');
      expect(html).toContain(en.wanted('field'));
      expectNoIdOrApiName(html, id, en, token);
      const page = await openIn(token, ZH);
      expect(page._status).toBe(200);
      const zhHtml = String(page._sent);
      expect(zhHtml).toContain(`<dl>${row(zh.recordRow, zh.recordTitled('Claim', TITLE))}${row(zh.goesIntoRow, zh.intoField('Policy'))}</dl>`);
      expect(zhHtml).toContain('<dt>记录</dt><dd>Claim「Taxi 11-12 to the airport」</dd><dt>放入</dt><dd>「Policy」字段</dd>');
      expectNoIdOrApiName(zhHtml, id, zh, token);
      // The names are page text only: the script's data carries none of them.
      const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(zhHtml)?.[1] ?? '';
      for (const name of [TITLE, 'Claim', 'Policy']) expect(script).not.toContain(name);
    });

    it('labels are the object\'s and the field\'s in the page\'s language, through the i18n bundle', async () => {
      const id = await titledClaim();
      const grant = await files.createUploadLinkAs('claim', id, { field: 'policy' }, OWNER as never);
      const i18n = {
        getLocales: () => ['zh-CN'],
        getTranslations: (locale: string) =>
          locale === 'zh-CN' ? { objects: { claim: { label: '报销单', fields: { policy: { label: '保单' } } } } } : {},
      };
      await withServices({ i18n }, async () => {
        const zhHtml = String((await openIn(tokenOf(grant.path), ZH))._sent);
        expect(zhHtml).toContain(`${row(zh.recordRow, zh.recordTitled('报销单', TITLE))}${row(zh.goesIntoRow, zh.intoField('保单'))}`);
        // English has no entry: the labels as declared.
        const enHtml = String((await openIn(tokenOf(grant.path), EN))._sent);
        expect(enHtml).toContain(row(en.recordRow, en.recordTitled('Claim', TITLE)));
      });
    });

    it('an attachments link, a multi-file field and a record not yet created each name what they can', async () => {
      const id = await titledClaim();
      const attach = await files.createUploadLinkAs('claim', id, { attachments: true }, OWNER as never);
      expect(String((await openIn(tokenOf(attach.path), ZH))._sent))
        .toContain(`<dl>${row(zh.recordRow, zh.recordTitled('Claim', TITLE))}${row(zh.goesIntoRow, zh.intoAttachments)}</dl>`);
      const several = await files.createUploadLinkAs('claim', id, { field: 'photos' }, OWNER as never);
      const severalHtml = String((await openIn(tokenOf(several.path), EN))._sent);
      expect(severalHtml).toContain(`<dl>${row(en.recordRow, en.recordTitled('Claim', TITLE))}${row(en.goesIntoRow, en.intoField('Photos'))}</dl>`);
      expect(severalHtml).toContain(en.wantedSeveral(UPLOAD_LINK_MAX_FILES));
      // No record yet: the object's label and the field, nothing to title.
      for (const [object, field, count, objectLabel, fieldLabel] of [
        ['expense_line', 'invoice', 1, 'Expense line', 'E-invoice'],
        ['claim', 'photos', 3, 'Claim', 'Photos'],
      ] as const) {
        const grant = await files.createUploadLinkForNewRecordAs(object, { field, count }, OWNER as never);
        const html = String((await openIn(tokenOf(grant.path), ZH))._sent);
        expect(html).toContain(`<dl>${row(zh.recordRow, zh.recordNotYetCreated(objectLabel))}${row(zh.goesIntoRow, zh.intoField(fieldLabel))}</dl>`);
        if (count > 1) expect(html).toContain(zh.wantedExactly(count));
        for (const fileId of grant.fileIds) expectNoIdOrApiName(html, fileId, zh, tokenOf(grant.path));
      }
    });

    it('a masked or hidden title shows the object\'s label only, and the value reaches no byte of the page', async () => {
      const id = await titledClaim('Secret trip to Lisbon');
      const grant = await files.createUploadLinkAs('claim', id, { field: 'policy' }, OWNER as never);
      const token = tokenOf(grant.path);
      for (const security of [
        securityHiding({ masked: ['name'] }),
        securityHiding({ unreadable: ['name'] }),
        // A security service that cannot say what is masked shows less, never more.
        securityHiding({ noQueryable: true }),
      ]) {
        await withServices({ security }, async () => {
          const page = await openIn(token, EN);
          expect(page._status).toBe(200);
          const html = String(page._sent);
          expect(html).toContain(`<dl>${row(en.recordRow, en.recordOfObject('Claim'))}${row(en.goesIntoRow, en.intoField('Policy'))}</dl>`);
          for (const part of ['Secret', 'Lisbon']) expect(html).not.toContain(part);
          expect(JSON.stringify(page._headers)).not.toContain('Lisbon');
        });
      }
    });

    it('a field the owner cannot read loses its row; the record row stays', async () => {
      const id = await titledClaim();
      const grant = await files.createUploadLinkAs('claim', id, { field: 'policy' }, OWNER as never);
      await withServices({ security: securityHiding({ unreadable: ['policy'] }) }, async () => {
        const html = String((await openIn(tokenOf(grant.path), EN))._sent);
        expect(html).toContain(`<dl>${row(en.recordRow, en.recordTitled('Claim', TITLE))}</dl>`);
        expect(html).not.toContain(en.goesIntoRow);
        expect(html).not.toContain('Policy');
      });
    });

    it('a record the owner can no longer read answers the stranger\'s 404, byte for byte', async () => {
      const id = await titledClaim('Moved away');
      const grant = await files.createUploadLinkAs('claim', id, { field: 'policy' }, OWNER as never);
      const token = tokenOf(grant.path);
      const stranger = unusableBytes(await openIn(token, EN, OUTSIDER.userId));
      const unknown = unusableBytes(await openIn('not-a-token', EN));
      expect(stranger.status).toBe(404);
      expect(stranger).toEqual(unknown);
      await engine.update('claim', { owner: OUTSIDER.userId }, { where: { id }, context: SYS } as never);
      const owner = unusableBytes(await openIn(token, EN));
      expect(owner).toEqual(stranger);
      expect(owner.body).not.toContain('Moved away');
      // In Chinese too: the same page as a stranger's in that language.
      expect(unusableBytes(await openIn(token, ZH))).toEqual(unusableBytes(await openIn(token, ZH, OUTSIDER.userId)));
    });

    it('a user who can no longer act in the link\'s organization answers the stranger\'s 404, byte for byte', async () => {
      const id = await titledClaim('Left the organization');
      const grant = await files.createUploadLinkAs('claim', id, { field: 'policy' }, OWNER as never);
      const token = tokenOf(grant.path);
      const stranger = unusableBytes(await openIn(token, EN, OUTSIDER.userId));
      expect(stranger.status).toBe(404);
      const members = engine.getDriverForObject('sys_member')!;
      await members.delete('sys_member', `mem_${OWNER.userId}`);
      try {
        const owner = unusableBytes(await openIn(token, EN));
        expect(owner).toEqual(stranger);
        expect(owner.body).not.toContain('Left the organization');
      } finally {
        await members.create('sys_member', { id: `mem_${OWNER.userId}`, user_id: OWNER.userId, organization_id: ORG, role: 'member' });
      }
      // A member again: the page names the record once more.
      expect(String((await openIn(token, EN))._sent)).toContain(row(en.recordRow, en.recordTitled('Claim', 'Left the organization')));
    });

    it('a record read the engine refuses 403 or 404 answers the stranger\'s 404; any other failure names nothing', async () => {
      const id = await titledClaim('Refused on read');
      const grant = await files.createUploadLinkAs('claim', id, { field: 'policy' }, OWNER as never);
      const token = tokenOf(grant.path);
      const stranger = unusableBytes(await openIn(token, EN, OUTSIDER.userId));
      const findOne = engine.findOne.bind(engine);
      let refusal: { status?: number } | null = null;
      const spy = vi.spyOn(engine as any, 'findOne').mockImplementation(async (object: any, query: any, options: any) => {
        if (refusal && object === 'claim' && query?.where?.id === id && options?.context?.userId === OWNER.userId) {
          throw Object.assign(new Error('refused'), refusal);
        }
        return findOne(object, query, options);
      });
      try {
        for (const status of [403, 404]) {
          refusal = { status };
          const owner = unusableBytes(await openIn(token, EN));
          expect(owner, String(status)).toEqual(stranger);
          expect(owner.body).not.toContain('Refused on read');
        }
        // A failure that is not a refusal: today's page, which names nothing.
        refusal = { status: 500 };
        const page = await openIn(token, EN);
        expect(page._status).toBe(200);
        expect(String(page._sent)).not.toContain('<dl>');
        expect(String(page._sent)).not.toContain('Refused on read');
      } finally {
        spy.mockRestore();
      }
    });

    it('a display field that is not title-typed (a lookup as nameField) shows the object\'s label only, never the id it serves', async () => {
      const claimId = await titledClaim('Referenced claim');
      const trip = await engine.insert('trip', { claim_ref: claimId, organization_id: ORG }, { context: SYS } as never);
      const tripId = String(trip.id);
      const fetched = await engine.findOne('trip', { where: { id: tripId } }, { context: OWNER } as never);
      expect(fetched?.claim_ref, 'the lookup serves the bare foreign id').toBe(claimId);
      const grant = await files.createUploadLinkAs('trip', tripId, { field: 'ticket' }, OWNER as never);
      const token = tokenOf(grant.path);
      for (const [headers, copy] of [[EN, en], [ZH, zh]] as const) {
        const page = await openIn(token, headers);
        expect(page._status).toBe(200);
        const html = String(page._sent);
        expect(html).toContain(`<dl>${row(copy.recordRow, copy.recordOfObject('Trip'))}${row(copy.goesIntoRow, copy.intoField('Ticket'))}</dl>`);
        expect(html).not.toContain(claimId);
        expect(html).not.toContain(tripId);
        expect(html).not.toContain('Referenced claim');
        expect(JSON.stringify(page._headers)).not.toContain(claimId);
      }
    });

    it('opening the page writes nothing and spends nothing: the link still takes its upload', async () => {
      const id = await titledClaim();
      const grant = await files.createUploadLinkAs('claim', id, { field: 'policy' }, OWNER as never);
      const token = tokenOf(grant.path);
      const linkId = token.split('.')[0];
      const rows = async () => ({
        files: await engine.count('sys_file', { context: SYS } as never),
        link: await fileRow(linkId),
        record: await claim(id),
      });
      const before = await rows();
      for (const headers of [EN, ZH, {}]) expect((await openIn(token, headers))._status).toBe(200);
      expect(await rows()).toEqual(before);
      const put = await useLink(token, Buffer.from('%PDF-1.4 still usable'));
      expect(put._status, JSON.stringify(put._json)).toBe(200);
    });

    it('CONTROL: another user, an expired link and a used link get the one refusal, naming nothing', async () => {
      const id = await titledClaim('Control claim');
      const grant = await files.createUploadLinkAs('claim', id, { field: 'policy' }, OWNER as never);
      const token = tokenOf(grant.path);
      const reference = unusableBytes(await openIn('not-a-token', EN));
      expect(unusableBytes(await openIn(token, EN, OUTSIDER.userId))).toEqual(reference);
      expect(unusableBytes(await openIn(token, EN, REVIEWER.userId))).toEqual(reference);
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now + (UPLOAD_LINK_TTL_SECONDS + 1) * 1000);
      expect(unusableBytes(await openIn(token, EN))).toEqual(reference);
      vi.restoreAllMocks();
      expect((await useLink(token, Buffer.from('%PDF-1.4 once')))._status).toBe(200);
      const used = unusableBytes(await openIn(token, EN));
      expect(used).toEqual(reference);
      expect(used.body).not.toContain('Control claim');
    });

    /** Run the page's script on a stubbed DOM; the elements it touched. */
    const runPage = (
      html: string,
      clock: () => number = () => Date.now(),
      answer: () => Promise<unknown> = async () => ({ ok: true, json: async () => ({ success: true, data: { fileId: 'f1' } }) }),
    ) => {
      const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)?.[1];
      expect(script, 'the page carries its upload script').toBeTruthy();
      const handlers: Record<string, () => void> = {};
      const timers: Array<{ fn: () => void; ms: number; cleared?: boolean }> = [];
      let fetched = 0;
      const el = (id: string) => ({
        id, disabled: id === 'send', textContent: id === 'expires' ? 'SERVER TEXT' : '',
        files: id === 'file' ? [{ name: 'scan.pdf', type: 'application/pdf' }] : undefined,
        addEventListener: (event: string, fn: () => void) => { handlers[`${id}:${event}`] = fn; },
      });
      const els: Record<string, ReturnType<typeof el>> = { file: el('file'), send: el('send'), status: el('status'), expires: el('expires') };
      // The browser's clock is `clock`: the script's `Date` is the page realm's own.
      const BrowserDate = class extends Date {
        static now() { return clock(); }
      };
      runInNewContext(script!, {
        Date: BrowserDate,
        document: { getElementById: (id: string) => els[id] },
        location: { pathname: '/api/v1/storage/upload-links/t' },
        fetch: async () => { fetched += 1; return answer(); },
        setTimeout: (fn: () => void, ms: number) => timers.push({ fn, ms }) - 1,
        clearTimeout: (handle: number) => { if (timers[handle]) timers[handle].cleared = true; },
      });
      return { els, handlers, timers, fetched: () => fetched };
    };
    const view = (expiresAt: string) => ({ expiresAt, target: 'field' as const, files: { min: 1, max: 1 } });
    const render = (expiresAt: string, now: number, copy = zh) => {
      const res: any = { _sent: '', header() { return res; }, status() { return res; }, send(b: string) { res._sent = b; return res; } };
      sendUploadLinkPage(res, view(expiresAt), copy, now);
      return String(res._sent);
    };

    it('the expiry is printed in the reader\'s own time zone, in the page\'s language', () => {
      const at = new Date(Date.now() + 5 * 60_000);
      const html = render(at.toISOString(), Date.now());
      expect(html).toContain(`<time id="expires" datetime="${at.toISOString()}">`);
      const { els } = runPage(html);
      const local = new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
      }).format(at);
      expect(els.expires.textContent).toBe(local);
      expect(els.status.textContent).toBe('');
    });

    it('once the printed expiry has passed, the page says so and disables Send, on the server\'s clock', async () => {
      // Expired by the server's clock while the browser's is behind: disabled at once, nothing sent.
      const ahead = Date.now() + 60 * 60_000;
      const expired = runPage(render(new Date(ahead).toISOString(), ahead + 1_000));
      expect(expired.els.status.textContent).toBe(zh.expired);
      expect(expired.els.send.disabled).toBe(true);
      expect(expired.els.file.disabled).toBe(true);
      expired.handlers['send:click']!();
      expect(expired.fetched()).toBe(0);
      expect(expired.timers).toEqual([]);
      // Live by the server's clock though the browser's is past it: the link still sends.
      const behind = Date.now() - 60 * 60_000;
      const live = runPage(render(new Date(behind).toISOString(), behind - 60_000, en));
      expect(live.els.status.textContent).toBe('');
      expect(live.timers).toHaveLength(1);
      live.handlers['send:click']!();
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
      expect(live.fetched()).toBe(1);
      expect(live.els.status.textContent).toBe(en.attached);
      // The timer flips an open page when the moment comes.
      let browserNow = Date.now();
      const soon = browserNow + 30_000;
      const open = runPage(render(new Date(soon).toISOString(), browserNow), () => browserNow);
      expect(open.timers).toHaveLength(1);
      expect(open.timers[0].ms).toBeGreaterThan(29_000);
      expect(open.els.status.textContent).toBe('');
      browserNow = soon + 1_000;
      open.timers[0].fn();
      expect(open.els.status.textContent).toBe(zh.expired);
      expect(open.els.send.disabled).toBe(true);
    });

    it('a file that landed is never followed by "expired": the timer stops once Send is pressed', async () => {
      const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
      let browserNow = Date.now();
      const end = browserNow + 60_000;
      const done = runPage(render(new Date(end).toISOString(), browserNow, en), () => browserNow);
      expect(done.timers).toHaveLength(1);
      done.handlers['send:click']!();
      expect(done.timers[0].cleared, 'Send stops the timer').toBe(true);
      await settle();
      expect(done.els.status.textContent).toBe(en.attached);
      // The moment passes with the page still open, and the timer fires anyway (a browser that runs a cleared one late).
      browserNow = end + 1_000;
      done.timers[0].fn();
      expect(done.els.status.textContent).toBe(en.attached);
      done.handlers['file:change']!();
      expect(done.els.status.textContent).toBe(en.attached);
      // A send still running at the moment is not talked over: its answer is the line.
      browserNow = Date.now();
      const late = browserNow + 60_000;
      let land!: (value: unknown) => void;
      const running = runPage(render(new Date(late).toISOString(), browserNow, en), () => browserNow,
        () => new Promise((resolve) => { land = resolve; }));
      running.handlers['send:click']!();
      expect(running.els.status.textContent).toBe(en.uploading);
      browserNow = late + 1_000;
      running.timers[0].fn();
      expect(running.els.status.textContent).toBe(en.uploading);
      land({ ok: true, json: async () => ({ success: true, data: { fileId: 'f2' } }) });
      await settle();
      expect(running.els.status.textContent).toBe(en.attached);
      // A send that fails while the link has time left re-arms the timer; the moment then says so.
      browserNow = Date.now();
      const later = browserNow + 60_000;
      const failed = runPage(render(new Date(later).toISOString(), browserNow, en), () => browserNow,
        async () => ({ ok: false, json: async () => ({ success: false }) }));
      failed.handlers['send:click']!();
      await settle();
      expect(failed.els.status.textContent).toBe(en.failed);
      expect(failed.timers).toHaveLength(2);
      expect(failed.timers[1].cleared).toBeUndefined();
      browserNow = later + 1_000;
      failed.timers[1].fn();
      expect(failed.els.status.textContent).toBe(en.expired);
      expect(failed.els.send.disabled).toBe(true);
    });
  });

  describe('#32686 — a link that names no record: the user uploads, then the creating write names the file id', () => {
    const failureOf = (write: Promise<unknown>) => write.then(() => null, (e: unknown) => resolveThrownHttpError(e));
    const insertAs = (who: { userId: string; tenantId?: string } | typeof SYS, object: string, data: Record<string, unknown>) =>
      engine.insert(object, data, { context: who } as never);
    const updateAs = (who: { userId: string; tenantId?: string }, object: string, id: string, data: Record<string, unknown>) =>
      engine.update(object, data, { where: { id }, context: who } as never);
    /** The one located refusal a write naming a file is answered with, as the HTTP boundary answers it. */
    const refusedAt = (field: string, label: string, message: string) => ({
      status: 400,
      code: 'VALIDATION_FAILED',
      details: { fields: [{ field, code: 'invalid_value', message, label }] },
    });
    const unreadable = (label: string) =>
      `${label} cannot reference this file: it is not a file you can open. Choose a file you can open, or upload it again.`;
    const REMEDY = 'Ask for a new upload link for this field and upload the file again.';
    /** Mint a link for `object`.`field` with no record as `who`, and use it once with `bytes`. */
    const uploadForNewRecord = async (
      object: string,
      field: string,
      bytes: Buffer = Buffer.from('%PDF-1.4 invoice'),
      who: { userId: string; tenantId: string } = OWNER,
    ) => {
      const grant = await files.createUploadLinkForNewRecordAs(object, { field }, who as never);
      const res = await useLink(tokenOf(grant.path), bytes, {}, who.userId);
      expect(res._status, JSON.stringify(res._json)).toBe(200);
      return { grant, fileId: grant.fileIds[0] as string };
    };
    const refOf = async (fileId: string) => {
      const row = await fileRow(fileId);
      return [row?.ref_object ?? null, row?.ref_id ?? null, row?.ref_field ?? null];
    };
    const UNCLAIMED = [null, null, null];
    /** The download door's answer to `user` for a file. */
    const downloadUrlAs = (fileId: string, user: string) =>
      call('GET', `${BASE}/files/:fileId/url`, { params: { fileId }, headers: sessionOf(user) });
    /** [#32686] Stand a security service in for the span of `fn`: the object create verdict and the writable fields. */
    const withSecurity = async (security: Record<string, unknown>, fn: () => Promise<void>) => {
      services.set('security', security);
      try {
        await fn();
      } finally {
        services.delete('security');
      }
    };

    it('the measured case: an expense line is refused without its required e-invoice, and taken naming the uploaded file id', async () => {
      // Reading 1: the record cannot exist without the file.
      const bare = await failureOf(insertAs(OWNER, 'expense_line', { invoice_no: 'INV-0' }));
      expect(bare).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
      expect(JSON.stringify(bare)).toContain('invoice');

      // Call 1: the link names the object and the field, no record, and answers the file id up front.
      const before = Date.now();
      const grant = await files.createUploadLinkForNewRecordAs('expense_line', { field: 'invoice' }, OWNER as never);
      expect(grant).toMatchObject({ object: 'expense_line', field: 'invoice', path: `${BASE}/upload-links/${grant.token}` });
      expect(grant.fileIds).toEqual([grant.token.split('.')[0]]);
      const ttl = Date.parse(grant.expiresAt) - before;
      expect(ttl).toBeGreaterThan(UPLOAD_LINK_TTL_SECONDS * 1000 - 5_000);
      expect(ttl).toBeLessThanOrEqual(UPLOAD_LINK_TTL_SECONDS * 1000 + 1_000);
      const fileId = grant.fileIds[0];
      const reserved = await fileRow(fileId);
      expect(reserved).toMatchObject({ status: 'pending', owner_id: OWNER.userId, name: 'upload-link' });
      expect(JSON.parse(reserved.metadata)).not.toHaveProperty('record_id');

      // Before the upload, the create naming it is refused as an upload that never completed.
      const early = await failureOf(insertAs(OWNER, 'expense_line', { invoice_no: 'INV-1', invoice: fileId }));
      expect(early).toMatchObject(refusedAt(
        'invoice', 'E-invoice', `E-invoice cannot reference file ${fileId}: its upload was never completed. Complete the upload, then save again.`,
      ));

      // The browser upload: the bytes land under the id the link answered, on no record.
      const res = await useLink(tokenOf(grant.path), Buffer.from('%PDF-1.4 taxi receipt'));
      expect(res._status, JSON.stringify(res._json)).toBe(200);
      expect(res._json).toEqual({ success: true, data: { fileId, fileIds: [fileId], size: 21, field: 'invoice' } });
      const landed = await fileRow(fileId);
      expect(landed).toMatchObject({
        status: 'committed', owner_id: OWNER.userId, size: 21, name: 'scan 1.pdf', mime_type: 'application/pdf',
        ref_object: null, ref_id: null, ref_field: null,
      });
      const binding = JSON.parse(landed.metadata);
      expect(binding).toMatchObject({ kind: 'pre_record_upload', object: 'expense_line', field: 'invoice', user_id: OWNER.userId, organization_id: ORG });
      expect(String(landed.metadata)).not.toContain(grant.token.split('.')[1]);
      const window = Date.parse(binding.claim_until) - Date.now();
      expect(window).toBeGreaterThan(PRE_RECORD_CLAIM_WINDOW_SECONDS * 1000 - 60_000);
      expect(window).toBeLessThanOrEqual(PRE_RECORD_CLAIM_WINDOW_SECONDS * 1000);
      expect((await storage.download(landed.key)).toString()).toBe('%PDF-1.4 taxi receipt');
      // The link is spent.
      expect((await useLink(tokenOf(grant.path), Buffer.from('again')))._status).toBe(404);

      // Call 2: the create naming the file id is taken, and the record owns the file.
      const line = await insertAs(OWNER, 'expense_line', { invoice_no: 'INV-1', invoice: fileId });
      expect(await refOf(fileId)).toEqual(['expense_line', String(line.id), 'invoice']);
    });

    it('the page says the file was received, not attached: no record holds it yet', async () => {
      const grant = await files.createUploadLinkForNewRecordAs('claim', { field: 'policy' }, OWNER as never);
      const html = String((await openLink(tokenOf(grant.path)))._sent);
      expect(html).toContain(UPLOAD_LINK_COPY.en.received);
      expect(html).not.toContain(UPLOAD_LINK_COPY.en.attached);
      expect(html).not.toContain('policy');
    });

    it('another user\'s write is refused with the unreadable-file words, and the file stays unclaimed', async () => {
      const { fileId } = await uploadForNewRecord('claim', 'policy');
      const failure = await failureOf(insertAs(REVIEWER, 'claim', { name: 'R', owner: REVIEWER.userId, policy: fileId }));
      expect(failure).toMatchObject(refusedAt('policy', 'Policy', unreadable('Policy')));
      expect(await refOf(fileId)).toEqual(UNCLAIMED);
    });

    it('a system write is refused too: it names no user whose upload this is', async () => {
      const { fileId } = await uploadForNewRecord('claim', 'policy');
      const failure = await failureOf(insertAs(SYS, 'claim', { name: 'S', owner: OWNER.userId, policy: fileId }));
      expect(failure).toMatchObject(refusedAt('policy', 'Policy', unreadable('Policy')));
      expect(await refOf(fileId)).toEqual(UNCLAIMED);
    });

    it('the uploader\'s write into another field or another object is refused, naming the field it was uploaded for', async () => {
      const { fileId } = await uploadForNewRecord('claim', 'policy');
      const why = 'it was uploaded through an upload link for claim.policy, and goes into that field only';
      expect(await failureOf(insertAs(OWNER, 'claim', { name: 'F', owner: OWNER.userId, receipt: fileId })))
        .toMatchObject(refusedAt('receipt', 'Receipt', `Receipt cannot reference file ${fileId}: ${why}. ${REMEDY}`));
      expect(await failureOf(insertAs(OWNER, 'expense_line', { invoice_no: 'INV-X', invoice: fileId })))
        .toMatchObject(refusedAt('invoice', 'E-invoice', `E-invoice cannot reference file ${fileId}: ${why}. ${REMEDY}`));
      expect(await refOf(fileId)).toEqual(UNCLAIMED);
    });

    it('goes into one record: a second record naming it within the window is refused, and the first keeps it', async () => {
      const { fileId } = await uploadForNewRecord('claim', 'policy');
      const first = await insertAs(OWNER, 'claim', { name: 'first', owner: OWNER.userId, policy: fileId });
      const second = await failureOf(insertAs(OWNER, 'claim', { name: 'second', owner: OWNER.userId, policy: fileId }));
      expect(second).toMatchObject(refusedAt('policy', 'Policy', `Policy cannot reference file ${fileId}: it was uploaded through an upload link and is already in another record; a file from an upload link goes into one record. ${REMEDY}`));
      expect(await refOf(fileId)).toEqual(['claim', String(first.id), 'policy']);
      expect((await claim(String(first.id))).policy).toBe(fileId);
      // Rewriting the record's own value takes nothing and is not refused.
      await updateAs(OWNER, 'claim', String(first.id), { policy: fileId, name: 'first again' });
      expect((await claim(String(first.id))).name).toBe('first again');
    });

    it('expires: once the window has passed with no record holding it, the uploader\'s own write is refused', async () => {
      const { fileId } = await uploadForNewRecord('claim', 'policy');
      const binding = JSON.parse((await fileRow(fileId)).metadata);
      await engine.update('sys_file', { metadata: JSON.stringify({ ...binding, claim_until: new Date(Date.now() - 1_000).toISOString() }) }, { where: { id: fileId }, context: SYS } as never);
      const failure = await failureOf(insertAs(OWNER, 'claim', { name: 'late', owner: OWNER.userId, policy: fileId }));
      expect(failure).toMatchObject(refusedAt('policy', 'Policy', `Policy cannot reference file ${fileId}: it was uploaded through an upload link, and no record took it within ${PRE_RECORD_CLAIM_WINDOW_SECONDS / 60} minutes of the upload. ${REMEDY}`));
      expect(await refOf(fileId)).toEqual(UNCLAIMED);
    });

    it('a record that lets the file go keeps it as any released file: its readers read it, and the binding no longer applies', async () => {
      const { fileId } = await uploadForNewRecord('claim', 'policy');
      const first = await insertAs(OWNER, 'claim', { name: 'held', owner: OWNER.userId, policy: fileId });
      // The record lets it go: its field cleared.
      await updateAs(OWNER, 'claim', String(first.id), { policy: null });
      const letGo = await fileRow(fileId);
      expect(letGo).toMatchObject({ ref_id: null, released_ref_object: 'claim', released_ref_id: String(first.id) });
      // #26046: the releasing record's readers still read it (the reviewer reads every claim).
      const read = await downloadUrlAs(fileId, REVIEWER.userId);
      expect(read._status, JSON.stringify(read._json)).toBe(200);
      // Past the hour, the uploader's restore and a second record take it as they take any released file.
      const binding = JSON.parse(letGo.metadata);
      await engine.update('sys_file', { metadata: JSON.stringify({ ...binding, claim_until: new Date(Date.now() - 1_000).toISOString() }) }, { where: { id: fileId }, context: SYS } as never);
      const second = await insertAs(OWNER, 'claim', { name: 'second', owner: OWNER.userId, policy: fileId });
      expect(await refOf(fileId)).toEqual(['claim', String(second.id), 'policy']);
      expect((await claim(String(second.id))).policy).toBe(fileId);
    });

    it('before the upload, the id it answered takes no write but its uploader\'s: a system write and another user are refused, and the upload still lands', async () => {
      const grant = await files.createUploadLinkForNewRecordAs('claim', { field: 'policy' }, OWNER as never);
      const fileId = grant.fileIds[0] as string;
      expect(await failureOf(insertAs(SYS, 'claim', { name: 'S', owner: OWNER.userId, policy: fileId })))
        .toMatchObject(refusedAt('policy', 'Policy', unreadable('Policy')));
      expect(await failureOf(insertAs(REVIEWER, 'claim', { name: 'R', owner: REVIEWER.userId, policy: fileId })))
        .toMatchObject(refusedAt('policy', 'Policy', unreadable('Policy')));
      expect(await fileRow(fileId)).toMatchObject({ status: 'pending', ref_object: null, ref_id: null, ref_field: null });
      const res = await useLink(tokenOf(grant.path), Buffer.from('%PDF-1.4 hotel'));
      expect(res._status, JSON.stringify(res._json)).toBe(200);
      const taken = await insertAs(OWNER, 'claim', { name: 'O', owner: OWNER.userId, policy: fileId });
      expect(await refOf(fileId)).toEqual(['claim', String(taken.id), 'policy']);
    });

    it('the uploader\'s update of an existing record takes it as the create does', async () => {
      const id = (await engine.insert('claim', { name: 'U', owner: OWNER.userId, organization_id: ORG }, { context: SYS } as never)).id;
      const { fileId } = await uploadForNewRecord('claim', 'policy');
      await updateAs(OWNER, 'claim', String(id), { policy: fileId });
      expect((await claim(String(id))).policy).toBe(fileId);
      expect(await refOf(fileId)).toEqual(['claim', String(id), 'policy']);
    });

    it('downloads: only the uploader while no record holds it; then the record\'s readers', async () => {
      const { fileId } = await uploadForNewRecord('claim', 'policy');
      expect((await downloadUrlAs(fileId, OWNER.userId))._status).toBe(200);
      const denied = await downloadUrlAs(fileId, REVIEWER.userId);
      expect(denied._status, JSON.stringify(denied._json)).toBe(403);
      expect(denied._json).toMatchObject({ success: false, error: { code: 'FILE_DOWNLOAD_DENIED' } });
      // Claimed: the record's read rule, and the reviewer reads every claim.
      await insertAs(OWNER, 'claim', { name: 'D', owner: OWNER.userId, policy: fileId });
      expect((await downloadUrlAs(fileId, REVIEWER.userId))._status).toBe(200);
    });

    it('control: a console-style upload (presign, PUT, complete) and save is taken as before, with no binding', async () => {
      const presigned = await call('POST', `${BASE}/upload/presigned`, {
        headers: sessionOf(OWNER.userId),
        body: { filename: 'form.pdf', mimeType: 'application/pdf', size: 8 },
      });
      expect(presigned._status, JSON.stringify(presigned._json)).toBe(200);
      const { fileId, uploadUrl } = presigned._json.data as { fileId: string; uploadUrl: string };
      const put = await call('PUT', `${BASE}/_local/raw/:token`, {
        params: { token: uploadUrl.slice(uploadUrl.lastIndexOf('/') + 1) },
        rawBody: async () => Buffer.from('%PDF-1.4'),
      });
      expect(put._status, JSON.stringify(put._json)).toBe(200);
      const done = await call('POST', `${BASE}/upload/complete`, { headers: sessionOf(OWNER.userId), body: { fileId } });
      expect(done._status, JSON.stringify(done._json)).toBe(200);
      expect(String((await fileRow(fileId)).metadata ?? '')).not.toContain('pre_record_upload');
      const saved = await insertAs(OWNER, 'claim', { name: 'console', owner: OWNER.userId, policy: fileId });
      expect(await refOf(fileId)).toEqual(['claim', String(saved.id), 'policy']);
    });

    describe('minting', () => {
      it('refuses the system context, a field that is not a file field, a read-only field, and no field at all', async () => {
        expect(await refusalOf(files.createUploadLinkForNewRecordAs('claim', { field: 'policy' }, SYS as never)))
          .toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
        expect(await refusalOf(files.createUploadLinkForNewRecordAs('claim', { field: 'owner' }, OWNER as never)))
          .toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
        expect(await refusalOf(files.createUploadLinkForNewRecordAs('claim', { field: 'stamp' }, OWNER as never)))
          .toMatchObject({ code: 'FIELD_NOT_ACCESSIBLE', status: 403 });
        expect(await refusalOf(files.createUploadLinkForNewRecordAs('claim', {} as never, OWNER as never)))
          .toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      });

      it('asks the object\'s create verdict and the field\'s writability, as the security service answers them', async () => {
        const asked: Array<{ object: string; operation: string }> = [];
        let mayCreate = false;
        let writable: string[] | undefined = undefined;
        await withSecurity({
          explain: async (request: { object: string; operation: string }) => {
            asked.push({ object: request.object, operation: request.operation });
            return { allowed: mayCreate };
          },
          getWritableFields: async () => writable,
        }, async () => {
          expect(await refusalOf(files.createUploadLinkForNewRecordAs('claim', { field: 'policy' }, OWNER as never)))
            .toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
          expect(asked).toEqual([{ object: 'claim', operation: 'create' }]);
          mayCreate = true;
          writable = ['name'];
          expect(await refusalOf(files.createUploadLinkForNewRecordAs('claim', { field: 'policy' }, OWNER as never)))
            .toMatchObject({ code: 'FIELD_NOT_ACCESSIBLE', status: 403 });
          writable = ['name', 'policy'];
          const grant = await files.createUploadLinkForNewRecordAs('claim', { field: 'policy' }, OWNER as never);
          expect(grant.fileIds).toHaveLength(1);
        });
      });
    });

    it('a file the field\'s own maxSize refuses is refused when it arrives, nothing stored and the link not spent', async () => {
      const grant = await files.createUploadLinkForNewRecordAs('claim', { field: 'receipt' }, OWNER as never);
      const big = await useLink(tokenOf(grant.path), Buffer.alloc(100, 1));
      expect(big._status, JSON.stringify(big._json)).toBe(400);
      expect(big._json.error.code).toBe('ERR_FILE_CONSTRAINT');
      expect(await fileRow(grant.fileIds[0])).toMatchObject({ status: 'pending', name: 'upload-link' });
      const small = await useLink(tokenOf(grant.path), Buffer.from('ok'));
      expect(small._status, JSON.stringify(small._json)).toBe(200);
    });
  });

  describe('#32747 — one link, several files: a multi-file field takes them in one submit, all or nothing', () => {
    type Pick = { name: string; bytes: Buffer; type?: string };
    const pdf = (name: string, text = `%PDF-1.4 ${name}`): Pick => ({ name, bytes: Buffer.from(text), type: 'application/pdf' });
    /** The page's several-file submit: one form, `count` and `file0` … `fileN-1`, each name URI-encoded. */
    const useLinkForm = (token: string, picks: Pick[], user: string | null = OWNER.userId, extra: Record<string, unknown> = {}) => {
      const body: Record<string, unknown> = { count: String(picks.length), ...extra };
      picks.forEach((pick, i) => {
        body[`file${i}`] = new File([new Uint8Array(pick.bytes)], encodeURIComponent(pick.name), { type: pick.type ?? 'application/pdf' });
      });
      return call('PUT', `${BASE}/upload-links/:token`, {
        params: { token },
        headers: { 'content-type': 'multipart/form-data; boundary=----os', 'x-upload-link-form': 'several', ...sessionOf(user) },
        body,
        // A transport hands the body's bytes too; a link that reads no form takes them.
        rawBody: async () => Buffer.from('------os--\r\n'),
      });
    };
    const failureOf = (write: Promise<unknown>) => write.then(() => null, (e: unknown) => resolveThrownHttpError(e));
    /** A form body sent exactly as given (parts, `count`), with extra headers. */
    const putForm = (token: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
      call('PUT', `${BASE}/upload-links/:token`, {
        params: { token },
        headers: { 'content-type': 'multipart/form-data; boundary=----os', 'x-upload-link-form': 'several', ...headers, ...sessionOf(OWNER.userId) },
        body,
        rawBody: async () => Buffer.from('------os--\r\n'),
      });
    /** File parts `file0` … that count how often their bytes are read. */
    const countedParts = (n: number) => {
      const reads = { count: 0 };
      const parts: Record<string, unknown> = {};
      for (let i = 0; i < n; i++) {
        const file = new File([new Uint8Array(Buffer.from(`%PDF-1.4 cp-${i}`))], `cp-${i}.pdf`, { type: 'application/pdf' });
        parts[`file${i}`] = {
          name: file.name,
          type: file.type,
          arrayBuffer: () => {
            reads.count += 1;
            return file.arrayBuffer();
          },
        };
      }
      return { reads, parts };
    };
    /** The `sys_file` rows named one of `names`: a submit's files, by the unique names a case picks. */
    const rowsNamed = async (names: string[]) =>
      ((await engine.find('sys_file', { where: { name: { $in: names } }, context: SYS } as never)) as Array<Record<string, any>>);
    const newClaim = async (name: string) =>
      String((await engine.insert('claim', { name, owner: OWNER.userId, organization_id: ORG }, { context: SYS } as never)).id);

    it('a record link: three PDFs in one submit land as three files on the field, in one write, as the minting user\'s', async () => {
      const id = await newClaim('three');
      const kept = await uploadThroughLink({ field: 'scans' }, Buffer.from('%PDF-1.4 kept'), id);
      const grant = await files.createUploadLinkAs('claim', id, { field: 'scans' }, OWNER as never);
      const res = await useLinkForm(tokenOf(grant.path), [pdf('inv-1.pdf'), pdf('inv-2.pdf'), pdf('inv-3.pdf')]);
      expect(res._status, JSON.stringify(res._json)).toBe(200);
      const fileIds = res._json.data.fileIds as string[];
      expect(fileIds).toHaveLength(3);
      expect(res._json.data).toEqual({
        fileId: fileIds[0],
        fileIds,
        files: fileIds.map((fileId) => ({ fileId, size: 18 })),
        field: 'scans',
      });
      expect((await claim(id)).scans).toEqual([kept.fileId, ...fileIds]);
      for (const [i, fileId] of fileIds.entries()) {
        expect(await fileRow(fileId)).toMatchObject({
          status: 'committed', owner_id: OWNER.userId, name: `inv-${i + 1}.pdf`, mime_type: 'application/pdf', size: 18,
          ref_object: 'claim', ref_id: id, ref_field: 'scans',
        });
      }
      // One submit spent it: the next use is the one unusable-link answer.
      const again = await useLinkForm(tokenOf(grant.path), [pdf('inv-4.pdf')]);
      expect(again._status).toBe(404);
      expect(again._json.error.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('a link that names no record: count 3 answers three ids, the submit fills them, and the create takes all three', async () => {
      const grant = await files.createUploadLinkForNewRecordAs('claim', { field: 'scans', count: 3 }, OWNER as never);
      expect(grant.fileIds).toHaveLength(3);
      expect(grant.fileIds[0]).toBe(grant.token.split('.')[0]);
      for (const reserved of grant.fileIds.slice(1)) {
        // A row that holds nothing, owned by the minting user: the pending-upload retention reaps it.
        expect(await fileRow(reserved)).toMatchObject({ status: 'pending', owner_id: OWNER.userId, name: 'upload-link (reserved)', size: 0 });
      }
      const res = await useLinkForm(tokenOf(grant.path), [pdf('pre-1.pdf'), pdf('pre-2.pdf'), pdf('pre-3.pdf')]);
      expect(res._status, JSON.stringify(res._json)).toBe(200);
      expect(res._json.data.fileIds).toEqual(grant.fileIds);
      for (const [i, fileId] of grant.fileIds.entries()) {
        const row = await fileRow(fileId);
        expect(row).toMatchObject({ status: 'committed', owner_id: OWNER.userId, name: `pre-${i + 1}.pdf`, ref_id: null });
        expect(JSON.parse(row.metadata)).toMatchObject({ kind: 'pre_record_upload', object: 'claim', field: 'scans', user_id: OWNER.userId });
      }
      // Each id is claimable only by that user, into that field.
      expect(await failureOf(engine.insert('claim', { name: 'R', owner: REVIEWER.userId, scans: [grant.fileIds[1]] }, { context: REVIEWER } as never)))
        .toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
      const created = await engine.insert('claim', { name: 'C', owner: OWNER.userId, scans: grant.fileIds }, { context: OWNER } as never);
      expect((await claim(String(created.id))).scans).toEqual(grant.fileIds);
      for (const fileId of grant.fileIds) {
        expect(await fileRow(fileId)).toMatchObject({ ref_object: 'claim', ref_id: String(created.id), ref_field: 'scans' });
      }
    });

    it('before its upload, a reserved id is refused to every write, the uploader\'s own included, and nothing serves it', async () => {
      const grant = await files.createUploadLinkForNewRecordAs('claim', { field: 'scans', count: 2 }, OWNER as never);
      const reserved = grant.fileIds[1];
      // The uploader: an upload that never completed (the incomplete-upload arm).
      expect(await failureOf(engine.insert('claim', { name: 'O', owner: OWNER.userId, scans: [reserved] }, { context: OWNER } as never)))
        .toMatchObject({
          status: 400,
          code: 'VALIDATION_FAILED',
          details: { fields: [{ field: 'scans', code: 'invalid_value', message: `Scans cannot reference file ${reserved}: its upload was never completed. Complete the upload, then save again.` }] },
        });
      // Another user and a system write: a file they cannot open (the not-yours arm).
      const unreadable = 'Scans cannot reference this file: it is not a file you can open. Choose a file you can open, or upload it again.';
      for (const who of [REVIEWER, SYS]) {
        expect(await failureOf(engine.insert('claim', { name: 'X', owner: OWNER.userId, scans: [reserved] }, { context: who } as never)))
          .toMatchObject({ status: 400, code: 'VALIDATION_FAILED', details: { fields: [{ field: 'scans', message: unreadable }] } });
      }
      // The download door serves no pending row, to its owner either.
      const url = await call('GET', `${BASE}/files/:fileId/url`, { params: { fileId: reserved }, headers: sessionOf(OWNER.userId) });
      expect(url._status, JSON.stringify(url._json)).toBe(404);
      expect(url._json.error.code).toBe('FILE_NOT_FOUND');
      // It is no link: its own id with any secret is the one unusable-link answer.
      const asLink = await useLinkForm(`${reserved}.${grant.token.split('.')[1]}`, [pdf('x.pdf')]);
      expect(asLink._status).toBe(404);
      expect(await fileRow(reserved)).toMatchObject({ status: 'pending', name: 'upload-link (reserved)', ref_id: null });
    });

    it('the cap: more than ten files is refused 400 VALIDATION_ERROR before the spend; nothing is stored and the link still takes ten', async () => {
      const id = await newClaim('cap');
      const grant = await files.createUploadLinkAs('claim', id, { field: 'scans' }, OWNER as never);
      const eleven = Array.from({ length: UPLOAD_LINK_MAX_FILES + 1 }, (_, i) => pdf(`cap-${i}.pdf`));
      const refused = await useLinkForm(tokenOf(grant.path), eleven);
      expect(refused._status, JSON.stringify(refused._json)).toBe(400);
      expect(refused._json.error.code).toBe('VALIDATION_ERROR');
      expect(refused._json.error.message).toContain(`takes up to ${UPLOAD_LINK_MAX_FILES} files`);
      expect(await rowsNamed(eleven.map((p) => p.name))).toEqual([]);
      expect((await claim(id)).scans ?? null).toBeNull();
      const ten = await useLinkForm(tokenOf(grant.path), eleven.slice(0, UPLOAD_LINK_MAX_FILES));
      expect(ten._status, JSON.stringify(ten._json)).toBe(200);
      expect((await claim(id)).scans).toHaveLength(UPLOAD_LINK_MAX_FILES);
    });

    it('a link that names no record takes exactly its count: two of three is refused before the spend, three land', async () => {
      const grant = await files.createUploadLinkForNewRecordAs('claim', { field: 'scans', count: 3 }, OWNER as never);
      const short = await useLinkForm(tokenOf(grant.path), [pdf('ex-1.pdf'), pdf('ex-2.pdf')]);
      expect(short._status, JSON.stringify(short._json)).toBe(400);
      expect(short._json.error).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(short._json.error.message).toContain('takes exactly 3 files');
      expect(await fileRow(grant.fileIds[0])).toMatchObject({ status: 'pending', name: 'upload-link' });
      const full = await useLinkForm(tokenOf(grant.path), [pdf('ex-1.pdf'), pdf('ex-2.pdf'), pdf('ex-3.pdf')]);
      expect(full._status, JSON.stringify(full._json)).toBe(200);
    });

    it('control: a single-file field link and an attachments link still take one file; a second is refused, and the one lands', async () => {
      for (const target of [{ field: 'policy' }, { attachments: true as const }]) {
        const grant = await files.createUploadLinkAs('claim', ids.claimB, target, OWNER as never);
        // The door never reads a form for such a link (below); the service it
        // spends through refuses two files before the spend all the same.
        const two = [pdf('one-a.pdf'), pdf('one-b.pdf')].map((p) => ({ filename: p.name, mimeType: 'application/pdf', data: p.bytes }));
        expect(await refusalOf(files.consumeUploadLinkFiles(tokenOf(grant.path), two, OWNER.userId)))
          .toMatchObject({ code: 'VALIDATION_ERROR', status: 400, message: expect.stringContaining('takes one file') });
        expect(await rowsNamed(['one-a.pdf', 'one-b.pdf'])).toEqual([]);
        const one = await useLink(tokenOf(grant.path), Buffer.from('%PDF-1.4 one'));
        expect(one._status, JSON.stringify(one._json)).toBe(200);
        // And once used, a second file through it is the one unusable-link answer, as before.
        const second = await useLink(tokenOf(grant.path), Buffer.from('%PDF-1.4 two'));
        expect(second._status).toBe(404);
      }
      // A link naming no record for a single-file field: count above one is refused when minted.
      expect(await refusalOf(files.createUploadLinkForNewRecordAs('claim', { field: 'policy', count: 2 }, OWNER as never)))
        .toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      for (const count of [0, UPLOAD_LINK_MAX_FILES + 1, 1.5]) {
        expect(await refusalOf(files.createUploadLinkForNewRecordAs('claim', { field: 'scans', count }, OWNER as never)))
          .toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      }
    });

    it('another signed-in user cannot use a several-file link: the one 404, nothing spent, and the minting user then uses it', async () => {
      const id = await newClaim('stranger');
      const grant = await files.createUploadLinkAs('claim', id, { field: 'scans' }, OWNER as never);
      const stranger = await useLinkForm(tokenOf(grant.path), [pdf('st-1.pdf'), pdf('st-2.pdf')], REVIEWER.userId);
      expect(stranger._status).toBe(404);
      expect(stranger._json.error.code).toBe('RESOURCE_NOT_FOUND');
      expect(await rowsNamed(['st-1.pdf', 'st-2.pdf'])).toEqual([]);
      const owner = await useLinkForm(tokenOf(grant.path), [pdf('st-1.pdf'), pdf('st-2.pdf')]);
      expect(owner._status, JSON.stringify(owner._json)).toBe(200);
    });

    it('file 2 of 3 the field does not take: the whole submit is refused before the spend, the record unchanged, nothing stored', async () => {
      const id = await newClaim('accept');
      const grant = await files.createUploadLinkAs('claim', id, { field: 'scans' }, OWNER as never);
      const picks = [pdf('acc-1.pdf'), { name: 'acc-2.png', bytes: Buffer.from('png'), type: 'image/png' }, pdf('acc-3.pdf')];
      const refused = await useLinkForm(tokenOf(grant.path), picks);
      expect(refused._status, JSON.stringify(refused._json)).toBe(400);
      expect(refused._json.error.code).toBe('ERR_FILE_CONSTRAINT');
      expect((await claim(id)).scans ?? null).toBeNull();
      expect(await rowsNamed(picks.map((p) => p.name))).toEqual([]);
      // Not spent: the same link takes the three PDFs.
      const ok = await useLinkForm(tokenOf(grant.path), [pdf('acc-1.pdf'), pdf('acc-2.pdf'), pdf('acc-3.pdf')]);
      expect(ok._status, JSON.stringify(ok._json)).toBe(200);
    });

    it('file 2 of 3 failing in the storage write after the spend: the record is unchanged and no row or bytes of the submit are left', async () => {
      const id = await newClaim('store-fail');
      const kept = await uploadThroughLink({ field: 'scans' }, Buffer.from('%PDF-1.4 kept'), id);
      const grant = await files.createUploadLinkAs('claim', id, { field: 'scans' }, OWNER as never);
      const upload = storage.upload.bind(storage);
      const keys: string[] = [];
      const tried: string[] = [];
      let calls = 0;
      vi.spyOn(storage, 'upload').mockImplementation(async (key, data, opts) => {
        calls += 1;
        tried.push(key);
        if (calls === 2) throw new Error('disk full');
        keys.push(key);
        return upload(key, data, opts);
      });
      const deleted = vi.spyOn(storage, 'delete');
      const picks = [pdf('sf-1.pdf'), pdf('sf-2.pdf'), pdf('sf-3.pdf')];
      const res = await useLinkForm(tokenOf(grant.path), picks);
      expect(res._status).toBe(500);
      expect((await claim(id)).scans).toEqual([kept.fileId]);
      expect(await rowsNamed(picks.map((p) => p.name))).toEqual([]);
      expect(keys).toHaveLength(1);
      expect(await storage.exists(keys[0])).toBe(false);
      // The upload that threw may have written part of its bytes: its key is deleted too.
      expect(tried).toHaveLength(2);
      expect(deleted.mock.calls.map(([key]) => key)).toEqual(tried);
      vi.restoreAllMocks();
      // A link naming no record: every id of the submit is gone, the reserved ones not reached included.
      const pre = await files.createUploadLinkForNewRecordAs('claim', { field: 'scans', count: 3 }, OWNER as never);
      calls = 0;
      keys.length = 0;
      tried.length = 0;
      vi.spyOn(storage, 'upload').mockImplementation(async (key, data, opts) => {
        calls += 1;
        tried.push(key);
        if (calls === 2) throw new Error('disk full');
        keys.push(key);
        return upload(key, data, opts);
      });
      const preDeleted = vi.spyOn(storage, 'delete');
      const preRes = await useLinkForm(tokenOf(pre.path), [pdf('spf-1.pdf'), pdf('spf-2.pdf'), pdf('spf-3.pdf')]);
      expect(preRes._status).toBe(500);
      for (const fileId of pre.fileIds) expect(await fileRow(fileId)).toBeUndefined();
      expect(await storage.exists(keys[0])).toBe(false);
      expect(tried).toHaveLength(2);
      expect(preDeleted.mock.calls.map(([key]) => key)).toEqual(tried);
    });

    it('the record\'s write refusing after the spend (a lock): 409, the record unchanged, none of the files kept', async () => {
      const id = await newClaim('lock-after');
      const grant = await files.createUploadLinkAs('claim', id, { field: 'scans' }, OWNER as never);
      locked.add(id);
      try {
        const picks = [pdf('lk-1.pdf'), pdf('lk-2.pdf'), pdf('lk-3.pdf')];
        const res = await useLinkForm(tokenOf(grant.path), picks);
        expect(res._status, JSON.stringify(res._json)).toBe(409);
        expect(res._json.error.code).toBe('RECORD_LOCKED');
        expect((await claim(id)).scans ?? null).toBeNull();
        expect(await rowsNamed(picks.map((p) => p.name))).toEqual([]);
      } finally {
        locked.delete(id);
      }
    });

    it('a form that lost a part is refused 400 INVALID_REQUEST and spends nothing', async () => {
      const id = await newClaim('lost-part');
      const grant = await files.createUploadLinkAs('claim', id, { field: 'scans' }, OWNER as never);
      const lost = await useLinkForm(tokenOf(grant.path), [pdf('lp-1.pdf'), pdf('lp-2.pdf')], OWNER.userId, { count: '3' });
      expect(lost._status, JSON.stringify(lost._json)).toBe(400);
      expect(lost._json.error.code).toBe('INVALID_REQUEST');
      const ok = await useLinkForm(tokenOf(grant.path), [pdf('lp-1.pdf'), pdf('lp-2.pdf')]);
      expect(ok._status, JSON.stringify(ok._json)).toBe(200);
    });

    it('a multi-file field\'s record link judges the field\'s accept before the spend for one file too: refused, nothing stored, the link unspent', async () => {
      const id = await newClaim('one-png');
      const grant = await files.createUploadLinkAs('claim', id, { field: 'scans' }, OWNER as never);
      const png = { name: 'one.png', bytes: Buffer.from('png'), type: 'image/png' };
      for (const refused of [
        await useLinkForm(tokenOf(grant.path), [png]),
        await useLink(tokenOf(grant.path), Buffer.from('png'), { 'content-type': 'image/png', 'x-file-name': 'one.png' }),
      ]) {
        expect(refused._status, JSON.stringify(refused._json)).toBe(400);
        expect(refused._json.error.code).toBe('ERR_FILE_CONSTRAINT');
      }
      expect((await claim(id)).scans ?? null).toBeNull();
      expect(await rowsNamed(['one.png'])).toEqual([]);
      const ok = await useLinkForm(tokenOf(grant.path), [pdf('one-ok.pdf')]);
      expect(ok._status, JSON.stringify(ok._json)).toBe(200);
    });

    it('a link that takes one file takes its body as the file whatever its content type, a multipart body included, under the one-file limit, as before', async () => {
      const multipart = 'multipart/form-data; boundary=----os';
      const raw = Buffer.from('------os\r\nContent-Disposition: form-data; name="count"\r\n\r\n1\r\n------os--\r\n');
      storage.setLimitsSnapshot({ maxUploadMb: { value: 1, authored: true } } as never);
      try {
        for (const target of [{ field: 'policy' }, { attachments: true as const }]) {
          const grant = await files.createUploadLinkAs('claim', ids.claimB, target, OWNER as never);
          const token = tokenOf(grant.path);
          // Declared over the one-file limit but within a form's allowance for
          // one file: refused, with the one-file words, before anything is read.
          const over = await useLink(token, raw, { 'content-type': multipart, 'content-length': String(MIB + 1) });
          expect(over._status, JSON.stringify(over._json)).toBe(413);
          expect(over._json.error.message).toBe(uploadSizeRefusal(MIB + 1, MIB, (n) => `The upload body is ${n} bytes`));
          // So is the page's own form, header and all: such a link reads no form.
          const marked = await putForm(token, { count: '1', ...countedParts(1).parts }, { 'content-length': String(MIB + 1) });
          expect(marked._status, JSON.stringify(marked._json)).toBe(413);
          expect(marked._json.error.message).toBe(over._json.error.message);
          // The body is the file: stored as sent, its size the body's length.
          const res = await useLink(token, raw, { 'content-type': multipart });
          expect(res._status, JSON.stringify(res._json)).toBe(200);
          expect(res._json.data.size).toBe(raw.length);
          expect(res._json.data.fileIds).toEqual([res._json.data.fileId]);
          expect((await useLink(token, raw, { 'content-type': multipart }))._status).toBe(404);
        }
      } finally {
        storage.setLimitsSnapshot({} as never);
      }
    });

    it('a multipart body without the form header is the file on every link, a multi-file field\'s and a count-1 link\'s included, under the one-file limit, as before', async () => {
      const multipart = 'multipart/form-data; boundary=----os';
      const raw = Buffer.from('------os\r\nContent-Disposition: form-data; name="file0"; filename="a.pdf"\r\n\r\n%PDF-1.4\r\n------os--\r\n');
      storage.setLimitsSnapshot({ maxUploadMb: { value: 1, authored: true } } as never);
      try {
        const record = await files.createUploadLinkAs('claim', await newClaim('raw-multipart'), { field: 'scans' }, OWNER as never);
        const pre = await files.createUploadLinkForNewRecordAs('claim', { field: 'scans', count: 1 }, OWNER as never);
        for (const grant of [record, pre]) {
          const token = tokenOf(grant.path);
          const over = await useLink(token, raw, { 'content-type': multipart, 'content-length': String(MIB + 1) });
          expect(over._status, JSON.stringify(over._json)).toBe(413);
          expect(over._json.error.message).toBe(uploadSizeRefusal(MIB + 1, MIB, (n) => `The upload body is ${n} bytes`));
          // Even a body shaped like the form (`count`, `file0`) is the file when it does not say it is the form.
          const res = await call('PUT', `${BASE}/upload-links/:token`, {
            params: { token },
            headers: { 'content-type': multipart, 'x-file-name': encodeURIComponent('scan 1.pdf'), ...sessionOf(OWNER.userId) },
            body: { count: '1', ...countedParts(1).parts },
            rawBody: async () => raw,
          });
          expect(res._status, JSON.stringify(res._json)).toBe(200);
          expect(res._json.data.size).toBe(raw.length);
          expect(res._json.data.fileIds).toEqual([res._json.data.fileId]);
        }
      } finally {
        storage.setLimitsSnapshot({} as never);
      }
    });

    it('a form to a link that cannot be used takes the one-file path: over the one-file limit it is refused 413 with the one-file words, as before', async () => {
      const grant = await files.createUploadLinkAs('claim', ids.claimB, { field: 'policy' }, OWNER as never);
      expect((await useLink(tokenOf(grant.path), Buffer.from('%PDF-1.4 used')))._status).toBe(200);
      storage.setLimitsSnapshot({ maxUploadMb: { value: 1, authored: true } } as never);
      try {
        const over = await putForm(tokenOf(grant.path), { count: '1', ...countedParts(1).parts }, { 'content-length': String(MIB + 1) });
        expect(over._status, JSON.stringify(over._json)).toBe(413);
        expect(over._json.error.message).toBe(uploadSizeRefusal(MIB + 1, MIB, (n) => `The upload body is ${n} bytes`));
      } finally {
        storage.setLimitsSnapshot({} as never);
      }
      expect((await putForm(tokenOf(grant.path), { count: '1', ...countedParts(1).parts }))._status).toBe(404);
    });

    it('a link whose reserved ids name a file twice, or its own id, is the one unusable link', async () => {
      for (const forge of ['twice', 'own'] as const) {
        const grant = await files.createUploadLinkForNewRecordAs('claim', { field: 'scans', count: 3 }, OWNER as never);
        const [linkId, first] = grant.fileIds;
        const row = await fileRow(linkId);
        const state = JSON.parse(row.metadata);
        state.reserved_ids = forge === 'twice' ? `${first},${first}` : `${linkId},${first}`;
        await engine.update('sys_file', { metadata: JSON.stringify(state) }, { where: { id: linkId }, context: SYS } as never);
        const res = await useLinkForm(tokenOf(grant.path), [pdf(`fg-${forge}-1.pdf`), pdf(`fg-${forge}-2.pdf`), pdf(`fg-${forge}-3.pdf`)]);
        expect(res._status, `${forge}: ${JSON.stringify(res._json)}`).toBe(404);
        expect(res._json.error.message).toBe(UPLOAD_LINK_UNUSABLE_MESSAGE);
        expect(await rowsNamed([`fg-${forge}-1.pdf`, `fg-${forge}-2.pdf`, `fg-${forge}-3.pdf`])).toEqual([]);
      }
    });

    it('a form on a multi-file field\'s link declares up to that link\'s files, each within the limit', async () => {
      storage.setLimitsSnapshot({ maxUploadMb: { value: 1, authored: true } } as never);
      try {
        const several = await files.createUploadLinkAs('claim', await newClaim('declared'), { field: 'scans' }, OWNER as never);
        const two = await putForm(tokenOf(several.path), { count: '2', ...countedParts(2).parts }, { 'content-length': String(2 * MIB) });
        expect(two._status, JSON.stringify(two._json)).toBe(200);
      } finally {
        storage.setLimitsSnapshot({} as never);
      }
    });
    it('a form is refused before any part is read: a count over the link\'s cap, parts that disagree with count, a part missing', async () => {
      const grant = await files.createUploadLinkAs('claim', await newClaim('unread'), { field: 'scans' }, OWNER as never);
      const token = tokenOf(grant.path);
      const over = countedParts(UPLOAD_LINK_MAX_FILES + 1);
      const tooMany = await putForm(token, { count: String(UPLOAD_LINK_MAX_FILES + 1), ...over.parts });
      expect(tooMany._status, JSON.stringify(tooMany._json)).toBe(400);
      expect(tooMany._json.error.code).toBe('VALIDATION_ERROR');
      expect(tooMany._json.error.message).toContain(`takes up to ${UPLOAD_LINK_MAX_FILES} files`);
      expect(over.reads.count).toBe(0);
      const huge = countedParts(2);
      const hugeCount = await putForm(token, { count: '999', ...huge.parts });
      expect(hugeCount._json.error.code).toBe('VALIDATION_ERROR');
      expect(huge.reads.count).toBe(0);
      const lost = countedParts(2);
      const lostRes = await putForm(token, { count: '3', ...lost.parts });
      expect(lostRes._json.error.code).toBe('INVALID_REQUEST');
      expect(lost.reads.count).toBe(0);
      const gap = countedParts(3);
      const gapRes = await putForm(token, { count: '2', file0: gap.parts.file0, file2: gap.parts.file2 });
      expect(gapRes._json.error.code).toBe('INVALID_REQUEST');
      expect(gap.reads.count).toBe(0);
      const ok = countedParts(2);
      expect((await putForm(token, { count: '2', ...ok.parts }))._status).toBe(200);
      expect(ok.reads.count).toBe(2);
    });

    it('the page: a multi-file field link picks several, a link naming no record asks for its count, a single-file link picks one', async () => {
      const id = await newClaim('page');
      const several = await openLink(tokenOf((await files.createUploadLinkAs('claim', id, { field: 'scans' }, OWNER as never)).path));
      expect(several._status).toBe(200);
      expect(String(several._sent)).toContain('<input id="file" type="file" multiple>');
      expect(String(several._sent)).toContain(UPLOAD_LINK_COPY.en.wantedSeveral(UPLOAD_LINK_MAX_FILES));
      // The page's form says it is the form; nothing else is read as one.
      expect(String(several._sent)).toContain('headers:{"x-upload-link-form":"several"},body:form');
      const exact = await openLink(tokenOf((await files.createUploadLinkForNewRecordAs('claim', { field: 'scans', count: 3 }, OWNER as never)).path));
      expect(String(exact._sent)).toContain(UPLOAD_LINK_COPY.en.wantedExactly(3));
      expect(String(exact._sent)).toContain('multiple');
      const single = await openLink(tokenOf((await files.createUploadLinkAs('claim', id, { field: 'policy' }, OWNER as never)).path));
      expect(String(single._sent)).toContain('<input id="file" type="file">');
      expect(String(single._sent)).not.toContain('multiple');
    });
  });
});
