// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import {
  installAttachmentLifecycleHooks,
  createSysFileReapGuard,
  createUploadSessionReapGuard,
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
    Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return row[k] === v;
    });

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
      // [#5671] An insert hook's payload arrives under `data` — `doc` was this
      // fixture's spelling from the old (wrong) contract table, a key no engine
      // path builds. Pinned in objectql's `hook-input-shape-contract.test.ts`.
      input: { data: { file_id: 'f1' } },
      result: { id: 'a9', file_id: 'f1' },
    });

    expect(engine.updates).toHaveLength(1);
    expect(engine.updates[0].data).toMatchObject({ id: 'f1', status: 'committed', deleted_at: null });
  });

  // [#5906] `input.data` is the ONE key an insert payload arrives under — measured
  // on the real engine by objectql's `hook-input-shape-contract.test.ts` ("insert
  // carries `data` — never `doc`", #5273). The fixture above cannot pin that: it
  // supplies `result`, which sits FIRST in the handler's read, so it stays green
  // whatever the limbs below it spell. These two carry the weight instead, and the
  // NEGATIVE one is the load-bearing half — it goes red the moment the deleted
  // `input.doc` alias limb is put back (that limb sat ahead of `data`, so a
  // `doc`-only context would be read again).
  const tombstonedFile = () => ({
    id: 'f1',
    key: 'attachments/f1.bin',
    scope: 'attachments',
    status: 'deleted',
    deleted_at: '2026-01-01T00:00:00Z',
  });

  it('un-tombstones from input.data when the context carries no result', async () => {
    const engine = fakeEngine({ attachments: [], files: [tombstonedFile()] });
    installAttachmentLifecycleHooks(engine, silentLogger());

    await engine.trigger('afterInsert', {
      object: 'sys_attachment',
      event: 'afterInsert',
      input: { data: { file_id: 'f1' } },
    });

    expect(engine.updates).toHaveLength(1);
    expect(engine.updates[0].data).toMatchObject({ id: 'f1', status: 'committed', deleted_at: null });
  });

  it('does NOT read an `input.doc` alias — no engine path produces that key', async () => {
    const engine = fakeEngine({ attachments: [], files: [tombstonedFile()] });
    installAttachmentLifecycleHooks(engine, silentLogger());

    await engine.trigger('afterInsert', {
      object: 'sys_attachment',
      event: 'afterInsert',
      // The spelling the deleted limb defended. With it gone the handler finds no
      // `file_id` at all, so the tombstone stands.
      input: { doc: { file_id: 'f1' } },
    });

    expect(engine.updates).toHaveLength(0);
    expect(engine.tables.sys_file[0].status).toBe('deleted');
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

  it('confirms zero-ref attachment tombstones after deleting the bytes — no migration flag needed', async () => {
    const engine = fakeEngine({ attachments: [], files: [] });
    const s = storage();
    const guard = createSysFileReapGuard(engine, () => s, silentLogger());

    const confirmed = await guard('sys_file', [
      { id: 'f1', key: 'attachments/f1.bin', status: 'deleted', scope: 'attachments' },
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
      { id: 'f1', key: 'attachments/f1.bin', status: 'deleted', scope: 'attachments' },
    ]);

    expect(confirmed).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });

  // ── Field-file lineage (#3459 PR-5b) ──────────────────────────────
  // The gated, irreversible half-pair: released field files only become byte
  // deletes when (a) nothing owns them at sweep time AND (b) this deployment's
  // file-as-reference migration flag is verified, re-read fresh each sweep.

  it('reaps a released field file when the deployment gate is open', async () => {
    const engine = fakeEngine({ attachments: [], files: [] });
    const s = storage();
    const guard = createSysFileReapGuard(engine, () => s, silentLogger(), async () => true);

    const confirmed = await guard('sys_file', [
      { id: 'f1', key: 'user/f1.png', status: 'deleted', scope: 'user', ref_object: null, ref_id: null },
    ]);

    expect(s.delete).toHaveBeenCalledWith('user/f1.png');
    expect(confirmed).toEqual(['f1']);
  });

  /**
   * R4 REGRESSION (the "two halves ship together" lock, #3459 PR-5b). A
   * tombstoned file whose ownership columns name a current owner — re-claimed
   * inside the grace window, or a release/claim race — must be un-tombstoned
   * and vetoed, exactly like an attachment that regained join rows. Without
   * this, every release would be a guaranteed byte delete.
   */
  it('vetoes and un-tombstones a field file that regained an owner (ownership re-verify)', async () => {
    const engine = fakeEngine({
      attachments: [],
      files: [{ id: 'f1', key: 'user/f1.png', status: 'deleted', scope: 'user' }],
    });
    const s = storage();
    const guard = createSysFileReapGuard(engine, () => s, silentLogger(), async () => true);

    const confirmed = await guard('sys_file', [
      { id: 'f1', key: 'user/f1.png', status: 'deleted', scope: 'user', ref_object: 'product', ref_id: 'p1', ref_field: 'image' },
    ]);

    expect(confirmed).toEqual([]);
    expect(s.delete).not.toHaveBeenCalled();
    expect(engine.updates[0].data).toMatchObject({ id: 'f1', status: 'committed', deleted_at: null });
  });

  it('vetoes field-file tombstones when no gate callback is wired (fail closed)', async () => {
    const engine = fakeEngine({ attachments: [], files: [] });
    const s = storage();
    const logger = silentLogger();
    const guard = createSysFileReapGuard(engine, () => s, logger);

    const confirmed = await guard('sys_file', [
      { id: 'f1', key: 'user/f1.png', status: 'deleted', scope: 'user' },
    ]);

    expect(confirmed).toEqual([]);
    expect(s.delete).not.toHaveBeenCalled();
    // Kept tombstoned — the observed release stands; only deletion is withheld.
    expect(engine.updates).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('files-to-references'));
  });

  it('vetoes field-file tombstones while the deployment gate is closed (flag regression)', async () => {
    const engine = fakeEngine({ attachments: [], files: [] });
    const s = storage();
    const guard = createSysFileReapGuard(engine, () => s, silentLogger(), async () => false);

    const confirmed = await guard('sys_file', [
      { id: 'f1', key: 'user/f1.png', status: 'deleted', scope: 'user' },
    ]);

    expect(confirmed).toEqual([]);
    expect(s.delete).not.toHaveBeenCalled();
  });

  it('a failing gate read vetoes field files but never blocks attachment reaps', async () => {
    const engine = fakeEngine({ attachments: [], files: [] });
    const s = storage();
    const guard = createSysFileReapGuard(engine, () => s, silentLogger(), async () => {
      throw new Error('sys_migration unreadable');
    });

    const confirmed = await guard('sys_file', [
      { id: 'f1', key: 'user/f1.png', status: 'deleted', scope: 'user' },
      { id: 'a1', key: 'attachments/a1.bin', status: 'deleted', scope: 'attachments' },
    ]);

    expect(confirmed).toEqual(['a1']);
    expect(s.delete).toHaveBeenCalledTimes(1);
    expect(s.delete).toHaveBeenCalledWith('attachments/a1.bin');
  });

  it('reads the gate once per sweep batch', async () => {
    const engine = fakeEngine({ attachments: [], files: [] });
    const s = storage();
    const isOpen = vi.fn(async () => true);
    const guard = createSysFileReapGuard(engine, () => s, silentLogger(), isOpen);

    await guard('sys_file', [
      { id: 'f1', key: 'user/f1.png', status: 'deleted', scope: 'user' },
      { id: 'f2', key: 'user/f2.png', status: 'deleted', scope: 'user' },
      { id: 'f3', key: 'user/f3.png', status: 'deleted', scope: 'user' },
    ]);

    expect(isOpen).toHaveBeenCalledTimes(1);
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

describe('createUploadSessionReapGuard', () => {
  /** Swappable-style storage fake: `getInner()` exposes an S3-like inner with
   * `setUploadKey`; `abortChunkedUpload` is forwarded. */
  const s3Storage = (abortImpl?: () => Promise<void>) => {
    const inner = {
      setUploadKey: vi.fn((_id: string, _key: string) => {}),
    };
    return {
      getInner: () => inner,
      abortChunkedUpload: vi.fn(abortImpl ?? (async () => {})),
      _inner: inner,
    } as any;
  };

  it('aborts the backend multipart (re-seeding the key) then reaps an abandoned session', async () => {
    const s = s3Storage();
    const guard = createUploadSessionReapGuard(() => s, silentLogger());

    const confirmed = await guard('sys_upload_session', [
      { id: 'u1', backend_upload_id: 'mp-1', key: 'attachments/u1.bin', status: 'in_progress' },
    ]);

    expect(s._inner.setUploadKey).toHaveBeenCalledWith('mp-1', 'attachments/u1.bin');
    expect(s.abortChunkedUpload).toHaveBeenCalledWith('mp-1');
    expect(confirmed).toEqual(['u1']);
  });

  it('does NOT abort a completed session (its multipart is already an object) — just reaps the row', async () => {
    const s = s3Storage();
    const guard = createUploadSessionReapGuard(() => s, silentLogger());

    const confirmed = await guard('sys_upload_session', [
      { id: 'u2', backend_upload_id: 'mp-2', key: 'attachments/u2.bin', status: 'completed' },
    ]);

    expect(s.abortChunkedUpload).not.toHaveBeenCalled();
    expect(confirmed).toEqual(['u2']);
  });

  it('reaps a session with no backend_upload_id without calling abort', async () => {
    const s = s3Storage();
    const guard = createUploadSessionReapGuard(() => s, silentLogger());

    const confirmed = await guard('sys_upload_session', [
      { id: 'u3', key: 'attachments/u3.bin', status: 'expired' },
    ]);

    expect(s.abortChunkedUpload).not.toHaveBeenCalled();
    expect(confirmed).toEqual(['u3']);
  });

  it('VETOES on abort failure so backend_upload_id survives for the retry', async () => {
    const s = s3Storage(async () => {
      throw new Error('S3 abort transient failure');
    });
    const logger = silentLogger();
    const guard = createUploadSessionReapGuard(() => s, logger);

    const confirmed = await guard('sys_upload_session', [
      { id: 'u4', backend_upload_id: 'mp-4', key: 'attachments/u4.bin', status: 'failed' },
    ]);

    expect(confirmed).toEqual([]); // kept
    expect(logger.warn).toHaveBeenCalled();
  });

  it('works with a local-style adapter (no setUploadKey / getInner) — aborts by id', async () => {
    const local = { abortChunkedUpload: vi.fn(async () => {}) } as any;
    const guard = createUploadSessionReapGuard(() => local, silentLogger());

    const confirmed = await guard('sys_upload_session', [
      { id: 'u5', backend_upload_id: 'local-5', key: 'attachments/u5.bin', status: 'expired' },
    ]);

    expect(local.abortChunkedUpload).toHaveBeenCalledWith('local-5');
    expect(confirmed).toEqual(['u5']);
  });

  it('reaps the row when the adapter cannot abort at all', async () => {
    const noAbort = {} as any;
    const guard = createUploadSessionReapGuard(() => noAbort, silentLogger());

    const confirmed = await guard('sys_upload_session', [
      { id: 'u6', backend_upload_id: 'mp-6', key: 'k', status: 'in_progress' },
    ]);

    expect(confirmed).toEqual(['u6']);
  });
});
