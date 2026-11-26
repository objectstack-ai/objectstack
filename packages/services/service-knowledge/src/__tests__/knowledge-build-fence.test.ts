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
 * - a build that keeps making progress is never cut by the bound.
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
    id: 'kb',
    label: 'Knowledge base',
    adapter: 'memory',
    source: { kind: 'object', object: 'kb_article', contentFields: ['title', 'body'] },
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

  it('a call outside the page loop that never answers (here completeBuild) is cancelled, and frees the source for the next build', async () => {
    vi.useFakeTimers();
    const db = makeEngine(rows(10));
    const { adapter, calls } = makeAdapter();
    const complete = adapter.completeBuild!.bind(adapter);
    let hang = true;
    adapter.completeBuild = (ctx) => (hang ? new Promise<void>(() => {}) : complete(ctx));
    const { lock, state } = makeLock();
    const { service } = makeService(db.engine, adapter, lock);

    const pending = service.rebuildSource('kb', { trigger: 'operator' });
    await vi.advanceTimersByTimeAsync(BUILD_STALL_LIMIT_MS + 1_000);
    expect((await pending).status).toBe('timed-out');
    expect(state.released).toBe(1);

    // The walk stopped waiting on the hung completion, so the next build is not queued behind it.
    hang = false;
    state.held = true;
    const next = await service.rebuildSource('kb', { trigger: 'operator' });
    expect(next.status).toBe('done');
    expect(calls.completeBuild).toBe(1);
  });

  it('a hung listing or a hung purge is cancelled at the bound, completes nothing, and frees the source', async () => {
    for (const where of ['listing', 'purge'] as const) {
      vi.useFakeTimers();
      const db = makeEngine(rows(10));
      const { adapter, calls } = makeAdapter();
      let hang = true;
      adapter.listDocuments = async () => {
        if (hang && where === 'listing') return new Promise<never>(() => {});
        return { documents: [{ documentId: 'kb:gone', docHash: 'h' }] };
      };
      adapter.delete = async () => {
        if (hang && where === 'purge') return new Promise<void>(() => {});
      };
      const { lock, state } = makeLock();
      const { service } = makeService(db.engine, adapter, lock);

      const pending = service.rebuildSource('kb', { trigger: 'operator' });
      await vi.advanceTimersByTimeAsync(BUILD_STALL_LIMIT_MS + 1_000);
      expect((await pending).status, where).toBe('timed-out');
      expect(state.released, where).toBe(1);
      expect(calls.completeBuild, where).toBe(0);

      hang = false;
      state.held = true;
      // The hung removal still holds that one document's own sync chain (a
      // per-document chain, not the source's walk chain), so the next build
      // is run against a store that no longer lists it.
      if (where === 'purge') adapter.listDocuments = async () => ({ documents: [] });
      expect((await service.rebuildSource('kb', { trigger: 'operator' })).status, where).toBe('done');
      expect(calls.completeBuild, where).toBe(1);
      vi.useRealTimers();
    }
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
});
