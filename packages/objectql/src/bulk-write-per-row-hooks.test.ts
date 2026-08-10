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
 *
 * [#5574] Section 7 extends every one of those to the `before*` phase, which
 * ADR-0058 Addendum II brought under the same contract (clauses D1–D7). The
 * cases live here rather than in a file of their own on purpose: "the before
 * half diverged from the after half" is exactly the failure that would go
 * unnoticed, and side-by-side is where it gets caught.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import { bindHooksToEngine } from './hook-binder.js';
import { HookTargetRebindError, HOOK_TARGET_REBIND_ERROR_CODE } from './hook-target-rebind-errors.js';
import type { Hook, HookContext } from '@objectstack/spec/data';
import {
  BULK_PER_ROW_HOOK_LIMIT_ERROR_CODE,
  MAX_BULK_PER_ROW_HOOK_ROWS,
} from '@objectstack/spec/data';

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
 * 7. [#5574] The BEFORE phase takes the same contract — ADR-0058 Addendum II
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#5574 / D1] a bulk write fires before-hooks once per matched row', () => {
  it('N matched rows ⇒ N `beforeUpdate` dispatches, each naming its row', async () => {
    const seen: string[] = [];
    const { engine } = await boot([hook('per_row_before', 'beforeUpdate', (ctx) => {
      seen.push(String((ctx.input as any).id));
    })]);

    const rows = await seedTasks(engine, [
      { title: 'a', status: 'todo' },
      { title: 'b', status: 'todo' },
      { title: 'c', status: 'todo' },
    ]);

    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } });

    expect(seen).toHaveLength(3);
    expect(seen.sort()).toEqual(rows.map((r) => String(r.id)).sort());
  });

  it('N doomed rows ⇒ N `beforeDelete` dispatches, each naming its row', async () => {
    const seen: string[] = [];
    const { engine } = await boot([hook('per_row_before', 'beforeDelete', (ctx) => {
      seen.push(String((ctx.input as any).id));
    })]);

    const rows = await seedTasks(engine, [
      { title: 'a', status: 'stale' },
      { title: 'b', status: 'stale' },
      { title: 'c', status: 'live' },
    ]);
    const doomed = rows.filter((r) => r.status === 'stale').map((r) => String(r.id));

    await engine.delete('task', { multi: true, where: { status: 'stale' } });

    expect(seen.sort()).toEqual(doomed.sort());
  });

  it('zero matched rows ⇒ ZERO before dispatches', async () => {
    // `[]` is meaningful and distinct from "no row set was read": a batch that
    // matches nothing is not a record change, so there is nothing to dispatch
    // over — not one dispatch standing for the empty set.
    const seen: string[] = [];
    const { engine } = await boot([hook('per_row_before', 'beforeUpdate', () => { seen.push('x'); })]);
    await seedTasks(engine, [{ title: 'a', status: 'done' }]);

    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'nothing_matches' } });

    expect(seen).toEqual([]);
  });

  it('is UNIFORM — the count never depends on the condition text', async () => {
    // The same ruling the after phase got: a hook's firing COUNT must not
    // depend on what its condition happens to say, because no author can infer
    // that from any declaration.
    const withPrevious: string[] = [];
    const withoutPrevious: string[] = [];
    const { engine } = await boot([
      hook('reads_previous', 'beforeUpdate', (ctx) => { withPrevious.push(String((ctx.input as any).id)); }, TRANSITION),
      hook('reads_record', 'beforeUpdate', (ctx) => { withoutPrevious.push(String((ctx.input as any).id)); }, 'record.status == "done"'),
    ]);

    await seedTasks(engine, [{ title: 'a', status: 'todo' }, { title: 'b', status: 'todo' }]);
    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } });

    expect(withPrevious).toHaveLength(2);
    expect(withoutPrevious).toHaveLength(2);
  });

  it('a single-record write still fires exactly once', async () => {
    const seen: string[] = [];
    const { engine } = await boot([hook('per_row_before', 'beforeUpdate', () => { seen.push('x'); })]);
    const row: any = await engine.insert('task', { title: 'a', status: 'todo' });

    await engine.update('task', { status: 'done' }, { where: { id: row.id } });

    expect(seen).toEqual(['x']);
  });
});

