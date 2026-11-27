// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A build's fence (`knowledge-build.ts`, "A build that loses its lease stops;
 * a build that stalls is cancelled"):
 *
 * - a lease that lapses mid-walk stops the build before its next page: no
 *   further page is read or embedded, nothing is completed, the record says
 *   `lease-lost`, and the lease is released;
 * - a lease the lock store stops answering for (no renewal succeeds within
 *   the lease) reads as lost too;
 * - an embedding call that never answers is cancelled at the stall bound: the
 *   record says `timed-out`, the lease is released, and the source's walk
 *   chain is free for the next build;
 * - a build that keeps making progress (pages, or purge deletions) is never
 *   cut by the bound;
 * - the completion is not a page: once begun it is waited on past the bound,
 *   and the source's walk queue stays held until it settles;
 * - a hung purge removal keeps its document listed and its queue held, so
 *   later builds wait there until it answers.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdapterContext, IDataEngine, IKnowledgeAdapter } from '@objectstack/spec/contracts';
import type { KnowledgeDocument, KnowledgeSource } from '@objectstack/spec/ai';
import { KnowledgeService } from '../knowledge-service.js';
import {
  BUILD_LEASE_MS,
  BUILD_STALL_LIMIT_MS,
  startBuildFence,
  type KnowledgeBuildLock,
  type KnowledgeBuildLockHandle,
} from '../knowledge-build.js';

type Row = Record<string, unknown>;

/** `count` rows with zero-padded ids, so string order is id order. */
function rows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: `r${String(i + 1).padStart(4, '0')}`, title: `Row ${i + 1}`, body: `Body ${i + 1}` }));
}

/** A data-engine double: `find` honours equality, `$and` and `id: { $gt }`, orders by id and takes `limit`. */
function makeEngine(initial: Row[]) {
  const all = [...initial].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const matches = (row: Row, where: Record<string, unknown> | undefined): boolean => {
    if (!where) return true;
    return Object.entries(where).every(([key, value]) => {
      if (key === '$and') return (value as Array<Record<string, unknown>>).every((c) => matches(row, c));
      if (value !== null && typeof value === 'object') {
        const gt = (value as { $gt?: unknown }).$gt;
        if (gt === undefined) throw new Error(`engine double: condition on '${key}' is not implemented`);
        return String(row[key]) > String(gt);
      }
      return row[key] === value;
    });
  };
  const find = vi.fn(async (_object: string, query?: { where?: Record<string, unknown>; limit?: number }) => {
    const page = all.filter((r) => matches(r, query?.where));
    return (typeof query?.limit === 'number' ? page.slice(0, query.limit) : page).map((r) => ({ ...r }));
  });
  const count = vi.fn(async () => all.length);
  return { find, engine: { find, count } as unknown as IDataEngine };
}

/** An adapter that records every page it is handed and the build calls. */
function makeAdapter() {
  const pages: string[][] = [];
  const calls = { beginBuild: 0, completeBuild: 0 };
  const adapter: IKnowledgeAdapter = {
    id: 'memory',
    embedding: { model: 'model-a', dimensions: 3 },
    async upsert(batch: KnowledgeDocument[], _ctx: AdapterContext) {
      pages.push(batch.map((d) => d.id));
    },
    async delete() {},
    async search() {
      return [];
    },
    async beginBuild() {
      calls.beginBuild += 1;
    },
    async completeBuild() {
      calls.completeBuild += 1;
    },
  };
  return { adapter, pages, calls };
}

