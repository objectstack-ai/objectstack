// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9719] The opt-in whole-operation `beforeDelete` dispatch for an UNSCOPED
 * predicate delete — `multi: true` carrying no caller `where` at all.
 *
 * Why the engine needs it, measured on #9719: the per-row contract
 * (#5038 / #5574) binds `input.id` on every predicate dispatch, so a handler
 * guarding the OPERATION SHAPE (the #4757 predicate-less multi-delete refusal
 * on `sys_attachment`) always took its by-id branch — and a zero-match
 * predicate dispatches nothing at all ([D1]), so the guard never ran on
 * exactly the shape it refuses. Both unreachability limbs need one dispatch
 * that happens BEFORE the matched-row read, keyed on the operation's shape.
 *
 * Pinned here, against the REAL engine:
 *   1. the dispatch CONDITION — `where` absent or `null` is unscoped;
 *      `where: {}` and a real predicate are scoped and get NO extra dispatch;
 *   2. the dispatched SHAPE — whole-operation: `input.id` undefined, the
 *      caller's raw `options` (the `hook.zod.ts` upper-bound read),
 *      `dispatch.mode === 'record'`, the batch `scope` identity-shared;
 *   3. ORDERING — a refusal from the flagged handler rejects the delete
 *      before the doomed-row read and before `deleteMany`: zero driver calls;
 *   4. the ZERO-MATCH limb — an unscoped delete of an EMPTY table still
 *      dispatches (with a positive control proving the measurement is not
 *      vacuous);
 *   5. NEUTRALITY — undeclared registrations and by-id deletes see no new
 *      dispatch: today's behaviour for every other object is unchanged;
 *   6. the retired-lever rule — binding `input.id` on the whole-operation
 *      context is refused (`HookTargetRebindError`, path `'unscoped-multi'`),
 *      never silently ignored;
 *   7. the registration-time refusal of the flag on any event whose dispatch
 *      never reads it (ADR-0078: no silently inert declaration).
 *
 * The consumer half — the #4757 refusal itself, wired end-to-end — is pinned
 * in `packages/services/service-storage/src/attachment-access-hooks.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import { HOOK_TARGET_REBIND_ERROR_CODE } from './hook-target-rebind-errors.js';
import type { HookContext } from '@objectstack/spec/data';

const FIELDS = {
  id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
  status: { name: 'status', label: 'Status', type: 'text' as const },
  owner: { name: 'owner', label: 'Owner', type: 'text' as const },
};
const attObject = { name: 'att', label: 'Att', fields: FIELDS };
const taskObject = { name: 'task', label: 'Task', fields: FIELDS };

/**
 * Minimal in-memory driver. Its WHERE matcher REFUSES combinators and
 * operator objects by throwing (the conforming shape
 * `check-where-matcher-conformance.mjs` documents): a double that answers an
 * operator silently wrong makes a suite green on a different query.
 */
function makeStubDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const matches = (row: Record<string, unknown>, where: unknown): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) throw new Error(`stub driver: unsupported combinator ${k}`);
      if (v !== null && typeof v === 'object') throw new Error(`stub driver: unsupported operator value on ${k}`);
      if ((row[k] ?? null) !== (v ?? null)) return false;
    }
    return true;
  };
  const d: any = {
    name: 'memory', version: '0.0.0', supports: {},
    stores,
    /** Every read/write the engine issued, in order — the ordering pins read it. */
    calls: [] as string[],
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; }, async syncSchema() {},
    async find(o: string, ast: any) {
      d.calls.push(`find:${o}`);
      return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
    },
    async findOne(o: string, ast: any) {
      d.calls.push(`findOne:${o}`);
      for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(o: string, data: Record<string, unknown>) {
      const id = String(data.id);
      const row = { ...data, id };
      storeFor(o).set(id, row);
      return row;
    },
    async update() { return null; },
    async delete(o: string, id: string) { d.calls.push(`delete:${o}`); return storeFor(o).delete(String(id)); },
    async count(o: string, ast: any) {
      return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)).length;
    },
    async deleteMany(o: string, ast: any) {
      d.calls.push(`deleteMany:${o}`);
      const doomed = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      for (const r of doomed) storeFor(o).delete(String(r.id));
      return doomed.length;
    },
    async updateMany() { return 0; },
  };
  return d;
}

async function boot() {
  const engine = new ObjectQL();
  const driver = makeStubDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(attObject as any, 'app:test');
  engine.registry.registerObject(taskObject as any, 'app:test');
  return { engine, driver };
}

/** Seed rows straight into the driver store — no insert hooks involved. */
function seed(driver: any, object: string, rows: Array<Record<string, unknown>>) {
  if (!driver.stores.get(object)) driver.stores.set(object, new Map());
  for (const row of rows) driver.stores.get(object)!.set(String(row.id), { ...row });
}

const rowsIn = (driver: any, object: string): number => driver.stores.get(object)?.size ?? 0;

type Seen = { id: unknown; where: unknown; multi: unknown; mode: unknown; index: unknown };
const snapshot = (ctx: HookContext): Seen => ({
  id: (ctx.input as any).id,
  where: (ctx.input as any).options?.where,
  multi: (ctx.input as any).options?.multi,
  mode: (ctx.dispatch as any)?.mode,
  index: (ctx.dispatch as any)?.index,
});

describe('[#9719] registration-time validation of dispatchUnscopedMultiDelete', () => {
  it("refuses the flag on any event other than 'beforeDelete'", async () => {
    const { engine } = await boot();
    for (const event of ['beforeUpdate', 'afterDelete', 'beforeInsert']) {
      expect(() =>
        engine.registerHook(event, async () => {}, {
          object: 'att',
          dispatchUnscopedMultiDelete: true,
        }),
      ).toThrow(/dispatchUnscopedMultiDelete/);
    }
  });

  it("accepts the flag on 'beforeDelete'", async () => {
    const { engine } = await boot();
    expect(() =>
      engine.registerHook('beforeDelete', async () => {}, {
        object: 'att',
        dispatchUnscopedMultiDelete: true,
      }),
    ).not.toThrow();
  });
});

describe('[#9719] the whole-operation dispatch on an unscoped predicate delete', () => {
  it('dispatches ONCE, whole-operation-shaped, before the per-row fan-out', async () => {
    const { engine, driver } = await boot();
    seed(driver, 'att', [
      { id: 'a1', status: 'x', owner: 'u1' },
      { id: 'a2', status: 'y', owner: 'u1' },
    ]);
    const seen: Seen[] = [];
    engine.registerHook(
      'beforeDelete',
      async (ctx: HookContext) => { seen.push(snapshot(ctx)); },
      { object: 'att', dispatchUnscopedMultiDelete: true },
    );

    await engine.delete('att', { multi: true, context: { userId: 'u1' } } as any);

    // 1 whole-operation dispatch + 2 per-row dispatches, in that order.
    expect(seen).toHaveLength(3);
    expect(seen[0]).toMatchObject({ id: undefined, where: undefined, multi: true, mode: 'record', index: 0 });
    expect([seen[1]!.id, seen[2]!.id].sort()).toEqual(['a1', 'a2']);
    expect(seen[1]!.mode).toBe('per-row');
    // The handler that let it pass did not stop the wipe — engine policy stays
    // with the handler, not the dispatch.
    expect(rowsIn(driver, 'att')).toBe(0);
  });

  it('a refusal from the flagged handler rejects the delete BEFORE any driver call', async () => {
    const { engine, driver } = await boot();
    seed(driver, 'att', [{ id: 'a1', status: 'x', owner: 'u1' }]);
    engine.registerHook(
      'beforeDelete',
      async (ctx: HookContext) => {
        if ((ctx.input as any).id === undefined) {
          const err: any = new Error('unscoped delete refused by test guard');
          err.code = 'TEST_UNSCOPED_REFUSED';
          err.status = 403;
          throw err;
        }
      },
      { object: 'att', dispatchUnscopedMultiDelete: true },
    );

    await expect(engine.delete('att', { multi: true, context: { userId: 'u1' } } as any))
      .rejects.toMatchObject({ code: 'TEST_UNSCOPED_REFUSED', status: 403 });
    // No doomed-row read, no deleteMany: the refusal cost nothing downstream.
    expect(driver.calls).toEqual([]);
    expect(rowsIn(driver, 'att')).toBe(1);
  });

  it('the ZERO-MATCH limb: an unscoped delete of an EMPTY table still dispatches', async () => {
    const { engine, driver } = await boot();
    // No rows at all — the [D1] per-row gate would dispatch nothing.
    let dispatched = 0;
    engine.registerHook(
      'beforeDelete',
      async (ctx: HookContext) => {
        if ((ctx.input as any).id === undefined) {
          dispatched += 1;
          const err: any = new Error('unscoped delete refused by test guard');
          err.code = 'TEST_UNSCOPED_REFUSED';
          err.status = 403;
          throw err;
        }
      },
      { object: 'att', dispatchUnscopedMultiDelete: true },
    );

    await expect(engine.delete('att', { multi: true, context: { userId: 'u1' } } as any))
      .rejects.toMatchObject({ code: 'TEST_UNSCOPED_REFUSED' });
    expect(dispatched).toBe(1);
    expect(driver.calls).toEqual([]);
  });

  it('positive control for the zero-match limb: WITHOUT the flag, the same shape dispatches nothing', async () => {
    const { engine, driver } = await boot();
    let dispatched = 0;
    engine.registerHook(
      'beforeDelete',
      async () => { dispatched += 1; },
      { object: 'att' }, // same handler, same object — flag withheld
    );

    // Resolves: zero rows matched, zero per-row dispatches ([D1]), and no
    // whole-operation dispatch without the declaration. This is exactly the
    // pre-#9719 wired behaviour, so the zero-match measurement above is a
    // measurement of the flag, not of the harness.
    await expect(engine.delete('att', { multi: true, context: { userId: 'u1' } } as any))
      .resolves.toBeDefined();
    expect(dispatched).toBe(0);
    expect(driver.calls).toContain('deleteMany:att');
  });

  it("dispatches on `where: null` — the handler contract's other unscoped spelling", async () => {
    const { engine, driver } = await boot();
    seed(driver, 'att', [{ id: 'a1', status: 'x', owner: 'u1' }]);
    const seen: Seen[] = [];
    engine.registerHook(
      'beforeDelete',
      async (ctx: HookContext) => { seen.push(snapshot(ctx)); },
      { object: 'att', dispatchUnscopedMultiDelete: true },
    );

    await engine.delete('att', { multi: true, where: null, context: { userId: 'u1' } } as any);
    expect(seen[0]).toMatchObject({ id: undefined, where: null, multi: true, mode: 'record' });
  });

  it('the whole-operation `scope` is identity-shared with the per-row contexts', async () => {
    const { engine, driver } = await boot();
    seed(driver, 'att', [{ id: 'a1', status: 'x', owner: 'u1' }]);
    const perRowSawMarker: unknown[] = [];
    engine.registerHook(
      'beforeDelete',
      async (ctx: HookContext) => {
        const scope = (ctx.dispatch as any)?.scope as Record<string, unknown>;
        if ((ctx.input as any).id === undefined) scope.marker = 'from-whole-op';
        else perRowSawMarker.push(scope.marker);
      },
      { object: 'att', dispatchUnscopedMultiDelete: true },
    );

    await engine.delete('att', { multi: true, context: { userId: 'u1' } } as any);
    expect(perRowSawMarker).toEqual(['from-whole-op']);
  });
});

describe('[#9719] scoped deletes and undeclared registrations see NO new dispatch', () => {
  it('a real `where` predicate gets only the per-row fan-out', async () => {
    const { engine, driver } = await boot();
    seed(driver, 'att', [
      { id: 'a1', status: 'x', owner: 'u1' },
      { id: 'a2', status: 'y', owner: 'u1' },
    ]);
    const seen: Seen[] = [];
    engine.registerHook(
      'beforeDelete',
      async (ctx: HookContext) => { seen.push(snapshot(ctx)); },
      { object: 'att', dispatchUnscopedMultiDelete: true },
    );

    await engine.delete('att', { multi: true, where: { status: 'x' }, context: { userId: 'u1' } } as any);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ id: 'a1', mode: 'per-row' });
    expect(rowsIn(driver, 'att')).toBe(1);
  });

  it('`where: {}` is a REAL match-all query, not an unscoped delete', async () => {
    const { engine, driver } = await boot();
    seed(driver, 'att', [{ id: 'a1', status: 'x', owner: 'u1' }]);
    const seen: Seen[] = [];
    engine.registerHook(
      'beforeDelete',
      async (ctx: HookContext) => { seen.push(snapshot(ctx)); },
      { object: 'att', dispatchUnscopedMultiDelete: true },
    );

    await engine.delete('att', { multi: true, where: {}, context: { userId: 'u1' } } as any);
    // Per-row only: the guard's whole-operation branch is not summoned for a
    // query that really ran and really matched.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ id: 'a1', mode: 'per-row' });
    expect(rowsIn(driver, 'att')).toBe(0);
  });

  it('a by-id delete is untouched', async () => {
    const { engine, driver } = await boot();
    seed(driver, 'att', [{ id: 'a1', status: 'x', owner: 'u1' }]);
    const seen: Seen[] = [];
    engine.registerHook(
      'beforeDelete',
      async (ctx: HookContext) => { seen.push(snapshot(ctx)); },
      { object: 'att', dispatchUnscopedMultiDelete: true },
    );

    await engine.delete('att', { where: { id: 'a1' }, context: { userId: 'u1' } } as any);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.id).toBe('a1');
    expect(seen[0]!.mode).toBe('record');
    expect(rowsIn(driver, 'att')).toBe(0);
  });

  it('an object whose registration does NOT declare the flag keeps exactly today\'s dispatches', async () => {
    const { engine, driver } = await boot();
    seed(driver, 'task', [
      { id: 't1', status: 'x', owner: 'u1' },
      { id: 't2', status: 'y', owner: 'u1' },
    ]);
    const seen: Seen[] = [];
    engine.registerHook(
      'beforeDelete',
      async (ctx: HookContext) => { seen.push(snapshot(ctx)); },
      { object: 'task' },
    );

    await engine.delete('task', { multi: true, context: { userId: 'u1' } } as any);
    // Per-row dispatches only — no whole-operation call arrived, and the
    // unscoped wipe proceeds as it does today for undeclared objects.
    expect(seen).toHaveLength(2);
    expect(seen.every((s) => s.id !== undefined && s.mode === 'per-row')).toBe(true);
    expect(rowsIn(driver, 'task')).toBe(0);
  });
});

describe('[#9719] the id slot is not a lever on the whole-operation context', () => {
  it('binding `input.id` is refused with HookTargetRebindError, nothing deleted', async () => {
    const { engine, driver } = await boot();
    seed(driver, 'att', [{ id: 'a1', status: 'x', owner: 'u1' }]);
    engine.registerHook(
      'beforeDelete',
      async (ctx: HookContext) => {
        if ((ctx.input as any).id === undefined) (ctx.input as any).id = 'a1';
      },
      { object: 'att', dispatchUnscopedMultiDelete: true },
    );

    await expect(engine.delete('att', { multi: true, context: { userId: 'u1' } } as any))
      .rejects.toMatchObject({ code: HOOK_TARGET_REBIND_ERROR_CODE, path: 'unscoped-multi' });
    expect(driver.calls).toEqual([]);
    expect(rowsIn(driver, 'att')).toBe(1);
  });
});
