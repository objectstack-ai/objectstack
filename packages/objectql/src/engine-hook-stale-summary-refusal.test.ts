// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A hook's own `ctx.api` write that raises the stale-roll-up refusal never
 * answers for the write the hook is bound to.
 *
 * `SummaryRecomputeError` (`ERR_SUMMARY_RECOMPUTE`) means "this write is
 * stored, only a parent's roll-up recompute failed". It carries the write's
 * result as `written`, and every answering surface turns it into that write's
 * own success. A hook that writes through `ctx.api` makes a write of its own.
 * When that write raised the refusal and the handler let it escape, the refusal
 * reached the OUTER write's caller unchanged. So the caller read the hook's
 * record as the result of its own write: measured through the REST data door
 * before this file, `POST /data/case` answered `201` with the id and record of
 * the row the hook wrote. Under an `after*` hook's unit (`inAfterAbortUnit`) the
 * unit then committed, because the refusal says "written".
 *
 * Pinned here, at the one seam a handler's error leaves through
 * (`triggerHooks`):
 *  - an aborting `afterInsert` / `afterUpdate` / `afterDelete` hook: the outer
 *    write refuses with an error that is NOT the stale-roll-up refusal (a
 *    declared `500 INTERNAL_ERROR`, no `written`, the refusal kept as `cause`),
 *    leading with the outer write, and its unit rolls both rows back;
 *  - a code-registered hook (no unit opens): the same refusal, whose text says
 *    what stays written, and both rows are stored;
 *  - a `before*` hook: the same refusal, and the outer row was never written.
 *
 * Controls: a hook declared `onError: 'log'` does not fail the outer write; the
 * outer write's OWN refusal still answers `ERR_SUMMARY_RECOMPUTE` carrying its
 * own result (and its unit still commits); any other error a hook throws passes
 * through unchanged.
 *
 * The driver rolls back for real (a snapshot per transaction), and refuses
 * every write to `bucket` while `refuseBucket` is set: that is the roll-up
 * recompute's parent update, refused without a transient message, so no retry
 * runs.
 */

import { describe, it, expect } from 'vitest';
import type { Hook } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { bindHooksToEngine } from './hook-binder.js';

type Row = Record<string, unknown>;

