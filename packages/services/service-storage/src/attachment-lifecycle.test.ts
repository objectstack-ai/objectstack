// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import {
  installAttachmentLifecycleHooks,
  createSysFileReapGuard,
  type AttachmentLifecycleEngine,
} from './attachment-lifecycle.js';

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });

/**
 * In-memory fake engine: a sys_attachment table + a sys_file table, plus a
 * hook registry so tests can drive the engine seams the way the real engine
 * does (same HookContext object across beforeDelete → afterDelete).
 */
function fakeEngine(seed: {
  attachments?: Array<Record<string, unknown>>;
  files?: Array<Record<string, unknown>>;
}) {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    sys_attachment: [...(seed.attachments ?? [])],
    sys_file: [...(seed.files ?? [])],
  };
  const hooks = new Map<string, Array<(ctx: any) => Promise<void> | void>>();
  const updates: Array<{ object: string; data: any }> = [];

  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => row[k] === v);

  const engine: AttachmentLifecycleEngine & {
    tables: typeof tables;
    updates: typeof updates;
    trigger(event: string, ctx: any): Promise<void>;
    deleteRows(where: Record<string, unknown>): void;
  } = {
    registerHook(event, handler, opts) {
      expect(opts?.object).toBe('sys_attachment');
      const list = hooks.get(event) ?? [];
      list.push(handler);
      hooks.set(event, list);
    },
    async find(object, options: any) {
      const rows = tables[object].filter((r) => matches(r, options?.where ?? {}));
      return typeof options?.limit === 'number' ? rows.slice(0, options.limit) : rows;
    },
    async findOne(object, options: any) {
      return tables[object].find((r) => matches(r, options?.where ?? {})) ?? null;
    },
    async update(object, data: any, _options) {
      updates.push({ object, data });
      const row = tables[object].find((r) => r.id === data.id);
      if (row) Object.assign(row, data);
      return row;
    },
    tables,
    updates,
    async trigger(event, ctx) {
      for (const h of hooks.get(event) ?? []) await h(ctx);
    },
    deleteRows(where) {
      tables.sys_attachment = tables.sys_attachment.filter((r) => !matches(r, where));
    },
  };
  return engine;
}

/** Drive a full engine-shaped delete: beforeDelete → row removal → afterDelete
 * with ONE shared ctx object (mirrors engine.ts delete()). */
async function driveDelete(engine: ReturnType<typeof fakeEngine>, input: any, where: Record<string, unknown>) {
  const ctx: any = { object: 'sys_attachment', event: 'beforeDelete', input };
  await engine.trigger('beforeDelete', ctx);
  engine.deleteRows(where);
  ctx.event = 'afterDelete';
  await engine.trigger('afterDelete', ctx);
}

const committedFile = (id: string, scope = 'attachments') => ({
  id,
  key: `attachments/${id}.bin`,
  scope,
  status: 'committed',
});

