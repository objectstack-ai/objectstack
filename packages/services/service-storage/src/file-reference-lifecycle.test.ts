// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import {
  installFileReferenceHooks,
  FileReferenceCopyError,
  FileConstraintError,
  type FileReferenceEngine,
} from './file-reference-lifecycle.js';

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });

/** Object schemas the fake registry serves. `sys_file` must be present or the
 * whole module is inert by design. */
const REGISTRY: Record<string, any> = {
  sys_file: { name: 'sys_file', fields: { id: { type: 'text' }, key: { type: 'text' } } },
  product: {
    name: 'product',
    fields: {
      id: { type: 'text' },
      name: { type: 'text' },
      image: { type: 'image' },
      gallery: { type: 'image', multiple: true },
    },
  },
  // No file-class field — every hook must exit before doing any I/O.
  tag: { name: 'tag', fields: { id: { type: 'text' }, label: { type: 'text' } } },
};

function fakeEngine(opts: {
  files?: Array<Record<string, unknown>>;
  records?: Record<string, Array<Record<string, unknown>>>;
  registry?: Record<string, any>;
} = {}) {
  const registry = opts.registry ?? REGISTRY;
  const tables: Record<string, Array<Record<string, unknown>>> = {
    sys_file: [...(opts.files ?? [])],
    ...Object.fromEntries(Object.entries(opts.records ?? {}).map(([k, v]) => [k, [...v]])),
  };
  const hooks = new Map<string, Array<(ctx: any) => Promise<void> | void>>();
  const calls: Array<{ op: string; object: string; arg: unknown }> = [];

  const matchValue = (actual: unknown, expected: unknown): boolean => {
    if (expected && typeof expected === 'object' && Array.isArray((expected as any).$in)) {
      return (expected as any).$in.some((v: unknown) => String(v) === String(actual));
    }
    return actual === expected;
  };
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => matchValue(row[k], v));

  const engine: FileReferenceEngine & {
    tables: typeof tables;
    calls: typeof calls;
    trigger(event: string, ctx: any): Promise<void>;
  } = {
    registerHook(event, handler, opts2) {
      // Global registration — any object may declare a file-class field.
      expect(opts2?.object).toBeUndefined();
      const list = hooks.get(event) ?? [];
      list.push(handler);
      hooks.set(event, list);
    },
    getObject(name) {
      return registry[name];
    },
    async find(object, options: any) {
      calls.push({ op: 'find', object, arg: options?.where });
      const rows = (tables[object] ?? []).filter((r) => matches(r, options?.where ?? {}));
      return typeof options?.limit === 'number' ? rows.slice(0, options.limit) : rows;
    },
    async findOne(object, options: any) {
      calls.push({ op: 'findOne', object, arg: options?.where });
      return (tables[object] ?? []).find((r) => matches(r, options?.where ?? {})) ?? null;
    },
    async insert(object, data: any) {
      calls.push({ op: 'insert', object, arg: data });
      (tables[object] ??= []).push({ ...data });
      return data;
    },
    async update(object, data: any) {
      calls.push({ op: 'update', object, arg: data });
      const row = (tables[object] ?? []).find((r) => String(r.id) === String(data.id));
      if (row) Object.assign(row, data);
      return row;
    },
    tables,
    calls,
    async trigger(event, ctx) {
      for (const h of hooks.get(event) ?? []) await h(ctx);
    },
  };
  return engine;
}

function fakeStorage() {
  return {
    download: vi.fn(async () => Buffer.from('the-bytes')),
    upload: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    exists: vi.fn(async () => true),
    getInfo: vi.fn(async () => ({ key: 'k', size: 9, contentType: 'image/png', lastModified: new Date() })),
  } as any;
}

type Engine = ReturnType<typeof fakeEngine>;

/** Drive an engine-shaped insert: beforeInsert → driver write → afterInsert,
 * with the same ctx object throughout and `input.data` as the persisted row
 * (exactly what engine.ts hands the driver). */
/**
 * [#6966] The engine's dispatch marker as a single-record write carries it.
 * A hand-built context without one already reads as "not a per-row dispatch",
 * so stating it here changes no verdict — it makes the per-row driver's marker
 * a visible difference rather than a hidden one.
 */
