// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10246 — a tombstoned `sys_file` that something still holds is downloadable.
 *
 * ## The defect
 *
 * A `sys_file` tombstone (`status: 'deleted'` + `deleted_at`) is recoverable
 * state: re-pointing a `sys_attachment` join row onto it, or re-claiming it
 * through the `ref_*` ownership columns, brings it back, and the reap guard
 * honours that at sweep time — `findFileHolder` says "still held", so the guard
 * un-tombstones the row and vetoes the reap instead of deleting the bytes.
 *
 * But the sweep is the ONLY thing that ever asked, and `sys_file`'s declared
 * lifecycle (`ttl { field: 'deleted_at', expireAfter: '30d' }`) nominates a
 * tombstone only AFTER the window expires. Inside the window the file was not
 * a candidate at all, so nothing asked — while the download routes refused
 * anything not `committed`. Net: a live attachment could point at a file that
 * 404s for up to 30 days and then silently starts working.
 *
 * ## What is pinned here — the PAIR, not the widening
 *
 * Proving "tombstoned + live join row ⇒ 200" alone proves only that something
 * got wider. The boundary is the pair, and both halves are asked of ONE shared
 * fixture so they cannot drift apart:
 *
 *   - tombstoned + a live holder ⇒ **200**, and the sweep would **veto**;
 *   - the last holder removed    ⇒ **404**, and the sweep **reaps** (bytes and
 *     row), exactly as before this change.
 *
 * `pending` is pinned unchanged on purpose: only the `deleted` limb widened.
 *
 * ## Why the read side calls the guard's predicate rather than counting rows
 *
 * `findFileHolder` is a deliberate UNION — `sys_attachment` join rows OR the
 * `ref_*` ownership columns — because both surfaces can hold one `sys_file`.
 * It is also what decides whether the next sweep reaps the row. A read side
 * that re-derived a narrower question (join rows only) would refuse files the
 * sweep refuses to reap: the same defect, one limb over. Both limbs are pinned
 * below against the guard's verdict on the same row.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
// The fake engine below is a WRITE-CAPABLE double, so its `update` opens with
// the real dispatch predicate rather than a hand-written approximation
// (`check:engine-double-contract`, #4550/#5480). It declares no `delete`: this
// suite never deletes a row, and a verb a double does not need is a contract
// it cannot get wrong.
import { assertEngineUpdateDispatch } from '@objectstack/objectql';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { StorageMetadataStore } from './metadata-store.js';
import { registerStorageRoutes } from './storage-routes.js';
import { createSysFileReapGuard, findFileHolder } from './attachment-lifecycle.js';

const DOWNLOAD_ROUTES = ['/api/v1/storage/files/:fileId/url', '/api/v1/storage/files/:fileId'] as const;

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });

function createMockHttpServer() {
  const routes = new Map<string, RouteHandler>();
  return {
    get: vi.fn((path: string, handler: RouteHandler) => { routes.set(`GET:${path}`, handler); }),
    post: vi.fn((path: string, handler: RouteHandler) => { routes.set(`POST:${path}`, handler); }),
    put: vi.fn((path: string, handler: RouteHandler) => { routes.set(`PUT:${path}`, handler); }),
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

function createMockRes(): IHttpResponse & { _status: number; _json: any; _headers: Record<string, string> } {
  const res: any = {
    _status: 200,
    _json: null,
    _headers: {},
    json(data: any) { res._json = data; },
    send(data: any) { res._sent = data; },
    status(code: number) { res._status = code; return res; },
    header(name: string, value: string) { res._headers[name] = value; return res; },
  };
  return res;
}

/**
 * One in-memory `sys_file` + `sys_attachment` pair, wired to BOTH the metadata
 * store the routes read through and the engine seam `findFileHolder` /
 * `createSysFileReapGuard` read through. Sharing the tables is the point: the
 * download verdict and the sweep verdict must come from the same rows, or the
 * pair proves nothing.
 */
function fakeEngine(seed: {
  files?: Array<Record<string, unknown>>;
  attachments?: Array<Record<string, unknown>>;
}) {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    sys_file: (seed.files ?? []).map((r) => ({ ...r })),
    sys_attachment: (seed.attachments ?? []).map((r) => ({ ...r })),
  };
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return String(row[k]) === String(v);
    });
  const engine = {
    tables,
    async find(object: string, options: any) {
      const rows = (tables[object] ?? []).filter((r) => matches(r, options?.where ?? {}));
      return typeof options?.limit === 'number' ? rows.slice(0, options.limit) : rows;
    },
    async findOne(object: string, options: any) {
      return (tables[object] ?? []).find((r) => matches(r, options?.where ?? {})) ?? null;
    },
    async insert(object: string, data: any) {
      (tables[object] ??= []).push({ ...data });
      return data;
    },
    async update(object: string, data: any, options?: any) {
      assertEngineUpdateDispatch(data, options);
      const row = (tables[object] ?? []).find((r) => String(r.id) === String(data.id));
      if (row) Object.assign(row, data);
      return row;
    },
    registerHook() { /* unused here */ },
  };
  return engine;
}

