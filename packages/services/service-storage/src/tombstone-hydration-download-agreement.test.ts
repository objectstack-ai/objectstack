// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11427 — record file-field hydration and the download path must answer the
 * SAME question about one `sys_file` row.
 *
 * ## The defect
 *
 * #10246 stopped the two download endpoints treating a `sys_file` tombstone as
 * the last word: they ask the reap guard's own `findFileHolder` and serve a
 * `status='deleted'` row for as long as something still holds it.
 *
 * The record read was not part of that ruling. `resolveFileReferences`
 * (`packages/objectql/src/engine.ts`) — the pass that turns a stored `sys_file`
 * id into `{ id, name, size, mimeType, url }` — kept the older, narrower rule,
 * `row.status === 'committed'`. A file failing it keeps its bare id, which UI
 * and export render as "this record has no attachment".
 *
 * So for ONE row, post-#10246: `GET /api/v1/storage/files/:id` answers 200
 * while a record read hydrating that same id answers a bare id. Two read
 * surfaces, two answers about one row.
 *
 * ## The population this pins — bounded, not a re-litigation of #10246
 *
 * Most field files never reach this state: `claimFile`
 * (`file-reference-lifecycle.ts`) un-tombstones synchronously at re-point time,
 * patching `status: 'committed'`, `deleted_at: null` — "a file re-referenced
 * within its grace window comes back to life". Attachments-scope files are not
 * involved either; that surface is `sys_attachment` join rows, not record file
 * fields, so hydration never asks about them.
 *
 * What is left is exactly the residual the reap guard's sweep-time
 * re-verification exists for and names: hook races, direct-driver writes, and
 * future trash restore. Every fixture below is a row in that state.
 *
 * ## What is pinned — the PAIR and its counter-direction, never one side
 *
 * Asserting only "the held tombstone now hydrates" would score green for an
 * implementation that hydrates everything, which would be a far worse defect
 * than the one being fixed. So each case asks BOTH surfaces of ONE shared
 * fixture, and the two directions are pinned together:
 *
 *   - tombstoned + a live holder ⇒ download serves it AND hydration enriches it;
 *   - tombstoned + nothing holding it ⇒ download 404s AND hydration keeps the
 *     bare id, exactly as before this change;
 *   - `pending` ⇒ unchanged on both surfaces (only the `deleted` limb moved).
 *
 * Both limbs of the holder union get their own case, because `findFileHolder`
 * is a deliberate union — `sys_attachment` join rows OR the `ref_*` ownership
 * columns — and a hydration side that re-derived a narrower question would
 * hide files the sweep refuses to reap: the same defect, one limb over.
 *
 * ## Why ONE engine and a real driver
 *
 * The download verdict and the hydration verdict must come from the SAME rows
 * or the pair proves nothing, so both surfaces are driven off one real
 * `ObjectQL` engine over `@objectstack/driver-memory` — a real driver that
 * really filters, including the `$in` the batched holder check issues. No
 * engine double is involved, so no write-verb dispatch contract applies.
 *
 * The seam is reached by DUCK TYPING, exactly as `StorageServicePlugin` wires
 * it. That is deliberate: it lets this file state the divergence as a
 * behavioural red on a tree where the seam does not exist yet, instead of
 * failing at import and measuring nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { ObjectQL } from '@objectstack/objectql';
import { InMemoryDriver } from '@objectstack/driver-memory';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { StorageMetadataStore } from './metadata-store.js';
import { registerStorageRoutes } from './storage-routes.js';
// Namespace import on purpose — a missing named export reads as `undefined`
// here rather than exploding at module load, which is what keeps the pre-fix
// run a MEASUREMENT of the divergence instead of an import crash.
import * as lifecycle from './attachment-lifecycle.js';

const URL_ROUTE = '/api/v1/storage/files/:fileId/url';
const RAW_ROUTE = '/api/v1/storage/files/:fileId';