function source(): KnowledgeSource {
  return {
    name: 'kb',
    label: 'Knowledge base',
    adapter: 'memory',
    source: { kind: 'object', object: 'kb_article', content: ['title', 'body'] },
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/** A cluster lock whose one handle the test steers: `held` flips the lease, `renew` can be made to hang. */
function makeLock() {
  const state = { held: true, released: 0, renewals: 0, renew: async (): Promise<void> => {} };
  const handle: KnowledgeBuildLockHandle = {
    async release() {
      state.released += 1;
      state.held = false;
    },
    async renew() {
      state.renewals += 1;
      await state.renew();
    },
    isHeld: () => state.held,
  };
  const lock: KnowledgeBuildLock = { acquire: async () => handle };
  return { lock, state };
}

function makeService(engine: IDataEngine, adapter: IKnowledgeAdapter, lock?: KnowledgeBuildLock) {
  const logger = makeLogger();
  const service = new KnowledgeService({ dataEngine: engine, logger, ...(lock ? { resolveBuildLock: () => lock } : {}) });
  service.registerAdapter('memory', adapter);
  service.registerSource(source());
  return { service, logger };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('a build whose lease lapses mid-walk stops before its next page', () => {
  it('embeds no further page, completes nothing, records lease-lost and releases the lease', async () => {
    const db = makeEngine(rows(250)); // three pages of at most 100 rows
    const { adapter, pages, calls } = makeAdapter();
    const { lock, state } = makeLock();
    const upsert = adapter.upsert.bind(adapter);
    adapter.upsert = async (batch, ctx) => {
      await upsert(batch, ctx);
      // The lease lapses while the first page is written.
      state.held = false;
    };
    const { service, logger } = makeService(db.engine, adapter, lock);

    const record = await service.rebuildSource('kb', { trigger: 'operator' });

    expect(pages).toHaveLength(1);
    expect(db.find).toHaveBeenCalledTimes(1);
    expect(calls.completeBuild).toBe(0);
    expect(record).toMatchObject({ status: 'lease-lost', progress: { pages: 1, discovered: 100 }, result: { ok: false } });
    expect(record.message).toMatch(/stopped at page 2/);
    expect(record.message).toMatch(/lease was lost/);
    expect(state.released).toBe(1);
    expect(logger.warn.mock.calls.some((c) => String(c[0]).includes('did not finish'))).toBe(true);
  });

  it('a lease that lapses after the last page neither purges nor completes', async () => {
    const db = makeEngine(rows(50));
    const { adapter, calls } = makeAdapter();
    const { lock, state } = makeLock();
    db.find.mockImplementationOnce(async () => rows(50)).mockImplementationOnce(async () => {
      state.held = false;
      return [];
    });
    const { service } = makeService(db.engine, adapter, lock);

    const record = await service.rebuildSource('kb', { trigger: 'operator' });

    expect(calls.completeBuild).toBe(0);
    expect(record).toMatchObject({ status: 'lease-lost', result: { ok: false, purged: null } });
    expect(record.message).toMatch(/before its purge and completion/);
  });

  it('a lease lost during the purge completes nothing', async () => {
    const db = makeEngine(rows(50));
    const { adapter, calls } = makeAdapter();
    // The store holds one document whose row is gone: the purge removes it.
    adapter.listDocuments = async () => ({ documents: [{ documentId: 'kb:gone', docHash: 'h' }] });
    const { lock, state } = makeLock();
    const removed: string[][] = [];
    adapter.delete = async (ids) => {
      removed.push(ids);
      // The lease lapses while the purge deletes.
      state.held = false;
    };
    const { service } = makeService(db.engine, adapter, lock);

    const record = await service.rebuildSource('kb', { trigger: 'operator' });

    expect(removed).toEqual([['kb:gone']]);
    expect(calls.completeBuild).toBe(0);
    expect(record).toMatchObject({ status: 'lease-lost', result: { ok: false } });
    expect(record.message).toMatch(/stopped before its completion/);
    expect(state.released).toBe(1);
  });

  it('a lease no renewal kept alive within its term (a lock store that does not answer) reads as lost', async () => {
    vi.useFakeTimers();
    const db = makeEngine(rows(250));
    const { adapter, pages, calls } = makeAdapter();
    const { lock, state } = makeLock();
    // Every renewal hangs: neither a success nor a failure ever arrives, and the handle still says held.
    state.renew = () => new Promise<void>(() => {});
    const upsert = adapter.upsert.bind(adapter);
    let first = true;
    adapter.upsert = async (batch, ctx) => {
      await upsert(batch, ctx);
      if (first) {
        first = false;
        // The first page takes longer than the lease.
        await new Promise<void>((resolve) => setTimeout(resolve, BUILD_LEASE_MS + 1_000));
      }
    };
    const { service } = makeService(db.engine, adapter, lock);

    const pending = service.rebuildSource('kb', { trigger: 'operator' });
    await vi.advanceTimersByTimeAsync(BUILD_LEASE_MS + 2_000);
    const record = await pending;

    expect(state.held).toBe(false); // released
    expect(state.renewals).toBeGreaterThanOrEqual(1);
    expect(pages).toHaveLength(1);
    expect(calls.completeBuild).toBe(0);
    expect(record.status).toBe('lease-lost');
    expect(record.message).toMatch(/not renewed within its 60 s/);
  });
});

describe('a build that stalls is cancelled at the bound', () => {
  it('a never-answering embed call: timed-out, lease released, nothing completed, the next build runs', async () => {
    vi.useFakeTimers();
    const db = makeEngine(rows(250));
    const { adapter, pages, calls } = makeAdapter();
    const { lock, state } = makeLock();
    const upsert = adapter.upsert.bind(adapter);
    let hang = true;
    adapter.upsert = async (batch, ctx) => {
      // The second page's embedding call never answers.
      if (pages.length === 1 && hang) return new Promise<void>(() => {});
      await upsert(batch, ctx);
    };
    const { service, logger } = makeService(db.engine, adapter, lock);

    const pending = service.rebuildSource('kb', { trigger: 'operator' });
    await vi.advanceTimersByTimeAsync(BUILD_STALL_LIMIT_MS - 1_000);
    expect(service.buildRecord('kb')?.status).toBe('running');
    expect(state.released).toBe(0);

    await vi.advanceTimersByTimeAsync(2_000);
    const record = await pending;

    expect(record).toMatchObject({ status: 'timed-out', progress: { pages: 1, discovered: 100 } });
    expect(record.message).toMatch(/no page finished for 15 minute\(s\)/);
    expect(record.finishedAt).toBeDefined();
    expect(state.released).toBe(1);
    expect(calls.completeBuild).toBe(0);
    expect(pages).toHaveLength(1);
    expect(logger.warn.mock.calls.some((c) => String(c[0]).includes('was cancelled'))).toBe(true);

    // The walk stopped waiting on the hung call, so the source's chain is
    // free: the next build runs at once and completes.
    hang = false;
    state.held = true;
    const next = await service.rebuildSource('kb', { trigger: 'operator' });
    expect(next.status).toBe('done');
    expect(calls.completeBuild).toBe(1);
  });

  it('a build that finishes a page within each bound is never cancelled, however long it runs', async () => {
    vi.useFakeTimers();
    const db = makeEngine(rows(350)); // four pages
    const { adapter, calls } = makeAdapter();
    const { lock } = makeLock();
    const upsert = adapter.upsert.bind(adapter);
    adapter.upsert = async (batch, ctx) => {
      // Each page takes most of the bound; the four together take far longer than it.
      await new Promise<void>((resolve) => setTimeout(resolve, BUILD_STALL_LIMIT_MS - 60_000));
      await upsert(batch, ctx);
    };
    const { service } = makeService(db.engine, adapter, lock);

    const pending = service.rebuildSource('kb', { trigger: 'operator' });
    await vi.advanceTimersByTimeAsync(4 * BUILD_STALL_LIMIT_MS);
    const record = await pending;

    expect(record.status).toBe('done');
    expect(calls.completeBuild).toBe(1);
  });

  it('the completion is not a page: a slow switch outlives the bound, the build waits for it, and no build begins beside it', async () => {
    vi.useFakeTimers();
    const db = makeEngine(rows(10));
    const { adapter, calls } = makeAdapter();
    const complete = adapter.completeBuild!.bind(adapter);
    let answer: () => void = () => {};
    let first = true;
    adapter.completeBuild = (ctx) => {
      if (!first) return complete(ctx);
      first = false;
      // The first completion (a switch and its sweep) answers only when the test says so.
      return new Promise<void>((resolve) => {
        answer = () => void complete(ctx).then(resolve);
      });
    };
    const { lock, state } = makeLock();
    const { service } = makeService(db.engine, adapter, lock);

    const pending = service.rebuildSource('kb', { trigger: 'operator' });
    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(2 * BUILD_STALL_LIMIT_MS);

    // Well past the bound, the build still waits on its completion: not
    // cancelled, the lease kept, and its record running.
    expect(settled).toBe(false);
    expect(service.buildRecord('kb')?.status).toBe('running');
    expect(state.released).toBe(0);
    expect(calls.beginBuild).toBe(1);

    // A rebuild asked on this node meanwhile is the same build, not a second one.
    expect((await service.rebuildSource('kb', { trigger: 'operator' })).status).toBe('running');
    // A complete walk asked meanwhile waits behind the completion: its
    // beginBuild (where a store takes its builder lock) does not run beside it.
    const queued = service.reindexSource('kb');
    await vi.advanceTimersByTimeAsync(BUILD_STALL_LIMIT_MS);
    expect(calls.beginBuild).toBe(1);

    answer();
    const record = await pending;
    expect(record.status).toBe('done');
    expect(calls.completeBuild).toBe(1);
    expect(state.released).toBe(1);

    // Only now does the queued walk begin its build, after the first one's
    // completion settled: nothing of it can clear what the next build holds.
    expect((await queued).ok).toBe(true);
    expect(calls.beginBuild).toBe(2);
    expect(calls.completeBuild).toBe(2);
  });

  it('a purge that keeps deleting is never cut by the bound, however long it runs', async () => {
    vi.useFakeTimers();
    const db = makeEngine(rows(10));
    const { adapter, calls } = makeAdapter();
    // Three stored documents whose rows are gone: three purge deletions.
    const stored = new Set(['kb:gone1', 'kb:gone2', 'kb:gone3']);
    adapter.listDocuments = async () => ({ documents: [...stored].map((documentId) => ({ documentId, docHash: 'h' })) });
    adapter.delete = async (ids) => {
      // Each deletion takes most of the bound; the three together take far longer than it.
      await new Promise<void>((resolve) => setTimeout(resolve, BUILD_STALL_LIMIT_MS - 60_000));
      for (const id of ids) stored.delete(id);
    };
    const { lock } = makeLock();
    const { service } = makeService(db.engine, adapter, lock);

    const pending = service.rebuildSource('kb', { trigger: 'operator' });
    await vi.advanceTimersByTimeAsync(4 * BUILD_STALL_LIMIT_MS);
    const record = await pending;

    expect(record).toMatchObject({ status: 'done', result: { ok: true, purged: 3 } });
    expect(stored.size).toBe(0);
    expect(calls.completeBuild).toBe(1);
  });

  it('a hung listing is cancelled at the bound, completes nothing, and frees the source', async () => {
    vi.useFakeTimers();
    const db = makeEngine(rows(10));
    const { adapter, calls } = makeAdapter();
    let hang = true;
    adapter.listDocuments = async () => {
      if (hang) return new Promise<never>(() => {});
      return { documents: [] };
    };
    const { lock, state } = makeLock();
    const { service } = makeService(db.engine, adapter, lock);

    const pending = service.rebuildSource('kb', { trigger: 'operator' });
    await vi.advanceTimersByTimeAsync(BUILD_STALL_LIMIT_MS + 1_000);
    expect((await pending).status).toBe('timed-out');
    expect(state.released).toBe(1);
    expect(calls.completeBuild).toBe(0);

    hang = false;
    state.held = true;
    expect((await service.rebuildSource('kb', { trigger: 'operator' })).status).toBe('done');
    expect(calls.completeBuild).toBe(1);
  });

  it('a hung purge removal keeps that document listed and its queue held: each later build waits there and is cancelled, until the removal answers', async () => {
    vi.useFakeTimers();
    const db = makeEngine(rows(10));
    const { adapter, calls } = makeAdapter();
    // One stored document whose row is gone; the store lists it until a removal lands.
    const stored = new Set(['kb:gone']);
    adapter.listDocuments = async () => ({ documents: [...stored].map((documentId) => ({ documentId, docHash: 'h' })) });
    const removals: string[][] = [];
    let answer: () => void = () => {};
    adapter.delete = (ids) => {
      removals.push(ids);
      if (removals.length > 1) {
        for (const id of ids) stored.delete(id);
        return Promise.resolve();
      }
      // The first removal answers only when the test says so.
      return new Promise<void>((resolve) => {
        answer = () => {
          for (const id of ids) stored.delete(id);
          resolve();
        };
      });
    };
    const { lock, state } = makeLock();
    const { service } = makeService(db.engine, adapter, lock);

    const first = service.rebuildSource('kb', { trigger: 'operator' });
    await vi.advanceTimersByTimeAsync(BUILD_STALL_LIMIT_MS + 1_000);
    expect((await first).status).toBe('timed-out');
    expect(state.released).toBe(1);
    expect(calls.completeBuild).toBe(0);

    // The store still lists the document, so the next build reaches it in its
    // purge, queues behind the hung removal, and is cancelled in its turn.
    state.held = true;
    const second = service.rebuildSource('kb', { trigger: 'operator' });
    await vi.advanceTimersByTimeAsync(BUILD_STALL_LIMIT_MS + 1_000);
    const secondRecord = await second;
    expect(secondRecord.status).toBe('timed-out');
    expect(secondRecord.message).toMatch(/no page finished/);
    expect(removals).toHaveLength(1);
    expect(stored.has('kb:gone')).toBe(true);
    expect(calls.completeBuild).toBe(0);

    // Once the hung removal answers, the document is gone and the next build completes.
    answer();
    await vi.advanceTimersByTimeAsync(0);
    expect(stored.has('kb:gone')).toBe(false);
    state.held = true;
    const third = await service.rebuildSource('kb', { trigger: 'operator' });
    expect(third.status).toBe('done');
    expect(calls.completeBuild).toBe(1);
  });

  it('a build queued behind a walk that never ends (a plain reindex, with no fence) is cancelled at the bound', async () => {
    vi.useFakeTimers();
    const db = makeEngine(rows(10));
    const { adapter, calls } = makeAdapter();
    // The first upsert never answers: a plain reindexSource (no build, no fence) holds the source's walk queue for good.
    let hang = true;
    const upsert = adapter.upsert.bind(adapter);
    adapter.upsert = (batch, ctx) => (hang ? new Promise<void>(() => {}) : upsert(batch, ctx));
    const { lock, state } = makeLock();
    const { service } = makeService(db.engine, adapter, lock);

    void service.reindexSource('kb', { limit: 5 });
    await vi.advanceTimersByTimeAsync(0);
    hang = false;
    const pending = service.rebuildSource('kb', { trigger: 'operator' });
    await vi.advanceTimersByTimeAsync(BUILD_STALL_LIMIT_MS + 1_000);
    const record = await pending;

    expect(record.status).toBe('timed-out');
    expect(state.released).toBe(1);
    expect(calls.beginBuild).toBe(0);
    expect(calls.completeBuild).toBe(0);
  });

  it('applies with no cluster service too (one node): the bound needs no lock', async () => {
    vi.useFakeTimers();
    const db = makeEngine(rows(10));
    const { adapter } = makeAdapter();
    adapter.upsert = () => new Promise<void>(() => {});
    const { service } = makeService(db.engine, adapter);

    const pending = service.rebuildSource('kb', { trigger: 'operator' });
    await vi.advanceTimersByTimeAsync(BUILD_STALL_LIMIT_MS + 1_000);
    expect((await pending).status).toBe('timed-out');
  });
});

describe('the fence is asked before beginBuild and before each purge deletion', () => {
  /**
   * An adapter whose first upsert answers only when the test says so: a plain
   * `reindexSource` (no build, no fence) holds the source's walk queue until then.
   */
  function holdFirstUpsert(adapter: IKnowledgeAdapter) {
    const upsert = adapter.upsert.bind(adapter);
    let answer: () => void = () => {};
    let first = true;
    adapter.upsert = (batch, ctx) => {
      if (!first) return upsert(batch, ctx);
      first = false;
      return new Promise<void>((resolve) => {
        answer = () => void upsert(batch, ctx).then(resolve);
      });
    };
    return { answer: () => answer() };
  }

  it('a build cancelled while queued behind another walk never begins its build once that walk ends', async () => {
    vi.useFakeTimers();
    const db = makeEngine(rows(10));
    const { adapter, pages, calls } = makeAdapter();
    const held = holdFirstUpsert(adapter);
    const { lock, state } = makeLock();
    const { service } = makeService(db.engine, adapter, lock);

    const plain = service.reindexSource('kb', { limit: 5 });
    await vi.advanceTimersByTimeAsync(0);
    const pending = service.rebuildSource('kb', { trigger: 'operator' });
    await vi.advanceTimersByTimeAsync(BUILD_STALL_LIMIT_MS + 1_000);
    const record = await pending;
    expect(record.status).toBe('timed-out');
    expect(state.released).toBe(1);

    // The earlier walk ends; the cancelled build's walk, queued behind it, runs
    // now. A walk queued behind THAT one returns only once it has finished.
    held.answer();
    expect((await plain).ok).toBe(true);
    expect((await service.reindexSource('kb', { limit: 1 })).ok).toBe(true);

    expect(calls.beginBuild).toBe(0);
    expect(calls.completeBuild).toBe(0);
    expect(pages).toHaveLength(2); // the two plain walks' pages, none of the build's
    expect(service.buildRecord('kb')?.status).toBe('timed-out');
  });

  it('a build whose lease is lost while queued never begins its build, and ends lease-lost', async () => {
    vi.useFakeTimers();
    const db = makeEngine(rows(10));
    const { adapter, pages, calls } = makeAdapter();
    const held = holdFirstUpsert(adapter);
    const { lock, state } = makeLock();
    const { service } = makeService(db.engine, adapter, lock);

    const plain = service.reindexSource('kb', { limit: 5 });
    await vi.advanceTimersByTimeAsync(0);
    const pending = service.rebuildSource('kb', { trigger: 'operator' });
    await vi.advanceTimersByTimeAsync(0);
    // The lease lapses while the build waits its turn.
    state.held = false;
    held.answer();
    expect((await plain).ok).toBe(true);
    const record = await pending;

    expect(calls.beginBuild).toBe(0);
    expect(calls.completeBuild).toBe(0);
    expect(pages).toHaveLength(1); // the plain walk's page only
    expect(record).toMatchObject({ status: 'lease-lost', progress: { pages: 0, discovered: 0 }, result: { ok: false, purged: null } });
    expect(record.message).toMatch(/stopped before its build began/);
    expect(record.message).toMatch(/lease was lost/);
    expect(state.released).toBe(1);
  });

  it('a lease lost mid-purge stops before the next deletion and completes nothing', async () => {
    const db = makeEngine(rows(10));
    const { adapter, calls } = makeAdapter();
    // Three stored documents whose rows are gone: three purge candidates.
    const stored = new Set(['kb:gone1', 'kb:gone2', 'kb:gone3']);
    adapter.listDocuments = async () => ({ documents: [...stored].map((documentId) => ({ documentId, docHash: 'h' })) });
    const { lock, state } = makeLock();
    const removed: string[][] = [];
    adapter.delete = async (ids) => {
      removed.push(ids);
      for (const id of ids) stored.delete(id);
      // The lease lapses while the first deletion lands.
      state.held = false;
    };
    const { service } = makeService(db.engine, adapter, lock);

    const record = await service.rebuildSource('kb', { trigger: 'operator' });

    expect(removed).toEqual([['kb:gone1']]);
    expect([...stored]).toEqual(['kb:gone2', 'kb:gone3']);
    expect(calls.completeBuild).toBe(0);
    expect(record).toMatchObject({ status: 'lease-lost', result: { ok: false, purged: 1 } });
    expect(record.message).toMatch(/stopped during its purge after 1 deletion/);
    expect(record.message).toMatch(/lease was lost/);
    expect(state.released).toBe(1);
  });

  it('a build cancelled mid-purge deletes nothing further once the deletion it stopped waiting on answers', async () => {
    vi.useFakeTimers();
    const db = makeEngine(rows(10));
    const { adapter, calls } = makeAdapter();
    const stored = new Set(['kb:gone1', 'kb:gone2', 'kb:gone3']);
    adapter.listDocuments = async () => ({ documents: [...stored].map((documentId) => ({ documentId, docHash: 'h' })) });
    const removals: string[][] = [];
    let answer: () => void = () => {};
    adapter.delete = (ids) => {
      removals.push(ids);
      const remove = () => { for (const id of ids) stored.delete(id); };
      if (removals.length > 1) {
        remove();
        return Promise.resolve();
      }
      // The first deletion answers only when the test says so.
      return new Promise<void>((resolve) => {
        answer = () => {
          remove();
          resolve();
        };
      });
    };
    const { lock, state } = makeLock();
    const { service } = makeService(db.engine, adapter, lock);

    const pending = service.rebuildSource('kb', { trigger: 'operator' });
    await vi.advanceTimersByTimeAsync(BUILD_STALL_LIMIT_MS + 1_000);
    expect((await pending).status).toBe('timed-out');
    expect(state.released).toBe(1);

    // The hung deletion answers. The walk stopped waiting on its purge at the
    // cancel, so the purge goes on unobserved: let it run to its end.
    answer();
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0);
    expect((await service.reindexSource('kb', { limit: 1 })).ok).toBe(true);

    expect(removals).toEqual([['kb:gone1']]);
    expect([...stored]).toEqual(['kb:gone2', 'kb:gone3']);
    expect(calls.completeBuild).toBe(0);
  });
});

describe('startBuildFence', () => {
  it('keeps the first stop it saw, and close() disarms the bound', async () => {
    vi.useFakeTimers();
    let held = true;
    const fence = startBuildFence({ handle: { release: async () => {}, isHeld: () => held }, leaseMs: 1_000, stallMs: 5_000 });
    expect(fence.stop()).toBeUndefined();
    held = false;
    expect(fence.stop()?.reason).toBe('lease-lost');
    held = true;
    expect(fence.stop()?.reason).toBe('lease-lost');
    fence.close();

    const quiet = startBuildFence({ leaseMs: 1_000, stallMs: 5_000 });
    quiet.close();
    let settled = false;
    void quiet.cancelled.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(settled).toBe(false);
    expect(quiet.stop()).toBeUndefined();
  });

  it('completing() disarms the bound for good: cancelled never settles after it, and progressed() does not re-arm it', async () => {
    vi.useFakeTimers();
    const fence = startBuildFence({ leaseMs: 1_000, stallMs: 5_000 });
    let settled = false;
    void fence.cancelled.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(4_000);
    fence.completing();
    fence.progressed();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(settled).toBe(false);
    expect(fence.stop()).toBeUndefined();
    fence.close();
  });
});