describe('installAttachmentLifecycleHooks — tombstoning', () => {
  it('tombstones the file when the LAST join row is deleted (by id)', async () => {
    const engine = fakeEngine({
      attachments: [{ id: 'a1', file_id: 'f1' }],
      files: [committedFile('f1')],
    });
    installAttachmentLifecycleHooks(engine, silentLogger());

    await driveDelete(engine, { id: 'a1', options: {} }, { id: 'a1' });

    expect(engine.updates).toHaveLength(1);
    expect(engine.updates[0].data).toMatchObject({ id: 'f1', status: 'deleted' });
    expect(typeof engine.updates[0].data.deleted_at).toBe('string');
  });

  it('does NOT tombstone while another join row still references the file', async () => {
    const engine = fakeEngine({
      attachments: [
        { id: 'a1', file_id: 'f1' },
        { id: 'a2', file_id: 'f1' }, // second parent, same file
      ],
      files: [committedFile('f1')],
    });
    installAttachmentLifecycleHooks(engine, silentLogger());

    await driveDelete(engine, { id: 'a1', options: {} }, { id: 'a1' });

    expect(engine.updates).toHaveLength(0);
    expect(engine.tables.sys_file[0].status).toBe('committed');
  });

  it('resolves every affected file on a multi-delete (options.where)', async () => {
    const engine = fakeEngine({
      attachments: [
        { id: 'a1', file_id: 'f1', parent_id: 'p1' },
        { id: 'a2', file_id: 'f2', parent_id: 'p1' },
        { id: 'a3', file_id: 'f2', parent_id: 'p2' }, // f2 keeps a ref
      ],
      files: [committedFile('f1'), committedFile('f2')],
    });
    installAttachmentLifecycleHooks(engine, silentLogger());

    await driveDelete(
      engine,
      { id: undefined, options: { where: { parent_id: 'p1' }, multi: true } },
      { parent_id: 'p1' },
    );

    expect(engine.updates.map((u) => u.data.id)).toEqual(['f1']);
  });

  it('never tombstones non-attachments scopes (Field.file/avatar protection)', async () => {
    const engine = fakeEngine({
      attachments: [{ id: 'a1', file_id: 'f1' }],
      files: [committedFile('f1', 'user')],
    });
    installAttachmentLifecycleHooks(engine, silentLogger());

    await driveDelete(engine, { id: 'a1', options: {} }, { id: 'a1' });

    expect(engine.updates).toHaveLength(0);
  });

  it('un-tombstones on re-attach (afterInsert)', async () => {
    const engine = fakeEngine({
      attachments: [],
      files: [{ id: 'f1', key: 'attachments/f1.bin', scope: 'attachments', status: 'deleted', deleted_at: '2026-01-01T00:00:00Z' }],
    });
    installAttachmentLifecycleHooks(engine, silentLogger());

    await engine.trigger('afterInsert', {
      object: 'sys_attachment',
      event: 'afterInsert',
      input: { doc: { file_id: 'f1' } },
      result: { id: 'a9', file_id: 'f1' },
    });

    expect(engine.updates).toHaveLength(1);
    expect(engine.updates[0].data).toMatchObject({ id: 'f1', status: 'committed', deleted_at: null });
  });

  it('a failing lookup never blocks the delete (best-effort)', async () => {
    const engine = fakeEngine({ attachments: [], files: [] });
    engine.findOne = async () => {
      throw new Error('driver exploded');
    };
    const logger = silentLogger();
    installAttachmentLifecycleHooks(engine, logger);

    await expect(driveDelete(engine, { id: 'a1', options: {} }, { id: 'a1' })).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('createSysFileReapGuard', () => {
  const storage = () => ({ delete: vi.fn(async () => {}) }) as any;

  it('confirms zero-ref tombstones after deleting the bytes', async () => {
    const engine = fakeEngine({ attachments: [], files: [] });
    const s = storage();
    const guard = createSysFileReapGuard(engine, () => s, silentLogger());

    const confirmed = await guard('sys_file', [
      { id: 'f1', key: 'attachments/f1.bin', status: 'deleted' },
    ]);

    expect(s.delete).toHaveBeenCalledWith('attachments/f1.bin');
    expect(confirmed).toEqual(['f1']);
  });

  it('vetoes and un-tombstones a row that regained references (sweep-time re-verification)', async () => {
    const engine = fakeEngine({
      attachments: [{ id: 'a1', file_id: 'f1' }],
      files: [{ id: 'f1', key: 'attachments/f1.bin', scope: 'attachments', status: 'deleted', deleted_at: '2026-01-01T00:00:00Z' }],
    });
    const s = storage();
    const guard = createSysFileReapGuard(engine, () => s, silentLogger());

    const confirmed = await guard('sys_file', [
      { id: 'f1', key: 'attachments/f1.bin', status: 'deleted' },
    ]);

    expect(confirmed).toEqual([]);
    expect(s.delete).not.toHaveBeenCalled();
    expect(engine.updates[0].data).toMatchObject({ id: 'f1', status: 'committed', deleted_at: null });
  });

  it('a byte-delete failure vetoes the row (retried next sweep, bytes never leaked)', async () => {
    const engine = fakeEngine({ attachments: [], files: [] });
    const s = { delete: vi.fn(async () => { throw new Error('S3 down'); }) } as any;
    const logger = silentLogger();
    const guard = createSysFileReapGuard(engine, () => s, logger);

    const confirmed = await guard('sys_file', [
      { id: 'f1', key: 'attachments/f1.bin', status: 'deleted' },
    ]);

    expect(confirmed).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('confirms abandoned pending uploads with best-effort byte cleanup', async () => {
    const engine = fakeEngine({ attachments: [], files: [] });
    const s = storage();
    const guard = createSysFileReapGuard(engine, () => s, silentLogger());

    const confirmed = await guard('sys_file', [
      { id: 'p1', key: 'user/p1.bin', status: 'pending' },
    ]);

    expect(s.delete).toHaveBeenCalledWith('user/p1.bin');
    expect(confirmed).toEqual(['p1']);
  });

  it('vetoes rows in any other state (fail toward retention)', async () => {
    const engine = fakeEngine({ attachments: [], files: [] });
    const guard = createSysFileReapGuard(engine, storage, silentLogger());

    const confirmed = await guard('sys_file', [
      { id: 'c1', key: 'attachments/c1.bin', status: 'committed' },
    ]);

    expect(confirmed).toEqual([]);
  });
});
