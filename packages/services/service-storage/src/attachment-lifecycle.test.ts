// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
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

/**
 * Drive an engine-shaped UPDATE. Both shapes the engine actually produces are
 * covered by one helper, because the only thing that differs is `dispatch.mode`
 * and whether a `before*` stash survives — and the handler under test reads
 * neither a stash nor the mode:
 *
 *  - by-id   (`dispatch.mode === 'record'`): ONE HookContext for both phases;
 *  - predicate (`dispatch.mode === 'per-row'`, since #5574 / ADR-0058
 *    Addendum II D1/D2): one FRESH context per matched row in each phase.
 *
 * `previous` is the row's pre-image on both — measured against the wired
 * ObjectQL engine for #10171, and the reason this handler reads it rather than
 * stashing across the phases the way the delete pair does.
 */
async function driveUpdate(
  engine: ReturnType<typeof fakeEngine>,
  id: string,
  patch: Record<string, unknown>,
  mode: 'record' | 'per-row' = 'record',
) {
  const before = engine.tables.sys_attachment.find((r) => r.id === id);
  const previous = before ? { ...before } : undefined;
  const options = mode === 'record' ? { where: { id } } : { multi: true, where: { parent_id: before?.parent_id } };
  const beforeCtx: any = {
    object: 'sys_attachment', event: 'beforeUpdate',
    input: { id, data: patch, options }, previous, dispatch: { mode, index: 0, scope: {} },
  };
  await engine.trigger('beforeUpdate', beforeCtx);
  if (before) Object.assign(before, patch);
  // A per-row after-context is a FRESH object, never the before one.
  const afterCtx: any =
    mode === 'record'
      ? Object.assign(beforeCtx, { event: 'afterUpdate', result: before ? { ...before } : undefined })
      : {
          object: 'sys_attachment', event: 'afterUpdate',
          input: { id, data: { ...patch }, options }, previous,
          dispatch: { mode, index: 0, scope: {} }, result: before ? { ...before } : undefined,
        };
  await engine.trigger('afterUpdate', afterCtx);
  return afterCtx;
}

/** The candidate filter `LifecycleService.reap()` derives from `sys_file`'s
 * DECLARED lifecycle (`system-file.object.ts`): `ttl { field: 'deleted_at',
 * expireAfter: '30d' }` and `retention { maxAge: '7d', onlyWhen: { status:
 * 'pending' } }`. Nothing outside this set is ever handed to the reap guard. */