describe('#10246 — tombstoned sys_file with a live holder is downloadable', () => {
  let rootDir: string;
  let adapter: LocalStorageAdapter;

  beforeEach(async () => {
    rootDir = join(tmpdir(), `os-10246-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(rootDir, { recursive: true });
    adapter = new LocalStorageAdapter({ rootDir, signingSecret: 'test-secret' });
  });

  afterEach(async () => {
    if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
  });

  /**
   * A tombstoned attachments-scope file, its bytes on disk, plus whatever
   * holders the case asks for. `wireHolder: false` models a bare kernel (no
   * data engine) — the routes then get no `resolveFileHolder` at all.
   */
  const scenario = async (opts: {
    file?: Record<string, unknown>;
    attachments?: Array<Record<string, unknown>>;
    wireHolder?: boolean;
    authorizeFileRead?: any;
    resolveFileHolder?: any;
  }) => {
    const file = {
      id: 'f-10246',
      key: 'attachments/f-10246.bin',
      name: 'contract.bin',
      scope: 'attachments',
      acl: 'private',
      status: 'deleted',
      deleted_at: new Date().toISOString(),
      ...opts.file,
    };
    const engine = fakeEngine({ files: [file], attachments: opts.attachments ?? [] });
    await adapter.upload(String(file.key), Buffer.from('the bytes'));

    const store = new StorageMetadataStore(engine as any);
    const server = createMockHttpServer();
    registerStorageRoutes(server as any, adapter, store, {
      basePath: '/api/v1/storage',
      authorizeFileRead: opts.authorizeFileRead,
      resolveFileHolder:
        opts.resolveFileHolder ??
        (opts.wireHolder === false
          ? undefined
          : (f: any) => findFileHolder(engine as any, f.id, f)),
    });

    const get = async (path: string, fileId = String(file.id)) => {
      const res = createMockRes();
      const req: IHttpRequest = { params: { fileId }, query: {}, body: undefined, headers: {}, method: 'GET', path } as any;
      await server._getHandler('GET', path)!(req, res);
      return res;
    };

    const sweep = async () => {
      const guard = createSysFileReapGuard(engine as any, () => adapter, silentLogger());
      const row = engine.tables.sys_file.find((r) => String(r.id) === String(file.id))!;
      return guard('sys_file', [{ ...row }]);
    };

    return { engine, store, get, sweep, fileId: String(file.id), key: String(file.key) };
  };

  // ── The pair. Both halves, one fixture shape, both download endpoints. ──

  it('serves a tombstoned file that still has a live join row — on BOTH download endpoints', async () => {
    const { get } = await scenario({
      attachments: [{ id: 'att-1', file_id: 'f-10246', parent_object: 'project', parent_id: 'p1' }],
    });

    const url = await get(DOWNLOAD_ROUTES[0]);
    expect(url._status).toBe(200);
    expect(url._json.data.url).toContain('/_local/raw/');

    const redirect = await get(DOWNLOAD_ROUTES[1]);
    expect(redirect._status).toBe(302);
    expect(redirect._headers.Location ?? redirect._headers.location).toContain('/_local/raw/');
  });

  it('and the sweep AGREES: the same row is vetoed and un-tombstoned, never reaped', async () => {
    const { engine, sweep, key } = await scenario({
      attachments: [{ id: 'att-1', file_id: 'f-10246', parent_object: 'project', parent_id: 'p1' }],
    });

    expect(await sweep()).toEqual([]); // vetoed — nothing confirmed for deletion
    expect(await adapter.exists(key)).toBe(true);
    // Revival stays the sweep guard's alone — this is the ONLY writer.
    const row = engine.tables.sys_file[0];
    expect(row.status).toBe('committed');
    expect(row.deleted_at).toBeNull();
  });

  it('404s again the moment the LAST holder goes — and the sweep then really reaps', async () => {
    const { get, sweep, engine, key, fileId } = await scenario({ attachments: [] });

    for (const path of DOWNLOAD_ROUTES) {
      const res = await get(path);
      expect(res._status, path).toBe(404);
      expect(res._json?.error?.code, path).toBe('FILE_NOT_FOUND');
    }

    expect(await sweep()).toEqual([fileId]); // confirmed for deletion
    expect(await adapter.exists(key)).toBe(false); // bytes reclaimed first
    expect(engine.tables.sys_file[0].status).toBe('deleted'); // never revived
  });

  // ── The union's other limb: a re-claimed field-owned tombstone. ─────────

  it('serves a tombstone held through the ref_* ownership columns, matching the guard', async () => {
    const { get, sweep } = await scenario({
      file: { scope: 'avatars', ref_object: 'sys_user', ref_id: 'u1', ref_field: 'image' },
      attachments: [],
    });

    expect((await get(DOWNLOAD_ROUTES[0]))._status).toBe(200);
    expect(await sweep()).toEqual([]); // the guard vetoes this row too
  });

  it('refuses a released field file — ref_* cleared is exactly what the guard reaps on', async () => {
    const { get } = await scenario({
      file: { scope: 'avatars', ref_object: null, ref_id: null, ref_field: null },
      attachments: [],
    });

    expect((await get(DOWNLOAD_ROUTES[0]))._status).toBe(404);
  });

  // ── Boundaries that must NOT have moved. ───────────────────────────────

  it('leaves `pending` refused — only the tombstone limb widened', async () => {
    const { get } = await scenario({
      file: { status: 'pending', deleted_at: null },
      attachments: [{ id: 'att-1', file_id: 'f-10246' }],
    });

    for (const path of DOWNLOAD_ROUTES) {
      const res = await get(path);
      expect(res._status, path).toBe(404);
      expect(res._json?.error?.code, path).toBe('FILE_NOT_FOUND');
    }
  });

  it('refuses a tombstone on a bare kernel — no engine wired, no holder question to ask', async () => {
    const { get } = await scenario({
      wireHolder: false,
      attachments: [{ id: 'att-1', file_id: 'f-10246' }],
    });

    expect((await get(DOWNLOAD_ROUTES[0]))._status).toBe(404);
  });

  it('refuses rather than falls open when the holder question itself throws', async () => {
    const { get } = await scenario({
      resolveFileHolder: vi.fn(async () => { throw new Error('engine down'); }),
      attachments: [{ id: 'att-1', file_id: 'f-10246' }],
    });

    const res = await get(DOWNLOAD_ROUTES[0]);
    expect(res._status).toBe(404);
    expect(res._json?.error?.code).toBe('FILE_NOT_FOUND');
  });

  it('still applies the download authorization gate to a served tombstone', async () => {
    // Servability is not authorization: widening the first must not open the
    // second. A caller who cannot read the parent record gets the same 403 a
    // committed file would have given.
    const denied = await scenario({
      authorizeFileRead: vi.fn(async () => 'deny'),
      attachments: [{ id: 'att-1', file_id: 'f-10246', parent_object: 'project', parent_id: 'p1' }],
    });
    const res = await denied.get(DOWNLOAD_ROUTES[0]);
    expect(res._status).toBe(403);
    expect(res._json?.error?.code).toBe('ATTACHMENT_DOWNLOAD_DENIED');

    const anon = await scenario({
      authorizeFileRead: vi.fn(async () => 'unauthenticated'),
      attachments: [{ id: 'att-2', file_id: 'f-10246', parent_object: 'project', parent_id: 'p1' }],
    });
    expect((await anon.get(DOWNLOAD_ROUTES[1]))._status).toBe(401);
  });
});
