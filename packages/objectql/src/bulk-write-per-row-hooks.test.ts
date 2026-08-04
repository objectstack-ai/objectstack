// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5038] A predicate (`multi: true`) write evaluates and fires its after-hooks
 * PER ROW.
 *
 * The contract recorded as ADR-0058's bulk-write addendum (the 2026-08-04
 * maintainer ruling on #4800 / #4862): a bulk write is N record changes, so
 * every record-scoped declaration on it is evaluated per row, with `record` =
 * that row's state and `previous` = that row's pre-write state. Validation
 * predicates have worked this way since #3106; hook `condition`s — and the
 * record-change flow triggers riding the same lifecycle hooks — now join them.
 *
 * What used to happen instead, measured on #4862: `driver.updateMany` resolves
 * an affected COUNT, the lifecycle hook fired ONCE, `hookContext.previous` was
 * never assigned, and `record` degraded to the write's bare payload. So the
 * transition condition the docs and ten showcase flows teach
 * (`status == "done" && previous.status != "done"`) could not be evaluated on a
 * bulk write, and the audit / notification automations behind it silently did
 * not happen — the one failure shape nobody goes looking for.
 *
 * Pinned here:
 *   1. firing GRANULARITY — N matched rows ⇒ N dispatches, uniformly for every
 *      after-hook, never keyed on whether the condition text says `previous`;
 *   2. the per-row BINDINGS — `previous` is that row's pre-image, `record` is
 *      that row's real state (not the bare payload), `input.id` names the row;
 *   3. the performance GUARDRAIL — the matched row set is read exactly ONCE and
 *      reused across every per-row evaluation, and is not read at all when the
 *      object has no after-hooks;
 *   4. the resource CEILING — an oversized batch is refused before anything is
 *      written, never silently downgraded to one call;
 *   5. `onError` and the write's own return contract, both unchanged;
 *   6. the same contract on a bulk DELETE.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import { bindHooksToEngine } from './hook-binder.js';
import type { Hook, HookContext } from '@objectstack/spec/data';

const TASK_FIELDS = {
  id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
  title: { name: 'title', label: 'Title', type: 'text' as const },
  status: { name: 'status', label: 'Status', type: 'text' as const },
  owner: { name: 'owner', label: 'Owner', type: 'text' as const },
  done: { name: 'done', label: 'Done', type: 'boolean' as const },
};
const taskObject = { name: 'task', label: 'Task', fields: TASK_FIELDS };
const otherObject = { name: 'other', label: 'Other', fields: TASK_FIELDS };

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** The transition shape the docs, the formula skill and the showcase all teach. */
const TRANSITION = 'record.status == "done" && previous.status != "done"';

