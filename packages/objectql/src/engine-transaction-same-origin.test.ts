// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #5351 + #5696 point 2 — the SAME-ORIGIN transaction gate, and the two answers
// the 2026-08-06 maintainer ruling gave it.
//
// The defect (#5351, reproduced independently in PR #5724): `buildDriverOptions`
// lifted the ambient transaction handle onto EVERY driver call with no idea
// which driver was about to receive it. A write routed elsewhere — by
// `setDatasourceMapping`, by an explicit `datasource:` binding, or by ADR-0057
// §3.6 lifecycle-class separation — was handed the DEFAULT driver's handle and
// executed on the wrong connection. On knex/SQLite that is `no such table`
// against a database that never held the object, which is how every compliance
// audit row written inside a transaction was being lost: 52 insert attempts, 50
// successes, and the 2 failures were exactly the 2 with a `trxClient.query`
// frame in their stack.
//
// The ruling is two answers, because the two kinds of write fail in opposite
// directions:
//
//   BUSINESS writes are REFUSED (#5696 point 2) — no two-phase commit exists,
//   so the honest move is to make the caller choose instead of committing part
//   of a "unit of work" they can neither see nor undo.
//
//   APPEND-ONLY SYSTEM LEDGERS are CARVED OUT (#5351 plan A) — audit /
//   telemetry / event rows execute OUTSIDE the transaction, on their own
//   connection, and therefore SURVIVE a rollback. The orphan row is the
//   deliberate cost: for an append-only ledger a spurious row is reconcilable,
//   while a missing row for a write that DID commit is an unrecoverable
//   compliance hole.
//
// Why they had to land together: refusal alone would be "loud but not fixed".
// An audit hook's try/catch eats the refusal and logs it, and the compliance
// row is lost exactly as before — only now with a different log line.

import { describe, it, expect } from 'vitest';
import { ObjectQL, ScopedContext } from './engine.js';
import { CrossDatasourceTransactionWriteError } from './transaction-errors.js';

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
 * The error a call rejected with, typed as `E`.
 *
 * `promise.catch((e) => e as E)` types the result as `E | <resolved type>`, so
 * every property read on it is a type error. This narrows to the rejection and
 * fails loudly if the call did NOT reject — which a bare `.catch()` would
 * silently let through as a passing test.
 */
async function rejection<E>(p: Promise<unknown>): Promise<E> {
  try {
    await p;
  } catch (e) {
    return e as E;
  }
  throw new Error('expected the call to reject, but it resolved');
}

function meta(r: Recorded): Record<string, unknown> {
  return (r.args.find((a) => a !== undefined && typeof a === 'object' && !(a instanceof Error)) ??
    {}) as Record<string, unknown>;
}

/** One write the driver double saw — the shape its `writes` array carries. */
type RecordedWrite = { object: string; op: 'create' | 'update' | 'delete'; transaction: unknown };

function makeDriver(name: string) {
  const writes: RecordedWrite[] = [];
  const reads: Array<{ object: string; transaction: unknown }> = [];
  const rows = new Map<string, Record<string, unknown>>();
  let nextId = 0;
  const driver: any = {
    name,
    version: '0.0.0',
    supports: {},
    writes,
    reads,
    rows,
    async connect() {},
    async disconnect() {},
    async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, _ast: any, options: any) {
      reads.push({ object, transaction: options?.transaction });
      return Array.from(rows.values());
    },
    async findOne(object: string, ast: any, options: any) {
      reads.push({ object, transaction: options?.transaction });
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
    // A transaction handle is a per-connection object. The double names its
    // driver so a handle arriving at the WRONG driver is visible in one glance —
    // which is precisely the defect #5351 measured.
    beginTransaction: async () => ({ __trx: name }),
    commit: async () => {},
    rollback: async () => {},
  };
  return driver;
}

/**
 * The real #5351 topology: a primary business datasource plus the dedicated
 * `telemetry` datasource ADR-0057 §3.6 routes lifecycle-classed system data to,
 * plus a plain business object routed away by an ordinary mapping rule.
 */