describe('[#5574 / D2] the per-row before context is the SINGLE-RECORD shape', () => {
  it('binds THAT row’s `previous` — the measured harm of #5574, fixed', async () => {
    // The failure this whole card exists for: `ctx.previous` was permanently
    // undefined on a predicate write, so every guard written the way guards are
    // written (`if (ctx.previous?.locked) throw`) passed SILENTLY. Fail-open,
    // and invisible.
    const seen: Array<{ id: string; prev: unknown }> = [];
    const { engine } = await boot([hook('guard', 'beforeUpdate', (ctx) => {
      seen.push({ id: String((ctx.input as any).id), prev: ctx.previous });
    })]);

    await seedTasks(engine, [
      { title: 'a', status: 'todo', owner: 'u1' },
      { title: 'b', status: 'todo', owner: 'u2' },
    ]);

    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } });

    expect(seen).toHaveLength(2);
    for (const { id, prev } of seen) {
      // Each context's `previous` is ITS row's pre-image — the pre-WRITE state,
      // so `status` is still `todo` here.
      expect((prev as any).id).toBe(id);
      expect((prev as any).status).toBe('todo');
    }
    expect(seen.map((s) => (s.prev as any).owner).sort()).toEqual(['u1', 'u2']);
  });

  it('a `previous`-reading GUARD can now refuse a bulk write per row', async () => {
    // What per-row `previous` is FOR (D3 says so in as many words): so a guard
    // can REFUSE, not so a rewrite can be aimed at one row.
    const { engine } = await boot([hook('guard', 'beforeUpdate', (ctx) => {
      if ((ctx.previous as any)?.status === 'locked') throw new Error('row is locked');
    })]);

    await seedTasks(engine, [
      { title: 'a', status: 'todo' },
      { title: 'b', status: 'locked' },
    ]);

    await expect(
      engine.update('task', { status: 'done' }, { multi: true, where: {} }),
    ).rejects.toThrow(/row is locked/);

    // The guard fired BEFORE the write, so nothing was written at all — the
    // refusal covers the whole batch, not just the offending row.
    expect(await engine.count('task', { where: { status: 'done' } })).toBe(0);
  });

  it('carries NO `result` — the before phase has no post-state', async () => {
    const seen: unknown[] = [];
    const { engine } = await boot([hook('probe', 'beforeUpdate', (ctx) => { seen.push(ctx.result); })]);
    await seedTasks(engine, [{ title: 'a', status: 'todo' }, { title: 'b', status: 'todo' }]);

    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } });

    expect(seen).toEqual([undefined, undefined]);
  });
});

describe('[#5574 / D3] the payload stays BATCH-scoped, and that IS the merge rule', () => {
  it('every per-row context carries the SAME payload object, not a copy', async () => {
    const payloads: unknown[] = [];
    const { engine } = await boot([hook('probe', 'beforeUpdate', (ctx) => {
      payloads.push((ctx.input as any).data);
    })]);
    await seedTasks(engine, [{ title: 'a', status: 'todo' }, { title: 'b', status: 'todo' }]);

    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } });

    expect(payloads).toHaveLength(2);
    // Reference identity, deliberately. Copies are what a reconciliation step
    // would need, and the ADR rejected reconciliation on measured evidence.
    expect(payloads[0]).toBe(payloads[1]);
  });

  it('a rewrite made on ONE row’s dispatch applies to the WHOLE batch', async () => {
    let firstOnly = true;
    const { engine } = await boot([hook('stamp', 'beforeUpdate', (ctx) => {
      if (firstOnly) { (ctx.input as any).data.owner = 'stamped'; firstOnly = false; }
    })]);
    await seedTasks(engine, [
      { title: 'a', status: 'todo', owner: 'u1' },
      { title: 'b', status: 'todo', owner: 'u2' },
    ]);

    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } });

    // Both rows got it, including the one whose dispatch did not make it. This
    // is the contract, not a leak: one `updateMany` carries one SET clause.
    const rows: any[] = await engine.find('task', {});
    expect(rows.map((r) => r.owner)).toEqual(['stamped', 'stamped']);
  });

  it('rewrites ACCUMULATE in dispatch order, including a REPLACED payload', async () => {
    // Two spellings a handler can use, and both must accumulate: mutating the
    // payload in place, and assigning a whole new object over `input.data`.
    // The second is the one that would silently vanish with the row context
    // that held it if the loop did not write it back.
    const { engine } = await boot([hook('acc', 'beforeUpdate', (ctx) => {
      const cur = (ctx.input as any).data as Record<string, unknown>;
      (ctx.input as any).data = { ...cur, title: `${String(cur.title ?? '')}+` };
    })]);
    await seedTasks(engine, [
      { title: 'a', status: 'todo' },
      { title: 'b', status: 'todo' },
      { title: 'c', status: 'todo' },
    ]);

    await engine.update('task', { title: '', status: 'done' }, { multi: true, where: { status: 'todo' } });

    // Three dispatches, three appends, one payload — every row gets '+++'.
    const rows: any[] = await engine.find('task', {});
    expect(rows.map((r) => r.title)).toEqual(['+++', '+++', '+++']);
  });

  it('never splits the write: one updateMany, one affected count (#4639)', async () => {
    const { engine, driver } = await boot([hook('probe', 'beforeUpdate', () => {})]);
    await seedTasks(engine, [{ title: 'a', status: 'todo' }, { title: 'b', status: 'todo' }]);

    driver.updateCalls = 0;
    const affected = await engine.update(
      'task', { status: 'done' }, { multi: true, where: { status: 'todo' } } as any,
    );

    expect(affected).toBe(2);
    // Not two single-row writes. A write that has learned to split itself
    // cannot be un-split without breaking whoever came to depend on it.
    expect(driver.updateCalls).toBe(0);
  });
});