function makeDriver() {
  let stores = new Map<string, Map<string, Row>>();
  const storeFor = (o: string) => stores.get(o) ?? (stores.set(o, new Map()), stores.get(o)!);
  const matches = (row: Row, where: any) =>
    !where || Object.entries(where).every(([k, v]) => k.startsWith('$') || row[k] === v);
  const begun: unknown[] = [];
  const committed: unknown[] = [];
  const rolledBack: unknown[] = [];
  const snapshots = new Map<unknown, typeof stores>();
  const state = { refuseBucket: false };
  let n = 0;
  const driver: any = {
    name: 'primary', version: '0.0.0', supports: {}, begun, committed, rolledBack, state,
    rowsOf: (o: string) => Array.from(storeFor(o).values()),
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async syncSchema() {},
    async find(o: string, ast: any) {
      const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(o: string, ast: any) { return (await this.find(o, ast))[0] ?? null; },
    async create(o: string, data: Row) {
      const row = { ...data, id: (data.id as string) ?? `${o}_${++n}` };
      storeFor(o).set(String(row.id), row);
      return row;
    },
    async update(o: string, id: string, data: Row) {
      if (state.refuseBucket && o === 'bucket') throw new Error('bucket store refused the write');
      const row = { ...storeFor(o).get(String(id)), ...data, id };
      storeFor(o).set(String(id), row);
      return row;
    },
    async delete(o: string, id: string) { return storeFor(o).delete(String(id)); },
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Row[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() {
      const handle = { trx: begun.length + 1 };
      snapshots.set(handle, new Map(Array.from(stores, ([o, s]) => [o, new Map(Array.from(s, ([k, v]) => [k, { ...v }]))])));
      begun.push(handle);
      return handle;
    },
    async commit(h: unknown) { snapshots.delete(h); committed.push(h); },
    async rollback(h: unknown) { stores = snapshots.get(h) ?? stores; rolledBack.push(h); },
  };
  return driver;
}

const text = (name: string) => ({ name, type: 'text' });
/** The hook's own write: a `line`, whose roll-up into `bucket` the driver refuses. */
const writeLine = (ctx: any) => ctx.api.object('line').insert({ name: `from-${ctx.event}`, bucket: 'b1' });
const hook = (events: string[], handler: (ctx: any) => unknown, extra: Partial<Hook> = {}) =>
  ({ name: 'line_writer', object: 'case', events, handler, ...extra }) as unknown as Hook;

async function makeEngine(hooks: Hook[]) {
  const log = () => {};
  const engine = new ObjectQL({ logger: { debug: log, info: log, warn: log, error: log } } as any);
  (engine as any).summaryRetryOptions = { sleep: async () => {}, backoffBaseMs: 0 };
  const driver = makeDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject({ name: 'case', label: 'case', fields: { id: { ...text('id'), primaryKey: true }, name: text('name') } } as any, '__test__');
  engine.registry.registerObject({
    name: 'bucket', label: 'bucket',
    fields: {
      id: { ...text('id'), primaryKey: true }, name: text('name'),
      line_count: { name: 'line_count', type: 'summary', summaryOperations: { object: 'line', function: 'count' } },
    },
  } as any, '__test__');
  engine.registry.registerObject({
    name: 'line', label: 'line',
    fields: { id: { ...text('id'), primaryKey: true }, name: text('name'), bucket: { name: 'bucket', type: 'master_detail', reference: 'bucket' } },
  } as any, '__test__');
  await engine.insert('bucket', { id: 'b1', name: 'B' });
  await engine.insert('case', { id: 'c0', name: 'existing' });
  bindHooksToEngine(engine, hooks, { packageId: 'app:t' });
  driver.begun.length = 0;
  driver.committed.length = 0;
  driver.rolledBack.length = 0;
  driver.state.refuseBucket = true;
  return { engine, driver };
}

const refusal = (p: Promise<unknown>): Promise<any> => p.then(() => null, (e: unknown) => e);
const names = (rows: Row[]) => rows.map((r) => r.name).sort();

/** The converted refusal: an internal error naming the OUTER write, the hook write's refusal kept as `cause`. */
function expectHookStopped(err: any, lead: string) {
  expect(err).toBeInstanceOf(Error);
  expect(err.code).toBe('INTERNAL_ERROR');
  expect(err.status).toBe(500);
  expect(err.written).toBeUndefined();
  expect(err.failures).toBeUndefined();
  expect(err.cause?.code).toBe('ERR_SUMMARY_RECOMPUTE');
  expect(err.cause?.written?.name).toMatch(/^from-/);
  expect(err.message.startsWith(lead), err.message).toBe(true);
  expect(err.message).toContain('bucket.line_count');
}

describe('a hook\'s own ctx.api write that raises ERR_SUMMARY_RECOMPUTE never answers for the write it is bound to', () => {
  it('afterInsert (aborting, unit open): the insert refuses naming itself, and the unit rolls both rows back', async () => {
    const { engine, driver } = await makeEngine([hook(['afterInsert'], writeLine)]);
    const err = await refusal(engine.insert('case', { name: 'c-1' }));
    expectHookStopped(err, 'The insert of "case" did not complete: its afterInsert hook "line_writer" stopped.');
    expect(driver.begun).toHaveLength(1);
    expect(driver.committed).toHaveLength(0);
    expect(driver.rolledBack).toHaveLength(1);
    expect(names(driver.rowsOf('case'))).toEqual(['existing']);
    expect(driver.rowsOf('line')).toHaveLength(0);
  });

  it('afterUpdate and afterDelete (aborting, unit open): refused naming the outer write, the stored row unchanged', async () => {
    const upd = await makeEngine([hook(['afterUpdate'], writeLine)]);
    const updErr = await refusal(upd.engine.update('case', { id: 'c0', name: 'renamed' }));
    expectHookStopped(updErr, 'The update of "case" did not complete: its afterUpdate hook "line_writer" stopped.');
    expect(upd.driver.rolledBack).toHaveLength(1);
    expect(names(upd.driver.rowsOf('case'))).toEqual(['existing']);
    expect(upd.driver.rowsOf('line')).toHaveLength(0);

    const del = await makeEngine([hook(['afterDelete'], writeLine)]);
    const delErr = await refusal(del.engine.delete('case', { where: { id: 'c0' } }));
    expectHookStopped(delErr, 'The delete of "case" did not complete: its afterDelete hook "line_writer" stopped.');
    expect(del.driver.rolledBack).toHaveLength(1);
    expect(names(del.driver.rowsOf('case'))).toEqual(['existing']);
    expect(del.driver.rowsOf('line')).toHaveLength(0);
  });

  it('a code-registered afterInsert (no unit opens): the same refusal, saying what stays written, and both rows stored', async () => {
    const { engine, driver } = await makeEngine([]);
    engine.registerHook('afterInsert', writeLine, { object: 'case', hookName: 'code_line_writer' });
    const err = await refusal(engine.insert('case', { name: 'c-1' }));
    expectHookStopped(err, 'The insert of "case" did not complete: its afterInsert hook "code_line_writer" stopped.');
    expect(err.message).toContain(
      'Under a transaction that rolls back nothing was written; otherwise what was written before that point stays written.',
    );
    expect(driver.begun).toHaveLength(0);
    expect(names(driver.rowsOf('case'))).toEqual(['c-1', 'existing']);
    expect(names(driver.rowsOf('line'))).toEqual(['from-afterInsert']);
  });

  it('beforeInsert: the same refusal, and the outer row was never written', async () => {
    const { engine, driver } = await makeEngine([hook(['beforeInsert'], writeLine)]);
    const err = await refusal(engine.insert('case', { name: 'c-1' }));
    expectHookStopped(err, 'The insert of "case" did not complete: its beforeInsert hook "line_writer" stopped.');
    expect(names(driver.rowsOf('case'))).toEqual(['existing']);
    // No unit opens for a before* hook, so the hook's own write stays, as the text says.
    expect(names(driver.rowsOf('line'))).toEqual(['from-beforeInsert']);
  });

  it('CONTROL onError: \'log\': the hook\'s refusal is logged, and the outer insert answers its own row', async () => {
    const { engine, driver } = await makeEngine([hook(['afterInsert'], writeLine, { onError: 'log' })]);
    const row: any = await engine.insert('case', { name: 'c-1' });
    expect(row?.name).toBe('c-1');
    expect(names(driver.rowsOf('case'))).toEqual(['c-1', 'existing']);
    expect(names(driver.rowsOf('line'))).toEqual(['from-afterInsert']);
  });

  it('CONTROL the outer write\'s OWN refusal still answers ERR_SUMMARY_RECOMPUTE with its own result, and its unit commits', async () => {
    const { engine, driver } = await makeEngine([
      { name: 'observe', object: 'line', events: ['afterInsert'], handler: () => {} } as unknown as Hook,
    ]);
    const err = await refusal(engine.insert('line', { name: 'direct', bucket: 'b1' }));
    expect(err?.code).toBe('ERR_SUMMARY_RECOMPUTE');
    expect(err.written?.name).toBe('direct');
    expect(driver.begun).toHaveLength(1);
    expect(driver.committed).toHaveLength(1);
    expect(driver.rolledBack).toHaveLength(0);
    expect(names(driver.rowsOf('line'))).toEqual(['direct']);
  });

  it('CONTROL any other error a hook throws passes through unchanged', async () => {
    const boom = new Error('refused by the hook');
    const { engine } = await makeEngine([hook(['afterInsert'], () => { throw boom; })]);
    expect(await refusal(engine.insert('case', { name: 'c-1' }))).toBe(boom);
  });
});
