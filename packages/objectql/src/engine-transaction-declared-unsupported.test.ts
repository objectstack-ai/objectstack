// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#18063] The engine's transaction gate reads the DECLARATION, not bare method
// presence.
//
// The shape this exists for cannot be produced by the pre-existing doubles, and
// that is the whole point: a driver that INHERITS `beginTransaction` from a base
// class whose transport has transactions, while its own transport has none. The
// method is present, so the old gate — `if (!drv?.beginTransaction)` — answered
// "transactional", the engine opened a transaction, and the handle it minted
// reached no statement. The measured instance is the libSQL remote transport,
// whose data methods take no `options` argument at all: the write executed on
// the plain connection, was already durable, and `rollback()` resolved having
// undone nothing.
//
// A subclass cannot opt out of a door it did not open, which is why the answer
// is a declaration (`supports.transactionsUnsupported`) rather than a second
// method-presence test. `driverSupportsTransactions` in `@objectstack/spec` is
// the one definition; both engine transaction surfaces call it.
//
// ⭐ Every case below pairs with a LIT CONTROL on the same double with the bit
// removed — the difference between the two columns is the bit and nothing else,
// so a green assertion here cannot be green because the double is inert.

import { describe, it, expect } from 'vitest';
import { ObjectQL, ScopedContext } from './engine.js';
import { TransactionUnsupportedError } from './transaction-errors.js';

interface Recorded {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  args: unknown[];
}