describe('[#5574 / D4] `input.id` is not a reroute lever, and is refused loudly', () => {
  it('REFUSES a per-row handler that rebinds `input.id`', async () => {
    const { engine } = await boot([hook('rebind', 'beforeUpdate', (ctx) => {
      (ctx.input as any).id = 'somewhere_else';
    })]);
    await seedTasks(engine, [{ title: 'a', status: 'todo' }, { title: 'b', status: 'todo' }]);

    const err = await engine
      .update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } })
      .then(() => null, (e) => e);

    expect(err).toBeInstanceOf(HookTargetRebindError);
    expect(err.code).toBe(HOOK_TARGET_REBIND_ERROR_CODE);
    expect(err.path).toBe('per-row');
    expect(err.event).toBe('beforeUpdate');
    expect(err.observedId).toBe('somewhere_else');
    // Refused, not ignored — a silent no-op is the failure this family exists
    // to abolish. And nothing was written.
    expect(await engine.count('task', { where: { status: 'done' } })).toBe(0);
  });

  it('REFUSES a by-id handler that clears `input.id` — the retired conversion', async () => {
    const { engine } = await boot([hook('clear', 'beforeUpdate', (ctx) => {
      (ctx.input as any).id = undefined;
    })]);
    const row: any = await engine.insert('task', { title: 'a', status: 'todo' });

    const err = await engine
      .update('task', { status: 'done' }, { where: { id: row.id } })
      .then(() => null, (e) => e);

    expect(err).toBeInstanceOf(HookTargetRebindError);
    expect(err.path).toBe('by-id');
    expect(err.expectedId).toBe(row.id);
    expect(err.message).toContain('RETIRED');
    expect((await engine.findOne('task', { where: { id: row.id } }) as any).status).toBe('todo');
  });

  it('REFUSES a by-id `beforeDelete` handler that CLEARS the id', async () => {
    // The clear is uniform across both verbs, because the ladder reorder leaves
    // it no answer of its own: it used to work by falling through to the
    // predicate branch, and that branch is now chosen before any handler runs.
    const { engine } = await boot([hook('clear', 'beforeDelete', (ctx) => {
      (ctx.input as any).id = undefined;
    })]);
    const row: any = await engine.insert('task', { title: 'a', status: 'todo' });

    const err = await engine
      .delete('task', { where: { id: row.id } })
      .then(() => null, (e) => e);

    expect(err).toBeInstanceOf(HookTargetRebindError);
    expect(err.event).toBe('beforeDelete');
    expect(err.path).toBe('by-id');
    expect(err.message).toContain('PREDICATE write');
    expect(await engine.count('task', {})).toBe(1);
  });

  it('still HONOURS a by-id `beforeDelete` REPOINT — deliberately not retired here', async () => {
    // ⚠️ The one place the two verbs answer a rebind differently, pinned so the
    // asymmetry is a decision on the record rather than something a later
    // reader "tidies up" in either direction.
    //
    // The case against honouring a rebind is that the write lands on a row
    // whose pre-image and rules were never evaluated. On `delete()` that is not
    // true: #5272 RE-RESOLVES the new target — re-reads its pre-image and
    // rebinds `previous` — before `afterDelete` or the summary recompute can
    // see it. `update()` has no such mechanism and refusing there is what keeps
    // this PR from inventing one (the ruling forbids picking re-resolution
    // silently). Retiring the delete-side repoint is its own question, filed as
    // #6752.
    const seen: unknown[] = [];
    const { engine } = await boot([
      hook('repoint', 'beforeDelete', (ctx) => {
        if ((ctx.previous as any)?.title === 'decoy') (ctx.input as any).id = String(target.id);
      }),
      hook('observe', 'afterDelete', (ctx) => { seen.push((ctx.previous as any)?.title); }, undefined, 'task', { priority: 200 }),
    ]);
    const decoy: any = await engine.insert('task', { title: 'decoy', status: 'todo' });
    const target: any = await engine.insert('task', { title: 'target', status: 'todo' });

    await engine.delete('task', { where: { id: decoy.id } });

    // The REPOINTED row is the one that went…
    const left: any[] = await engine.find('task', {});
    expect(left.map((r) => r.title)).toEqual(['decoy']);
    // …and `previous` was re-read for it, so the after phase describes the row
    // actually deleted rather than the one the caller named.
    expect(seen).toEqual(['target']);
  });

  it('leaves an untouched `input.id` alone — the refusal is not a trap', async () => {
    // The negative control. A handler that reads the id, or writes back the
    // SAME id, is doing nothing wrong and must not be refused.
    const { engine } = await boot([hook('readonly', 'beforeUpdate', (ctx) => {
      (ctx.input as any).id = (ctx.input as any).id;
    })]);
    await seedTasks(engine, [{ title: 'a', status: 'todo' }, { title: 'b', status: 'todo' }]);

    const affected = await engine.update(
      'task', { status: 'done' }, { multi: true, where: { status: 'todo' } } as any,
    );
    expect(affected).toBe(2);
  });
});