function recordDispatch(scope: Record<string, unknown> = {}) {
  return { mode: 'record' as const, index: 0, scope };
}

async function driveInsert(engine: Engine, object: string, data: Record<string, unknown>, id: string) {
  const ctx: any = { object, event: 'beforeInsert', input: { data }, dispatch: recordDispatch() };
  await engine.trigger('beforeInsert', ctx);
  const row = { ...(ctx.input.data as Record<string, unknown>), id };
  (engine.tables[object] ??= []).push(row);
  ctx.event = 'afterInsert';
  ctx.result = row;
  await engine.trigger('afterInsert', ctx);
  return row;
}

async function driveUpdate(engine: Engine, object: string, id: string, data: Record<string, unknown>) {
  const ctx: any = { object, event: 'beforeUpdate', input: { id, data }, dispatch: recordDispatch() };
  await engine.trigger('beforeUpdate', ctx);
  const row = (engine.tables[object] ?? []).find((r) => String(r.id) === String(id));
  if (row) Object.assign(row, ctx.input.data);
  ctx.event = 'afterUpdate';
  ctx.result = row;
  await engine.trigger('afterUpdate', ctx);
  return row;
}

/**
 * Drive an engine-shaped delete.
 *
 * [#6966] A `where`-shaped delete is driven the way the engine has actually
 * driven it since #5038/#5574 — the doomed rows are matched FIRST, then
 * `beforeDelete` and `afterDelete` each fire once per matched row on a
 * single-record-shaped context carrying that row's `input.id` and the
 * `dispatch` marker, with one `scope` object shared by all of them.
 *
 * This driver used to model the pre-#5574 batch dispatch instead: ONE context
 * with no `id`, carrying only `options.where`. The engine stopped producing
 * that shape two releases ago, so the release-on-multi-delete case below was
 * passing against a dispatch that no longer exists.
 */
async function driveDelete(engine: Engine, object: string, input: any) {
  const where = input?.options?.where;
  const byId = input?.id != null;
  const doomed = byId
    ? (() => {
        const ids = typeof input.id === 'object' ? input.id.$in : [input.id];
        return (engine.tables[object] ?? []).filter((r) => ids.some((i: unknown) => String(i) === String(r.id)));
      })()
    : where
      ? (engine.tables[object] ?? []).filter((r) => Object.entries(where).every(([k, v]) => r[k] === v))
      : [];

  const drop = () => {
    const gone = new Set(doomed.map((r) => String(r.id)));
    engine.tables[object] = (engine.tables[object] ?? []).filter((r) => !gone.has(String(r.id)));
  };

  if (byId) {
    // Single-id path: ONE context, reused across the pair, `mode: 'record'`.
    const ctx: any = { object, event: 'beforeDelete', input, dispatch: recordDispatch() };
    await engine.trigger('beforeDelete', ctx);
    drop();
    ctx.event = 'afterDelete';
    await engine.trigger('afterDelete', ctx);
    return;
  }

  // Predicate path: per-row fan-out, one shared scope, fresh context per row.
  const scope: Record<string, unknown> = {};
  const rowCtx = (event: string, row: any, index: number) => ({
    object,
    event,
    input: { id: row.id, options: input?.options },
    previous: row,
    dispatch: { mode: 'per-row' as const, index, scope },
  });
  for (let i = 0; i < doomed.length; i++) await engine.trigger('beforeDelete', rowCtx('beforeDelete', doomed[i], i));
  drop();
  for (let i = 0; i < doomed.length; i++) await engine.trigger('afterDelete', rowCtx('afterDelete', doomed[i], i));
}

function install(engine: Engine, storage: any = fakeStorage()) {
  const logger = silentLogger();
  installFileReferenceHooks(engine, () => storage, logger);
  return { logger, storage };
}

const file = (over: Record<string, unknown> = {}) => ({
  id: 'file_a',
  key: 'user/file_a.png',
  name: 'a.png',
  mime_type: 'image/png',
  size: 10,
  scope: 'user',
  status: 'committed',
  ...over,
});

