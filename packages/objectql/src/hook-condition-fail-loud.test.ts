// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4775] A hook `condition` the platform cannot evaluate ABORTS the operation.
 *
 * Before this, "the condition said no" and "the platform could not work out
 * what the condition says" produced the same outcome: a `logger.warn` at a
 * level most deployments read as noise, and `return false`. One result, two
 * opposite risks —
 *
 *   - a `before*` guard swallowed into `false` LETS THROUGH a write it was
 *     declared to stop;
 *   - an `after*` audit swallowed into `false` DROPS a row nobody will go
 *     looking for, because nobody knows it should exist.
 *
 * Maintainer's ruling (option B on the issue, superseding the C recorded in an
 * earlier comment): fail loud GLOBALLY. `before*` and `after*` take the same
 * direction, knowingly — a typo in an `afterUpdate` audit condition fails the
 * write it was only watching. One rule, one answer; no hidden second rule that
 * makes the failure direction depend on the event name.
 *
 * The three things this file pins, in the order they are easiest to get wrong:
 *
 *   1. UNEVALUABLE ⇒ rejected, naming the hook and the key (#4649's shape,
 *      shared through `cel-fault.ts`);
 *   2. FALSE ⇒ still just a skip, and the write still SUCCEEDS. This is the
 *      change's blast radius, and the single most likely thing to break by
 *      accident;
 *   3. `onError` is untouched — a condition fault is raised BEFORE the handler
 *      exists to fail, so `onError: 'log'` cannot resurrect the silent skip.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from './engine.js';
import { bindHooksToEngine } from './hook-binder.js';
import { wrapDeclarativeHook, HookConditionError } from './hook-wrappers.js';
import type { Hook, HookContext } from '@objectstack/spec/data';

const TASK_FIELDS = {
  id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
  title: { name: 'title', label: 'Title', type: 'text' as const },
  status: { name: 'status', label: 'Status', type: 'text' as const },
  done: { name: 'done', label: 'Done', type: 'boolean' as const },
  archived: { name: 'archived', label: 'Archived', type: 'boolean' as const },
};
const taskObject = { name: 'hook_task', label: 'Task', fields: TASK_FIELDS };
const qlStub = { getObject: (n: string) => (n === 'hook_task' ? taskObject : undefined) };

function makeCtx(overrides: Partial<HookContext> = {}): HookContext {
  return {
    object: 'hook_task',
    event: 'afterUpdate',
    input: { id: 't1', data: { done: true } },
    previous: { id: 't1', title: 'Ship it', status: 'todo', done: false },
    ql: qlStub,
    ...overrides,
  } as unknown as HookContext;
}