async function splitEngine() {
  const rec = recordingLogger();
  const engine = new ObjectQL({ logger: rec.logger } as any);
  const primary = makeDriver('primary');
  const telemetry = makeDriver(ObjectQL.LIFECYCLE_DATASOURCE);
  const ledgerDb = makeDriver('ledger_db');
  engine.registerDriver(telemetry);
  engine.registerDriver(ledgerDb);
  engine.registerDriver(primary, true); // default
  await engine.init();
  // `ledger` is an ordinary BUSINESS object that a mapping rule routes away.
  engine.setDatasourceMapping([{ objectPattern: 'ledger', datasource: 'ledger_db' }]);
  engine.registry.registerObject({ name: 'thing', fields: { name: { type: 'text' } } }, '__test__');
  engine.registry.registerObject({ name: 'ledger', fields: { name: { type: 'text' } } }, '__test__');
  // The three append-only system ledgers, routed by lifecycle class alone.
  engine.registry.registerObject({
    name: 'sys_audit_log',
    lifecycle: { class: 'audit', retention: { maxAge: '90d' } },
    fields: { action: { type: 'text' } },
  } as any, '__test__');
  engine.registry.registerObject({
    name: 'sys_activity',
    lifecycle: { class: 'telemetry', retention: { maxAge: '14d' } },
    fields: { action: { type: 'text' } },
  } as any, '__test__');
  engine.registry.registerObject({
    name: 'sys_bus_event',
    lifecycle: { class: 'event', ttl: { field: 'created_at', expireAfter: '6h' } },
    fields: { action: { type: 'text' } },
  } as any, '__test__');
  const carveOutNotes = () =>
    rec.at('debug').filter((r) => r.message.includes('executing it OUTSIDE the transaction'));
  return { rec, engine, primary, telemetry, ledgerDb, carveOutNotes };
}

// ---------------------------------------------------------------------------
// (a) The system-ledger carve-out — the compliance row actually lands
// ---------------------------------------------------------------------------