/** Tombstoned, held through the `ref_*` ownership columns (field-owner limb). */
const HELD_BY_COLUMNS = 'f_heldByColumns_7kQ2';
/** Tombstoned, held through a live `sys_attachment` join row (attachment limb). */
const HELD_BY_JOIN = 'f_heldByJoinRow_4mZ8';
/** Tombstoned and genuinely unheld — the counter-direction control. */
const UNHELD = 'f_unheld_9tRw3';
/** Never completed. Only the `deleted` limb moved; this pins that. */
const PENDING = 'f_pending_2bXy';

const silentLogger = () => ({
  info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(),
  trace: vi.fn(), fatal: vi.fn(), child() { return this; },
});

function createMockHttpServer() {
  const routes = new Map<string, RouteHandler>();
  const put = (m: string) => vi.fn((path: string, handler: RouteHandler) => { routes.set(`${m}:${path}`, handler); });
  return {
    get: put('GET'), post: put('POST'), put: put('PUT'),
    delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    _getHandler(method: string, path: string) { return routes.get(`${method}:${path}`); },
  };
}

function createMockRes(): IHttpResponse & { _status: number; _json: any; _headers: Record<string, string> } {
  const res: any = {
    _status: 200, _json: null, _headers: {},
    json(data: any) { res._json = data; },
    send(data: any) { res._sent = data; },
    status(code: number) { res._status = code; return res; },
    header(name: string, value: string) { res._headers[name] = value; return res; },
  };
  return res;
}

const tombstone = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  key: `files/${id}.bin`,
  name: 'signed.pdf',
  size: 2048,
  mime_type: 'application/pdf',
  scope: 'field',
  acl: 'private',
  status: 'deleted',
  deleted_at: new Date().toISOString(),
  ...extra,
});

/** The enriched form `resolveFileReferences` owes a held file. */
const hydrated = (id: string) => ({
  id,
  name: 'signed.pdf',
  size: 2048,
  mimeType: 'application/pdf',
  url: `/api/v1/storage/files/${id}`,
});