function makeHook(condition: string, extra: Partial<Hook> = {}): Hook {
  return {
    name: 'audit_hook', object: 'hook_task', events: ['afterUpdate'], priority: 100,
    condition, handler: () => {},
    ...extra,
  } as unknown as Hook;
}

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/* ────────────────────────────────────────────────────────────────────────────
 * 1. Unevaluable ⇒ the operation is rejected, and the message is usable
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#4775] an unevaluable condition aborts the operation', () => {
  it('throws a HookConditionError naming the hook and the undeclared key', async () => {
    const calls: string[] = [];
    const wrapped = wrapDeclarativeHook(
      makeHook('record.stauts == "done"'),
      (async () => { calls.push('ran'); }) as any,
      { logger: silentLogger },
    );

    const err = await wrapped(makeCtx()).then(() => null, (e) => e);

    expect(err).toBeInstanceOf(HookConditionError);
    expect(err.hook).toBe('audit_hook');
    expect(err.object).toBe('hook_task');
    expect(err.event).toBe('afterUpdate');
    expect(err.reason).toBe('unevaluable');
    expect(err.missingKey).toBe('stauts');
    expect(err.condition).toBe('record.stauts == "done"');
    // Names the hook, names the key, and says what to do about it — the same
    // three facts `unevaluableRuleError` puts in a validation rejection.
    expect(err.message).toContain("Hook 'audit_hook'");
    expect(err.message).toContain("reads 'stauts'");
    expect(err.message).toContain('does not declare');
    expect(err.message).toContain("fix the hook's condition, or declare the field");
    // And the handler never ran.
    expect(calls).toEqual([]);
  });

  it("words the rejection like #4649's, so an author who has met one can read the other", async () => {
    // The two surfaces share `cel-fault.ts`; this pins the shared sentence
    // rather than a copy of it.
    const wrapped = wrapDeclarativeHook(
      makeHook('record.stauts == "done"'), (async () => {}) as any, { logger: silentLogger },
    );
    const err = await wrapped(makeCtx()).then(() => null, (e) => e);
    const { evaluateValidationRules } = await import('./validation/rule-validator.js');

    let ruleMessage = '';
    try {
      evaluateValidationRules(
        {
          name: 'hook_task', fields: TASK_FIELDS,
          validations: [{
            type: 'script' as const,
            name: 'broken_rule',
            condition: { dialect: 'cel', source: 'record.stauts == "done"' },
            message: 'nope',
          }],
        } as any,
        { done: true }, 'update',
        { previous: { id: 't1', title: 'x', status: 'todo', done: false } } as any,
      );
    } catch (e: any) {
      ruleMessage = e?.fields?.[0]?.message ?? String(e?.message ?? '');
    }
    expect(ruleMessage).not.toBe('');

    const shared = "reads 'stauts', which this object does not declare";
    expect(err.message).toContain(shared);
    expect(ruleMessage).toContain(shared);
  });

  it('explains a null comparison the same way the validation side does', async () => {
    // `archived` is declared and materialised to null; ordering over null has
    // no CEL overload, and `has()` does NOT guard it.
    const wrapped = wrapDeclarativeHook(
      makeHook('record.archived > 1'), (async () => {}) as any, { logger: silentLogger },
    );
    const err = await wrapped(makeCtx()).then(() => null, (e) => e);

    expect(err).toBeInstanceOf(HookConditionError);
    expect(err.message).toMatch(/Guard it with '!= null'/);
    expect(err.message).toMatch(/has\(x\) is true/);
  });

  it('logs nothing that pretends the hook was merely "skipped"', async () => {
    const warn = vi.fn();
    const wrapped = wrapDeclarativeHook(
      makeHook('record.stauts == "done"'), (async () => {}) as any,
      { logger: { ...silentLogger, warn } },
    );
    await wrapped(makeCtx()).catch(() => {});
    expect(warn.mock.calls.filter(([m]) => /treating as false/.test(String(m)))).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 2. before* and after* take the SAME direction (acceptance #2 — no C tiering)
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#4775] `before*` and `after*` fail in the SAME direction', () => {
  const BROKEN = 'record.stauts == "done"';

  it('rejects on a before* guard hook', async () => {
    const wrapped = wrapDeclarativeHook(
      makeHook(BROKEN, { name: 'guard_hook', events: ['beforeUpdate'] }),
      (async () => {}) as any, { logger: silentLogger },
    );
    await expect(wrapped(makeCtx({ event: 'beforeUpdate' }))).rejects.toBeInstanceOf(HookConditionError);
  });

  it('rejects on an after* audit hook — the accepted cost of one rule, one answer', async () => {
    const wrapped = wrapDeclarativeHook(
      makeHook(BROKEN, { name: 'audit_hook', events: ['afterUpdate'] }),
      (async () => {}) as any, { logger: silentLogger },
    );
    await expect(wrapped(makeCtx({ event: 'afterUpdate' }))).rejects.toBeInstanceOf(HookConditionError);
  });

  it('rejects on an after* hook even when it is `async` (fire-and-forget)', async () => {
    // The gate runs BEFORE the fire-and-forget branch, so the caller still
    // sees the rejection instead of it vanishing into a detached promise.
    // `showcase_audit_task_completion` is exactly this shape.
    const wrapped = wrapDeclarativeHook(
      makeHook(BROKEN, { async: true, onError: 'log' } as any),
      (async () => {}) as any, { logger: silentLogger },
    );
    await expect(wrapped(makeCtx())).rejects.toBeInstanceOf(HookConditionError);
  });

  it('produces the same `reason` for both, with no event-derived tiering', async () => {
    const read = async (events: string[], event: string) => {
      const wrapped = wrapDeclarativeHook(
        makeHook(BROKEN, { events } as any), (async () => {}) as any, { logger: silentLogger },
      );
      return wrapped(makeCtx({ event } as any)).then(() => null, (e) => e);
    };
    const before = await read(['beforeUpdate'], 'beforeUpdate');
    const after = await read(['afterUpdate'], 'afterUpdate');
    expect(before.reason).toBe(after.reason);
    expect(before.missingKey).toBe(after.missingKey);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 3. FALSE is still just FALSE (acceptance #3 — the easiest thing to break)
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#4775] a condition that evaluates FALSE still just skips', () => {
  it('does not run the handler and does not throw', async () => {
    const calls: string[] = [];
    const wrapped = wrapDeclarativeHook(
      makeHook('record.done == false'),
      (async () => { calls.push('ran'); }) as any,
      { logger: silentLogger },
    );

    await expect(wrapped(makeCtx())).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('still records the skip as a `condition` skip, not an error', async () => {
    const recordSkip = vi.fn();
    const wrapped = wrapDeclarativeHook(
      makeHook('record.done == false'), (async () => {}) as any,
      {
        logger: silentLogger,
        metrics: { recordSkip, recordRetry: () => {}, recordExecution: () => {} } as any,
      },
    );
    await wrapped(makeCtx());
    expect(recordSkip).toHaveBeenCalledWith(expect.objectContaining({ hook: 'audit_hook' }), 'condition');
  });

  it('a falsy comparison against a materialised null is FALSE, not a fault', async () => {
    // `archived` is declared and absent from the stored row → null. `== true`
    // is a legitimate NO, and must not be confused with "unevaluable".
    const calls: string[] = [];
    const wrapped = wrapDeclarativeHook(
      makeHook('record.archived == true'),
      (async () => { calls.push('ran'); }) as any,
      { logger: silentLogger },
    );
    await expect(wrapped(makeCtx())).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('through a real engine: a FALSE condition leaves the write succeeding', async () => {
    const ran: string[] = [];
    const engine = await bootEngine([{
      name: 'never_fires', object: 'hook_task', events: ['afterUpdate'], priority: 90,
      condition: 'record.done == false',
      handler: () => { ran.push('x'); },
    } as unknown as Hook]);

    const row: any = await engine.insert('hook_task', { title: 'A', status: 'todo', done: false });
    const updated: any = await engine.update('hook_task', { done: true }, { where: { id: row.id } } as any);

    expect(updated.done).toBe(true);
    expect(ran).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 4. `onError` is untouched (acceptance #5)
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#4775] a condition fault never enters `onError`', () => {
  it("`onError: 'log'` does NOT swallow a condition fault", async () => {
    const error = vi.fn();
    const wrapped = wrapDeclarativeHook(
      makeHook('record.stauts == "done"', { onError: 'log' } as any),
      (async () => {}) as any,
      { logger: { ...silentLogger, error } },
    );

    await expect(wrapped(makeCtx())).rejects.toBeInstanceOf(HookConditionError);
    // The `onError` branch logs '[hook] handler failed (onError=log; suppressing)'.
    // The condition never reached it.
    expect(error.mock.calls.filter(([m]) => /onError=log/.test(String(m)))).toEqual([]);
  });

  it("`onError: 'log'` still swallows a HANDLER throw, exactly as before", async () => {
    const error = vi.fn();
    const wrapped = wrapDeclarativeHook(
      makeHook('record.done == true', { onError: 'log' } as any),
      (async () => { throw new Error('handler boom'); }) as any,
      { logger: { ...silentLogger, error } },
    );

    await expect(wrapped(makeCtx())).resolves.toBeUndefined();
    expect(error.mock.calls.filter(([m]) => /onError=log/.test(String(m)))).toHaveLength(1);
  });

  it('a condition fault is not retried by `retryPolicy` either', async () => {
    const recordRetry = vi.fn();
    const wrapped = wrapDeclarativeHook(
      makeHook('record.stauts == "done"', { retryPolicy: { maxRetries: 3, backoffMs: 0 } } as any),
      (async () => {}) as any,
      {
        logger: silentLogger,
        metrics: { recordSkip: () => {}, recordRetry, recordExecution: () => {} } as any,
      },
    );
    await wrapped(makeCtx()).catch(() => {});
    expect(recordRetry).not.toHaveBeenCalled();
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 5. RETIRED (#5574) — the predicate bulk write no longer NEEDS a diagnosis
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#4800 B1 → #5038 → #5574] the batch-dispatch diagnosis is retired at the producer', () => {
  // ⚠️ Six cases stood here and asserted the diagnosis's wording: that a
  // `previous`-reading condition on a batch dispatch named the BATCH rather
  // than saying "No such key", pointed at the after-type event and at a
  // record-change flow trigger, and carried `predicateBulkWrite: true`.
  //
  // The arc is worth stating once, because it is the argument for fixing
  // producers rather than writing better messages about them. #4800/B1 asked
  // for a diagnosis instead of a riddle. #5037 shipped it with a machine-
  // readable `limitation`, expiring when the contract landed. #5038 landed the
  // per-row contract for `after*` and retired half of it. #5574 (ADR-0058
  // Addendum II) landed it for `before*` — and at that point there was no
  // dispatch left without a bound `previous`, so the condition being diagnosed
  // stopped existing and the diagnosis went with it under ADR-0049.
  //
  // What is pinned instead is the outcome: the write that used to fail now
  // succeeds, per row, as authored. The full retirement pins (including that no
  // dispatch lacking `previous` is produced at all) live in
  // `hook-condition-bulk-previous.test.ts` §a.

  it('the bulk write this section existed to explain now SUCCEEDS', async () => {
    // Verbatim the "fail loud takes NO exception for the batch" case, inverted.
    const engine = await bootEngine([{
      name: 'bulk_breaker', object: 'hook_task', events: ['beforeUpdate'], priority: 90,
      condition: 'previous.done != true && record.done == true',
      handler: () => {},
    } as unknown as Hook]);

    await engine.insert('hook_task', { title: 'A', status: 'todo', done: false });
    await engine.insert('hook_task', { title: 'B', status: 'todo', done: false });

    await expect(
      engine.update('hook_task', { done: true }, { multi: true, where: { status: 'todo' } } as any),
    ).resolves.toBeDefined();
  });

  it('an UNDECLARED key on a bulk write is STILL reported as the typo it is', async () => {
    // The half that was always the author's, and the half fail-loud is about.
    // Retiring the platform-limitation branch must not soften this one — a
    // misspelled key is misspelled on a bulk write exactly as on a single-row
    // one, and it still ABORTS.
    const engine = await bootEngine([{
      name: 'typo_hook', object: 'hook_task', events: ['beforeUpdate'], priority: 90,
      condition: 'record.stauts == "x"',
      handler: () => {},
    } as unknown as Hook]);

    await engine.insert('hook_task', { title: 'A', status: 'todo', done: false });

    const err = await engine
      .update('hook_task', { done: true }, { multi: true, where: { status: 'todo' } } as any)
      .then(() => null, (e) => e);

    expect(err).toBeInstanceOf(HookConditionError);
    expect(err.message).toContain("reads 'stauts', which this object does not declare");
    expect(err.message).not.toContain('PREDICATE bulk write');
  });

  it('a single-record write of the SAME hook still succeeds', async () => {
    const ran: string[] = [];
    const engine = await bootEngine([{
      name: 'bulk_breaker', object: 'hook_task', events: ['afterUpdate'], priority: 90,
      condition: 'previous.done != true && record.done == true',
      handler: () => { ran.push('audited'); },
    } as unknown as Hook]);

    const row: any = await engine.insert('hook_task', { title: 'A', status: 'todo', done: false });
    const updated: any = await engine.update('hook_task', { done: true }, { where: { id: row.id } } as any);

    expect(updated.done).toBe(true);
    expect(ran).toEqual(['audited']);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 6. A condition that never compiled (the worse half of the old swallow)
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#4775] a condition that does not compile aborts too', () => {
  it('rejects rather than firing the hook unconditionally', async () => {
    const calls: string[] = [];
    // Old behaviour: "condition formula failed to compile; condition ignored"
    // → the gate vanished and the hook ran on EVERY write, as though no
    // condition had been declared. That is the same `declared ≠ enforced`,
    // one step earlier and pointing the other way.
    const wrapped = wrapDeclarativeHook(
      makeHook('record.done == = true'),
      (async () => { calls.push('ran'); }) as any,
      { logger: silentLogger },
    );

    const err = await wrapped(makeCtx()).then(() => null, (e) => e);

    expect(err).toBeInstanceOf(HookConditionError);
    expect(err.reason).toBe('uncompilable');
    expect(err.message).toContain("Hook 'audit_hook'");
    expect(err.message).toContain('does not compile');
    expect(calls).toEqual([]);
  });

  it('is reported at invocation, not at bind time — a broken hook cannot wedge boot', async () => {
    // Wrapping must not throw; only running the operation does.
    expect(() =>
      wrapDeclarativeHook(makeHook('record.done == = true'), (async () => {}) as any, { logger: silentLogger }),
    ).not.toThrow();
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Real-engine harness
 * ──────────────────────────────────────────────────────────────────────────── */

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
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; }, async syncSchema() {},
    async find(o: string, ast: any) { return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)); },
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
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: any[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async updateMany(o: string, ast: any, data: Record<string, unknown>) {
      const rows = await this.find(o, ast);
      for (const r of rows) storeFor(o).set(r.id as string, { ...r, ...data, id: r.id });
      return rows.length;
    },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return d;
}

async function bootEngine(hooks: Hook[]): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(makeStubDriver(), true);
  await engine.init();
  engine.registry.registerObject(taskObject);
  bindHooksToEngine(engine, hooks, { packageId: 'app:test', logger: silentLogger });
  return engine;
}