function recordingLogger() {
  const records: Recorded[] = [];
  const push = (level: Recorded['level']) => (message: string, ...args: unknown[]) =>
    void records.push({ level, message: String(message), args });
  return {
    records,
    logger: { debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') },
    at(level: Recorded['level']) {
      return records.filter((r) => r.level === level);
    },
  };
}

/**
 * A driver that ALWAYS implements `beginTransaction` — the inherited door — and
 * differs only in whether it declares the transport cannot honour it.
 *
 * `begins` counts the calls, because "the engine did not open a transaction" is
 * the load-bearing observation and an absent handle alone would not prove it:
 * the engine could have opened one and dropped it.
 */
function makeDriver(name: string, declareUnsupported: boolean) {
  const writes: Array<{ object: string; op: string; transaction: unknown }> = [];
  const rows = new Map<string, Record<string, unknown>>();
  const begins: unknown[] = [];
  let nextId = 0;
  const driver: any = {
    name,
    version: '0.0.0',
    // The ONLY difference between the two columns.
    supports: declareUnsupported ? { transactionsUnsupported: true } : {},
    writes,
    begins,
    async connect() {},
    async disconnect() {},
    async checkHealth() { return true; },
    async execute() { return null; },
    async find() { return Array.from(rows.values()); },
    async findOne(_o: string, ast: any) {
      const id = ast?.where?.find?.((c: any) => c?.field === 'id')?.value;
      if (id !== undefined) return rows.get(String(id)) ?? null;
      for (const r of rows.values()) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>, options: any) {
      writes.push({ object, op: 'create', transaction: options?.transaction });
      nextId += 1;
      const id = (data.id as string) ?? `${name}_${nextId}`;
      const row = { ...data, id };
      rows.set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>, options: any) {
      writes.push({ object, op: 'update', transaction: options?.transaction });
      const row = { ...rows.get(String(id)), ...data, id };
      rows.set(String(id), row);
      return row;
    },
    async delete(object: string, id: string, options: any) {
      writes.push({ object, op: 'delete', transaction: options?.transaction });
      return rows.delete(String(id));
    },
    async count() { return 0; },
    async bulkCreate(object: string, batch: Record<string, unknown>[]) {
      return Promise.all(batch.map((r) => this.create(object, r, undefined)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async syncSchema() {},
    // Present on BOTH columns — inherited from a base whose transport can.
    async beginTransaction() {
      const handle = { __trx: name, n: begins.length };
      begins.push(handle);
      return handle;
    },
    async commit() {},
    async rollback() {},
  };
  return driver;
}

async function engineWith(declareUnsupported: boolean) {
  const rec = recordingLogger();
  const engine = new ObjectQL({ logger: rec.logger } as any);
  const driver = makeDriver('primary', declareUnsupported);
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject({ name: 'thing', fields: { name: { type: 'text' } } }, '__test__');
  return { rec, engine, driver };
}

const scopedOf = (engine: ObjectQL): ScopedContext =>
  (engine as any).createContext({ userId: 'u1' }) as ScopedContext;

describe('[#18063] engine.transaction() gates on supports.transactionsUnsupported', () => {
  it('does not call beginTransaction on a declaring driver — and DOES on the same double without the bit', async () => {
    const declared = await engineWith(true);
    const control = await engineWith(false);

    await declared.engine.transaction(async () => 'ran');
    await control.engine.transaction(async () => 'ran');

    // DARK: the declaration was honoured.
    expect(declared.driver.begins).toHaveLength(0);
    // LIT: the same double, same method, bit removed — the engine still opens
    // one, so the zero above is a reading and not an inert fixture.
    expect(control.driver.begins).toHaveLength(1);
  });

  it('runs the callback non-transactionally and threads NO handle to the writes', async () => {
    const declared = await engineWith(true);
    const control = await engineWith(false);

    await declared.engine.transaction(async () => {
      await declared.engine.insert('thing', { name: 'x' });
    });
    await control.engine.transaction(async () => {
      await control.engine.insert('thing', { name: 'x' });
    });

    expect(declared.driver.writes).toHaveLength(1);
    expect(declared.driver.writes[0].transaction).toBeUndefined();
    // LIT control: the write on the undeclared double carries the handle.
    expect(control.driver.writes[0].transaction).toEqual({ __trx: 'primary', n: 0 });
  });

  it('reports owned: false — there is no transaction here to own', async () => {
    const { engine } = await engineWith(true);
    let owned: boolean | undefined;
    await engine.transaction(async (_ctx: any, info: any) => { owned = info.owned; });
    expect(owned).toBe(false);
  });

  it('warns once, and the warning names the DECLARATION rather than a missing method', async () => {
    const { engine, rec } = await engineWith(true);

    await engine.transaction(async () => 1);
    await engine.transaction(async () => 2);

    const warns = rec.at('warn');
    expect(warns).toHaveLength(1);
    expect(warns[0].message).toContain('declares supports.transactionsUnsupported');
    // ⛔ The message an operator must NOT get: this driver publishes the method,
    // so sending them to look for a missing one wastes the report.
    expect(warns[0].message).not.toContain("driver 'primary' has no beginTransaction");
    // The consequence has to stay in the text — it is the reason this degrades
    // loudly rather than quietly.
    expect(warns[0].message).toContain('running WITHOUT transaction or rollback');
  });

  it('throws TransactionUnsupportedError under require: true, before the callback writes anything', async () => {
    const { engine, driver } = await engineWith(true);
    let ran = false;

    await expect(
      engine.transaction(async () => { ran = true; }, undefined, { require: true }),
    ).rejects.toBeInstanceOf(TransactionUnsupportedError);

    expect(ran).toBe(false);
    expect(driver.writes).toHaveLength(0);
    expect(driver.begins).toHaveLength(0);
  });
});

describe('[#18063] ScopedContext reads the same declaration', () => {
  it('degrades instead of opening one, with the LIT control opening one', async () => {
    const declared = await engineWith(true);
    const control = await engineWith(false);

    await expect(scopedOf(declared.engine).transaction(async () => 'ran')).resolves.toBe('ran');
    await expect(scopedOf(control.engine).transaction(async () => 'ran')).resolves.toBe('ran');

    expect(declared.driver.begins).toHaveLength(0);
    expect(control.driver.begins).toHaveLength(1);
  });

  it('the discrete trio returns null rather than a handle covering nothing', async () => {
    const declared = await engineWith(true);
    const control = await engineWith(false);

    const declaredOpened = await scopedOf(declared.engine).beginTransaction();
    const controlOpened = await scopedOf(control.engine).beginTransaction();

    // `null` is the trio's declared "no transaction support" answer, and the
    // caller then runs non-transactionally — the same graceful degrade a driver
    // with no `beginTransaction` already got.
    expect(declaredOpened).toBeNull();
    expect(controlOpened).not.toBeNull();
    expect(controlOpened!.owned).toBe(true);
  });

  it('refuses under require: true, on this surface too', async () => {
    const { engine } = await engineWith(true);
    await expect(
      scopedOf(engine).transaction(async () => 'unreachable', { require: true }),
    ).rejects.toBeInstanceOf(TransactionUnsupportedError);
  });
});