describe('an audit-shaped write inside a cross-origin transaction LANDS, outside it (#5351)', () => {
  it('reaches the telemetry datasource with NO foreign transaction handle', async () => {
    const { engine, telemetry, primary } = await splitEngine();

    await engine.transaction(async () => {
      await engine.insert('thing', { name: 'business row' });
      // The shape of an `afterInsert` audit hook: an ordinary insert of an
      // audit-class object, made by an author who knows nothing about routing.
      await engine.insert('sys_audit_log', { action: 'insert thing' });
    });

    // It landed — this is the whole point. Before #5351 this write was handed
    // `primary`'s handle and, on a real SQL driver, never reached this store.
    expect(telemetry.writes).toHaveLength(1);
    expect(telemetry.writes[0]).toMatchObject({ object: 'sys_audit_log', op: 'create' });
    // And it landed WITHOUT another driver's connection. Asserting `undefined`
    // rather than "not primary's": there is no handle this driver could
    // legitimately have been given, since the engine opened no transaction here.
    expect(telemetry.writes[0].transaction).toBeUndefined();
    // The business write is unaffected and still rides its own transaction.
    expect(primary.writes).toHaveLength(1);
    expect(primary.writes[0].transaction).toEqual({ __trx: 'primary' });
  });

  it('covers all three system-ledger classes, not just audit', async () => {
    const { engine, telemetry } = await splitEngine();

    await engine.transaction(async () => {
      await engine.insert('sys_audit_log', { action: 'a' });
      await engine.insert('sys_activity', { action: 'b' });
      await engine.insert('sys_bus_event', { action: 'c' });
    });

    expect(telemetry.writes.map((w: RecordedWrite) => w.object)).toEqual(['sys_audit_log', 'sys_activity', 'sys_bus_event']);
    expect(telemetry.writes.every((w: RecordedWrite) => w.transaction === undefined)).toBe(true);
  });

  it('SURVIVES the rollback of the business transaction — the orphan row, pinned', async () => {
    const { engine, telemetry, primary } = await splitEngine();
    let rolledBack = false;
    primary.rollback = async () => { rolledBack = true; };

    await expect(
      engine.transaction(async () => {
        await engine.insert('thing', { name: 'doomed' });
        await engine.insert('sys_audit_log', { action: 'insert thing' });
        throw new Error('business failure');
      }),
    ).rejects.toThrow('business failure');

    expect(rolledBack).toBe(true);
    // The decided cost of plan A, asserted rather than left implicit: an audit
    // row describing a write that was undone. For an append-only compliance
    // ledger this is the correct direction of error — a spurious row can be
    // reconciled against the business data, a MISSING row for a write that did
    // commit cannot be recovered at all. ADR-0067/ADR-0119 record it.
    expect(telemetry.writes).toHaveLength(1);
    expect(telemetry.writes[0]).toMatchObject({ object: 'sys_audit_log' });
  });

  it('notes the carve-out at debug — once per transaction per datasource', async () => {
    const { engine, carveOutNotes, rec } = await splitEngine();

    await engine.transaction(async () => {
      await engine.insert('sys_audit_log', { action: 'a' });
      await engine.insert('sys_audit_log', { action: 'b' });
      await engine.insert('sys_activity', { action: 'c' });
    });

    const notes = carveOutNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toContain("insert of 'sys_audit_log'");
    expect(notes[0].message).toContain('SURVIVE a rollback');
    expect(meta(notes[0])).toMatchObject({
      object: 'sys_audit_log',
      operation: 'insert',
      datasource: ObjectQL.LIFECYCLE_DATASOURCE,
      transactionDatasource: 'primary',
    });
    // NOT `warn`, NOT `error`. This is now DECLARED behaviour that fires on
    // every audited write of every transaction in a lifecycle-split deployment;
    // AGENTS.md's judgment question asks whether something claimed persisted
    // has failed to land, and here it lands. Escalating it would train readers
    // to skim the levels that carry real durability failures.
    expect(rec.at('error')).toHaveLength(0);
    expect(rec.at('warn')).toHaveLength(0);
  });

  it('re-notes in a NEW transaction — the budget is per transaction', async () => {
    const { engine, carveOutNotes } = await splitEngine();

    await engine.transaction(async () => { await engine.insert('sys_audit_log', { action: 'a' }); });
    await engine.transaction(async () => { await engine.insert('sys_audit_log', { action: 'b' }); });

    expect(carveOutNotes()).toHaveLength(2);
  });

  it('carves out update and delete of a system ledger too, not just insert', async () => {
    const { engine, telemetry } = await splitEngine();

    const seeded = await engine.insert('sys_audit_log', { action: 'seed' });
    await engine.transaction(async () => {
      await engine.update('sys_audit_log', { id: seeded.id, action: 'amended' });
      await engine.delete('sys_audit_log', { where: { id: seeded.id } } as any);
    });

    const inTxn = telemetry.writes.slice(1) as RecordedWrite[];
    expect(inTxn.map((w) => w.op)).toEqual(['update', 'delete']);
    expect(inTxn.every((w) => w.transaction === undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (b) Business writes across drivers — refused, by name
// ---------------------------------------------------------------------------

describe('a BUSINESS write across drivers inside a transaction is refused (#5696 point 2)', () => {
  it('throws CrossDatasourceTransactionWriteError naming both datasources and the fix', async () => {
    const { engine } = await splitEngine();

    const err = await rejection<CrossDatasourceTransactionWriteError>(
      engine.transaction(async () => { await engine.insert('ledger', { name: 'NOT covered' }); }),
    );

    expect(err).toBeInstanceOf(CrossDatasourceTransactionWriteError);
    expect(err.code).toBe('ERR_CROSS_DATASOURCE_TRANSACTION_WRITE');
    expect(err).toMatchObject({
      object: 'ledger',
      operation: 'insert',
      datasource: 'ledger_db',
      transactionDatasource: 'primary',
    });
    // A refusal owes the caller the remedy — both routes out, concretely.
    expect(err.message).toContain('datasourceMapping');
    expect(err.message).toContain('split the work into per-datasource units');
    expect(err.message).toContain('Nothing was written.');
  });

  it('writes nothing, on either datasource, and rolls the transaction back', async () => {
    const { engine, primary, ledgerDb } = await splitEngine();
    let rolledBack = false;
    primary.rollback = async () => { rolledBack = true; };

    await expect(
      engine.transaction(async () => {
        await engine.insert('thing', { name: 'first' });
        await engine.insert('ledger', { name: 'refused' });
      }),
    ).rejects.toBeInstanceOf(CrossDatasourceTransactionWriteError);

    // Refused before any hook, default or validation ran — so the cross-driver
    // store is untouched, and the covered write is undone by the rollback the
    // rejection triggers. This is the difference from the pre-v17 behaviour:
    // the caller now learns before a partial commit exists, not after.
    expect(ledgerDb.writes).toHaveLength(0);
    expect(rolledBack).toBe(true);
  });

  it('refuses update and delete too', async () => {
    const { engine } = await splitEngine();
    const seeded = await engine.insert('ledger', { name: 'seed' });

    await expect(
      engine.transaction(async () => { await engine.update('ledger', { id: seeded.id, name: 'x' }); }),
    ).rejects.toMatchObject({ operation: 'update', code: 'ERR_CROSS_DATASOURCE_TRANSACTION_WRITE' });

    await expect(
      engine.transaction(async () => { await engine.delete('ledger', { where: { id: seeded.id } } as any); }),
    ).rejects.toMatchObject({ operation: 'delete', code: 'ERR_CROSS_DATASOURCE_TRANSACTION_WRITE' });
  });

  it('refuses from a nested transaction() that JOINED the outer one (ADR-0067 D2)', async () => {
    const { engine } = await splitEngine();

    // A joined nested call opens nothing — it runs in the outer scope, so the
    // OUTER owner is what the write is measured against. Just as uncovered as
    // at the top level, and refused the same way.
    await expect(
      engine.transaction(async () => {
        await engine.transaction(async () => { await engine.insert('ledger', { name: 'nested' }); });
      }),
    ).rejects.toMatchObject({ transactionDatasource: 'primary' });
  });

  it('refuses from ScopedContext.transaction too (ctx.api.transaction in a hook body)', async () => {
    const { engine } = await splitEngine();
    const scoped = (engine as any).createContext({ userId: 'u1' }) as ScopedContext;

    await expect(
      scoped.transaction(async () => { await engine.insert('ledger', { name: 'from sandbox' }); }),
    ).rejects.toBeInstanceOf(CrossDatasourceTransactionWriteError);
  });

  it('refuses from a ScopedContext.transaction that JOINED the outer one, against the OUTER owner (#6168)', async () => {
    const { engine } = await splitEngine();

    // #6168 made `ctx.api.transaction` join an ambient transaction instead of
    // opening a second one. The joined callback is handed the OUTER handle, so
    // the same-origin gate attributes it to the outer scope by identity
    // (`transactionCoversDriverFor`) and judges the write exactly as it judges
    // a write made directly in the outer call: refused, and refused naming the
    // OUTER datasource. The join changes which transaction the write is in, not
    // how #5351 measures it — there is no new interaction between the two.
    const err = await rejection<CrossDatasourceTransactionWriteError>(
      engine.transaction(async (outerCtx: any) => {
        const scoped = (engine as any).createContext({
          userId: 'u1',
          transaction: outerCtx.transaction,
        }) as ScopedContext;
        await scoped.transaction(async (trxCtx: any) => {
          await trxCtx.object('ledger').insert({ name: 'joined' });
        });
      }),
    );

    expect(err).toBeInstanceOf(CrossDatasourceTransactionWriteError);
    expect(err.transactionDatasource).toBe('primary');
    expect(err.operation).toBe('insert');
  });

  it('carves an audit row out of a JOINED ScopedContext.transaction the same way (#6168)', async () => {
    const { engine, telemetry, carveOutNotes } = await splitEngine();

    // The carve-out half of the same ruling, measured through the joined
    // surface: a system ledger still executes OUTSIDE the transaction, on its
    // own connection, with no foreign handle.
    await engine.transaction(async (outerCtx: any) => {
      const scoped = (engine as any).createContext({
        userId: 'u1',
        transaction: outerCtx.transaction,
      }) as ScopedContext;
      await scoped.transaction(async (trxCtx: any) => {
        await trxCtx.object('sys_audit_log').insert({ action: 'joined audit' });
      });
    });

    expect(telemetry.writes).toHaveLength(1);
    expect(telemetry.writes[0].transaction).toBeUndefined();
    expect(carveOutNotes()).toHaveLength(1);
  });

  it('does NOT refuse a mapped write made outside any transaction — no false positive', async () => {
    const { engine, ledgerDb } = await splitEngine();

    // Routing a business object to another datasource is normal and supported.
    // It is only a problem while a transaction is open and claiming to cover
    // the work.
    const seeded = await engine.insert('ledger', { name: 'plain write' });
    await engine.update('ledger', { id: seeded.id, name: 'renamed' });
    await engine.delete('ledger', { where: { id: seeded.id } } as any);

    expect(ledgerDb.writes.map((w: RecordedWrite) => w.op)).toEqual(['create', 'update', 'delete']);
  });

  it('stays quiet after the transaction closes — the scope does not leak', async () => {
    const { engine, ledgerDb } = await splitEngine();

    await engine.transaction(async () => { await engine.insert('thing', { name: 'covered' }); });
    await expect(engine.insert('ledger', { name: 'after' })).resolves.toBeTruthy();
    expect(ledgerDb.writes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Reads: never the wrong connection, never refused
// ---------------------------------------------------------------------------

describe('a cross-driver READ inside a transaction loses the handle but is not refused (#5351)', () => {
  it('does not hand the other driver the transaction handle', async () => {
    const { engine, ledgerDb, primary } = await splitEngine();

    await engine.transaction(async () => {
      await engine.find('thing', {});
      await engine.find('ledger', {});
    });

    // A read has no atomicity claim to break, so refusing it would only break
    // legitimate work (reference checks against a routed object, expand reads).
    // But it must not run on a connection its driver does not own — that was
    // the same wrong-connection defect, one verb over.
    //
    // Both lengths asserted first: `reads.at(-1)?.transaction` on an EMPTY
    // array is `undefined`, so the handle assertion alone would pass for the
    // reason "no read happened" rather than "the read was clean".
    expect(ledgerDb.reads).toHaveLength(1);
    expect(primary.reads).toHaveLength(1);
    expect(ledgerDb.reads[0].transaction).toBeUndefined();
    expect(primary.reads[0].transaction).toEqual({ __trx: 'primary' });
  });
});

// ---------------------------------------------------------------------------
// (e) Single-datasource deployments: nothing changes at all
// ---------------------------------------------------------------------------

describe('a same-origin (single datasource) transaction is untouched (#5351 regression guard)', () => {
  async function singleEngine() {
    const rec = recordingLogger();
    const engine = new ObjectQL({ logger: rec.logger } as any);
    const primary = makeDriver('primary');
    engine.registerDriver(primary, true);
    await engine.init();
    engine.registry.registerObject({ name: 'thing', fields: { name: { type: 'text' } } }, '__test__');
    // Audit-classed, but with NO telemetry datasource registered it resolves to
    // the default driver like everything else — ADR-0057 §3.6 is opt-in by the
    // datasource's existence. The carve-out must not fire on it.
    engine.registry.registerObject({
      name: 'sys_audit_log',
      lifecycle: { class: 'audit', retention: { maxAge: '90d' } },
      fields: { action: { type: 'text' } },
    } as any, '__test__');
    return { rec, engine, primary };
  }

  it('every write still rides the one transaction, audit rows included', async () => {
    const { engine, primary, rec } = await singleEngine();

    await engine.transaction(async () => {
      await engine.insert('thing', { name: 'a' });
      await engine.insert('sys_audit_log', { action: 'insert thing' });
    });

    expect(primary.writes).toHaveLength(2);
    expect(primary.writes.every((w: RecordedWrite) => JSON.stringify(w.transaction) === JSON.stringify({ __trx: 'primary' }))).toBe(true);
    // No carve-out, no refusal, and nothing said: the gate is invisible to the
    // deployments that make up the overwhelming majority.
    expect(rec.at('error')).toHaveLength(0);
    expect(rec.at('warn')).toHaveLength(0);
    expect(rec.at('debug').filter((r) => r.message.includes('OUTSIDE the transaction'))).toHaveLength(0);
  });

  it('rolls audit rows back with the business rows, exactly as before', async () => {
    const { engine, primary } = await singleEngine();
    let rolledBack = false;
    primary.rollback = async () => { rolledBack = true; };

    await expect(
      engine.transaction(async () => {
        await engine.insert('sys_audit_log', { action: 'doomed' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // No orphan-row semantics here — there is nothing to be orphaned FROM. The
    // carve-out's cost is paid only by deployments that actually split.
    expect(rolledBack).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The gate's declared limit — handles the engine cannot attribute
// ---------------------------------------------------------------------------

describe('the same-origin gate declines to judge a handle it cannot attribute (#5351 boundary)', () => {
  it('covers an explicitly-threaded handle when it IS the ambient one', async () => {
    const { engine, ledgerDb } = await splitEngine();

    // The dominant explicit path: `transaction()` hands the caller `trxCtx` and
    // the caller threads it back as `{ context: trxCtx }`. Identity-matching
    // that handle against the store entry is what keeps this path covered — a
    // caller cannot escape the gate by passing the context the engine gave it.
    await expect(
      engine.transaction(async (trxCtx) => {
        await engine.insert('ledger', { name: 'threaded' }, { context: trxCtx } as any);
      }),
    ).rejects.toBeInstanceOf(CrossDatasourceTransactionWriteError);
    expect(ledgerDb.writes).toHaveLength(0);
  });

  it('does NOT cover a foreign handle passed in from outside — declared, not overlooked', async () => {
    const { engine, ledgerDb } = await splitEngine();

    // The sandbox runner's discrete `beginTransaction`/`commit`/`rollback` trio
    // threads its handle across `setImmediate` boundaries where
    // AsyncLocalStorage does not survive, so it never populates txStore and the
    // engine holds an opaque driver object with no back-reference to its owner.
    // There is no honest comparison to make, and guessing would refuse
    // legitimate single-datasource work. So the pre-#5351 behaviour stands on
    // this path — pinned here so the limit is a recorded decision rather than a
    // gap someone discovers. Closing it needs handle ownership to become
    // discoverable on `IDataDriver`; filed separately.
    const foreign = { __trx: 'somebody elses handle' };
    await engine.insert('ledger', { name: 'unattributed' }, { context: { transaction: foreign } } as any);

    expect(ledgerDb.writes).toHaveLength(1);
    expect(ledgerDb.writes[0].transaction).toBe(foreign);
  });
});