describe('#11427 — file-field hydration and the download path agree about one sys_file row', () => {
  let rootDir: string;
  let adapter: LocalStorageAdapter;
  let engine: ObjectQL;
  let server: ReturnType<typeof createMockHttpServer>;

  beforeEach(async () => {
    rootDir = join(tmpdir(), `os-11427-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(rootDir, { recursive: true });
    adapter = new LocalStorageAdapter({ rootDir, signingSecret: 'test-secret' });

    engine = new ObjectQL({ logger: silentLogger() } as any);
    engine.registerDriver(new InMemoryDriver() as any, true);
    await engine.init();

    engine.registry.registerObject({
      name: 'sys_file',
      fields: {
        name: { type: 'text' }, size: { type: 'number' }, mime_type: { type: 'text' },
        key: { type: 'text' }, scope: { type: 'text' }, acl: { type: 'text' },
        status: { type: 'text' }, deleted_at: { type: 'datetime' },
        ref_object: { type: 'text' }, ref_id: { type: 'text' }, ref_field: { type: 'text' },
      },
    } as any);
    engine.registry.registerObject({
      name: 'sys_attachment',
      fields: {
        file_id: { type: 'text' }, parent_object: { type: 'text' }, parent_id: { type: 'text' },
      },
    } as any);
    engine.registry.registerObject({
      name: 'contract',
      fields: { title: { type: 'text' }, signed_pdf: { type: 'file' } },
    } as any);

    // ── The shared fixture: four sys_file rows in the residual state ──────
    const files = [
      tombstone(HELD_BY_COLUMNS, { ref_object: 'contract', ref_id: 'c1', ref_field: 'signed_pdf' }),
      tombstone(HELD_BY_JOIN),
      tombstone(UNHELD),
      tombstone(PENDING, { status: 'pending', deleted_at: null }),
    ];
    for (const f of files) {
      await engine.insert('sys_file', f as any);
      await adapter.upload(String(f.key), Buffer.from(`bytes of ${f.id}`));
    }
    // Only HELD_BY_JOIN carries a join row.
    await engine.insert('sys_attachment', {
      id: 'att-1', file_id: HELD_BY_JOIN, parent_object: 'project', parent_id: 'p1',
    } as any);

    // One record per file, so hydration is asked about every case in ONE read.
    await engine.insert('contract', { id: 'c1', title: 'MSA', signed_pdf: HELD_BY_COLUMNS } as any);
    await engine.insert('contract', { id: 'c2', title: 'NDA', signed_pdf: HELD_BY_JOIN } as any);
    await engine.insert('contract', { id: 'c3', title: 'SOW', signed_pdf: UNHELD } as any);
    await engine.insert('contract', { id: 'c4', title: 'DPA', signed_pdf: PENDING } as any);

    // ── The two read surfaces, both over the rows just seeded ─────────────
    server = createMockHttpServer();
    registerStorageRoutes(server as any, adapter, new StorageMetadataStore(engine as any), {
      basePath: '/api/v1/storage',
      resolveFileHolder: (f: any) => (lifecycle as any).findFileHolder(engine as any, f.id, f),
    });

    // The hydration seam, wired exactly as StorageServicePlugin wires it.
    (engine as any).registerHeldFileResolver?.(
      (rows: any[]) => (lifecycle as any).findHeldFiles(engine as any, rows),
    );
  });

  afterEach(async () => {
    if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
  });

  /** What the download path says about one file id. */
  const download = async (fileId: string) => {
    const url = createMockRes();
    await server._getHandler('GET', URL_ROUTE)!(
      { params: { fileId }, query: {}, headers: {}, method: 'GET', path: URL_ROUTE } as any, url);
    const raw = createMockRes();
    await server._getHandler('GET', RAW_ROUTE)!(
      { params: { fileId }, query: {}, headers: {}, method: 'GET', path: RAW_ROUTE } as any, raw);
    return { url, raw };
  };

  /** What the record read says about the same file id — by record IDENTITY. */
  const hydrationOf = async (recordId: string) => {
    const rows = await engine.find('contract', { where: { id: recordId } });
    return rows[0]?.signed_pdf;
  };

  it('the seam and its ONE batched implementation both exist', () => {
    // Hydration cannot ask the holder question without a seam to ask through,
    // and the answer must come from the storage package's single definition —
    // never a copy re-derived inside the engine.
    expect(typeof (engine as any).registerHeldFileResolver).toBe('function');
    expect(typeof (lifecycle as any).findHeldFiles).toBe('function');
  });

  // ── The pair: a held tombstone, both limbs of the holder union ──────────

  it('held through the ref_* columns — download and hydration AGREE it is there', async () => {
    const { url, raw } = await download(HELD_BY_COLUMNS);

    // The download path, post-#10246.
    expect(url._status).toBe(200);
    expect(url._json.data.url).toContain('/_local/raw/');
    expect(raw._status).toBe(302);

    // …and the record read must say the same thing about the same row.
    expect(await hydrationOf('c1')).toEqual(hydrated(HELD_BY_COLUMNS));
  });

  it('held through a sys_attachment join row — download and hydration AGREE it is there', async () => {
    const { url, raw } = await download(HELD_BY_JOIN);

    expect(url._status).toBe(200);
    expect(raw._status).toBe(302);

    // The union's other limb. A hydration side that only read `ref_*` would
    // hide this row while the download path serves it — the same divergence,
    // one limb over.
    expect(await hydrationOf('c2')).toEqual(hydrated(HELD_BY_JOIN));
  });

  // ── The counter-direction: nothing holds it, so BOTH surfaces hide it ───

  it('a genuinely unheld tombstone stays absent on BOTH surfaces', async () => {
    const { url, raw } = await download(UNHELD);

    expect(url._status).toBe(404);
    expect(url._json?.error?.code).toBe('FILE_NOT_FOUND');
    expect(raw._status).toBe(404);
    expect(raw._json?.error?.code).toBe('FILE_NOT_FOUND');

    // The control that a widening cannot fake: still the BARE ID, by identity.
    expect(await hydrationOf('c3')).toBe(UNHELD);
  });

  it('a pending upload stays absent on BOTH surfaces — only the deleted limb moved', async () => {
    const { url, raw } = await download(PENDING);

    expect(url._status).toBe(404);
    expect(raw._status).toBe(404);
    expect(await hydrationOf('c4')).toBe(PENDING);
  });

  // ── One read, every case at once: the agreement is per-row, not per-read ─

  it('one read carrying all four files enriches exactly the held two, by identity', async () => {
    const rows = await engine.find('contract');
    const byId = new Map(rows.map((r: any) => [r.id, r.signed_pdf]));

    expect(byId.get('c1')).toEqual(hydrated(HELD_BY_COLUMNS));
    expect(byId.get('c2')).toEqual(hydrated(HELD_BY_JOIN));
    expect(byId.get('c3')).toBe(UNHELD);
    expect(byId.get('c4')).toBe(PENDING);
  });
});

/**
 * The batched question and the single-file question must be the SAME question.
 *
 * `findHeldFiles` exists only because asking `findFileHolder` per row would be
 * N queries per read. The moment the two disagree, the divergence #11427 fixes
 * reopens one layer down — hydration and the download path would once again be
 * reading one row through two predicates. So the equivalence is pinned over a
 * matrix that exercises both limbs and both of their absences, rather than
 * asserted in a comment.
 */
describe('#11427 — findHeldFiles is findFileHolder, batched', () => {
  /** A fake that honours the `$in` the batch form issues, and equality for the single form. */
  const engineOver = (joinRows: Array<Record<string, unknown>>) => ({
    async find(_object: string, options: any) {
      const cond = options?.where?.file_id;
      const wanted = cond && typeof cond === 'object' && '$in' in cond
        ? (cond.$in as string[]).map(String)
        : [String(cond)];
      const hit = joinRows.filter((r) => wanted.includes(String(r.file_id)));
      return typeof options?.limit === 'number' ? hit.slice(0, options.limit) : hit;
    },
  }) as any;

  const MATRIX: Array<{ label: string; row: Record<string, unknown>; joined: boolean }> = [
    { label: 'both limbs', row: { id: 'f1', ref_object: 'p', ref_id: 'r' }, joined: true },
    { label: 'columns only', row: { id: 'f2', ref_object: 'p', ref_id: 'r' }, joined: false },
    { label: 'join row only', row: { id: 'f3' }, joined: true },
    { label: 'neither', row: { id: 'f4' }, joined: false },
    { label: 'an EMPTY ref_id is not an owner', row: { id: 'f5', ref_object: 'p', ref_id: '' }, joined: false },
  ];

  it('agrees with findFileHolder on every combination, asked in ONE batch', async () => {
    const joinRows = MATRIX.filter((c) => c.joined).map((c) => ({ id: `att-${c.row.id}`, file_id: c.row.id }));
    const engine = engineOver(joinRows);

    const held = await (lifecycle as any).findHeldFiles(engine, MATRIX.map((c) => c.row));

    for (const { label, row } of MATRIX) {
      const single = await (lifecycle as any).findFileHolder(engine, row.id, row);
      expect(held.has(String(row.id)), label).toBe(single !== null);
    }
    // …and by identity, so a resolver that returned everything cannot pass.
    expect([...held].sort()).toEqual(['f1', 'f2', 'f3']);
  });

  it('asks NOTHING when every row is settled by the ownership columns', async () => {
    const find = vi.fn(async () => []);
    const held = await (lifecycle as any).findHeldFiles({ find } as any, [
      { id: 'f1', ref_object: 'p', ref_id: 'r1' },
      { id: 'f2', ref_object: 'p', ref_id: 'r2' },
    ]);

    // The free limb settles both, so the join-row read is never issued: an
    // ordinary read pays nothing for this feature.
    expect(find).not.toHaveBeenCalled();
    expect([...held].sort()).toEqual(['f1', 'f2']);
  });

  it('asks ONCE for a whole batch, however many files are unsettled', async () => {
    const find = vi.fn(async () => [{ id: 'att-1', file_id: 'f2' }]);
    const held = await (lifecycle as any).findHeldFiles({ find } as any, [
      { id: 'f1' }, { id: 'f2' }, { id: 'f3' }, { id: 'f4' },
    ]);

    // ONE query, not one per file — the whole point of the batched form.
    expect(find).toHaveBeenCalledTimes(1);
    expect(find.mock.calls[0][1].where.file_id.$in).toEqual(['f1', 'f2', 'f3', 'f4']);
    expect([...held]).toEqual(['f2']);
  });
});