const DAY_MS = 86_400_000;
function sweepCandidates(files: Array<Record<string, unknown>>, now: number) {
  const ttlCutoff = new Date(now - 30 * DAY_MS).toISOString();
  const retentionCutoff = new Date(now - 7 * DAY_MS).toISOString();
  return files.filter(
    (f) =>
      (typeof f.deleted_at === 'string' && f.deleted_at < ttlCutoff) ||
      (f.status === 'pending' && typeof f.created_at === 'string' && f.created_at < retentionCutoff),
  );
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

/* ────────────────────────────────────────────────────────────────────────────
 * #10171 — the UPDATE verb
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#10171] a `file_id` re-point detaches the prior file', () => {
  it('tombstones the prior file when the re-pointed row was its LAST reference', async () => {
    const engine = fakeEngine({
      attachments: [{ id: 'a1', file_id: 'f_old', parent_id: 'r1' }],
      files: [committedFile('f_old'), committedFile('f_new')],
    });
    installAttachmentLifecycleHooks(engine, silentLogger());

    await driveUpdate(engine, 'a1', { file_id: 'f_new' });

    const tombstone = engine.updates.find((u) => u.data.id === 'f_old');
    expect(tombstone?.data).toMatchObject({ id: 'f_old', status: 'deleted' });
    expect(typeof tombstone?.data.deleted_at).toBe('string');
  });

  it('tombstones on the PREDICATE path too — where a beforeUpdate stash would have been lost', async () => {
    // The shape #10171 proposed (beforeUpdate stash → afterUpdate) works by-id
    // and silently does nothing here: since #5574 each matched row gets a FRESH
    // context per phase, so anything written onto the before context dies with
    // it. Reading `ctx.previous` is what makes both paths behave alike, and
    // this case is the one that would catch a regression back to a stash.
    const engine = fakeEngine({
      attachments: [{ id: 'a1', file_id: 'f_old', parent_id: 'r1' }],
      files: [committedFile('f_old'), committedFile('f_new')],
    });
    installAttachmentLifecycleHooks(engine, silentLogger());

    await driveUpdate(engine, 'a1', { file_id: 'f_new' }, 'per-row');

    expect(engine.updates.find((u) => u.data.id === 'f_old')?.data).toMatchObject({
      id: 'f_old',
      status: 'deleted',
    });
  });

  it('does NOT tombstone while another join row still references the prior file', async () => {
    const engine = fakeEngine({
      attachments: [
        { id: 'a1', file_id: 'f_old' },
        { id: 'a2', file_id: 'f_old' }, // second parent, same file
      ],
      files: [committedFile('f_old'), committedFile('f_new')],
    });
    installAttachmentLifecycleHooks(engine, silentLogger());

    await driveUpdate(engine, 'a1', { file_id: 'f_new' });

    expect(engine.updates).toEqual([]);
    expect(engine.tables.sys_file[0]).toMatchObject({ id: 'f_old', status: 'committed' });
  });

  it('never tombstones non-attachments scopes (Field.file/avatar protection)', async () => {
    const engine = fakeEngine({
      attachments: [{ id: 'a1', file_id: 'f_field' }],
      files: [committedFile('f_field', 'field'), committedFile('f_new')],
    });
    installAttachmentLifecycleHooks(engine, silentLogger());

    await driveUpdate(engine, 'a1', { file_id: 'f_new' });

    expect(engine.updates).toEqual([]);
  });

  it('ignores an update whose payload does not carry `file_id`', async () => {
    const engine = fakeEngine({
      attachments: [{ id: 'a1', file_id: 'f1' }],
      files: [committedFile('f1')],
    });
    installAttachmentLifecycleHooks(engine, silentLogger());

    await driveUpdate(engine, 'a1', { description: 'renamed' });

    expect(engine.updates).toEqual([]);
    expect(engine.tables.sys_file[0]).toMatchObject({ status: 'committed' });
  });

  it('a payload that re-states the SAME file_id detaches nothing', async () => {
    const engine = fakeEngine({
      attachments: [{ id: 'a1', file_id: 'f1' }],
      files: [committedFile('f1')],
    });
    installAttachmentLifecycleHooks(engine, silentLogger());

    await driveUpdate(engine, 'a1', { file_id: 'f1' });

    expect(engine.updates).toEqual([]);
  });

  it('no pre-image → tombstones nothing (fail toward retention)', async () => {
    const engine = fakeEngine({
      attachments: [{ id: 'a1', file_id: 'f_old' }],
      files: [committedFile('f_old'), committedFile('f_new')],
    });
    installAttachmentLifecycleHooks(engine, silentLogger());

    const ctx: any = {
      object: 'sys_attachment', event: 'afterUpdate',
      input: { id: 'a1', data: { file_id: 'f_new' }, options: { where: { id: 'a1' } } },
      dispatch: { mode: 'record', index: 0, scope: {} },
    };
    await engine.trigger('afterUpdate', ctx);

    expect(engine.updates).toEqual([]);
  });

  it('a failing lookup never blocks the update (best-effort)', async () => {
    const engine = fakeEngine({
      attachments: [{ id: 'a1', file_id: 'f_old' }],
      files: [committedFile('f_old'), committedFile('f_new')],
    });
    const logger = silentLogger();
    installAttachmentLifecycleHooks(engine, logger);
    engine.find = async () => { throw new Error('driver down'); };

    await expect(driveUpdate(engine, 'a1', { file_id: 'f_new' })).resolves.toBeDefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('[#10171] the leak this closes, and the half the reap guard already owned', () => {
  it('an untombstoned orphan is never a sweep candidate — the leak is permanent, not deferred', async () => {
    // Why the update leg has to exist at all: `sys_file`'s declared lifecycle
    // can only ever nominate a row through `deleted_at` (ttl) or `status:
    // 'pending'` (retention). A silently detached file carries neither, so the
    // reap guard is never even asked about it — a permanent leak, which is
    // outside this module's "fail toward retention" bias (that bias buys a
    // LATER look, and here no later look exists).
    const orphan = { ...committedFile('f_old') }; // detached, never tombstoned
    expect(sweepCandidates([orphan], Date.now() + 365 * DAY_MS)).toEqual([]);

    // Once the update leg tombstones it, the same row IS nominated.
    const engine = fakeEngine({
      attachments: [{ id: 'a1', file_id: 'f_old' }],
      files: [committedFile('f_old'), committedFile('f_new')],
    });
    installAttachmentLifecycleHooks(engine, silentLogger());
    await driveUpdate(engine, 'a1', { file_id: 'f_new' });

    expect(sweepCandidates(engine.tables.sys_file, Date.now() + 365 * DAY_MS)).toEqual([
      expect.objectContaining({ id: 'f_old', status: 'deleted' }),
    ]);
  });

  it('re-pointing a row ONTO a tombstoned file is revived by the sweep — so no revival leg is added here', async () => {
    // #10171's second leg, measured rather than assumed: the reap guard's
    // sweep-time re-verification resolves CURRENT references, so a re-pointed
    // tombstone is un-tombstoned and vetoed instead of reaped. The bytes were
    // never at risk, and an `afterUpdate` revival twin would be a second
    // implementation of an answer that already exists.
    const engine = fakeEngine({
      // `a2` keeps `f_other` referenced, so the detach half stays out of the
      // way and this case is about the REVIVAL half alone.
      attachments: [{ id: 'a1', file_id: 'f_other' }, { id: 'a2', file_id: 'f_other' }],
      files: [
        { id: 'f_t', key: 'attachments/f_t.bin', scope: 'attachments', status: 'deleted', deleted_at: '2026-01-01T00:00:00Z' },
        committedFile('f_other'),
      ],
    });
    installAttachmentLifecycleHooks(engine, silentLogger());
    const s = { delete: vi.fn(async () => {}) } as any;

    await driveUpdate(engine, 'a1', { file_id: 'f_t' });
    // The update leg itself neither revives nor tombstones anything here.
    expect(engine.updates).toEqual([]);

    const guard = createSysFileReapGuard(engine, () => s, silentLogger(), async () => true);
    const confirmed = await guard('sys_file', [{ ...engine.tables.sys_file[0] }]);

    expect(confirmed).toEqual([]);
    expect(s.delete).not.toHaveBeenCalled();
    expect(engine.tables.sys_file[0]).toMatchObject({ id: 'f_t', status: 'committed', deleted_at: null });
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * #10171 — the same leg through the WIRED engine
 *
 * The fakes above model the dispatch shapes; this section checks the model.
 * The whole design rests on the engine binding `previous` to the row's
 * pre-image on the after phase of BOTH dispatch paths — a fake that simply
 * asserts that would be circular, so these cases drive real `ObjectQL`.
 * ──────────────────────────────────────────────────────────────────────────── */

const wiredAttachmentObject = {
  name: 'sys_attachment', label: 'Attachment',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    file_id: { name: 'file_id', label: 'File', type: 'text' as const },
    parent_id: { name: 'parent_id', label: 'Parent Id', type: 'text' as const },
  },
};
const wiredFileObject = {
  name: 'sys_file', label: 'File',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    key: { name: 'key', label: 'Key', type: 'text' as const },
    scope: { name: 'scope', label: 'Scope', type: 'text' as const },
    status: { name: 'status', label: 'Status', type: 'text' as const },
    deleted_at: { name: 'deleted_at', label: 'Deleted At', type: 'text' as const },
  },
};