/* ────────────────────────────────────────────────────────────────────────────
 * 1. Firing granularity
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#5038] a bulk write fires after-hooks once per matched row', () => {
  it('N matched rows ⇒ N dispatches', async () => {
    const seen: string[] = [];
    const { engine } = await boot([hook('per_row', 'afterUpdate', (ctx) => {
      seen.push(String((ctx.input as any).id));
    })]);

    await seedTasks(engine, [
      { title: 'a', status: 'todo' },
      { title: 'b', status: 'todo' },
      { title: 'c', status: 'todo' },
    ]);

    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } } as any);

    expect(seen).toHaveLength(3);
    // Each dispatch names a DIFFERENT row — this is N record changes, not one
    // hook call repeated.
    expect(new Set(seen).size).toBe(3);
  });

  it('is UNIFORM — a condition that never mentions `previous` fires per row too', async () => {
    // The ruling rejected keying per-row dispatch on the condition text
    // explicitly: a hook's firing COUNT must not depend on what its condition
    // happens to say, because no author can infer that from any declaration.
    // Two hooks, one reading `previous` and one not, must fire the same number
    // of times on the same write.
    const withPrevious: string[] = [];
    const withoutPrevious: string[] = [];
    const { engine } = await boot([
      hook('reads_previous', 'afterUpdate', (ctx) => { withPrevious.push(String((ctx.input as any).id)); }, TRANSITION),
      hook('reads_record', 'afterUpdate', (ctx) => { withoutPrevious.push(String((ctx.input as any).id)); }, 'record.status == "done"'),
    ]);

    await seedTasks(engine, [{ title: 'a', status: 'todo' }, { title: 'b', status: 'todo' }]);

    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } } as any);

    expect(withPrevious).toHaveLength(2);
    expect(withoutPrevious).toHaveLength(2);
  });

  it('a hook with NO condition fires per row as well', async () => {
    const seen: string[] = [];
    const { engine } = await boot([hook('uncondtional', 'afterUpdate', (ctx) => {
      seen.push(String((ctx.input as any).id));
    })]);

    await seedTasks(engine, [{ title: 'a', status: 'todo' }, { title: 'b', status: 'todo' }]);
    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } } as any);

    expect(seen).toHaveLength(2);
  });

  it('zero matched rows ⇒ ZERO dispatches (a batch that changed nothing is not a record change)', async () => {
    const seen: string[] = [];
    const { engine } = await boot([hook('per_row', 'afterUpdate', () => { seen.push('x'); })]);

    await seedTasks(engine, [{ title: 'a', status: 'done' }]);

    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'nothing_matches' } } as any);

    expect(seen).toEqual([]);
  });

  it('a single-record write still fires exactly once', async () => {
    const seen: string[] = [];
    const { engine } = await boot([hook('per_row', 'afterUpdate', () => { seen.push('x'); })]);
    const row: any = await engine.insert('task', { title: 'a', status: 'todo' });

    await engine.update('task', { status: 'done' }, { where: { id: row.id } } as any);

    expect(seen).toEqual(['x']);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 2. Per-row bindings
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#5038] each dispatch carries THAT row\'s previous / record', () => {
  it('`previous` is the row\'s own pre-write state, not a shared one', async () => {
    const priors: Array<Record<string, unknown> | undefined> = [];
    const { engine } = await boot([hook('capture', 'afterUpdate', (ctx) => {
      priors.push(ctx.previous as Record<string, unknown>);
    })]);

    await seedTasks(engine, [
      { title: 'a', status: 'todo', owner: 'ann' },
      { title: 'b', status: 'blocked', owner: 'bob' },
    ]);

    await engine.update('task', { status: 'done' }, { multi: true, where: {} } as any);

    expect(priors).toHaveLength(2);
    // One payload, N DIFFERENT prior states — the #3106 shape, now on the hook
    // side. The pre-images differ in exactly the fields the rows differed in.
    expect(priors.map((p) => p?.status).sort()).toEqual(['blocked', 'todo']);
    expect(priors.map((p) => p?.owner).sort()).toEqual(['ann', 'bob']);
  });

  it('the condition discriminates per row — only real transitions fire', async () => {
    // The whole reason `previous` exists. `record.status == "done"` alone is
    // true for the already-done row too; the transition is not.
    const fired: string[] = [];
    const { engine } = await boot([hook('transition', 'afterUpdate', (ctx) => {
      fired.push(String((ctx.previous as any).title));
    }, TRANSITION)]);

    await seedTasks(engine, [
      { title: 'just_finished', status: 'todo' },
      { title: 'already_done', status: 'done' },
    ]);

    await engine.update('task', { status: 'done' }, { multi: true, where: {} } as any);

    expect(fired).toEqual(['just_finished']);
  });

  it('`record` is the row\'s REAL state, not the bare payload (#4862 fact 4)', async () => {
    // The payload sets only `status`. Before per-row dispatch, `record` WAS the
    // payload, so `record.title` / `record.owner` — fields this write does not
    // touch — were simply absent and any condition naming one was unevaluable.
    const records: Array<Record<string, unknown>> = [];
    const { engine } = await boot([hook('capture', 'afterUpdate', (ctx) => {
      records.push(ctx.result as Record<string, unknown>);
    }, 'record.status == "done" && record.owner == "ann"')]);

    await seedTasks(engine, [
      { title: 'hers', status: 'todo', owner: 'ann' },
      { title: 'his', status: 'todo', owner: 'bob' },
    ]);

    await engine.update('task', { status: 'done' }, { multi: true, where: {} } as any);

    // The condition could only select Ann's row by reading a field the write
    // never carried — which is what "the row's real state" means.
    expect(records).toHaveLength(1);
    expect(records[0].title).toBe('hers');
    expect(records[0].owner).toBe('ann');
    // …overlaid with what this write applied.
    expect(records[0].status).toBe('done');
  });

  it('`input.id` names the row, giving the single-record context shape (#2922)', async () => {
    const ids: unknown[] = [];
    const { engine } = await boot([hook('capture', 'afterUpdate', (ctx) => {
      ids.push((ctx.input as any).id);
      // …and the payload is still reachable, as on any single-record write.
      expect((ctx.input as any).data.status).toBe('done');
    })]);

    const rows = await seedTasks(engine, [{ title: 'a', status: 'todo' }, { title: 'b', status: 'todo' }]);

    await engine.update('task', { status: 'done' }, { multi: true, where: {} } as any);

    expect(ids.sort()).toEqual(rows.map((r: any) => r.id).sort());
  });

  it('a per-row handler mutating `input` does not leak into the next row', async () => {
    // The batch has one payload, but each dispatch gets its own shallow copy so
    // an after-handler writing through the flat-input proxy cannot rewrite what
    // the next row's handler sees.
    const observed: unknown[] = [];
    const { engine } = await boot([hook('mutate', 'afterUpdate', (ctx) => {
      observed.push((ctx.input as any).scribble);
      (ctx.input as any).scribble = 'was here';
    })]);

    await seedTasks(engine, [{ title: 'a', status: 'todo' }, { title: 'b', status: 'todo' }]);
    await engine.update('task', { status: 'done' }, { multi: true, where: {} } as any);

    expect(observed).toEqual([undefined, undefined]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 3. The performance guardrail
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#5038] the matched row set is read ONCE', () => {
  it('one `find` serves every per-row evaluation, however many rows matched', async () => {
    const { engine, driver } = await boot([hook('per_row', 'afterUpdate', () => {}, TRANSITION)]);
    await seedTasks(engine, [
      { title: 'a', status: 'todo' }, { title: 'b', status: 'todo' },
      { title: 'c', status: 'todo' }, { title: 'd', status: 'todo' },
    ]);

    driver.findCalls.length = 0;
    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } } as any);

    // Four rows, four hook dispatches, ONE query. Re-reading per row would make
    // a bulk write cost N round trips — the guardrail the issue set.
    expect(driver.findCalls).toHaveLength(1);
  });

  it('does NOT read the row set when the object has no after-hooks', async () => {
    // The read is DEMAND-driven: an object nobody hooks pays nothing for a
    // contract it cannot observe.
    const { engine, driver } = await boot([hook('elsewhere', 'afterUpdate', () => {}, undefined, 'other')]);
    await seedTasks(engine, [{ title: 'a', status: 'todo' }]);

    driver.findCalls.length = 0;
    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } } as any);

    expect(driver.findCalls).toHaveLength(0);
  });

  it('reads it once for an object-filtered hook that DOES match', async () => {
    const seen: string[] = [];
    const { engine, driver } = await boot([hook('here', 'afterUpdate', () => { seen.push('x'); }, undefined, 'task')]);
    await seedTasks(engine, [{ title: 'a', status: 'todo' }]);

    driver.findCalls.length = 0;
    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } } as any);

    expect(driver.findCalls).toHaveLength(1);
    expect(seen).toEqual(['x']);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 4. The resource ceiling
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#5038] an oversized matched set is refused, never silently downgraded', () => {
  it('rejects past the ceiling, naming the count, the limit and the routes out', async () => {
    const fired: string[] = [];
    const { engine } = await boot([hook('per_row', 'afterUpdate', () => { fired.push('x'); })]);

    const over = ObjectQL.MAX_BULK_PER_ROW_HOOK_ROWS + 1;
    await seedTasks(engine, Array.from({ length: over }, (_, i) => ({ title: `t${i}`, status: 'todo' })));

    const err = await engine
      .update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } } as any)
      .then(() => null, (e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('ERR_BULK_PER_ROW_HOOK_LIMIT');
    expect(err.matched).toBe(over);
    expect(err.limit).toBe(ObjectQL.MAX_BULK_PER_ROW_HOOK_ROWS);
    expect(err.message).toContain('PER ROW');
    expect(err.message).toContain('Narrow the predicate');
    // The refused alternative, named so nobody re-proposes it: firing once for
    // the batch would skip the hook for N-1 rows without saying so.
    expect(err.message).toContain('NOT silently downgraded');

    // Nothing ran and nothing was written — the check is before the driver call.
    expect(fired).toEqual([]);
    const stillTodo = await engine.count('task', { where: { status: 'todo' } } as any);
    expect(stillTodo).toBe(over);
  });

  it('does not apply to an object with no after-hooks — a big batch still writes', async () => {
    const { engine } = await boot([]);
    const over = ObjectQL.MAX_BULK_PER_ROW_HOOK_ROWS + 1;
    await seedTasks(engine, Array.from({ length: over }, (_, i) => ({ title: `t${i}`, status: 'todo' })));

    const affected = await engine.update(
      'task', { status: 'done' }, { multi: true, where: { status: 'todo' } } as any,
    );

    expect(affected).toBe(over);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 5. What did NOT change
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#5038] the write\'s own contract is untouched', () => {
  it('a predicate update still resolves the affected COUNT (#4639)', async () => {
    const { engine } = await boot([hook('per_row', 'afterUpdate', () => {})]);
    await seedTasks(engine, [{ title: 'a', status: 'todo' }, { title: 'b', status: 'todo' }]);

    const affected = await engine.update(
      'task', { status: 'done' }, { multi: true, where: { status: 'todo' } } as any,
    );

    // Per-row dispatch changed the HOOK granularity, not the write's return
    // shape — a caller counting affected rows is unaffected.
    expect(affected).toBe(2);
  });

  it('the rows are actually written', async () => {
    const { engine } = await boot([hook('per_row', 'afterUpdate', () => {})]);
    await seedTasks(engine, [{ title: 'a', status: 'todo' }, { title: 'b', status: 'todo' }]);

    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } } as any);

    expect(await engine.count('task', { where: { status: 'done' } } as any)).toBe(2);
  });

  it('`onError: abort` on a per-row handler fails the operation, as on every other path', async () => {
    // `onError` needed no new per-row meaning: it governs a HANDLER on a
    // record-scoped context, and per-row dispatch is what finally gives it one.
    // The single-record and batch-insert paths both propagate; so does this.
    const { engine } = await boot([hook('boom', 'afterUpdate', () => { throw new Error('handler exploded'); })]);
    await seedTasks(engine, [{ title: 'a', status: 'todo' }, { title: 'b', status: 'todo' }]);

    await expect(
      engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } } as any),
    ).rejects.toThrow(/handler exploded/);
  });

  it('`onError: log` swallows per row and the remaining rows still fire', async () => {
    const reached: string[] = [];
    const { engine } = await boot([hook('noisy', 'afterUpdate', (ctx) => {
      reached.push(String((ctx.input as any).id));
      throw new Error('handler exploded');
    }, undefined, 'task', { onError: 'log' })]);
    await seedTasks(engine, [{ title: 'a', status: 'todo' }, { title: 'b', status: 'todo' }]);

    const affected = await engine.update(
      'task', { status: 'done' }, { multi: true, where: { status: 'todo' } } as any,
    );

    expect(affected).toBe(2);
    // Row 1's failure did not abort the batch's remaining dispatches.
    expect(reached).toHaveLength(2);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 6. Bulk DELETE takes the same contract
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#5038] a bulk delete fires afterDelete per row', () => {
  it('one dispatch per deleted row, each carrying that row as `previous`', async () => {
    const deleted: string[] = [];
    const { engine } = await boot([hook('audit_delete', 'afterDelete', (ctx) => {
      deleted.push(String((ctx.previous as any).title));
    })]);

    await seedTasks(engine, [
      { title: 'a', status: 'stale' },
      { title: 'b', status: 'stale' },
      { title: 'c', status: 'live' },
    ]);

    await engine.delete('task', { multi: true, where: { status: 'stale' } } as any);

    // The deleted rows are NAMED. Before this, a bulk delete fired once with a
    // context that identified no row at all, so a `record-after-delete` flow
    // could not say what it had just seen deleted.
    expect(deleted.sort()).toEqual(['a', 'b']);
  });

  it('a delete-shaped condition evaluates against the deleted row', async () => {
    const deleted: string[] = [];
    const { engine } = await boot([hook('audit_done_deletes', 'afterDelete', (ctx) => {
      deleted.push(String((ctx.previous as any).title));
    }, 'record.status == "done"')]);

    await seedTasks(engine, [
      { title: 'finished', status: 'done' },
      { title: 'abandoned', status: 'todo' },
    ]);

    await engine.delete('task', { multi: true, where: {} } as any);

    // `record` on a delete-shaped context is the row that was removed.
    expect(deleted).toEqual(['finished']);
  });

  it('does not read the doomed rows when nothing hooks afterDelete', async () => {
    const { engine, driver } = await boot([hook('other_event', 'afterUpdate', () => {})]);
    await seedTasks(engine, [{ title: 'a', status: 'stale' }]);

    driver.findCalls.length = 0;
    await engine.delete('task', { multi: true, where: { status: 'stale' } } as any);

    expect(driver.findCalls).toHaveLength(0);
  });

  it('the delete still resolves the affected count and removes the rows', async () => {
    const { engine } = await boot([hook('audit_delete', 'afterDelete', () => {})]);
    await seedTasks(engine, [{ title: 'a', status: 'stale' }, { title: 'b', status: 'stale' }]);

    const affected = await engine.delete('task', { multi: true, where: { status: 'stale' } } as any);

    expect(affected).toBe(2);
    expect(await engine.count('task', {} as any)).toBe(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Harness
 * ──────────────────────────────────────────────────────────────────────────── */

