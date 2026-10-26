// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25692 — a record write claims or copies only a file its caller may read,
 * and "may read" is the download door's own verdict.
 *
 * ADR-0104 D3: one file, one owning record, one access rule. The claim path
 * (`installFileReferenceHooks`) copies a file another record owns into a fresh
 * `sys_file` the writing record owns, and claims a file no record owns for it.
 * Either hands the file's bytes to the writing record's readers, so neither
 * runs for a caller the door would not serve the file to. The storage plugin
 * binds the hooks to the door's judgement (`judgeFileRead`, shared with the
 * download authorizer), so the two cannot disagree.
 *
 * ## What is pinned
 *
 * One real `ObjectQL` engine over sqlite `:memory:`, with `StorageServicePlugin`
 * booted and wired exactly as it ships, asked about ONE fixture through both
 * doors: the download door (`GET /files/:fileId/url`, as the writer) and a
 * record write (as the same writer). For every file the write takes it exactly
 * when the door serves it:
 *
 *   - a file owned by a record the writer cannot read: door 403, and the write
 *     neither copies nor claims it — the value is kept as written;
 *   - an attachments-scope file whose only parent the writer cannot read: door
 *     403, and the write does not claim it;
 *   - an owner object that declares a `fileAccessDelegate`: the DELEGATE
 *     decides on both doors, refusal and admission alike;
 *   - controls, served by the door and taken by the write: a file owned by a
 *     record the writer can read (copied), the writer's own upload (copied —
 *     the uploader arm), a `public_read` file (copied), and an unclaimed file
 *     of the organization (claimed).
 *
 * And the writes with no caller to judge: a system write takes a file the
 * door refuses the writer, as it did before.
 *
 * A throw from the judgement is not a verdict: an authorization-store outage
 * fails the write with its declared envelope, and any other fault fails
 * closed — the file is kept as written, never taken.
 *
 * ## The stand-ins, and only these
 *
 *   - The security layer's refusals: an engine middleware that throws
 *     `PERMISSION_DENIED` for every non-system read of `vault` and of
 *     `sys_file`, the shape `field-owned-file-hydration-door-agreement.test.ts`
 *     uses for the same layer.
 *   - The permission store the door's context resolution reads: reads of an
 *     object this fixture never registered answer empty.
 *   - A fault switch on the judgement's `sys_attachment` read, for the
 *     outage pins.
 *   - Authentication: one `x-test-user` header per session.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuthzStoreUnavailableError, AUTHZ_STORE_UNAVAILABLE_CODE, AUTHZ_STORE_UNAVAILABLE_STATUS } from '@objectstack/core';
import type { IStorageService, RouteHandler } from '@objectstack/spec/contracts';
import { RAW_FILE_VALUES_CONTEXT_KEY, type EngineQueryOptions } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveThrownHttpError } from '@objectstack/types';
import { StorageServicePlugin } from './storage-service-plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const URL_ROUTE = '/api/v1/storage/files/:fileId/url';
const SYS = { isSystem: true };
const SYS_RAW = { isSystem: true, [RAW_FILE_VALUES_CONTEXT_KEY]: true };
const WRITER = 'u_writer';
const WRITER_CTX = { userId: WRITER };
const DELEGATE = 'test_decision_files';

/** Owned by `vault/v_closed.doc` — a record the writer cannot read. */
const F_CLOSED = 'f_closed_aa';
/** Owned by `contract/c_open.doc` — a record the writer can read. */
const F_OPEN = 'f_open_bb';
/** Owned by `vault/v_closed.doc`'s sibling slot, uploaded by the writer. */
const F_UPLOADED = 'f_uploaded_cc';
/** Owned by `vault/v_closed.annex`, `acl: 'public_read'`. */
const F_PUBLIC = 'f_public_dd';
/** No field owner: an attachments-scope file attached to `v_closed` only. */
const F_ATTACHED = 'f_attached_ee';
/** No owner at all, no attachment: an unclaimed file of the organization. */
const F_FREE = 'f_free_ff';
/** Owned by `decision/dec_allow.proof` — the delegate admits the writer. */
const F_DEC_ALLOW = 'f_decallow_gg';
/** Owned by `decision/dec_deny.proof` — the delegate refuses the writer. */
const F_DEC_DENY = 'f_decdeny_hh';
/** No owner at all, `acl: 'public_read'`: anyone's to download. */
const F_PUBLIC_FREE = 'f_publicfree_ii';
/** [#25694] The guest principal an `authRequired: false` endpoint's write executes as (ADR-0138 D9). */
const GUEST_CTX = { principalKind: 'guest' as const, positions: ['guest'], isSystem: false };