describe('[#5574 / D5] equivalence with the single-id path', () => {
  it('a read-only before-handler sees the same context on both shapes', async () => {
    const shapeOf = (ctx: HookContext) => ({
      keys: Object.keys(ctx.input as any).sort(),
      idIsRow: Boolean((ctx.input as any).id),
      previousStatus: (ctx.previous as any)?.status,
      data: (ctx.input as any).data,
      result: ctx.result,
    });

    const bulkSeen: unknown[] = [];
    const bulk = await boot([hook('probe', 'beforeUpdate', (ctx) => { bulkSeen.push(shapeOf(ctx)); })]);
    await seedTasks(bulk.engine, [{ title: 'a', status: 'todo' }]);
    await bulk.engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } });

    const singleSeen: unknown[] = [];
    const single = await boot([hook('probe', 'beforeUpdate', (ctx) => { singleSeen.push(shapeOf(ctx)); })]);
    const row: any = await single.engine.insert('task', { title: 'a', status: 'todo' });
    await single.engine.update('task', { status: 'done' }, { where: { id: row.id } });

    // The declared differences (D5) are `input.options` carrying `multi`/`where`,
    // the affected COUNT, the aggregate event and D4 — none of which this
    // projection reads. Everything else must be indistinguishable.
    expect(bulkSeen).toEqual(singleSeen);
  });
});