/** In-memory driver whose WHERE matcher REFUSES combinators/operator values by
 * throwing — the conforming shape `check-where-matcher-conformance.mjs` asks of
 * a double (silently wrong answers are the defect class, not incompleteness). */
function makeWiredDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => {
    let st = stores.get(o);
    if (!st) { st = new Map(); stores.set(o, st); }
    return st;
  };
  const matches = (row: Record<string, unknown>, where: unknown): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) throw new Error(`wired stub driver: unsupported combinator ${k}`);
      if (v !== null && typeof v === 'object') throw new Error(`wired stub driver: unsupported operator value on ${k}`);
      if ((row[k] ?? null) !== (v ?? null)) return false;
    }
    return true;
  };
  const d: any = {
    name: 'memory', version: '0.0.0', supports: {}, stores,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; }, async syncSchema() {},
    async find(o: string, ast: any) { return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)); },
    async findOne(o: string, ast: any) { for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r; return null; },
    async create(o: string, data: Record<string, unknown>) {
      const id = String(data.id); const row = { ...data, id }; storeFor(o).set(id, row); return row;
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      const st = storeFor(o); const row = st.get(String(id)); if (!row) return null;
      const next = { ...row, ...data, id: row.id }; st.set(String(id), next); return next;
    },
    async delete(o: string, id: string) { return storeFor(o).delete(String(id)); },
    async count(o: string, ast: any) { return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)).length; },
    async deleteMany(o: string, ast: any) {
      const doomed = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      for (const r of doomed) storeFor(o).delete(String(r.id));
      return doomed.length;
    },
    async updateMany(o: string, ast: any, data: Record<string, unknown>) {
      const hit = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      for (const r of hit) storeFor(o).set(String(r.id), { ...r, ...data, id: r.id });
      return hit.length;
    },
  };
  return d;
}

