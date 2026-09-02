// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14099] A `multi: true` update whose per-row `beforeUpdate` dispatches
 * assigned DIFFERENT sets of payload keys is refused whole, before any write.
 *
 * The defect these pins retire was measured downstream against published
 * 17.2.0: two `duly_task` rows — one open, one completed earlier — updated in
 * one `multi: true` call with a `completed_at` transition stamp bound to
 * `beforeUpdate`. The already-completed row's `completed_at` MOVED, from
 * `…:26.560Z` to `…:26.571Z`, without transitioning and without an error. The
 * corrupted row is byte-for-byte indistinguishable from one genuinely completed
 * late, which is what turns a compliant record into a breach in every on-time
 * measure reading the column.
 *
 * Maintainer ruling, 2026-09-02 (recommendation C): keep D3 — the payload stays
 * batch-scoped and the engine never splits its own write — and ENFORCE it, by
 * recording each row's assigned key set and refusing the batch when two rows
 * disagree. ⛔ The criterion is the key SET and never the values; the three
 * pins the ruling named are §1, §2 and §3 below, and §3 is the regression guard
 * for the whole platform (if the audit-stamp-only batch ever moves, the refusal
 * is over-firing on a hook registered in essentially every deployment).
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import { bindHooksToEngine } from './hook-binder.js';
import {
  MultiUpdateHookKeyDivergenceError,
  MULTI_UPDATE_HOOK_KEY_DIVERGENCE_CODE,
  MULTI_UPDATE_HOOK_KEY_DIVERGENCE_STATUS,
  divergingHookPayloadKeys,
} from './multi-update-hook-key-divergence.js';
import type { Hook, HookContext } from '@objectstack/spec/data';

const TASK_FIELDS = {
  id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
  title: { name: 'title', label: 'Title', type: 'text' as const },
  status: { name: 'status', label: 'Status', type: 'text' as const },
  completed_at: { name: 'completed_at', label: 'Completed at', type: 'text' as const },
  priority: { name: 'priority', label: 'Priority', type: 'text' as const },
  updated_at: { name: 'updated_at', label: 'Updated at', type: 'text' as const },
};
const taskObject = { name: 'task', label: 'Task', fields: TASK_FIELDS };
const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** The hook the card measured, and the shape the docs and the showcase teach. */
const transitionStamp = (at: string) => (ctx: HookContext) => {
  const prev = (ctx as any).previous as Record<string, unknown> | undefined;
  const data = (ctx.input as any).data as Record<string, unknown>;
  if (prev?.status !== 'done' && data.status === 'done') data.completed_at = at;
};

function hook(name: string, event: string, handler: (ctx: HookContext) => void): Hook {
  return { name, object: 'task', events: [event], priority: 100, handler } as unknown as Hook;
}