const silentLogger = () => ({
  info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(),
  trace: vi.fn(), fatal: vi.fn(), child() { return this; },
});

/** The refusal the security layer throws — `PermissionDeniedError`'s declared envelope. */
const refusal = () =>
  Object.assign(new Error('You do not have permission to perform this action.'), {
    name: 'PermissionDeniedError', code: 'PERMISSION_DENIED', status: 403, statusCode: 403,
  });

const fileRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  key: `files/${id}.pdf`,
  name: `${id}.pdf`,
  size: 2048,
  mime_type: 'application/pdf',
  scope: 'user',
  acl: 'private',
  status: 'committed',
  owner_id: 'u_uploader',
  ...extra,
});
const owned = (object: string, recordId: string, field: string) => ({
  ref_object: object, ref_id: recordId, ref_field: field,
});

const FILES = [
  fileRow(F_CLOSED, owned('vault', 'v_closed', 'doc')),
  fileRow(F_OPEN, owned('contract', 'c_open', 'doc')),
  fileRow(F_UPLOADED, { ...owned('vault', 'v_closed', 'annex'), owner_id: WRITER }),
  fileRow(F_PUBLIC, { ...owned('vault', 'v_mine', 'annex'), acl: 'public_read' }),
  fileRow(F_ATTACHED, { scope: 'attachments' }),
  fileRow(F_FREE),
  fileRow(F_DEC_ALLOW, owned('decision', 'dec_allow', 'proof')),
  fileRow(F_DEC_DENY, owned('decision', 'dec_deny', 'proof')),
  fileRow(F_PUBLIC_FREE, { acl: 'public_read' }),
];

function makeCtx() {
  const services = new Map<string, unknown>();
  const hooks: Array<() => Promise<void> | void> = [];
  return {
    logger: silentLogger(),
    registerService: (name: string, svc: unknown) => { services.set(name, svc); },
    getService: <T>(name: string): T => {
      if (!services.has(name)) throw new Error(`service '${name}' not registered`);
      return services.get(name) as T;
    },
    hook: (event: string, fn: () => Promise<void> | void) => {
      if (event === 'kernel:ready') hooks.push(fn);
    },
    flushReady: async () => { for (const h of hooks) await h(); },
  };
}