async function bootWiredLifecycle(seed: {
  attachments?: Array<Record<string, unknown>>;
  files?: Array<Record<string, unknown>>;
}) {
  const ql = new ObjectQL();
  const driver = makeWiredDriver();
  ql.registerDriver(driver, true);
  await ql.init();
  ql.registry.registerObject(wiredAttachmentObject as any, 'app:test');
  ql.registry.registerObject(wiredFileObject as any, 'app:test');
  // `ql as any` mirrors the production wiring in storage-service-plugin.ts.
  installAttachmentLifecycleHooks(ql as any, silentLogger());
  for (const o of ['sys_attachment', 'sys_file']) {
    if (!driver.stores.get(o)) driver.stores.set(o, new Map());
  }
  for (const r of seed.attachments ?? []) driver.stores.get('sys_attachment')!.set(String(r.id), { ...r });
  for (const r of seed.files ?? []) driver.stores.get('sys_file')!.set(String(r.id), { ...r });
  return { ql, file: (id: string) => driver.stores.get('sys_file')!.get(id) };
}

const SYS_WRITE = { context: { isSystem: true } } as any;

describe('[#10171] the update leg through the wired engine', () => {
  it('a by-id re-point tombstones the prior file (`dispatch.mode === "record"`)', async () => {
    const { ql, file } = await bootWiredLifecycle({
      attachments: [{ id: 'a1', file_id: 'f_old', parent_id: 'r1' }],
      files: [committedFile('f_old'), committedFile('f_new')],
    });

    await ql.update('sys_attachment', { file_id: 'f_new' }, { where: { id: 'a1' }, ...SYS_WRITE });

    expect(file('f_old')).toMatchObject({ id: 'f_old', status: 'deleted' });
    expect(typeof file('f_old')!.deleted_at).toBe('string');
    expect(file('f_new')).toMatchObject({ status: 'committed' });
  });

  it('a PREDICATE re-point tombstones the prior file (`dispatch.mode === "per-row"`)', async () => {
    // The case that decides the design. A `beforeUpdate` stash reaches
    // `afterUpdate` on the by-id path and is LOST here, because each matched
    // row gets a fresh context per phase (#5574 / ADR-0058 Addendum II D1/D2) —
    // so the shape #10171 proposed would pass the case above and fail this one.
    const { ql, file } = await bootWiredLifecycle({
      attachments: [{ id: 'a1', file_id: 'f_old', parent_id: 'r1' }],
      files: [committedFile('f_old'), committedFile('f_new')],
    });

    await ql.update('sys_attachment', { file_id: 'f_new' }, { multi: true, where: { parent_id: 'r1' }, ...SYS_WRITE });

    expect(file('f_old')).toMatchObject({ id: 'f_old', status: 'deleted' });
  });

  it('a re-point that leaves the prior file still referenced tombstones nothing', async () => {
    const { ql, file } = await bootWiredLifecycle({
      attachments: [
        { id: 'a1', file_id: 'f_old', parent_id: 'r1' },
        { id: 'a2', file_id: 'f_old', parent_id: 'r2' },
      ],
      files: [committedFile('f_old'), committedFile('f_new')],
    });

    await ql.update('sys_attachment', { file_id: 'f_new' }, { where: { id: 'a1' }, ...SYS_WRITE });

    expect(file('f_old')).toMatchObject({ status: 'committed' });
  });

  it('the by-id DELETE leg still tombstones — the shared orphan helper did not move it', async () => {
    const { ql, file } = await bootWiredLifecycle({
      attachments: [{ id: 'a1', file_id: 'f1', parent_id: 'r1' }],
      files: [committedFile('f1')],
    });

    await ql.delete('sys_attachment', { where: { id: 'a1' }, ...SYS_WRITE });

    expect(file('f1')).toMatchObject({ id: 'f1', status: 'deleted' });
  });
});
