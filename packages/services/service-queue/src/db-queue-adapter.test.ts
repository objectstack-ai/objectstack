// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ENGINE_DELETE_DISPATCH_CASES,
  ENGINE_DELETE_REJECT_MESSAGE,
  assertEngineDeleteDispatch,
} from '@objectstack/objectql';
import { DbQueueAdapter } from './db-queue-adapter.js';

/**
 * In-memory engine that mimics objectql's `where:`-based find and
 * `(table, {id, ...patch})` update signature.
 */
function makeFakeEngine() {
  const tables = new Map<string, any[]>();
  function row(table: string, id: string) {
    const t = tables.get(table) ?? [];
    return t.find((r) => r.id === id);
  }
  function matches(row: any, where: Record<string, any>): boolean {
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (row[k] !== v) return false;
    }
    return true;
  }
  return {
    tables,
    async find(table: string, opts: any = {}) {
      const t = tables.get(table) ?? [];
      let out = opts.where ? t.filter((r) => matches(r, opts.where)) : [...t];
      if (opts.orderBy) {
        for (const ord of [...opts.orderBy].reverse()) {
          // Canonical SortNode key only (spec/data/query.zod.ts): the real
          // engine strips an unknown `direction:` key and defaults to asc,
          // so the mock must too — honoring both keys masks wrong-key sorts.
          out.sort((a, b) => {
            const av = a[ord.field], bv = b[ord.field];
            if (av === bv) return 0;
            const cmp = av > bv ? 1 : -1;
            return ord.order === 'desc' ? -cmp : cmp;
          });
        }
      }
      if (opts.offset) out = out.slice(opts.offset);
      if (opts.limit) out = out.slice(0, opts.limit);
      return out;
    },
    async insert(table: string, data: any) {
      const t = tables.get(table) ?? [];
      t.push({ ...data });
      tables.set(table, t);
      return { id: data.id };
    },
    async update(table: string, patch: any) {
      const r = row(table, patch.id);
      if (!r) throw new Error(`row ${patch.id} not found in ${table}`);
      Object.assign(r, patch);
      return r;
    },
    async delete(table: string, opts: any) {
      // [#4550/#5198] Opened with ObjectQL.delete's OWN dispatch predicate.
      // What stood here was a hand-mirrored `if (opts?.where?.id == null)` —
      // written for #4371 to stop the mock accepting the top-level `{ id }`
      // bags the real engine rejects, and correct about that. But a mirror is a
      // second copy of the contract, and it was looser than the producer in
      // both directions: `where: { id: { $in: [...] } }` only LOOKS like an id
      // (a multi-row predicate the engine refuses without `multi`) and the
      // mirror waved it through, while `{ multi: true }` with no `where` is a
      // shape the engine ACCEPTS and the mirror threw on. A double that imports
      // the decision cannot drift from it; the same predicate already opens the
      // sibling `job-queue-retention.test.ts` fake in this package.
      const dispatch = assertEngineDeleteDispatch(opts);
      const t = tables.get(table) ?? [];
      if (dispatch.kind === 'multi') {
        const keep = t.filter((r) => !matches(r, opts?.where ?? {}));
        tables.set(table, keep);
        return t.length - keep.length; // drivers report a deleted count
      }
      tables.set(table, t.filter((r) => r.id !== dispatch.id));
      return { id: dispatch.id };
    },
  };
}

