// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22637 — a file field's metadata follows the parent-derived verdict the
 * download door already applies (maintainer ruling B on #22624).
 *
 * ## The defect
 *
 * A reader who may read a record but not `sys_file` (the platform default:
 * `member_default` grants no `sys_file` read) used to get the file field back
 * as `{ id, metadataRefused: true }` (#22620) — while the download door, which
 * judges a field-owned file by its OWNING RECORD (ADR-0104 D3,
 * `buildFileReadAuthorizer`), served that same reader the bytes. One file, two
 * authorities: the bytes yes, the name no.
 *
 * ## What is pinned — the two surfaces asked about ONE fixture
 *
 * Both answers come from the same rows on one real `ObjectQL` engine over
 * sqlite `:memory:` (the project's ruled test backend), with
 * `StorageServicePlugin` booted and wired exactly as it ships: its `start()`
 * mounts the door AND hands the engine the door's field-owned verdict through
 * `registerFieldOwnedFileReadAuthorizer`. So each case asks the door
 * (`GET /files/:fileId/url`, as the reader) and the record read (as the same
 * reader), and the pair is pinned together:
 *
 *   - a field-owned file on the record read — the door serves it, and the read
 *     hydrates it in full;
 *   - an owner object that declares a `fileAccessDelegate` — the DELEGATE
 *     decides on both surfaces, deny and allow alike, while the raw record
 *     read would allow both;
 *   - an id copied out of a record the reader cannot read — refused on both
 *     surfaces.
 *
 * And the ruling's boundary, where the read is deliberately NARROWER than the
 * door: an id copied out of another record the reader CAN read, an
 * attachment-only file and an unclaimed `public_read` file all keep the
 * refused marker in the record read, because none of them is owned by the
 * record being read. `public_read` itself is unchanged (the door still serves
 * it anonymously), and a direct `sys_file` query by the reader is still
 * refused.
 *
 * ## The stand-ins, and only these
 *
 *   - The security layer's `sys_file` refusal: an engine middleware that
 *     throws `PERMISSION_DENIED` for every non-system `sys_file` read — the
 *     shape plugin-security's `file-field-hydration-refused.test.ts` measures
 *     on the real `SecurityPlugin`. A second middleware refuses the reader the
 *     `vault` object the same way.
 *   - The permission store `resolveAuthzContext` reads for the door: reads of
 *     an object this fixture never registered answer empty (the reader holds
 *     no grants), as `mount-storage-routes.test.ts` does.
 *   - Authentication: one `x-test-user` header per session.
 *
 * `@objectstack/objectql` resolves through its `exports` to `dist/` here
 * (`KNOWN_UNALIASED_TEST_IMPORTS`), so an ablation of the engine's arm is
 * observed only after a rebuild of that package.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RouteHandler } from '@objectstack/spec/contracts';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { StorageServicePlugin } from './storage-service-plugin.js';

const URL_ROUTE = '/api/v1/storage/files/:fileId/url';
const SYS = { isSystem: true };
const READER = 'u_reader';
const READER_CTX = { userId: READER };
const DELEGATE = 'test_decision_files';

/** Owned by `contract/c_open.signed_pdf`. */
const F_OWNED = 'f_owned_c1aa';
/** Owned by `contract/c_open.annexes`. */
const F_ANNEX = 'f_annex_c1bb';
/** Owned by `contract/c_other.signed_pdf` — and copied into `c_open.annexes`. */
const F_SIBLING = 'f_sibling_c2cc';
/** Owned by `vault/v1.doc`, a record the reader cannot read — copied into `c_open.annexes`. */
const F_VAULT = 'f_vault_v1dd';
/** No field owner: an attachments-scope file, attached to `c_open` by a `sys_attachment` row. */
const F_ATTACH = 'f_attach_c1ee';
/** No field owner, `acl: 'public_read'`. */
const F_PUBLIC = 'f_public_ff';
/** Owned by `decision/dec_allow.proof` — the delegate allows the reader. */
const F_DEC_ALLOW = 'f_decallow_gg';
/** Owned by `decision/dec_deny.proof` — the delegate refuses the reader. */
const F_DEC_DENY = 'f_decdeny_hh';

const silentLogger = () => ({
  info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(),
  trace: vi.fn(), fatal: vi.fn(), child() { return this; },
});

/** The refusal the security layer throws — `PermissionDeniedError`'s declared envelope. */
const refusal = () =>
  Object.assign(new Error('You do not have permission to perform this action.'), {
    name: 'PermissionDeniedError', code: 'PERMISSION_DENIED', status: 403, statusCode: 403,
  });

const fileRow = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  key: `files/${id}.pdf`,
  name,
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
  fileRow(F_OWNED, 'owned.pdf', owned('contract', 'c_open', 'signed_pdf')),
  fileRow(F_ANNEX, 'annex.pdf', owned('contract', 'c_open', 'annexes')),
  fileRow(F_SIBLING, 'sibling.pdf', owned('contract', 'c_other', 'signed_pdf')),
  fileRow(F_VAULT, 'vault.pdf', owned('vault', 'v1', 'doc')),
  fileRow(F_ATTACH, 'attached.pdf', { scope: 'attachments' }),
  fileRow(F_PUBLIC, 'public.pdf', { acl: 'public_read' }),
  fileRow(F_DEC_ALLOW, 'allow.pdf', owned('decision', 'dec_allow', 'proof')),
  fileRow(F_DEC_DENY, 'deny.pdf', owned('decision', 'dec_deny', 'proof')),
];

const hydrated = (id: string, name: string) => ({
  id, name, size: 2048, mimeType: 'application/pdf', url: `/api/v1/storage/files/${id}`,
});
const refused = (id: string) => ({ id, metadataRefused: true });

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

describe('#22637 — a file field\'s metadata and the download door agree, for a reader refused sys_file read', () => {
  let rootDir: string;
  let engine: ObjectQL;
  let routes: Map<string, RouteHandler>;
  const delegateCalls: Array<{ recordId: string; userId: unknown }> = [];

  beforeAll(async () => {
    rootDir = join(tmpdir(), `os-22637-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(rootDir, { recursive: true });

    engine = new ObjectQL({ logger: silentLogger() } as any);
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }) as any, true);
    await engine.init();

    // The data door the plugin is handed: the real engine, except that a read
    // of an object this fixture never registered — the permission store
    // `resolveAuthzContext` consults for the door's caller — answers empty.
    const dataEngine = new Proxy(engine, {
      get(target, prop) {
        if (prop === 'find') {
          return (object: string, query?: unknown) =>
            target.getSchema(object) ? target.find(object, query as any) : Promise.resolve([]);
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
    // The plugin registers the real `sys_file` / `sys_attachment` through this.
    ctx.registerService('manifest', { register: (manifest: any) => engine.registerApp(manifest) });
    ctx.registerService('auth', {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const userId = headers.get('x-test-user');
          return userId ? { user: { id: userId }, session: {} } : undefined;
        },
      },
    });
    // The declared delegate: allows the reader on `dec_allow` only.
    ctx.registerService(DELEGATE, {
      authorizeFileRead: async (recordId: string, context: any) => {
        delegateCalls.push({ recordId, userId: context?.userId });
        return recordId === 'dec_allow' && context?.userId === READER;
      },
    });

    const plugin = new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false });
    await plugin.init(ctx as any);

    engine.registerApp({
      id: 'com.objectstack.test.field-owned-file-hydration',
      name: 'Field-owned file hydration',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      objects: [
        {
          name: 'contract',
          label: 'Contract',
          fields: {
            title: { name: 'title', type: 'text' },
            signed_pdf: { name: 'signed_pdf', type: 'file' },
            annexes: { name: 'annexes', type: 'file', multiple: true },
          },
        },
        { name: 'vault', label: 'Vault', fields: { doc: { name: 'doc', type: 'file' } } },
        {
          name: 'decision',
          label: 'Decision',
          // Both decisions are readable by a raw record read; the delegate is
          // what tells them apart.
          fileAccessDelegate: DELEGATE,
          fields: { proof: { name: 'proof', type: 'file' } },
        },
      ],
    } as never);
    await engine.syncSchemas();

    // Seeded BEFORE kernel:ready, so the field-reference hooks (which would
    // copy an already-owned id into a fresh row) do not rewrite the fixture.
    for (const f of FILES) await engine.insert('sys_file', f as any, { context: SYS } as any);
    await engine.insert('sys_attachment', {
      id: 'att_1', file_id: F_ATTACH, parent_object: 'contract', parent_id: 'c_open',
      file_name: 'attached.pdf', mime_type: 'application/pdf', size: 2048,
    } as any, { context: SYS } as any);
    await engine.insert('contract', {
      id: 'c_open', title: 'Open', signed_pdf: F_OWNED, annexes: [F_ANNEX, F_SIBLING, F_VAULT, F_ATTACH, F_PUBLIC],
    } as any, { context: SYS } as any);
    await engine.insert('contract', { id: 'c_other', title: 'Other', signed_pdf: F_SIBLING } as any, { context: SYS } as any);
    await engine.insert('vault', { id: 'v1', doc: F_VAULT } as any, { context: SYS } as any);
    await engine.insert('decision', { id: 'dec_allow', proof: F_DEC_ALLOW } as any, { context: SYS } as any);
    await engine.insert('decision', { id: 'dec_deny', proof: F_DEC_DENY } as any, { context: SYS } as any);

    // The security layer, as far as this fixture needs it.
    const refuseNonSystem = async (opCtx: any, next: () => Promise<void>) => {
      if (!opCtx.context?.isSystem) throw refusal();
      return next();
    };
    engine.registerMiddleware(refuseNonSystem, { object: 'sys_file' });
    engine.registerMiddleware(refuseNonSystem, { object: 'vault' });

    await plugin.start(ctx as any);
    await ctx.flushReady();

    const storage = ctx.getService<any>('storage');
    for (const f of FILES) await storage.upload(f.key, Buffer.from(`bytes of ${f.id}`));
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* already torn down */ }
    if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
  });

  /** What the download door tells `user` (or an anonymous caller) about one file. */
  const door = async (fileId: string, user?: string) => {
    const res: any = {
      _status: 200, _json: null,
      json(data: any) { res._json = data; return res; },
      send() { return res; },
      status(code: number) { res._status = code; return res; },
      header() { return res; },
    };
    await routes.get(`GET:${URL_ROUTE}`)!(
      { params: { fileId }, query: {}, headers: user ? { 'x-test-user': user } : {}, method: 'GET', path: URL_ROUTE } as any,
      res,
    );
    return { status: res._status as number, code: res._json?.error?.code as string | undefined };
  };

  /** What the record read tells the reader about one record's file fields. */
  const readAs = async (object: string, id: string) =>
    (await engine.find(object, { where: { id }, context: READER_CTX } as any))[0];

  it('the refusal it starts from: the reader may not query sys_file directly — and still may not', async () => {
    const direct = await engine.find('sys_file', { context: READER_CTX } as any).then(() => null, (e: any) => e);
    expect({ code: direct?.code, status: direct?.statusCode ?? direct?.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
  });

  it('a field-owned file on the record read: the door serves the reader its bytes, and the read hydrates it in full', async () => {
    expect(await door(F_OWNED, READER)).toEqual({ status: 200, code: undefined });
    expect(await door(F_ANNEX, READER)).toEqual({ status: 200, code: undefined });

    const contract = await readAs('contract', 'c_open');
    expect(contract.signed_pdf).toEqual(hydrated(F_OWNED, 'owned.pdf'));
    expect(contract.annexes[0]).toEqual(hydrated(F_ANNEX, 'annex.pdf'));
  });

  it('a declared fileAccessDelegate decides on BOTH surfaces — it refuses: door 403 and the read keeps the marker', async () => {
    expect(await door(F_DEC_DENY, READER)).toEqual({ status: 403, code: 'FILE_DOWNLOAD_DENIED' });
    expect((await readAs('decision', 'dec_deny')).proof).toEqual(refused(F_DEC_DENY));
  });

  it('a declared fileAccessDelegate decides on BOTH surfaces — it allows: door 200 and the read hydrates', async () => {
    expect(await door(F_DEC_ALLOW, READER)).toEqual({ status: 200, code: undefined });

    delegateCalls.length = 0;
    expect((await readAs('decision', 'dec_allow')).proof).toEqual(hydrated(F_DEC_ALLOW, 'allow.pdf'));
    // The delegate was asked — by the reader, for the owning record.
    expect(delegateCalls).toEqual([{ recordId: 'dec_allow', userId: READER }]);
  });

  it('an id copied out of a record the reader cannot read is refused on both surfaces', async () => {
    expect(await door(F_VAULT, READER)).toEqual({ status: 403, code: 'FILE_DOWNLOAD_DENIED' });
    expect((await readAs('contract', 'c_open')).annexes[2]).toEqual(refused(F_VAULT));
  });

  it('the ruling\'s boundary: an id copied out of a record the reader CAN read hydrates on its owner and stays refused where it was copied', async () => {
    // The door serves it (its owner, `c_other`, is readable) …
    expect(await door(F_SIBLING, READER)).toEqual({ status: 200, code: undefined });
    // … and the record that owns it hydrates it, while the one it was copied
    // into does not own it and keeps the marker.
    expect((await readAs('contract', 'c_other')).signed_pdf).toEqual(hydrated(F_SIBLING, 'sibling.pdf'));
    expect((await readAs('contract', 'c_open')).annexes[1]).toEqual(refused(F_SIBLING));
  });

  it('the ruling\'s boundary: an attachment-only file keeps the marker — it is not field-owned by the record read', async () => {
    expect((await readAs('contract', 'c_open')).annexes[3]).toEqual(refused(F_ATTACH));
  });

  it('public_read is unchanged: the door still serves it anonymously, and the refused reader\'s read still marks it', async () => {
    expect(await door(F_PUBLIC)).toEqual({ status: 200, code: undefined });
    expect((await readAs('contract', 'c_open')).annexes[4]).toEqual(refused(F_PUBLIC));
  });

  it('one read, every case: each element of the multi-value field is judged on its own', async () => {
    const contract = await readAs('contract', 'c_open');
    expect(contract.annexes).toEqual([
      hydrated(F_ANNEX, 'annex.pdf'),
      refused(F_SIBLING),
      refused(F_VAULT),
      refused(F_ATTACH),
      refused(F_PUBLIC),
    ]);
  });
});