describe('[#5574 / D6] one ceiling, BOTH phases, checked before the first dispatch', () => {
  const over = MAX_BULK_PER_ROW_HOOK_ROWS + 1;

  it('refuses an over-ceiling batch on the BEFORE phase — zero handlers, zero rows written', async () => {
    const fired: string[] = [];
    const { engine } = await boot([hook('per_row_before', 'beforeUpdate', () => { fired.push('x'); })]);
    await seedTasks(engine, Array.from({ length: over }, (_, i) => ({ title: `t${i}`, status: 'todo' })));

    const err = await engine
      .update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } })
      .then(() => null, (e) => e);

    expect(err.code).toBe(BULK_PER_ROW_HOOK_LIMIT_ERROR_CODE);
    expect(err.event).toBe('beforeUpdate');
    expect(err.matched).toBe(over);
    expect(err.limit).toBe(MAX_BULK_PER_ROW_HOOK_ROWS);
    expect(err.message).toContain('Nothing was written');
    expect(err.message).toContain('NOT silently downgraded');
    // Refusal BEFORE the first dispatch — not after running `over` of them.
    expect(fired).toEqual([]);
    expect(await engine.count('task', { where: { status: 'todo' } })).toBe(over);
  });

  it('refuses an over-ceiling bulk DELETE on the before phase too', async () => {
    const fired: string[] = [];
    const { engine } = await boot([hook('per_row_before', 'beforeDelete', () => { fired.push('x'); })]);
    await seedTasks(engine, Array.from({ length: over }, (_, i) => ({ title: `t${i}`, status: 'stale' })));

    const err = await engine
      .delete('task', { multi: true, where: { status: 'stale' } })
      .then(() => null, (e) => e);

    expect(err.code).toBe(BULK_PER_ROW_HOOK_LIMIT_ERROR_CODE);
    expect(err.event).toBe('beforeDelete');
    expect(fired).toEqual([]);
    expect(await engine.count('task', {})).toBe(over);
  });

  it('ADMITS a batch exactly AT the ceiling, in both phases', async () => {
    // The boundary, stated on the admitted side too: an off-by-one here would
    // refuse honest batches, which is the failure nobody reports as a bug.
    const beforeFired: string[] = [];
    const afterFired: string[] = [];
    const { engine } = await boot([
      hook('pre', 'beforeUpdate', () => { beforeFired.push('x'); }),
      hook('post', 'afterUpdate', () => { afterFired.push('x'); }),
    ]);
    const at = MAX_BULK_PER_ROW_HOOK_ROWS;
    await seedTasks(engine, Array.from({ length: at }, (_, i) => ({ title: `t${i}`, status: 'todo' })));

    const affected = await engine.update(
      'task', { status: 'done' }, { multi: true, where: { status: 'todo' } } as any,
    );

    expect(affected).toBe(at);
    expect(beforeFired).toHaveLength(at);
    expect(afterFired).toHaveLength(at);
  }, 60_000);

  it('the engine ceiling IS the spec contract’s, not a second copy', async () => {
    expect(ObjectQL.MAX_BULK_PER_ROW_HOOK_ROWS).toBe(MAX_BULK_PER_ROW_HOOK_ROWS);
  });
});