describe('DbQueueAdapter', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let adapter: DbQueueAdapter;

  beforeEach(() => {
    engine = makeFakeEngine();
    adapter = new DbQueueAdapter({
      engine,
      options: { pollIntervalMs: 60_000, autoStart: false, defaultMaxAttempts: 3 },
    });
  });

  it('publishes message persisted with status=pending', async () => {
    const id = await adapter.publish('email.retry', { to: 'a@b.c' });
    const rows = engine.tables.get('sys_job_queue') ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].queue).toBe('email.retry');
    expect(JSON.parse(rows[0].payload_json)).toEqual({ to: 'a@b.c' });
  });

  it('dedups by idempotencyKey within window', async () => {
    const a = await adapter.publish('q', { x: 1 }, { idempotencyKey: 'k1' });
    const b = await adapter.publish('q', { x: 2 }, { idempotencyKey: 'k1' });
    expect(b).toBe(a);
    const rows = engine.tables.get('sys_job_queue') ?? [];
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].payload_json)).toEqual({ x: 1 });
  });

  it('processes pending messages via subscribed handler', async () => {
    const received: any[] = [];
    await adapter.subscribe('jobs', async (msg) => { received.push(msg.data); });
    await adapter.publish('jobs', { hello: 'world' });

    const n = await adapter.pollOnce();
    expect(n).toBe(1);
    expect(received).toEqual([{ hello: 'world' }]);
    const row = (engine.tables.get('sys_job_queue') ?? [])[0];
    expect(row.status).toBe('completed');
    expect(row.attempts).toBe(1);
  });

  it('retries with backoff on handler failure', async () => {
    let calls = 0;
    await adapter.subscribe('flaky', async () => {
      calls++;
      if (calls < 2) throw new Error('first attempt fails');
    });
    await adapter.publish('flaky', {}, { maxAttempts: 3, backoff: { type: 'fixed', delayMs: 1 } });

    await adapter.pollOnce();
    const row1 = (engine.tables.get('sys_job_queue') ?? [])[0];
    expect(row1.status).toBe('pending');
    expect(row1.attempts).toBe(1);
    expect(row1.last_error).toContain('first attempt fails');

    // Wait past backoff
    await new Promise((r) => setTimeout(r, 10));
    await adapter.pollOnce();
    const row2 = (engine.tables.get('sys_job_queue') ?? [])[0];
    expect(row2.status).toBe('completed');
    expect(row2.attempts).toBe(2);
    expect(calls).toBe(2);
  });

  it('moves to dlq after maxAttempts exhausted', async () => {
    await adapter.subscribe('always-fail', async () => { throw new Error('boom'); });
    await adapter.publish('always-fail', {}, {
      maxAttempts: 2,
      backoff: { type: 'fixed', delayMs: 1 },
    });

    await adapter.pollOnce();
    expect((engine.tables.get('sys_job_queue') ?? [])[0].status).toBe('pending');

    await new Promise((r) => setTimeout(r, 5));
    await adapter.pollOnce();
    const final = (engine.tables.get('sys_job_queue') ?? [])[0];
    expect(final.status).toBe('dlq');
    expect(final.attempts).toBe(2);
    expect(final.last_error).toContain('boom');
  });

  it('respects scheduled_for delay', async () => {
    await adapter.subscribe('later', async () => {});
    await adapter.publish('later', {}, { delay: 10_000 });

    const n = await adapter.pollOnce();
    expect(n).toBe(0);
    expect((engine.tables.get('sys_job_queue') ?? [])[0].status).toBe('pending');
  });

  it('listFailed returns only dlq rows', async () => {
    await adapter.subscribe('dlq-q', async () => { throw new Error('x'); });
    await adapter.publish('dlq-q', { a: 1 }, { maxAttempts: 1 });
    await adapter.pollOnce();

    const failed = await adapter.listFailed('dlq-q');
    expect(failed).toHaveLength(1);
    expect(failed[0].status).toBe('dlq');
    expect(failed[0].data).toEqual({ a: 1 });
    expect(failed[0].lastError).toContain('x');
  });

  it('listFailed returns the newest message first', async () => {
    // Regression: the query sorted with the non-canonical `direction: 'desc'`
    // key, which SortNode strips — so it sorted ascending (oldest first).
    engine.tables.set('sys_job_queue', [
      { id: 'm_old', queue: 'q', status: 'dlq', payload_json: '{}', created_at: '2026-01-01T00:00:00Z' },
      { id: 'm_new', queue: 'q', status: 'dlq', payload_json: '{}', created_at: '2026-02-01T00:00:00Z' },
    ]);
    const failed = await adapter.listFailed('q');
    expect(failed.map((f) => f.id)).toEqual(['m_new', 'm_old']);
  });

  it('replay resets dlq message back to pending and re-processes', async () => {
    let attempts = 0;
    await adapter.subscribe('replay-q', async () => {
      attempts++;
      if (attempts < 3) throw new Error('still failing');
    });
    await adapter.publish('replay-q', { v: 1 }, { maxAttempts: 1 });
    await adapter.pollOnce();
    const id = (engine.tables.get('sys_job_queue') ?? [])[0].id;
    expect((engine.tables.get('sys_job_queue') ?? [])[0].status).toBe('dlq');

    await adapter.replay(id);
    expect((engine.tables.get('sys_job_queue') ?? [])[0].status).toBe('pending');
    expect((engine.tables.get('sys_job_queue') ?? [])[0].attempts).toBe(0);

    await adapter.pollOnce(); // attempts++ → still failing, back to dlq (maxAttempts=1)
    await adapter.replay(id);
    await adapter.pollOnce(); // success on third call
    expect((engine.tables.get('sys_job_queue') ?? [])[0].status).toBe('completed');
    expect(attempts).toBe(3);
  });

  it('purgeFailed deletes dlq row', async () => {
    await adapter.subscribe('purge-q', async () => { throw new Error(); });
    await adapter.publish('purge-q', {}, { maxAttempts: 1 });
    await adapter.pollOnce();
    const id = (engine.tables.get('sys_job_queue') ?? [])[0].id;

    await adapter.purgeFailed(id);
    expect(engine.tables.get('sys_job_queue')).toEqual([]);
  });

  it('replay rejects non-dlq messages', async () => {
    await adapter.publish('q', {});
    const id = (engine.tables.get('sys_job_queue') ?? [])[0].id;
    await expect(adapter.replay(id)).rejects.toThrow(/INVALID_STATE/);
  });

  it('getQueueSize counts pending only', async () => {
    await adapter.subscribe('mix', async () => {});
    await adapter.publish('mix', { x: 1 });
    await adapter.publish('mix', { x: 2 });
    await adapter.publish('mix', { x: 3 });
    expect(await adapter.getQueueSize('mix')).toBe(3);
    await adapter.pollOnce();
    expect(await adapter.getQueueSize('mix')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The double itself, measured against the producer (#4550 / #5198)
// ---------------------------------------------------------------------------
//
// Every assertion above is only worth what this fake's fidelity is worth: a
// double that accepts a call the real engine refuses turns a green suite into
// no suite at all, on exactly the path the double was introduced for (#4434).
// So the fake is driven against ObjectQL.delete's OWN published case-set here,
// rather than trusted because its `delete` now names the right function.
//
// This is what the deleted `scripts/engine-double-contract.baseline.json` DEBT
// entry bought, and why the entry could go: the gate proves the predicate is
// CALLED, and these two tests prove the call is answered — the by-id and multi
// branches route by verdict, and every shape the engine rejects the fake
// rejects, with the producer's own message.

describe('makeFakeEngine().delete conforms to ObjectQL.delete (#4550)', () => {
  it.each(ENGINE_DELETE_DISPATCH_CASES.map((c) => [c.what, c] as const))(
    'agrees with the engine on %s',
    async (_what, c) => {
      const engine = makeFakeEngine();
      engine.tables.set('sys_job_queue', [{ id: 'rec_1', rule_id: 'r1' }]);
      const call = engine.delete('sys_job_queue', c.options as any);
      if (c.expect === 'reject') {
        // Not merely "throws": the same message a real server answers with, so
        // the fake's rejection surface cannot drift from the producer's.
        await expect(call).rejects.toThrow(ENGINE_DELETE_REJECT_MESSAGE);
        // …and a refused call must not have deleted anything on its way out.
        expect(engine.tables.get('sys_job_queue')).toHaveLength(1);
        return;
      }
      await expect(call).resolves.toBeDefined();
    },
  );

  it('routes by the verdict, not by guessing at `where`', async () => {
    const engine = makeFakeEngine();
    const rows = () => engine.tables.get('sys_job_queue') ?? [];

    // by-id: the scalar id is the ONLY row removed, siblings survive.
    engine.tables.set('sys_job_queue', [{ id: 'a' }, { id: 'b' }]);
    expect(await engine.delete('sys_job_queue', { where: { id: 'a' } })).toEqual({ id: 'a' });
    expect(rows().map((r: any) => r.id)).toEqual(['b']);

    // multi: the predicate matches many, and the fake reports the count a
    // driver's `deleteMany` reports.
    engine.tables.set('sys_job_queue', [
      { id: 'a', status: 'completed' },
      { id: 'b', status: 'completed' },
      { id: 'c', status: 'pending' },
    ]);
    expect(
      await engine.delete('sys_job_queue', { where: { status: 'completed' }, multi: true }),
    ).toBe(2);
    expect(rows().map((r: any) => r.id)).toEqual(['c']);

    // `where: { id: { $in: […] } }` only LOOKS like an id: it is a multi-row
    // predicate, so without `multi` the engine rejects it — the exact case a
    // hand-mirrored `if (opts?.where?.id == null)` waves through, and the reason
    // the mirror had to go rather than be corrected in place. (This fake's
    // `matches` is equality-only by design — no fixture here sends an operator
    // predicate — so what is pinned is the dispatch verdict, not `$in` matching.)
    engine.tables.set('sys_job_queue', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    await expect(
      engine.delete('sys_job_queue', { where: { id: { $in: ['a', 'b'] } } }),
    ).rejects.toThrow(ENGINE_DELETE_REJECT_MESSAGE);
    expect(rows()).toHaveLength(3);

    // The property the removed mirror was ORIGINALLY written for (#4371): a
    // top-level `{ id }` bag is not an address — the id lives at `where.id`.
    // It is not one of ENGINE_DELETE_DISPATCH_CASES, so it is asserted here
    // rather than left to lapse with the code that used to carry it.
    await expect(
      engine.delete('sys_job_queue', { id: 'a' } as any),
    ).rejects.toThrow(ENGINE_DELETE_REJECT_MESSAGE);
    expect(rows()).toHaveLength(3);
  });
});
