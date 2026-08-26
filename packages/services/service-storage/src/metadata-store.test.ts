// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #5216 — `StorageMetadataStore` used to wrap all eight of its `IDataEngine`
// calls in `try { … } catch { /* ignore */ }` with no logger and no rethrow.
// With an engine wired, that catch could only ever fire on a RUNTIME failure
// (`if (this.engine)` already separated "no engine" out), so a failed
// `sys_file` insert lost mostly-permanent business truth (#5202) while the
// route answered 200 over an in-process Map shadow that vanished with the
// worker.
//
// These tests pin the three properties the fix rests on:
//   1. `engine === null` behaves exactly as before — the Map IS the store;
//   2. with an engine present the Map is never written, so no shadow can make
//      a lost write look like a landed one;
//   3. a failing engine surfaces: writes AND reads throw
//      `StorageMetadataStoreError`, and a MISS (`findOne` → null) still
//      returns `null` rather than throwing.

import { describe, it, expect } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineFindOnePredicate } from '@objectstack/objectql';
import type { IDataEngine } from '@objectstack/spec/contracts';
import {
  StorageMetadataStore,
  StorageMetadataStoreError,
  type FileRecord,
  type UploadSessionRecord,
} from './metadata-store.js';

// ---------------------------------------------------------------------------
// Fake engine
// ---------------------------------------------------------------------------

type EngineMethod = 'insert' | 'update' | 'delete' | 'findOne';

/**
 * A minimal in-memory `IDataEngine` whose every method can be made to throw,
 * simulating the runtime failures (`constraint`, `connection`, RLS refusal,
 * missing table) the swallowed catches used to hide.
 *
 * `delete` opens with {@link assertEngineDeleteDispatch} — the producer's own
 * dispatch predicate (#4550/#5197) — so this double can never accept a delete
 * shape the real `ObjectQL.delete` refuses.
 */
function createFakeEngine(opts: { failing?: EngineMethod[] } = {}) {
  const failing = new Set<EngineMethod>(opts.failing ?? []);
  const rows = new Map<string, Map<string, any>>();
  const calls: Array<{ method: EngineMethod; object: string }> = [];

  const table = (object: string) => {
    let t = rows.get(object);
    if (!t) rows.set(object, (t = new Map()));
    return t;
  };
  const boom = (method: EngineMethod, object: string) => {
    calls.push({ method, object });
    if (failing.has(method)) {
      throw new Error(`simulated engine outage on ${method}(${object})`);
    }
  };

  const engine = {
    async insert(object: string, data: any) {
      boom('insert', object);
      table(object).set(String(data.id), { ...data });
      return { ...data };
    },
    async findOne(object: string, query?: any) {
      assertEngineFindOnePredicate(object, query);
      boom('findOne', object);
      const id = query?.where?.id;
      return table(object).get(String(id)) ?? null;
    },
    async update(object: string, data: any, options?: any) {
      boom('update', object);
      const id = String(options?.where?.id ?? data?.id);
      const t = table(object);
      if (!t.has(id)) return null;
      t.set(id, { ...t.get(id), ...data });
      return { ...t.get(id) };
    },
    async delete(object: string, options?: any) {
      assertEngineDeleteDispatch(options);
      boom('delete', object);
      const id = String(options?.where?.id);
      return table(object).delete(id) ? 1 : 0;
    },
    async find() {
      return [];
    },
    async count() {
      return 0;
    },
    async aggregate() {
      return [];
    },
    /** Rows the engine actually persisted, for "did the write land?" assertions. */
    _rows: (object: string) => [...table(object).values()],
    /** Every engine call this store issued, in order. */
    _calls: calls,
    /** Flip a method into/out of the failing set mid-test. */
    _setFailing: (method: EngineMethod, on: boolean) => {
      if (on) failing.add(method);
      else failing.delete(method);
    },
  };
  return engine as typeof engine & IDataEngine;
}

const fileRec = (id: string): FileRecord => ({
  id,
  key: `user/${id}.txt`,
  name: `${id}.txt`,
  mime_type: 'text/plain',
  size: 3,
  status: 'pending',
});

const sessionRec = (id: string): UploadSessionRecord => ({
  id,
  file_id: `file-of-${id}`,
  key: `user/${id}.bin`,
  filename: `${id}.bin`,
  total_size: 100,
  chunk_size: 50,
  total_chunks: 2,
  status: 'in_progress',
});

// ---------------------------------------------------------------------------
// 1. engine === null — the documented fallback, unchanged
// ---------------------------------------------------------------------------