describe('[#5574 / D7] the matched row set is read ONCE, and serves everything', () => {
  it('one `find` for a write whose object has BOTH a before- and an after-hook', async () => {
    const { engine, driver } = await boot([
      hook('pre', 'beforeUpdate', () => {}),
      hook('post', 'afterUpdate', () => {}),
    ]);
    await seedTasks(engine, [
      { title: 'a', status: 'todo' }, { title: 'b', status: 'todo' },
      { title: 'c', status: 'todo' }, { title: 'd', status: 'todo' },
    ]);

    driver.findCalls.length = 0;
    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } });

    // Four rows, eight dispatches, ONE query. The ruling forbids a second fetch
    // in as many words.
    expect(driver.findCalls).toHaveLength(1);
  });

  it('one `find` for a bulk DELETE with both phases hooked', async () => {
    const { engine, driver } = await boot([
      hook('pre', 'beforeDelete', () => {}),
      hook('post', 'afterDelete', () => {}),
    ]);
    await seedTasks(engine, [{ title: 'a', status: 'stale' }, { title: 'b', status: 'stale' }]);

    driver.findCalls.length = 0;
    await engine.delete('task', { multi: true, where: { status: 'stale' } });

    expect(driver.findCalls).toHaveLength(1);
  });

  it('does NOT read the row set when the object has NEITHER phase hooked', async () => {
    // Still demand-driven: an object nobody hooks pays nothing for a contract
    // it cannot observe.
    const { engine, driver } = await boot([hook('elsewhere', 'beforeUpdate', () => {}, undefined, 'other')]);
    await seedTasks(engine, [{ title: 'a', status: 'todo' }]);

    driver.findCalls.length = 0;
    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } });

    expect(driver.findCalls).toHaveLength(0);
  });

  it('reads it once for a BEFORE-only hook — the phase can hold the gate open alone', async () => {
    const { engine, driver } = await boot([hook('pre', 'beforeUpdate', () => {}, undefined, 'task')]);
    await seedTasks(engine, [{ title: 'a', status: 'todo' }]);

    driver.findCalls.length = 0;
    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } });

    expect(driver.findCalls).toHaveLength(1);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 8. [#6966] The dispatch marker — the fact D1/D2's indistinguishability erased
 *
 * Sections 1–7 make a per-row context deliberately indistinguishable from a
 * single-id one, which is what lets a handler written for one record work
 * unchanged on a batch. The cost is that "am I one of N?" became unanswerable,
 * and the guards that had been answering it from `input.id`'s shape — "no id
 * means bulk" — silently inverted rather than failing. `HookContext.dispatch`
 * is that question restored as an engine-stated fact.
 *
 * Pinned here rather than in a file of its own for section 7's reason: the
 * marker exists to describe THIS fan-out, and a marker that drifts from the
 * dispatch it describes is worse than none.
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#6966] every dispatched context carries the marker, on all four write paths', () => {
  const seenOn = async (event: string, drive: (engine: ObjectQL, ids: string[]) => Promise<unknown>) => {
    const seen: Array<{ mode: unknown; index: unknown; id: unknown }> = [];
    const { engine } = await boot([hook('marker', event, (ctx) => {
      const d = (ctx as any).dispatch;
      seen.push({ mode: d?.mode, index: d?.index, id: (ctx.input as any)?.id });
    })]);
    const rows = await seedTasks(engine, [
      { title: 'a', status: 'todo' },
      { title: 'b', status: 'todo' },
    ]);
    await drive(engine, rows.map((r) => String(r.id)));
    return seen;
  };

  it('single-id UPDATE ⇒ one dispatch, mode "record", index 0', async () => {
    for (const event of ['beforeUpdate', 'afterUpdate']) {
      const seen = await seenOn(event, (engine, ids) =>
        engine.update('task', { status: 'done' }, { where: { id: ids[0] } }));
      expect(seen, event).toEqual([{ mode: 'record', index: 0, id: seen[0].id }]);
    }
  });

  it('single-id DELETE ⇒ one dispatch, mode "record", index 0', async () => {
    for (const event of ['beforeDelete', 'afterDelete']) {
      const seen = await seenOn(event, (engine, ids) => engine.delete('task', { where: { id: ids[0] } } as any));
      expect(seen, event).toEqual([{ mode: 'record', index: 0, id: seen[0].id }]);
    }
  });

  it('predicate UPDATE ⇒ N dispatches, mode "per-row", index counting 0..N-1', async () => {
    for (const event of ['beforeUpdate', 'afterUpdate']) {
      const seen = await seenOn(event, (engine) =>
        engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } }));
      expect(seen.map((s) => s.mode), event).toEqual(['per-row', 'per-row']);
      // The INDEX is the member a consumer keys "do this once per batch" on, so
      // it must count rather than repeat the batch context's 0.
      expect(seen.map((s) => s.index), event).toEqual([0, 1]);
      expect(new Set(seen.map((s) => s.id)).size, event).toBe(2);
    }
  });

  it('predicate DELETE ⇒ N dispatches, mode "per-row", index counting 0..N-1', async () => {
    for (const event of ['beforeDelete', 'afterDelete']) {
      const seen = await seenOn(event, (engine) =>
        engine.delete('task', { multi: true, where: { status: 'todo' } } as any));
      expect(seen.map((s) => s.mode), event).toEqual(['per-row', 'per-row']);
      expect(seen.map((s) => s.index), event).toEqual([0, 1]);
      expect(new Set(seen.map((s) => s.id)).size, event).toBe(2);
    }
  });

  it('a batch INSERT is per-row too, and a single insert is not', async () => {
    const batch: any[] = [];
    const { engine } = await boot([hook('marker', 'beforeInsert', (ctx) => {
      batch.push((ctx as any).dispatch);
    })]);
    await engine.insert('task', [{ title: 'a' }, { title: 'b' }, { title: 'c' }] as any);
    expect(batch.map((d) => [d.mode, d.index])).toEqual([['per-row', 0], ['per-row', 1], ['per-row', 2]]);

    batch.length = 0;
    await engine.insert('task', { title: 'solo' } as any);
    expect(batch.map((d) => [d.mode, d.index])).toEqual([['record', 0]]);
  });

  it('NO handler is ever dispatched on a context without the marker', async () => {
    // The contract the JSDoc states, pinned as an invariant rather than
    // path-by-path. It is what makes `ctx.dispatch?.mode` safe to read without
    // a "what if the engine did not bind it" branch — and it covers the one
    // context a reader might worry about: `update()`/`delete()` keep a
    // BATCH-scoped `hookContext` on the predicate path, and the claim is that
    // no handler ever sees it (the per-row loop runs whenever `hasHooksFor` is
    // true, and when it is false no handler runs at all).
    const unmarked: string[] = [];
    const events = [
      'beforeInsert', 'afterInsert',
      'beforeUpdate', 'afterUpdate',
      'beforeDelete', 'afterDelete',
    ];
    const { engine } = await boot(events.map((e) => hook(`probe_${e}`, e, (ctx) => {
      const d = (ctx as any).dispatch;
      if (!d || (d.mode !== 'record' && d.mode !== 'per-row') || typeof d.index !== 'number' || !d.scope) {
        unmarked.push(`${e}:${JSON.stringify(d)}`);
      }
    })));

    // Every write shape this engine can take, in one pass.
    await engine.insert('task', { title: 'solo', status: 'todo' } as any);
    const batch: any = await engine.insert('task', [
      { title: 'a', status: 'todo' },
      { title: 'b', status: 'todo' },
    ] as any);
    await engine.update('task', { status: 'mid' }, { where: { id: batch[0].id } });
    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } });
    await engine.delete('task', { where: { id: batch[0].id } } as any);
    await engine.delete('task', { multi: true, where: { status: 'done' } } as any);

    expect(unmarked).toEqual([]);
  });
});