function makeHttpServer() {
  const routes = new Map<string, RouteHandler>();
  const put = (m: string) => (path: string, handler: RouteHandler) => { routes.set(`${m}:${path}`, handler); };
  return {
    routes,
    server: {
      get: put('GET'), post: put('POST'), put: put('PUT'),
      delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
      listen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('#25692 — a record write claims or copies only a file the download door serves its caller', () => {
  let rootDir: string;
  let engine: ObjectQL;
  let routes: Map<string, RouteHandler>;
  let seq = 0;
  /** When set, the judgement's `sys_attachment` read rejects with it. */
  let attachmentReadFault: Error | null = null;

  beforeAll(async () => {
    rootDir = join(tmpdir(), `os-25692-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(rootDir, { recursive: true });

    engine = new ObjectQL({ logger: silentLogger() } as any);
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }) as any, true);
    await engine.init();

    // The data door the plugin is handed: the real engine, except that a read
    // of an object this fixture never registered — the permission store the
    // door's context resolution consults — answers empty.
    const dataEngine = new Proxy(engine, {
      get(target, prop) {
        if (prop === 'find') {
          return (object: string, query?: EngineQueryOptions) => {
            if (object === 'sys_attachment' && attachmentReadFault) return Promise.reject(attachmentReadFault);
            return target.getSchema(object) ? target.find(object, query) : Promise.resolve([]);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    const ctx = makeCtx();
    const http = makeHttpServer();
    routes = http.routes;
    ctx.registerService('objectql', dataEngine);
    ctx.registerService('http-server', http.server);
    ctx.registerService('manifest', { register: (manifest: any) => engine.registerApp(manifest) });
    ctx.registerService('auth', {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const userId = headers.get('x-test-user');
          return userId ? { user: { id: userId }, session: {} } : undefined;
        },
      },
    });
    ctx.registerService(DELEGATE, {
      authorizeFileRead: async (recordId: string, context: any) =>
        recordId === 'dec_allow' && context?.userId === WRITER,
    });

    const plugin = new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false });
    await plugin.init(ctx as any);

    engine.registerApp({
      id: 'com.objectstack.test.file-reference-read-verdict',
      name: 'File reference read verdict',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      objects: [
        {
          name: 'contract',
          label: 'Contract',
          fields: {
            title: { name: 'title', type: 'text' },
            doc: { name: 'doc', type: 'file' },
            annexes: { name: 'annexes', type: 'file', multiple: true },
          },
        },
        {
          name: 'vault',
          label: 'Vault',
          fields: { doc: { name: 'doc', type: 'file' }, annex: { name: 'annex', type: 'file' } },
        },
        {
          name: 'decision',
          label: 'Decision',
          fileAccessDelegate: DELEGATE,
          fields: { proof: { name: 'proof', type: 'file' } },
        },
      ],
    } as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);

    // Seeded BEFORE kernel:ready, so the field-reference hooks do not rewrite
    // the fixture.
    for (const f of FILES) await engine.insert('sys_file', f as any, { context: SYS });
    await engine.insert('sys_attachment', {
      id: 'att_closed', file_id: F_ATTACHED, parent_object: 'vault', parent_id: 'v_closed',
      file_name: `${F_ATTACHED}.pdf`, mime_type: 'application/pdf', size: 2048,
    } as any, { context: SYS });
    await engine.insert('vault', { id: 'v_closed', doc: F_CLOSED, annex: F_UPLOADED } as any, { context: SYS });
    await engine.insert('vault', { id: 'v_mine', annex: F_PUBLIC } as any, { context: SYS });
    await engine.insert('contract', { id: 'c_open', title: 'Open', doc: F_OPEN } as any, { context: SYS });
    await engine.insert('decision', { id: 'dec_allow', proof: F_DEC_ALLOW } as any, { context: SYS });
    await engine.insert('decision', { id: 'dec_deny', proof: F_DEC_DENY } as any, { context: SYS });

    const refuseNonSystem = async (opCtx: any, next: () => Promise<void>) => {
      if (!opCtx.context?.isSystem) throw refusal();
      return next();
    };
    engine.registerMiddleware(refuseNonSystem, { object: 'sys_file' });
    engine.registerMiddleware(refuseNonSystem, { object: 'vault' });

    await plugin.start(ctx as any);
    await ctx.flushReady();

    const storage = ctx.getService<IStorageService>('storage');
    for (const f of FILES) await storage.upload(f.key, Buffer.from(`bytes of ${f.id}`));
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* already torn down */ }
    if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
  });

  /** What the download door tells `user` about one file. */
  const door = async (fileId: string, user: string = WRITER) => {
    const res: any = {
      _status: 200, _json: null,
      json(data: any) { res._json = data; return res; },
      send() { return res; },
      status(code: number) { res._status = code; return res; },
      header() { return res; },
    };
    await routes.get(`GET:${URL_ROUTE}`)!(
      { params: { fileId }, query: {}, headers: { 'x-test-user': user }, method: 'GET', path: URL_ROUTE } as any,
      res,
    );
    return { status: res._status as number, code: res._json?.error?.code as string | undefined };
  };

  const fileRows = async () => (await engine.find('sys_file', { context: SYS })) as Array<Record<string, any>>;
  const fileById = async (id: string) => (await fileRows()).find((r) => r.id === id);
  const storedDoc = async (recordId: string) =>
    ((await engine.find('contract', { where: { id: recordId }, context: SYS_RAW })) as any[])[0]?.doc;

  /**
   * Write `fileId` into a new contract's `doc`, as `context`, and report what
   * the write did with it: `copied` (the record holds a fresh file it owns),
   * `claimed` (the record owns the file it named) or `kept` (the record holds
   * the id as written and owns nothing).
   */
  const writeAs = async (fileId: string, context: Record<string, unknown>) => {
    const recordId = `c_new_${++seq}`;
    const before = (await fileRows()).length;
    await engine.insert('contract', { id: recordId, title: recordId, doc: fileId } as any, { context });
    const held = await storedDoc(recordId);
    const heldRow = await fileById(String(held));
    const ownsHeld = heldRow?.ref_object === 'contract' && heldRow?.ref_id === recordId && heldRow?.ref_field === 'doc';
    const minted = (await fileRows()).length - before;
    const outcome = held !== fileId && ownsHeld && minted === 1
      ? 'copied'
      : held === fileId && ownsHeld && minted === 0
        ? 'claimed'
        : held === fileId && !ownsHeld && minted === 0
          ? 'kept'
          : `unexpected (held ${String(held)}, owns ${ownsHeld}, minted ${minted})`;
    return { recordId, held, outcome };
  };

  describe('a file the door refuses the writer is neither copied nor claimed by the writer\'s write', () => {
    it('a file owned by a record the writer cannot read', async () => {
      expect(await door(F_CLOSED)).toEqual({ status: 403, code: 'FILE_DOWNLOAD_DENIED' });

      const { outcome } = await writeAs(F_CLOSED, WRITER_CTX);

      expect(outcome).toBe('kept');
      expect(await fileById(F_CLOSED)).toMatchObject(owned('vault', 'v_closed', 'doc'));
    });

    it('an attachments-scope file whose only parent the writer cannot read', async () => {
      expect(await door(F_ATTACHED)).toEqual({ status: 403, code: 'ATTACHMENT_DOWNLOAD_DENIED' });

      const { outcome } = await writeAs(F_ATTACHED, WRITER_CTX);

      expect(outcome).toBe('kept');
      expect((await fileById(F_ATTACHED))?.ref_id ?? null).toBeNull();
    });

    it('a file whose owner object\'s delegate refuses the writer', async () => {
      expect(await door(F_DEC_DENY)).toEqual({ status: 403, code: 'FILE_DOWNLOAD_DENIED' });

      expect((await writeAs(F_DEC_DENY, WRITER_CTX)).outcome).toBe('kept');
    });
  });

  describe('CONTROL — a file the door serves the writer is taken by the writer\'s write, as before', () => {
    it('a file owned by a record the writer can read is copied', async () => {
      expect(await door(F_OPEN)).toEqual({ status: 200, code: undefined });

      const { held, outcome } = await writeAs(F_OPEN, WRITER_CTX);

      expect(outcome).toBe('copied');
      // The copy is the writer's record's own, and the door serves it to the writer.
      expect(await door(String(held))).toEqual({ status: 200, code: undefined });
      expect(await fileById(F_OPEN)).toMatchObject(owned('contract', 'c_open', 'doc'));
    });

    it('the writer\'s own upload, owned by a record the writer cannot read, is copied (the uploader arm)', async () => {
      expect(await door(F_UPLOADED)).toEqual({ status: 200, code: undefined });

      expect((await writeAs(F_UPLOADED, WRITER_CTX)).outcome).toBe('copied');
    });

    it('a public_read file is copied', async () => {
      expect(await door(F_PUBLIC)).toEqual({ status: 200, code: undefined });

      expect((await writeAs(F_PUBLIC, WRITER_CTX)).outcome).toBe('copied');
    });

    it('a file whose owner object\'s delegate admits the writer is copied', async () => {
      expect(await door(F_DEC_ALLOW)).toEqual({ status: 200, code: undefined });

      expect((await writeAs(F_DEC_ALLOW, WRITER_CTX)).outcome).toBe('copied');
    });

    it('an unclaimed file of the organization is claimed', async () => {
      expect(await door(F_FREE)).toEqual({ status: 200, code: undefined });

      expect((await writeAs(F_FREE, WRITER_CTX)).outcome).toBe('claimed');
    });
  });

  describe('a throw from the judgement is not a verdict', () => {
    it('an authorization-store outage fails the write with its declared envelope', async () => {
      attachmentReadFault = new AuthzStoreUnavailableError('sys_attachment');
      const recordId = `c_new_${++seq}`;
      try {
        const err = await engine
          .insert('contract', { id: recordId, title: recordId, doc: F_ATTACHED } as any, { context: WRITER_CTX })
          .then(() => null, (e: any) => e);
        expect({ code: err?.code, status: err?.status }).toEqual({
          code: AUTHZ_STORE_UNAVAILABLE_CODE,
          status: AUTHZ_STORE_UNAVAILABLE_STATUS,
        });
      } finally {
        attachmentReadFault = null;
      }
      expect(await storedDoc(recordId)).toBeUndefined();
      expect((await fileById(F_ATTACHED))?.ref_id ?? null).toBeNull();
    });

    it('any other fault fails closed: the file is kept as written, never taken', async () => {
      attachmentReadFault = new Error('driver fault');
      try {
        expect((await writeAs(F_ATTACHED, WRITER_CTX)).outcome).toBe('kept');
      } finally {
        attachmentReadFault = null;
      }
    });
  });

  it('a system write has no caller to judge, and copies a file the door refuses the writer, as before', async () => {
    const { outcome } = await writeAs(F_CLOSED, { ...SYS, userId: WRITER });

    expect(outcome).toBe('copied');
  });

  describe('[#25694] an anonymous write carries no file, whatever the door would serve it', () => {
    /**
     * The refusal as the HTTP boundary answers it (ADR-0112: code and status),
     * through the one mapping both dispatcher exits and the REST door share.
     */
    const expectAnswered400 = (err: unknown) => {
      const answered = resolveThrownHttpError(err);
      expect({ status: answered.status, code: answered.code }).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
      expect(answered.details?.fields).toEqual([expect.objectContaining({ field: 'doc', code: 'invalid_value' })]);
    };

    /** The write's refusal, and proof that nothing was written: no record, no new file, no owner moved. */
    const expectRefused = async (data: Record<string, unknown>, context: Record<string, unknown>) => {
      const recordId = `c_new_${++seq}`;
      const before = await fileRows();
      const err = await engine
        .insert('contract', { id: recordId, title: recordId, ...data } as any, { context })
        .then(() => null, (e: any) => e);
      expectAnswered400(err);
      expect(err?.fields).toEqual([expect.objectContaining({ field: 'doc', code: 'invalid_value' })]);
      expect(await storedDoc(recordId)).toBeUndefined();
      expect(await fileRows()).toEqual(before);
    };

    it('a public_read file another record owns is not copied for the guest', async () => {
      await expectRefused({ doc: F_PUBLIC }, GUEST_CTX);
      expect(await fileById(F_PUBLIC)).toMatchObject(owned('vault', 'v_mine', 'annex'));
    });

    it('an unclaimed public_read file is not claimed for the guest', async () => {
      await expectRefused({ doc: F_PUBLIC_FREE }, GUEST_CTX);
      expect((await fileById(F_PUBLIC_FREE))?.ref_id ?? null).toBeNull();
    });

    it('a file id the guest may not read is not stored either', async () => {
      await expectRefused({ doc: F_FREE }, GUEST_CTX);
    });

    it('a value that names no platform file is not stored either', async () => {
      await expectRefused({ doc: 'https://example.test/report.pdf' }, GUEST_CTX);
    });

    it('an update carrying a file is refused, and the record keeps what it held', async () => {
      const recordId = `c_new_${++seq}`;
      await engine.insert('contract', { id: recordId, title: recordId } as any, { context: GUEST_CTX });
      const err = await engine
        .update('contract', { id: recordId, doc: F_PUBLIC_FREE } as any, { context: GUEST_CTX })
        .then(() => null, (e: any) => e);
      expectAnswered400(err);
      expect(await storedDoc(recordId)).toBeNull();
      expect((await fileById(F_PUBLIC_FREE))?.ref_id ?? null).toBeNull();
    });

    it('CONTROL — a guest write that carries no file is written', async () => {
      const recordId = `c_new_${++seq}`;
      await engine.insert('contract', { id: recordId, title: recordId, doc: null } as any, { context: GUEST_CTX });
      expect(await storedDoc(recordId)).toBeNull();
    });

    it('CONTROL — a signed-in writer still takes the same public_read file', async () => {
      expect((await writeAs(F_PUBLIC_FREE, WRITER_CTX)).outcome).toBe('claimed');
    });
  });
});