describe('StorageMetadataStore: no engine wired (the Map IS the store)', () => {
  it('round-trips files through the process-local Map', async () => {
    const store = new StorageMetadataStore(null);

    const created = await store.createFile(fileRec('f1'));
    expect(created.id).toBe('f1');
    expect(created.created_at).toBeTruthy();
    expect(await store.getFile('f1')).toMatchObject({ id: 'f1', status: 'pending' });

    const updated = await store.updateFile('f1', { status: 'committed', etag: 'abc' });
    expect(updated).toMatchObject({ status: 'committed', etag: 'abc' });
    expect(await store.getFile('f1')).toMatchObject({ status: 'committed' });

    await store.deleteFile('f1');
    expect(await store.getFile('f1')).toBeNull();
  });

  it('round-trips upload sessions through the process-local Map', async () => {
    const store = new StorageMetadataStore(null);

    const created = await store.createSession(sessionRec('s1'));
    expect(created).toMatchObject({ id: 's1', uploaded_chunks: 0, parts: '[]' });
    expect(await store.getSession('s1')).toMatchObject({ id: 's1' });

    const updated = await store.updateSession('s1', { uploaded_chunks: 1, status: 'completing' });
    expect(updated).toMatchObject({ uploaded_chunks: 1, status: 'completing' });

    await store.deleteSession('s1');
    expect(await store.getSession('s1')).toBeNull();
  });

  it('updating / reading something absent is a miss, not an error', async () => {
    const store = new StorageMetadataStore(null);
    expect(await store.getFile('nope')).toBeNull();
    expect(await store.updateFile('nope', { status: 'committed' })).toBeNull();
    expect(await store.getSession('nope')).toBeNull();
    expect(await store.updateSession('nope', { status: 'completed' })).toBeNull();
    await expect(store.deleteFile('nope')).resolves.toBeUndefined();
    await expect(store.deleteSession('nope')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. engine wired and healthy — one store, no Map shadow
// ---------------------------------------------------------------------------

describe('StorageMetadataStore: engine wired and healthy', () => {
  it('writes and reads sys_file through the engine', async () => {
    const engine = createFakeEngine();
    const store = new StorageMetadataStore(engine);

    await store.createFile(fileRec('f1'));
    expect(engine._rows('sys_file')).toHaveLength(1);

    await store.updateFile('f1', { status: 'committed' });
    expect(engine._rows('sys_file')[0]).toMatchObject({ status: 'committed' });

    await store.deleteFile('f1');
    expect(engine._rows('sys_file')).toHaveLength(0);
    expect(await store.getFile('f1')).toBeNull();
  });

  it('writes and reads sys_upload_session through the engine', async () => {
    const engine = createFakeEngine();
    const store = new StorageMetadataStore(engine);

    await store.createSession(sessionRec('s1'));
    await store.updateSession('s1', { uploaded_chunks: 2, status: 'completed' });
    expect(engine._rows('sys_upload_session')[0]).toMatchObject({
      uploaded_chunks: 2,
      status: 'completed',
    });

    await store.deleteSession('s1');
    expect(await store.getSession('s1')).toBeNull();
  });

  it('mirrors NOTHING into the Map — a row that leaves the engine is gone', async () => {
    // The #5216 mechanism in miniature: the old store wrote the Map first, so
    // a read right after a lost engine write found the shadow and everything
    // looked fine inside this process. With an engine wired the Map is never
    // touched, so the engine is the only answer there is.
    const engine = createFakeEngine();
    const store = new StorageMetadataStore(engine);

    await store.createFile(fileRec('f1'));
    await store.createSession(sessionRec('s1'));

    // Another worker / an admin deletes the rows straight out of the engine.
    await engine.delete('sys_file', { where: { id: 'f1' } });
    await engine.delete('sys_upload_session', { where: { id: 's1' } });

    expect(await store.getFile('f1')).toBeNull();
    expect(await store.getSession('s1')).toBeNull();
  });

  it('a findOne miss is a miss — null, not a throw', async () => {
    const store = new StorageMetadataStore(createFakeEngine());
    expect(await store.getFile('never-existed')).toBeNull();
    expect(await store.getSession('never-existed')).toBeNull();
    expect(await store.updateFile('never-existed', { status: 'committed' })).toBeNull();
    expect(await store.updateSession('never-existed', { status: 'completed' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. engine wired and FAILING — loud, and no in-memory residue
// ---------------------------------------------------------------------------

describe('StorageMetadataStore: engine wired and failing (#5216)', () => {
  it('createFile throws instead of losing the sys_file row behind a 200', async () => {
    const engine = createFakeEngine({ failing: ['insert'] });
    const store = new StorageMetadataStore(engine);

    await expect(store.createFile(fileRec('f1'))).rejects.toBeInstanceOf(StorageMetadataStoreError);
    expect(engine._rows('sys_file')).toHaveLength(0);

    // No Map residue: once the engine recovers, the read is honest about the
    // row never having been written.
    engine._setFailing('insert', false);
    expect(await store.getFile('f1')).toBeNull();
  });

  it("the thrown error names the object, the consequence and the fix", async () => {
    const engine = createFakeEngine({ failing: ['insert'] });
    const store = new StorageMetadataStore(engine);

    const err = await store.createFile(fileRec('f1')).catch((e: any) => e);
    expect(err).toBeInstanceOf(StorageMetadataStoreError);
    expect(err.name).toBe('StorageMetadataStoreError');
    expect(err.objectName).toBe('sys_file');
    expect(err.operation).toBe('insert');
    // CONSEQUENCE — what is not persisted (AGENTS.md → "Degradation log levels").
    expect(err.message).toContain('sys_file row was NOT written');
    // FIX — what restores durability.
    expect(err.message).toContain('Restore the data engine');
    // The underlying failure is preserved, not replaced.
    expect(err.message).toContain('simulated engine outage on insert(sys_file)');
    expect((err.cause as Error)?.message).toBe('simulated engine outage on insert(sys_file)');
  });

  it.each([
    ['updateFile', 'update' as const, 'sys_file'],
    ['deleteFile', 'delete' as const, 'sys_file'],
  ])('%s propagates a %s outage', async (_method, failing, objectName) => {
    const engine = createFakeEngine();
    const store = new StorageMetadataStore(engine);
    await store.createFile(fileRec('f1'));
    engine._setFailing(failing, true);

    const call =
      failing === 'update'
        ? store.updateFile('f1', { status: 'committed' })
        : store.deleteFile('f1');
    const err = await call.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(StorageMetadataStoreError);
    expect((err as StorageMetadataStoreError).objectName).toBe(objectName);
    expect((err as StorageMetadataStoreError).operation).toBe(failing);
  });

  it('createSession throws instead of stranding later chunks on another worker', async () => {
    const engine = createFakeEngine({ failing: ['insert'] });
    const store = new StorageMetadataStore(engine);

    const err = await store.createSession(sessionRec('s1')).catch((e: any) => e);
    expect(err).toBeInstanceOf(StorageMetadataStoreError);
    expect(err.objectName).toBe('sys_upload_session');
    expect(err.message).toContain('cannot find this upload');

    engine._setFailing('insert', false);
    expect(await store.getSession('s1')).toBeNull();
  });

  it.each([
    ['updateSession', 'update' as const],
    ['deleteSession', 'delete' as const],
  ])('%s propagates a %s outage', async (_method, failing) => {
    const engine = createFakeEngine();
    const store = new StorageMetadataStore(engine);
    await store.createSession(sessionRec('s1'));
    engine._setFailing(failing, true);

    const call =
      failing === 'update'
        ? store.updateSession('s1', { status: 'completed' })
        : store.deleteSession('s1');
    const err = await call.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(StorageMetadataStoreError);
    expect((err as StorageMetadataStoreError).objectName).toBe('sys_upload_session');
    expect((err as StorageMetadataStoreError).operation).toBe(failing);
  });

  it('a READ outage is loud — it never gets dressed up as "not found"', async () => {
    const engine = createFakeEngine();
    const store = new StorageMetadataStore(engine);
    await store.createFile(fileRec('f1'));
    await store.createSession(sessionRec('s1'));

    engine._setFailing('findOne', true);

    const fileErr = await store.getFile('f1').catch((e: any) => e);
    expect(fileErr).toBeInstanceOf(StorageMetadataStoreError);
    expect(fileErr.operation).toBe('findOne');
    expect(fileErr.message).toContain('NOT the same as it being absent');

    const sessionErr = await store.getSession('s1').catch((e: any) => e);
    expect(sessionErr).toBeInstanceOf(StorageMetadataStoreError);
    expect(sessionErr.objectName).toBe('sys_upload_session');
    expect(sessionErr.message).toContain('abort a live upload');
  });

  it('a read outage inside updateFile/updateSession propagates too', async () => {
    const engine = createFakeEngine({ failing: ['findOne'] });
    const store = new StorageMetadataStore(engine);

    await expect(store.updateFile('f1', { status: 'committed' })).rejects.toBeInstanceOf(
      StorageMetadataStoreError,
    );
    await expect(store.updateSession('s1', { status: 'completed' })).rejects.toBeInstanceOf(
      StorageMetadataStoreError,
    );
  });
});