describe('[#6966] `scope` is one object per WRITE, spanning both phases', () => {
  it('carries a before-phase stash to the after phase of a predicate update', async () => {
    // The regression this closes: a per-row `before*` context is freshly built,
    // so a handler stashing on the CONTEXT (which is what every consumer did,
    // because a single-id write reuses one context across its pair) wrote to an
    // object the after phase never sees.
    const arrived: unknown[] = [];
    const { engine } = await boot([
      hook('stash', 'beforeUpdate', (ctx) => {
        const scope = (ctx as any).dispatch.scope as Record<string, unknown>;
        ((scope.ids ??= []) as unknown[]).push((ctx.input as any).id);
      }),
      hook('read', 'afterUpdate', (ctx) => {
        arrived.push(JSON.stringify(((ctx as any).dispatch.scope as any).ids));
      }),
    ]);
    const rows = await seedTasks(engine, [
      { title: 'a', status: 'todo' },
      { title: 'b', status: 'todo' },
    ]);
    const ids = rows.map((r) => String(r.id));

    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } });

    // Every after dispatch sees the WHOLE batch's collection — all before
    // dispatches complete before the write, so the union is closed by then.
    expect(arrived).toEqual([JSON.stringify(ids), JSON.stringify(ids)]);
  });

  it('is per WRITE — a second call gets a fresh scope, never the first call\'s', async () => {
    const scopes: unknown[] = [];
    const { engine } = await boot([hook('mark', 'beforeUpdate', (ctx) => {
      const scope = (ctx as any).dispatch.scope as Record<string, unknown>;
      scopes.push(scope);
      scope.touched = true;
    })]);
    const rows = await seedTasks(engine, [{ title: 'a', status: 'todo' }]);

    await engine.update('task', { status: 'mid' }, { where: { id: rows[0].id } });
    await engine.update('task', { status: 'done' }, { where: { id: rows[0].id } });

    expect(scopes).toHaveLength(2);
    expect(scopes[0]).not.toBe(scopes[1]);
  });

  it('is the SAME object across a single-id write\'s before/after pair', async () => {
    const scopes: unknown[] = [];
    const grab = (ctx: HookContext) => { scopes.push((ctx as any).dispatch.scope); };
    const { engine } = await boot([
      hook('b', 'beforeUpdate', grab),
      hook('a', 'afterUpdate', grab),
    ]);
    const rows = await seedTasks(engine, [{ title: 'a', status: 'todo' }]);

    await engine.update('task', { status: 'done' }, { where: { id: rows[0].id } });

    expect(scopes).toHaveLength(2);
    expect(scopes[0]).toBe(scopes[1]);
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

function makeStubDriver(): any {
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
    /** Single-row writes, so a test can pin that a predicate write is never
     *  split into N of them (#5574 D3). */
    updateCalls: 0,
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
      d.updateCalls += 1;
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
  const driver = makeStubDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(taskObject);
  engine.registry.registerObject(otherObject);
  if (hooks.length > 0) {
    bindHooksToEngine(engine, hooks, { packageId: 'app:test', logger: silentLogger });
  }
  return { engine, driver };
}
