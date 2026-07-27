// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import {
  installFileReferenceHooks,
  FileReferenceCopyError,
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
async function driveInsert(engine: Engine, object: string, data: Record<string, unknown>, id: string) {
  const ctx: any = { object, event: 'beforeInsert', input: { data } };
  await engine.trigger('beforeInsert', ctx);
  const row = { ...(ctx.input.data as Record<string, unknown>), id };
  (engine.tables[object] ??= []).push(row);
  ctx.event = 'afterInsert';
  ctx.result = row;
  await engine.trigger('afterInsert', ctx);
  return row;
}

async function driveUpdate(engine: Engine, object: string, id: string, data: Record<string, unknown>) {
  const ctx: any = { object, event: 'beforeUpdate', input: { id, data } };
  await engine.trigger('beforeUpdate', ctx);
  const row = (engine.tables[object] ?? []).find((r) => String(r.id) === String(id));
  if (row) Object.assign(row, ctx.input.data);
  ctx.event = 'afterUpdate';
  ctx.result = row;
  await engine.trigger('afterUpdate', ctx);
  return row;
}

async function driveDelete(engine: Engine, object: string, input: any) {
  const ctx: any = { object, event: 'beforeDelete', input };
  await engine.trigger('beforeDelete', ctx);
  const where = input?.options?.where;
  if (input?.id != null) {
    const ids = typeof input.id === 'object' ? input.id.$in : [input.id];
    engine.tables[object] = (engine.tables[object] ?? []).filter(
      (r) => !ids.some((i: unknown) => String(i) === String(r.id)),
    );
  } else if (where) {
    engine.tables[object] = (engine.tables[object] ?? []).filter(
      (r) => !Object.entries(where).every(([k, v]) => r[k] === v),
    );
  }
  ctx.event = 'afterDelete';
  await engine.trigger('afterDelete', ctx);
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

    it('releases via the beforeDelete stash for a where-shaped multi delete', async () => {
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
     * R4 REGRESSION. Releasing must NOT tombstone: `deleted_at` is what makes a
     * row a reap candidate, and the reap guard's sweep-time re-verify still
     * only consults `sys_attachment` (always empty for a field file). Setting
     * the tombstone here without extending that guard in the same change turns
     * every released file into a guaranteed byte delete.
     */
    it('never tombstones on release — the file stays as retained as it was', async () => {
      const engine = fakeEngine({
        files: [file({ ref_object: 'product', ref_id: 'p1', ref_field: 'image' })],
        records: { product: [{ id: 'p1', image: 'file_a' }] },
      });
      install(engine);

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