function makeStubDriver(): any {
  const store = new Map<string, Record<string, unknown>>();
  let nextId = 0;
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      if (v && typeof v === 'object' && Array.isArray((v as any).$in)) {
        if (!(v as any).$in.some((x: unknown) => x === row[k])) return false;
        continue;
      }
      const expected = v && typeof v === 'object' && '$eq' in (v as any) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  const d: any = {
    name: 'memory', version: '0.0.0', supports: {},
    store,
    /** Single-row writes — a predicate write must never be split into N (D3). */
    updateCalls: 0,
    /** Every payload `updateMany` was handed, so a pin can read the SET clause. */
    updateManyPayloads: [] as Record<string, unknown>[],
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; }, async syncSchema() {},
    async find(_o: string, ast: any, opts?: any) {
      // The caller's bound is applied AFTER the filter and by PRESENCE — a
      // limit-blind double silently answers past a bound the engine set, which
      // is what `check:objectql-double-limit` exists to keep out of new fakes.
      const rows = Array.from(store.values()).filter((r) => matches(r, ast?.where));
      const limit = typeof ast?.limit === 'number'
        ? ast.limit
        : typeof opts?.limit === 'number' ? opts.limit : undefined;
      return typeof limit === 'number' ? rows.slice(0, limit) : rows;
    },
    async findOne(_o: string, ast: any) {
      for (const r of store.values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(_o: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id }; store.set(id, row); return row;
    },
    async update(_o: string, id: string, data: Record<string, unknown>) {
      d.updateCalls += 1;
      const cur = store.get(id); if (!cur) return null;
      const u = { ...cur, ...data, id }; store.set(id, u); return u;
    },
    async updateMany(_o: string, ast: any, data: Record<string, unknown>) {
      d.updateManyPayloads.push({ ...data });
      const rows = Array.from(store.values()).filter((r) => matches(r, ast?.where));
      for (const r of rows) store.set(r.id as string, { ...r, ...data, id: r.id });
      return rows.length;
    },
    async delete(_o: string, id: string) { return store.delete(id); },
    async deleteMany(_o: string, ast: any) {
      const rows = Array.from(store.values()).filter((r) => matches(r, ast?.where));
      for (const r of rows) store.delete(r.id as string);
      return rows.length;
    },
    async count(_o: string) { return store.size; },
    async bulkCreate(_o: string, rows: any[]) { return Promise.all(rows.map((r) => d.create(_o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async upsert(_o: string, data: any) { return d.create(_o, data); },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return d;
}

async function boot(hooks: Hook[]): Promise<{ engine: ObjectQL; driver: any }> {
  const engine = new ObjectQL();
  const driver = makeStubDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(taskObject);
  if (hooks.length > 0) {
    bindHooksToEngine(engine, hooks, { packageId: 'app:test', logger: silentLogger });
  }
  return { engine, driver };
}

/** The stored rows, as a stable, comparable snapshot. */
const snapshot = (driver: any): string =>
  JSON.stringify(
    [...(driver.store as Map<string, Record<string, unknown>>).values()]
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
  );

/* ────────────────────────────────────────────────────────────────────────────
 * 1. The card's own fixture — REFUSED, with the envelope naming `completed_at`
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#14099] the mixed batch the card measured is refused', () => {
  async function mixedBatch() {
    const { engine, driver } = await boot([
      hook('stamp_completion', 'beforeUpdate', transitionStamp('2026-09-01T00:00:26.571Z')),
    ]);
    await engine.insert('task', [
      { id: 'open', title: 'a', status: 'todo', completed_at: null },
      { id: 'already', title: 'b', status: 'done', completed_at: '2026-09-01T00:00:26.560Z' },
    ] as any);
    return { engine, driver };
  }

  const run = (engine: ObjectQL) =>
    engine.update('task', { status: 'done' }, {
      multi: true, where: { id: { $in: ['open', 'already'] } },
    } as any);

  it('refuses with the ADR-0112 envelope — asserted by `code` and `status`', async () => {
    const { engine } = await mixedBatch();
    // ⛔ Never a bare `toThrow()`: an un-fixed engine throws nothing at all here,
    // and a *different* refusal would satisfy one. The envelope is the pin.
    const err = await run(engine).then(
      () => { throw new Error('expected the batch to be refused'); },
      (e: unknown) => e as MultiUpdateHookKeyDivergenceError,
    );
    expect(err).toBeInstanceOf(MultiUpdateHookKeyDivergenceError);
    expect(err.code).toBe(MULTI_UPDATE_HOOK_KEY_DIVERGENCE_CODE);
    expect(err.code).toBe('MULTI_UPDATE_HOOK_KEY_DIVERGENCE');
    expect(err.status).toBe(MULTI_UPDATE_HOOK_KEY_DIVERGENCE_STATUS);
    expect(err.status).toBe(400);
  });

  it('names the object, the diverging key and the prescription', async () => {
    const { engine } = await mixedBatch();
    const err = await run(engine).catch((e) => e as MultiUpdateHookKeyDivergenceError);
    expect(err.object).toBe('task');
    expect(err.keys).toEqual(['completed_at']);
    expect(err.rows).toBe(2);
    // The message a user-facing surface renders names the object and the key…
    expect(err.message).toContain("'task'");
    expect(err.message).toContain("'completed_at'");
    expect(err.message).toContain('Nothing was written');
    // …and the developer half carries both routes out, which is the whole point
    // of refusing rather than corrupting.
    expect(err.developerMessage).toContain('ctx.api');
    expect(err.developerMessage).toContain('by id');
  });

  it('refuses BEFORE any write — no row changed, and no driver write ran', async () => {
    const { engine, driver } = await mixedBatch();
    const before = snapshot(driver);
    await run(engine).catch(() => {});
    // Not "after the first row", not "inside a transaction that then rolls
    // back": the driver was never asked to write anything.
    expect(driver.updateManyPayloads).toEqual([]);
    expect(driver.updateCalls).toBe(0);
    expect(snapshot(driver)).toBe(before);
    // Specifically: the row the card watched still holds its ORIGINAL instant.
    expect(driver.store.get('already').completed_at).toBe('2026-09-01T00:00:26.560Z');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 2. An all-transition batch PROCEEDS as one `updateMany`
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#14099] an honest batch still proceeds as ONE updateMany (D3 intact)', () => {
  it('every row transitions ⇒ one write, and every row is stamped', async () => {
    const { engine, driver } = await boot([
      hook('stamp_completion', 'beforeUpdate', transitionStamp('2026-09-02T10:00:00.000Z')),
    ]);
    await engine.insert('task', [
      { id: 'a', title: 'a', status: 'todo', completed_at: null },
      { id: 'b', title: 'b', status: 'todo', completed_at: null },
      { id: 'c', title: 'c', status: 'todo', completed_at: null },
    ] as any);

    await engine.update('task', { status: 'done' }, {
      multi: true, where: { status: 'todo' },
    } as any);

    // ONE `updateMany`, never split into N single-row writes.
    expect(driver.updateManyPayloads).toHaveLength(1);
    expect(driver.updateCalls).toBe(0);
    expect(driver.updateManyPayloads[0].completed_at).toBe('2026-09-02T10:00:00.000Z');
    for (const id of ['a', 'b', 'c']) {
      expect(driver.store.get(id).status).toBe('done');
      expect(driver.store.get(id).completed_at).toBe('2026-09-02T10:00:00.000Z');
    }
  });

  it('a batch of ONE row is never refused — there is nothing to diverge from', async () => {
    const { engine, driver } = await boot([
      hook('stamp_completion', 'beforeUpdate', transitionStamp('2026-09-02T10:00:00.000Z')),
    ]);
    await engine.insert('task', [{ id: 'solo', title: 'a', status: 'done' }] as any);
    await engine.update('task', { status: 'done' }, {
      multi: true, where: { status: 'done' },
    } as any);
    expect(driver.updateManyPayloads).toHaveLength(1);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 3. The audit-stamp-only batch is BYTE-IDENTICAL before and after
 *
 * The platform-wide regression guard. `sys_stamp_audit_update` is registered on
 * `'*'`, so it runs in essentially every deployment: if the refusal ever fires
 * on a batch whose only payload rewrite is that stamp, every bulk update on
 * every ObjectStack install starts erroring. It reads the clock ONCE PER ROW,
 * so the VALUES diverge across rows on a perfectly honest batch — which is
 * precisely why the ruled criterion is the key SET.
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#14099] a row-invariant rewrite is never refused, however its values differ', () => {
  /** The audit stamp's shape: same key on every row, a fresh clock read each time. */
  const perRowClockStamp = () => {
    let tick = 0;
    return (ctx: HookContext) => {
      tick += 1;
      (ctx.input as any).data.updated_at = `2026-09-02T10:00:00.${String(tick).padStart(3, '0')}Z`;
    };
  };

  it('same key, DIFFERENT value per row ⇒ proceeds (the values are not the criterion)', async () => {
    const { engine, driver } = await boot([
      hook('audit_stamp', 'beforeUpdate', perRowClockStamp()),
    ]);
    await engine.insert('task', [
      { id: 'a', title: 'a', status: 'todo' },
      { id: 'b', title: 'b', status: 'done' },
      { id: 'c', title: 'c', status: 'blocked' },
    ] as any);

    await engine.update('task', { title: 'renamed' }, {
      multi: true, where: {},
    } as any);

    expect(driver.updateManyPayloads).toHaveLength(1);
    // D3, unchanged: the LAST dispatch's value is the one the batch carries.
    expect(driver.updateManyPayloads[0].updated_at).toBe('2026-09-02T10:00:00.003Z');
    for (const id of ['a', 'b', 'c']) {
      expect(driver.store.get(id).title).toBe('renamed');
      expect(driver.store.get(id).updated_at).toBe('2026-09-02T10:00:00.003Z');
    }
  });

  it('BYTE-IDENTICAL: the audit-stamp-only batch writes exactly what it wrote before #14099', async () => {
    // Both engines run the same hook over the same rows; the pin is that the
    // stored bytes are the same object graph either way, so "the refusal
    // over-fires" cannot hide as a subtle payload difference.
    const expected = JSON.stringify([
      { id: 'a', title: 'renamed', status: 'todo', updated_at: '2026-09-02T10:00:00.001Z' },
      { id: 'b', title: 'renamed', status: 'done', updated_at: '2026-09-02T10:00:00.001Z' },
    ]);
    const { engine, driver } = await boot([
      hook('audit_stamp', 'beforeUpdate', (ctx) => {
        (ctx.input as any).data.updated_at = '2026-09-02T10:00:00.001Z';
      }),
    ]);
    await engine.insert('task', [
      { id: 'a', title: 'a', status: 'todo' },
      { id: 'b', title: 'b', status: 'done' },
    ] as any);
    await engine.update('task', { title: 'renamed' }, { multi: true, where: {} } as any);
    expect(snapshot(driver)).toBe(expected);
  });

  it('a hook that writes NOTHING on any row is never refused', async () => {
    const { engine, driver } = await boot([hook('inert', 'beforeUpdate', () => {})]);
    await engine.insert('task', [
      { id: 'a', title: 'a', status: 'todo' },
      { id: 'b', title: 'b', status: 'done' },
    ] as any);
    await engine.update('task', { title: 'x' }, { multi: true, where: {} } as any);
    expect(driver.updateManyPayloads).toHaveLength(1);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 4. The blind spot the ruling carries OPENLY — pinned as intended, not fixed
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#14099] same key + per-row VALUES still passes — D3’s declared cost', () => {
  it('a per-row derived value is NOT refused, and the LAST dispatch’s value reaches every row', async () => {
    // ⚠️ This is the ruling's named blind spot, pinned so it cannot change by
    // accident in either direction. It is filed as its own finding with a
    // measured instance; ⛔ it is NOT widened into this card, and ⛔ the fix is
    // NOT a value comparison — see `multi-update-hook-key-divergence.ts` for
    // the two measurements that rejected one.
    const { engine, driver } = await boot([
      hook('derive_priority', 'beforeUpdate', (ctx) => {
        const prev = (ctx as any).previous as Record<string, unknown>;
        (ctx.input as any).data.priority = prev.status === 'blocked' ? 'high' : 'low';
      }),
    ]);
    await engine.insert('task', [
      { id: 'a', title: 'a', status: 'blocked' },
      { id: 'b', title: 'b', status: 'todo' },
    ] as any);

    await engine.update('task', { title: 'x' }, { multi: true, where: {} } as any);

    expect(driver.updateManyPayloads).toHaveLength(1);
    // The LAST row's derivation wins and lands on both rows. Row `a` is
    // `blocked` and should have been `high`; it is not.
    expect(driver.store.get('a').priority).toBe('low');
    expect(driver.store.get('b').priority).toBe('low');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 5. What the recorder cannot say, it does not say
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#14099] a hook that REPLACES the payload abstains rather than being refused', () => {
  it('replacement ⇒ no attributable record ⇒ the batch is not refused', async () => {
    // `hook-write-provenance.ts`'s KNOWN LIMIT: a replaced payload's keys are
    // indistinguishable from the caller's, so the recording says "cannot say".
    // Refusing on a measurement never taken would be a fabricated verdict, so
    // the pre-#14099 behaviour stands — the same fail-safe direction #14088
    // chose for the same limit.
    const { engine, driver } = await boot([
      hook('replaces', 'beforeUpdate', (ctx) => {
        const prev = (ctx as any).previous as Record<string, unknown>;
        (ctx.input as any).data = prev.status === 'todo'
          ? { ...(ctx.input as any).data, completed_at: 'x' }
          : { ...(ctx.input as any).data };
      }),
    ]);
    await engine.insert('task', [
      { id: 'a', title: 'a', status: 'todo' },
      { id: 'b', title: 'b', status: 'done' },
    ] as any);
    await engine.update('task', { title: 'x' }, { multi: true, where: {} } as any);
    expect(driver.updateManyPayloads).toHaveLength(1);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 6. Neighbouring contracts, unchanged
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#14099] the refusal is scoped to the predicate UPDATE path', () => {
  it('a by-id update with the same hook is untouched — one row, one payload', async () => {
    const { engine, driver } = await boot([
      hook('stamp_completion', 'beforeUpdate', transitionStamp('2026-09-02T11:00:00.000Z')),
    ]);
    await engine.insert('task', [{ id: 'a', title: 'a', status: 'todo' }] as any);
    await engine.update('task', { id: 'a', status: 'done' } as any);
    expect(driver.store.get('a').completed_at).toBe('2026-09-02T11:00:00.000Z');
  });

  it('a predicate DELETE is untouched — that event carries no payload at all', async () => {
    const seen: unknown[] = [];
    const { engine, driver } = await boot([
      hook('guard', 'beforeDelete', (ctx) => { seen.push((ctx.input as any).id); }),
    ]);
    await engine.insert('task', [
      { id: 'a', title: 'a', status: 'todo' },
      { id: 'b', title: 'b', status: 'done' },
    ] as any);
    await engine.delete('task', { multi: true, where: {} } as any);
    expect(seen).toHaveLength(2);
    expect(driver.store.size).toBe(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 7. The criterion itself — pure, total, order-independent
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#14099] divergingHookPayloadKeys', () => {
  const S = (...k: string[]) => new Set(k);

  it('agreeing rows diverge on nothing', () => {
    expect(divergingHookPayloadKeys([S('a', 'b'), S('b', 'a'), S('a', 'b')])).toEqual([]);
  });

  it('reports `union \\ intersection`, sorted — every offending key, not the first pair', () => {
    expect(divergingHookPayloadKeys([S('x'), S('y'), S('x', 'y', 'z')])).toEqual(['x', 'y', 'z']);
    expect(divergingHookPayloadKeys([S('shared', 'a'), S('shared')])).toEqual(['a']);
  });

  it('is ORDER-INDEPENDENT — the same batch answers the same whatever order the rows came in', () => {
    const rows = [S('a'), S(), S('a', 'b')];
    const answer = divergingHookPayloadKeys(rows);
    expect(divergingHookPayloadKeys([...rows].reverse())).toEqual(answer);
    expect(divergingHookPayloadKeys([rows[1], rows[2], rows[0]])).toEqual(answer);
  });

  it('fewer than two recorded rows cannot diverge', () => {
    expect(divergingHookPayloadKeys([])).toEqual([]);
    expect(divergingHookPayloadKeys([S('a')])).toEqual([]);
  });

  it('rows with no writes at all agree with each other', () => {
    // The abstention case — a hook REPLACED the payload, so the recording can
    // say nothing — never reaches this function: the engine skips the
    // comparison outright when its seal returns no record (pinned end-to-end in
    // §5). ⛔ So an absent row must never be modelled here as an empty set;
    // these are real windows that happen to be empty.
    expect(divergingHookPayloadKeys([S(), S(), S()])).toEqual([]);
  });

  it('a key DELETED on one row and assigned on another diverges', () => {
    // `recordHookPayloadWrites` drops a deleted key from the record, so this is
    // the shape a `delete ctx.input.data.x` on some rows produces.
    expect(divergingHookPayloadKeys([S('x'), S()])).toEqual(['x']);
  });
});