describe('File Reference Ownership (ADR-0104 D3 wave 2)', () => {
  // ── Claim ────────────────────────────────────────────────────────
  describe('claim', () => {
    it('claims a file id written into a field on insert', async () => {
      const engine = fakeEngine({ files: [file()] });
      install(engine);

      await driveInsert(engine, 'product', { name: 'Widget', image: 'file_a' }, 'p1');

      expect(engine.tables.sys_file[0]).toMatchObject({
        id: 'file_a',
        ref_object: 'product',
        ref_id: 'p1',
        ref_field: 'image',
      });
    });

    it('claims every id of a multiple:true field', async () => {
      const engine = fakeEngine({ files: [file(), file({ id: 'file_b', key: 'user/file_b.png' })] });
      install(engine);

      await driveInsert(engine, 'product', { gallery: ['file_a', 'file_b'] }, 'p1');

      expect(engine.tables.sys_file.map((f) => [f.id, f.ref_field])).toEqual([
        ['file_a', 'gallery'],
        ['file_b', 'gallery'],
      ]);
    });

    it('brings a tombstoned file back to life when it is referenced again', async () => {
      const engine = fakeEngine({
        files: [file({ status: 'deleted', deleted_at: '2026-01-01T00:00:00.000Z' })],
      });
      install(engine);

      await driveInsert(engine, 'product', { image: 'file_a' }, 'p1');

      expect(engine.tables.sys_file[0]).toMatchObject({
        status: 'committed',
        deleted_at: null,
        ref_id: 'p1',
      });
    });
  });

  // ── Dormancy: the pre-v17 world must cost nothing ────────────────
  describe('dormancy (dual-mode)', () => {
    it('ignores a legacy inline blob value — no sys_file access at all', async () => {
      const engine = fakeEngine({ files: [file()] });
      install(engine);

      await driveInsert(
        engine,
        'product',
        { image: { url: 'https://cdn.example.com/a.png', name: 'a.png' } },
        'p1',
      );

      expect(engine.calls.filter((c) => c.object === 'sys_file')).toHaveLength(0);
      expect(engine.tables.sys_file[0].ref_id).toBeUndefined();
    });

    it.each([
      ['https://cdn.example.com/a.png'],
      ['/api/v1/storage/files/file_a'],
      ['data:image/svg+xml,<svg/>'],
      ['blob:http://localhost/abc'],
    ])('never treats the URL-shaped value %s as a reference', async (value) => {
      const engine = fakeEngine({ files: [file()] });
      install(engine);

      await driveInsert(engine, 'product', { image: value }, 'p1');

      expect(engine.calls.filter((c) => c.object === 'sys_file')).toHaveLength(0);
    });

    it('does nothing for an object with no file-class fields', async () => {
      const engine = fakeEngine({ files: [file()] });
      install(engine);

      await driveInsert(engine, 'tag', { label: 'x' }, 't1');
      await driveDelete(engine, 'tag', { id: 't1' });

      expect(engine.calls.filter((c) => c.object === 'sys_file')).toHaveLength(0);
    });

    it('stays inert when sys_file is not registered (storage plugin absent)', async () => {
      const engine = fakeEngine({
        files: [file()],
        registry: { product: REGISTRY.product },
      });
      install(engine);

      await driveInsert(engine, 'product', { image: 'file_a' }, 'p1');

      expect(engine.calls.filter((c) => c.object === 'sys_file')).toHaveLength(0);
    });
  });

  // ── Release ──────────────────────────────────────────────────────
  describe('release', () => {
    it('releases ownership when the owning record is deleted', async () => {
      const engine = fakeEngine({
        files: [file({ ref_object: 'product', ref_id: 'p1', ref_field: 'image' })],
        records: { product: [{ id: 'p1', image: 'file_a' }] },
      });
      install(engine);

      await driveDelete(engine, 'product', { id: 'p1' });

      expect(engine.tables.sys_file[0]).toMatchObject({
        ref_object: null,
        ref_id: null,
        ref_field: null,
      });
    });

    it('releases every row of a where-shaped multi delete, in ONE release pass', async () => {
      const engine = fakeEngine({
        files: [
          file({ ref_object: 'product', ref_id: 'p1', ref_field: 'image' }),
          file({ id: 'file_b', ref_object: 'product', ref_id: 'p2', ref_field: 'image' }),
        ],
        records: {
          product: [
            { id: 'p1', image: 'file_a', archived: true },
            { id: 'p2', image: 'file_b', archived: true },
          ],
        },
      });
      install(engine);

      await driveDelete(engine, 'product', { options: { where: { archived: true } } });

      expect(engine.tables.sys_file.every((f) => f.ref_id === null)).toBe(true);

      // [#6966] Both rows released by ONE `sys_file` lookup over an `$in`, not
      // one lookup per row. The per-row `afterDelete` fan-out is what made the
      // naive spelling N queries; `dispatch.index === 0` plus the ids the
      // `before` phase collected onto the shared scope is what collapses it.
      const ownershipReads = engine.calls.filter((c) => c.op === 'find' && c.object === 'sys_file');
      expect(ownershipReads).toHaveLength(1);
      expect(ownershipReads[0].arg).toMatchObject({ ref_id: { $in: ['p1', 'p2'] } });

      // And nothing re-queried the deleted object to learn its ids: the engine
      // already handed them over row by row. (The pre-#6966 hook ran one
      // `engine.find(object, { where })` here.)
      expect(engine.calls.filter((c) => c.op === 'find' && c.object === 'product')).toHaveLength(0);
    });

    it('releases the old file and claims the new one when a field is swapped', async () => {
      const engine = fakeEngine({
        files: [
          file({ ref_object: 'product', ref_id: 'p1', ref_field: 'image' }),
          file({ id: 'file_b', key: 'user/file_b.png' }),
        ],
        records: { product: [{ id: 'p1', image: 'file_a' }] },
      });
      install(engine);

      await driveUpdate(engine, 'product', 'p1', { image: 'file_b' });

      expect(engine.tables.sys_file[0]).toMatchObject({ id: 'file_a', ref_id: null });
      expect(engine.tables.sys_file[1]).toMatchObject({ id: 'file_b', ref_id: 'p1', ref_field: 'image' });
    });

    it('releases when the field is cleared', async () => {
      const engine = fakeEngine({
        files: [file({ ref_object: 'product', ref_id: 'p1', ref_field: 'image' })],
        records: { product: [{ id: 'p1', image: 'file_a' }] },
      });
      install(engine);

      await driveUpdate(engine, 'product', 'p1', { image: null });

      expect(engine.tables.sys_file[0]).toMatchObject({ ref_id: null });
    });

    it('leaves the file alone when a PATCH does not touch the file field', async () => {
      const engine = fakeEngine({
        files: [file({ ref_object: 'product', ref_id: 'p1', ref_field: 'image' })],
        records: { product: [{ id: 'p1', image: 'file_a', name: 'old' }] },
      });
      install(engine);

      await driveUpdate(engine, 'product', 'p1', { name: 'new' });

      expect(engine.tables.sys_file[0]).toMatchObject({ ref_id: 'p1', ref_field: 'image' });
      expect(engine.calls.filter((c) => c.op === 'update' && c.object === 'sys_file')).toHaveLength(0);
    });

    it('is idempotent when an update rewrites the same value', async () => {
      const engine = fakeEngine({
        files: [file({ ref_object: 'product', ref_id: 'p1', ref_field: 'image' })],
        records: { product: [{ id: 'p1', image: 'file_a' }] },
      });
      const { storage } = install(engine);

      await driveUpdate(engine, 'product', 'p1', { image: 'file_a' });

      expect(engine.tables.sys_file[0]).toMatchObject({ ref_id: 'p1', ref_field: 'image' });
      expect(engine.calls.filter((c) => c.op === 'update' && c.object === 'sys_file')).toHaveLength(0);
      expect(storage.download).not.toHaveBeenCalled();
    });

    /**
     * R4 REGRESSION (updated by #3459 PR-5b). Release may tombstone ONLY on a
     * deployment whose file-as-reference migration is verified — and every way
     * of not knowing (no engine method, an unverified flag, a failing read)
     * must keep release tombstone-free, because `deleted_at` is what makes a
     * row a reap candidate. The matching half — the reap guard re-verifying
     * the ownership columns at sweep time — lives in attachment-lifecycle and
     * shipped in the same change; its own regression tests are there.
     */
    it('never tombstones on release when the engine cannot attest the migration (fail closed)', async () => {
      const engine = fakeEngine({
        files: [file({ ref_object: 'product', ref_id: 'p1', ref_field: 'image' })],
        records: { product: [{ id: 'p1', image: 'file_a' }] },
      });
      install(engine); // fake engine has no isFileReferencesMigrationVerified

      await driveDelete(engine, 'product', { id: 'p1' });

      const row = engine.tables.sys_file[0];
      expect(row.status).toBe('committed');
      expect(row.deleted_at).toBeUndefined();
      const writes = engine.calls.filter((c) => c.op === 'update' && c.object === 'sys_file');
      for (const w of writes) {
        expect(w.arg).not.toHaveProperty('status');
        expect(w.arg).not.toHaveProperty('deleted_at');
      }
    });

    it('never tombstones on release while the deployment is unverified', async () => {
      const engine = fakeEngine({
        files: [file({ ref_object: 'product', ref_id: 'p1', ref_field: 'image' })],
        records: { product: [{ id: 'p1', image: 'file_a' }] },
      });
      engine.isFileReferencesMigrationVerified = async () => false;
      install(engine);

      await driveDelete(engine, 'product', { id: 'p1' });

      expect(engine.tables.sys_file[0]).toMatchObject({ status: 'committed', ref_id: null });
      expect(engine.tables.sys_file[0].deleted_at).toBeUndefined();
    });

    it('a failing flag read keeps release tombstone-free (unreadable evidence is not permission)', async () => {
      const engine = fakeEngine({
        files: [file({ ref_object: 'product', ref_id: 'p1', ref_field: 'image' })],
        records: { product: [{ id: 'p1', image: 'file_a' }] },
      });
      engine.isFileReferencesMigrationVerified = async () => {
        throw new Error('sys_migration unreadable');
      };
      install(engine);

      await driveDelete(engine, 'product', { id: 'p1' });

      expect(engine.tables.sys_file[0]).toMatchObject({ status: 'committed', ref_id: null });
    });

    it('tombstones on release once the deployment has verified its migration (#3459 PR-5b)', async () => {
      const engine = fakeEngine({
        files: [file({ ref_object: 'product', ref_id: 'p1', ref_field: 'image' })],
        records: { product: [{ id: 'p1', image: 'file_a' }] },
      });
      engine.isFileReferencesMigrationVerified = async () => true;
      install(engine);

      await driveDelete(engine, 'product', { id: 'p1' });

      const row = engine.tables.sys_file[0];
      expect(row).toMatchObject({ ref_object: null, ref_id: null, ref_field: null, status: 'deleted' });
      expect(typeof row.deleted_at).toBe('string');
    });

    it('tombstones when an update replaces the field value, on a verified deployment', async () => {
      const engine = fakeEngine({
        files: [file({ ref_object: 'product', ref_id: 'p1', ref_field: 'image' })],
        records: { product: [{ id: 'p1', image: 'file_a' }] },
      });
      engine.isFileReferencesMigrationVerified = async () => true;
      install(engine);

      await driveUpdate(engine, 'product', 'p1', { image: null });

      expect(engine.tables.sys_file[0]).toMatchObject({ ref_id: null, status: 'deleted' });
    });

    it('releases a non-committed file without tombstoning it, even when verified', async () => {
      // A `pending` row already has its own never-completed reap policy;
      // tombstoning it here would hand it to the wrong lifecycle.
      const engine = fakeEngine({
        files: [file({ status: 'pending', ref_object: 'product', ref_id: 'p1', ref_field: 'image' })],
        records: { product: [{ id: 'p1', image: 'file_a' }] },
      });
      engine.isFileReferencesMigrationVerified = async () => true;
      install(engine);

      await driveDelete(engine, 'product', { id: 'p1' });

      expect(engine.tables.sys_file[0]).toMatchObject({ status: 'pending', ref_id: null });
      expect(engine.tables.sys_file[0].deleted_at).toBeUndefined();
    });
  });

  // ── Exclusive ownership / copy-on-claim ──────────────────────────
  describe('exclusive ownership', () => {
    it('copies the bytes when a second record claims an already-owned file', async () => {
      const engine = fakeEngine({
        files: [file({ ref_object: 'product', ref_id: 'p1', ref_field: 'image' })],
        records: { product: [{ id: 'p1', image: 'file_a' }] },
      });
      const { storage } = install(engine);

      const row = await driveInsert(engine, 'product', { image: 'file_a' }, 'p2');

      // The second record stores a DIFFERENT id — never the original.
      expect(row.image).not.toBe('file_a');
      expect(typeof row.image).toBe('string');
      expect(storage.download).toHaveBeenCalledWith('user/file_a.png');
      expect(storage.upload).toHaveBeenCalledTimes(1);

      // The original owner is untouched…
      expect(engine.tables.sys_file[0]).toMatchObject({ id: 'file_a', ref_id: 'p1' });
      // …and the copy is owned by the second record.
      const copy = engine.tables.sys_file.find((f) => f.id === row.image)!;
      expect(copy).toMatchObject({
        ref_object: 'product',
        ref_id: 'p2',
        ref_field: 'image',
        status: 'committed',
        name: 'a.png',
        mime_type: 'image/png',
      });
      expect(copy.key).not.toBe('user/file_a.png');
    });

    it('copies when an UPDATE moves an owned id into a different slot', async () => {
      const engine = fakeEngine({
        files: [file({ ref_object: 'product', ref_id: 'p1', ref_field: 'image' })],
        records: { product: [{ id: 'p1', image: 'file_a' }, { id: 'p2' }] },
      });
      const { storage } = install(engine);

      const row = await driveUpdate(engine, 'product', 'p2', { image: 'file_a' });

      expect(row!.image).not.toBe('file_a');
      expect(storage.upload).toHaveBeenCalledTimes(1);
      expect(engine.tables.sys_file[0]).toMatchObject({ id: 'file_a', ref_id: 'p1' });
    });

    it('copies into the SAME record when a second field references its file', async () => {
      const engine = fakeEngine({
        files: [file({ ref_object: 'product', ref_id: 'p1', ref_field: 'image' })],
        records: { product: [{ id: 'p1', image: 'file_a' }] },
      });
      install(engine);

      const row = await driveUpdate(engine, 'product', 'p1', { gallery: ['file_a'] });

      // Ownership is per (object, record, FIELD) — a sibling field is a
      // different slot and gets its own copy.
      expect((row!.gallery as string[])[0]).not.toBe('file_a');
      expect(engine.tables.sys_file[0]).toMatchObject({ ref_field: 'image' });
    });

    it('does not copy when the same slot rewrites its own file', async () => {
      const engine = fakeEngine({
        files: [file({ ref_object: 'product', ref_id: 'p1', ref_field: 'image' })],
        records: { product: [{ id: 'p1', image: 'file_a' }] },
      });
      const { storage } = install(engine);

      await driveUpdate(engine, 'product', 'p1', { image: 'file_a', name: 'renamed' });

      expect(storage.download).not.toHaveBeenCalled();
      expect(engine.tables.sys_file).toHaveLength(1);
    });

    it('fails the write when the copy cannot be made', async () => {
      const engine = fakeEngine({
        files: [file({ ref_object: 'product', ref_id: 'p1', ref_field: 'image' })],
        records: { product: [{ id: 'p1', image: 'file_a' }] },
      });
      const storage = fakeStorage();
      storage.download = vi.fn(async () => {
        throw new Error('backend unavailable');
      });
      install(engine, storage);

      await expect(driveInsert(engine, 'product', { image: 'file_a' }, 'p2')).rejects.toThrow(
        FileReferenceCopyError,
      );
      // Nothing partially recorded: the original still owns its file and no
      // half-built copy row was left behind.
      expect(engine.tables.sys_file).toHaveLength(1);
      expect(engine.tables.sys_file[0]).toMatchObject({ id: 'file_a', ref_id: 'p1' });
    });

    it('never transfers ownership when copying is impossible (no storage service)', async () => {
      const engine = fakeEngine({
        files: [file({ ref_object: 'product', ref_id: 'p1', ref_field: 'image' })],
        records: { product: [{ id: 'p1', image: 'file_a' }] },
      });
      const logger = silentLogger();
      installFileReferenceHooks(engine, () => null, logger);

      await driveInsert(engine, 'product', { image: 'file_a' }, 'p2');

      // The first record keeps it — a steal would silently re-home the file
      // and hand its read authorisation to a different parent record.
      expect(engine.tables.sys_file[0]).toMatchObject({ ref_id: 'p1', ref_field: 'image' });
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  // ── Declared media constraints (ADR-0104 D3 wave 2) ──────────────
  describe('accept / maxSize enforcement', () => {
    const constrained = (over: Record<string, any> = {}) => ({
      sys_file: REGISTRY.sys_file,
      product: {
        name: 'product',
        fields: {
          id: { type: 'text' },
          image: { type: 'image', accept: ['image/*'], maxSize: 1000, ...over },
          gallery: { type: 'image', multiple: true },
        },
      },
    });

    it('rejects a file larger than the declared maxSize', async () => {
      const engine = fakeEngine({
        files: [file({ size: 5000 })],
        registry: constrained(),
      });
      install(engine);

      await expect(driveInsert(engine, 'product', { image: 'file_a' }, 'p1')).rejects.toThrow(
        FileConstraintError,
      );
      // The write failed, so nothing was claimed.
      expect(engine.tables.sys_file[0].ref_id).toBeUndefined();
    });

    it('rejects a file whose MIME type is outside the declared accept list', async () => {
      const engine = fakeEngine({
        files: [file({ mime_type: 'application/pdf', name: 'a.pdf', size: 10 })],
        registry: constrained(),
      });
      install(engine);

      await expect(driveInsert(engine, 'product', { image: 'file_a' }, 'p1')).rejects.toThrow(
        /not permitted by the accept list/,
      );
    });

    it('accepts a file that satisfies both declarations', async () => {
      const engine = fakeEngine({ files: [file({ size: 10 })], registry: constrained() });
      install(engine);

      await driveInsert(engine, 'product', { image: 'file_a' }, 'p1');

      expect(engine.tables.sys_file[0].ref_id).toBe('p1');
    });

    it.each([
      [['image/png'], 'image/png', 'a.png', true],
      [['image/*'], 'image/jpeg', 'a.jpg', true],
      [['.pdf'], 'application/pdf', 'report.pdf', true],
      [['.pdf'], 'application/pdf', 'report.txt', false],
      [['image/png'], 'image/jpeg', 'a.jpg', false],
      [['*/*'], 'anything/at-all', 'x', true],
    ])('accept %j vs %s/%s → %s', async (accept, mime, name, allowed) => {
      const engine = fakeEngine({
        files: [file({ mime_type: mime, name, size: 10 })],
        registry: constrained({ accept, maxSize: undefined }),
      });
      install(engine);

      const write = driveInsert(engine, 'product', { image: 'file_a' }, 'p1');
      if (allowed) {
        await write;
        expect(engine.tables.sys_file[0].ref_id).toBe('p1');
      } else {
        await expect(write).rejects.toThrow(FileConstraintError);
      }
    });

    /**
     * Missing metadata is not evidence of a violation — a sys_file row with no
     * recorded size or MIME type must not be rejected by a constraint it
     * cannot be tested against.
     */
    it('does not reject a file whose size or MIME type is unrecorded', async () => {
      const engine = fakeEngine({
        files: [{ id: 'file_a', key: 'user/file_a', name: 'file_a', status: 'committed' }],
        registry: constrained(),
      });
      install(engine);

      await driveInsert(engine, 'product', { image: 'file_a' }, 'p1');

      expect(engine.tables.sys_file[0].ref_id).toBe('p1');
    });

    it('leaves a field with no declared constraints alone', async () => {
      const engine = fakeEngine({
        files: [file({ mime_type: 'application/pdf', size: 10_000_000 })],
        registry: constrained(),
      });
      install(engine);

      // `gallery` declares neither accept nor maxSize.
      await driveInsert(engine, 'product', { gallery: ['file_a'] }, 'p1');

      expect(engine.tables.sys_file[0].ref_field).toBe('gallery');
    });
  });

  // ── Unknown ids ──────────────────────────────────────────────────
  it('leaves an id that matches no sys_file row untouched', async () => {
    const engine = fakeEngine({ files: [file()] });
    const { storage } = install(engine);

    const row = await driveInsert(engine, 'product', { image: 'not_a_known_file' }, 'p1');

    expect(row.image).toBe('not_a_known_file');
    expect(storage.download).not.toHaveBeenCalled();
    expect(engine.calls.filter((c) => c.op === 'update' && c.object === 'sys_file')).toHaveLength(0);
  });
});