function hook(
  name: string,
  event: string,
  handler: (ctx: HookContext) => void,
  condition?: string,
  object = 'task',
  extra: Record<string, unknown> = {},
): Hook {
  return {
    name, object, events: [event], priority: 100,
    ...(condition ? { condition } : {}),
    handler,
    ...extra,
  } as unknown as Hook;
}

async function seedTasks(engine: ObjectQL, rows: Record<string, unknown>[]): Promise<any[]> {
  const written = await engine.insert('task', rows as any);
  return Array.isArray(written) ? written : [written];
}

function makeMemoryDriver(): any {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let nextId = 0;
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      const expected = v && typeof v === 'object' && '$eq' in (v as any) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  const d: any = {
    name: 'memory', version: '0.0.0', supports: {},
    /** Every `find` the engine issues, so a test can pin the read count. */
    findCalls: [] as unknown[],
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; }, async syncSchema() {},
    async find(o: string, ast: any) {
      d.findCalls.push(ast);
      return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
    },
    async findOne(o: string, ast: any) { for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r; return null; },
    async create(o: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id }; storeFor(o).set(id, row); return row;
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(o); const cur = s.get(id); if (!cur) return null;
      const u = { ...cur, ...data, id }; s.set(id, u); return u;
    },
    async upsert(o: string, data: any) { const id = data.id; return id && storeFor(o).has(id) ? this.update(o, id, data) : this.create(o, data); },
    async delete(o: string, id: string) { return storeFor(o).delete(id); },
    async count(o: string, ast: any) { return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)).length; },
    async bulkCreate(o: string, rows: any[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async updateMany(o: string, ast: any, data: Record<string, unknown>) {
      const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      for (const r of rows) storeFor(o).set(r.id as string, { ...r, ...data, id: r.id });
      return rows.length;
    },
    async deleteMany(o: string, ast: any) {
      const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      for (const r of rows) storeFor(o).delete(r.id as string);
      return rows.length;
    },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return d;
}

async function boot(hooks: Hook[]): Promise<{ engine: ObjectQL; driver: any }> {
  const engine = new ObjectQL();
  const driver = makeMemoryDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(taskObject as any);
  engine.registry.registerObject(otherObject as any);
  if (hooks.length > 0) {
    bindHooksToEngine(engine, hooks, { packageId: 'app:test', logger: silentLogger });
  }
  return { engine, driver };
}
