// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22782 — an `after*` hook whose `onError` is `abort` (the default) rolls its
 * write back, as `HookSchema.onError` says ("abort: Rollback transaction").
 *
 * Before this, a plain write opened no unit of work, so a throwing
 * `afterInsert` refused the caller while the row, and the `ctx.api` write an
 * earlier hook made, stayed stored. The write door now opens a unit for exactly
 * that case (`inAfterAbortUnit`); every other write opens none, which the
 * `begun` ledger below measures.
 *
 * The driver rolls back for real (a snapshot per transaction): a stub whose
 * `rollback()` is a no-op cannot tell "wrapped" from "not wrapped".
 */

import { describe, it, expect } from 'vitest';
import type { Hook } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { bindHooksToEngine } from './hook-binder.js';
import { HookConditionError } from './hook-wrappers.js';

function makeDriver(name: string, opts: { transactional?: boolean; failParentUpdate?: boolean } = {}) {
  let stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => stores.get(o) ?? (stores.set(o, new Map()), stores.get(o)!);
  const matches = (row: Record<string, unknown>, where: any) =>
    !where || Object.entries(where).every(([k, v]) => k.startsWith('$') || row[k] === v);
  const begun: unknown[] = [];
  const rolledBack: unknown[] = [];
  const snapshots = new Map<unknown, typeof stores>();
  let n = 0;
  const driver: any = {
    name, version: '0.0.0', supports: {}, begun, rolledBack,
    rowsOf: (o: string) => Array.from(storeFor(o).values()),
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async syncSchema() {},
    async find(o: string, ast: any) {
      const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(o: string, ast: any) { return (await this.find(o, ast))[0] ?? null; },
    async create(o: string, data: Record<string, unknown>) {
      const row = { ...data, id: (data.id as string) ?? `${o}_${++n}` };
      storeFor(o).set(row.id, row);
      return row;
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      if (opts.failParentUpdate && o === 'inv') throw new Error('ETIMEDOUT');
      const row = { ...storeFor(o).get(String(id)), ...data, id };
      storeFor(o).set(String(id), row);
      return row;
    },
    async delete(o: string, id: string) { return storeFor(o).delete(String(id)); },
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
  };
  if (opts.transactional !== false) {
    driver.beginTransaction = async () => {
      const handle = { trx: begun.length + 1 };
      snapshots.set(handle, new Map(Array.from(stores, ([o, s]) => [o, new Map(Array.from(s, ([k, v]) => [k, { ...v }]))])));
      begun.push(handle);
      return handle;
    };
    driver.commit = async (h: unknown) => { snapshots.delete(h); };
    driver.rollback = async (h: unknown) => { stores = snapshots.get(h) ?? stores; rolledBack.push(h); };
  }
  return driver;
}

const obj = (name: string, extra: Record<string, unknown> = {}) => ({
  name, label: name, fields: { id: { name: 'id', type: 'text', primaryKey: true }, name: { name: 'name', type: 'text' }, ...extra },
});
const hook = (name: string, events: string[], handler: (ctx: any) => unknown, extra: Partial<Hook> = {}) =>
  ({ name, object: 'case', events, handler, ...extra }) as unknown as Hook;
const boom = () => { throw new Error('refused by the hook'); };
/** The earlier `afterInsert` the card measured: it writes a note through `ctx.api` first. */
const noteWriter = hook('note_writer', ['afterInsert'], (ctx) => ctx.api.object('note').insert({ name: 'from-hook' }), { priority: 10 });

async function makeEngine(hooks: Hook[], opts: { transactional?: boolean; caseDriver?: string; failParentUpdate?: boolean } = {}) {
  const warns: string[] = [];
  const errors: string[] = [];
  const log = () => {};
  const logger = { debug: log, info: log, error: (m: string) => void errors.push(String(m)), warn: (m: string) => void warns.push(String(m)) };
  const engine = new ObjectQL({ logger } as any);
  const driver = makeDriver('primary', opts);
  engine.registerDriver(driver, true);
  const side = makeDriver('side');
  engine.registerDriver(side);
  await engine.init();
  engine.registry.registerObject({ ...obj('case'), ...(opts.caseDriver ? { datasource: opts.caseDriver } : {}) } as any, '__test__');
  engine.registry.registerObject(obj('note') as any, '__test__');
  bindHooksToEngine(engine, hooks, { packageId: 'app:t', logger });
  return { engine, driver, side, warns, errors };
}

describe('#22782 — an aborting after* hook rolls its write back', () => {
  it('a throwing afterInsert with the default onError: refused, the row and the chain\'s ctx.api write absent', async () => {
    const { engine, driver } = await makeEngine([noteWriter, hook('veto', ['afterInsert'], boom, { priority: 20 })]);
    await expect(engine.insert('case', { name: 'c1' })).rejects.toThrow('refused by the hook');
    expect(driver.rowsOf('case')).toEqual([]);
    expect(driver.rowsOf('note')).toEqual([]);
    expect(driver.begun).toHaveLength(1);
    expect(driver.rolledBack).toHaveLength(1);
  });

  it('afterUpdate and afterDelete: the stored row is what it was before the refused write', async () => {
    const { engine, driver } = await makeEngine([hook('veto', ['afterUpdate', 'afterDelete'], boom)]);
    const row = await engine.insert('case', { name: 'before' });
    await expect(engine.update('case', { name: 'after' }, { where: { id: row.id } } as any)).rejects.toThrow('refused by the hook');
    await expect(engine.delete('case', { where: { id: row.id } } as any)).rejects.toThrow('refused by the hook');
    expect(driver.rowsOf('case')).toMatchObject([{ id: row.id, name: 'before' }]);
    expect(driver.begun).toHaveLength(2);
  });

  it('CONTROL onError: \'log\' — the row is stored and no unit is opened', async () => {
    const { engine, driver } = await makeEngine([hook('veto', ['afterInsert'], boom, { onError: 'log' })]);
    await engine.insert('case', { name: 'c1' });
    expect(driver.rowsOf('case')).toMatchObject([{ name: 'c1' }]);
    expect(driver.begun).toHaveLength(0);
  });

  it('CONTROL a throwing before* hook — refused, nothing stored, no unit opened', async () => {
    const { engine, driver } = await makeEngine([hook('veto', ['beforeInsert'], boom)]);
    await expect(engine.insert('case', { name: 'c1' })).rejects.toThrow('refused by the hook');
    expect(driver.rowsOf('case')).toEqual([]);
    expect(driver.begun).toHaveLength(0);
  });

  it('CONTROL inside a caller-opened transaction() — it joins (one unit), and the caller decides', async () => {
    const { engine, driver } = await makeEngine([hook('veto', ['afterInsert'], boom)]);
    await engine.transaction(async (trx: any) => {
      await expect(engine.insert('case', { name: 'kept' }, { context: trx })).rejects.toThrow('refused by the hook');
    });
    expect(driver.begun).toHaveLength(1);
    expect(driver.rolledBack).toHaveLength(0);
    expect(driver.rowsOf('case')).toMatchObject([{ name: 'kept' }]);
  });

  it('no unit for a hook that cannot abort the write: async, code-registered, or skipped automations', async () => {
    const { engine, driver } = await makeEngine([hook('fire_and_forget', ['afterInsert'], () => {}, { async: true })]);
    engine.registerHook('afterInsert', async () => {}, { object: 'case' });
    await engine.insert('case', { name: 'c1' });
    const vetoed = await makeEngine([hook('veto', ['afterInsert'], boom)]);
    await vetoed.engine.insert('case', { name: 'c2' }, { context: { isSystem: true, skipAutomations: true } as any });
    expect(driver.begun).toHaveLength(0);
    expect(vetoed.driver.begun).toHaveLength(0);
  });

  it('no unit where one cannot hold — off the default driver, or a driver with no transactions — and no warning', async () => {
    const off = await makeEngine([hook('veto', ['afterInsert'], boom)], { caseDriver: 'side' });
    await expect(off.engine.insert('case', { name: 'c1' })).rejects.toThrow('refused by the hook');
    expect(off.side.rowsOf('case')).toMatchObject([{ name: 'c1' }]);
    const plain = await makeEngine([hook('veto', ['afterInsert'], boom)], { transactional: false });
    await expect(plain.engine.insert('case', { name: 'c2' })).rejects.toThrow('refused by the hook');
    expect(plain.driver.rowsOf('case')).toMatchObject([{ name: 'c2' }]);
    expect([...off.driver.begun, ...off.side.begun]).toHaveLength(0);
    expect(plain.warns.filter((w) => w.includes('transaction'))).toEqual([]);
  });

  it('a roll-up failure inside the unit still means "the records WERE written": committed, then thrown', async () => {
    const { engine, driver } = await makeEngine([], { failParentUpdate: true });
    (engine as any).summaryRetryOptions = { sleep: async () => {}, backoffBaseMs: 0 };
    engine.registry.registerObject({ name: 'inv', fields: { total: { type: 'summary', summaryOperations: { object: 'inv_line', field: 'amount', function: 'sum' } } } } as any);
    engine.registry.registerObject({ name: 'inv_line', fields: { amount: { type: 'number' }, inv: { type: 'master_detail', reference: 'inv' } } } as any);
    bindHooksToEngine(engine, [{ name: 'observe', object: 'inv_line', events: ['afterInsert'], handler: () => {} } as unknown as Hook], { packageId: 'app:s' });
    const parent = await engine.insert('inv', {});
    await expect(engine.insert('inv_line', { inv: parent.id, amount: 1 })).rejects.toMatchObject({ code: 'ERR_SUMMARY_RECOMPUTE' });
    expect(driver.begun).toHaveLength(1);
    expect(driver.rolledBack).toHaveLength(0);
    expect(driver.rowsOf('inv_line')).toHaveLength(1);
  });
});

/**
 * #22856 — a hook `condition` that cannot be evaluated aborts the operation
 * whatever the hook's `onError` (#4775: the gate sits outside `onError`), and
 * before the handler detaches for `async: true`. So an `after*` hook carrying a
 * condition can abort its write too, and the door's unit rolls the row back.
 */
describe('#22856 — an after* hook carrying a condition rolls its write back when the condition cannot be evaluated', () => {
  /** `previous` is unbound on an insert, so this condition cannot be evaluated there. */
  const unbindable = 'previous.name != record.name';
  /** A key `case` does not declare: unevaluable on every event. */
  const undeclared = 'record.stauts == "x"';
  const refusal = (p: Promise<unknown>) => p.then(() => null, (e) => e);
  /** `noteWriter` as a `log` hook: an `abort` one would open the unit by itself. */
  const loggedNoteWriter = hook('note_writer', ['afterInsert'], (ctx) => ctx.api.object('note').insert({ name: 'from-hook' }), { priority: 10, onError: 'log' });

  it('onError: \'log\' with a condition that cannot be evaluated: refused, the row and the chain\'s ctx.api write absent', async () => {
    const { engine, driver } = await makeEngine([loggedNoteWriter, hook('watch', ['afterInsert'], () => {}, { priority: 20, onError: 'log', condition: unbindable })]);
    const err = await refusal(engine.insert('case', { name: 'c1' }));
    expect(err).toBeInstanceOf(HookConditionError);
    expect(err).toMatchObject({ hook: 'watch', event: 'afterInsert', reason: 'unevaluable' });
    expect(driver.rowsOf('case')).toEqual([]);
    expect(driver.rowsOf('note')).toEqual([]);
    expect([driver.begun.length, driver.rolledBack.length]).toEqual([1, 1]);
  });

  it('onError: \'log\', afterUpdate and afterDelete: the stored row is what it was before the refused write', async () => {
    const { engine, driver } = await makeEngine([hook('watch', ['afterUpdate', 'afterDelete'], () => {}, { onError: 'log', condition: undeclared })]);
    const row = await engine.insert('case', { name: 'before' });
    expect(await refusal(engine.update('case', { name: 'after' }, { where: { id: row.id } } as any))).toMatchObject({ name: 'HookConditionError', event: 'afterUpdate' });
    expect(await refusal(engine.delete('case', { where: { id: row.id } } as any))).toMatchObject({ name: 'HookConditionError', event: 'afterDelete' });
    expect(driver.rowsOf('case')).toMatchObject([{ id: row.id, name: 'before' }]);
    expect([driver.begun.length, driver.rolledBack.length]).toEqual([2, 2]);
  });

  it('async: true — the condition is evaluated before the hook detaches, so it refuses the write, and the row is rolled back', async () => {
    let ran = 0;
    const { engine, driver } = await makeEngine([hook('later', ['afterInsert'], () => { ran += 1; }, { async: true, onError: 'log', condition: unbindable })]);
    expect(await refusal(engine.insert('case', { name: 'c1' }))).toBeInstanceOf(HookConditionError);
    expect(driver.rowsOf('case')).toEqual([]);
    expect([driver.begun.length, driver.rolledBack.length, ran]).toEqual([1, 1, 0]);
  });

  it('CONTROL onError: \'log\' with a condition that evaluates: the handler throws, the error is logged, the row is stored', async () => {
    const { engine, driver, errors } = await makeEngine([hook('watch', ['afterInsert'], boom, { onError: 'log', condition: 'record.name == "c1"' })]);
    await engine.insert('case', { name: 'c1' });
    await engine.insert('case', { name: 'c2' }); // FALSE: skipped
    expect(driver.rowsOf('case')).toMatchObject([{ name: 'c1' }, { name: 'c2' }]);
    expect(errors).toEqual(['[hook] handler failed (onError=log; suppressing)']);
    expect(driver.rolledBack).toHaveLength(0);
  });

  it('CONTROL an abort hook with that condition: refused, the row absent — as #22782 leaves it', async () => {
    const { engine, driver } = await makeEngine([hook('watch', ['afterInsert'], () => {}, { condition: unbindable })]);
    expect(await refusal(engine.insert('case', { name: 'c1' }))).toBeInstanceOf(HookConditionError);
    expect(driver.rowsOf('case')).toEqual([]);
    expect([driver.begun.length, driver.rolledBack.length]).toEqual([1, 1]);
  });

  it('CONTROL skipped automations: the conditional hook does not run, no unit is opened, the row is stored', async () => {
    const { engine, driver } = await makeEngine([hook('watch', ['afterInsert'], () => {}, { onError: 'log', condition: unbindable })]);
    await engine.insert('case', { name: 'c1' }, { context: { isSystem: true, skipAutomations: true } as any });
    expect(driver.rowsOf('case')).toMatchObject([{ name: 'c1' }]);
    expect(driver.begun).toHaveLength(0);
  });
});
