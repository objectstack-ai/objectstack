// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4619 (ADR-0119 D1 follow-up, engine half) — `transaction()` carries two
// caveats that are part of its DECLARED meaning, not hidden behaviour:
//
//   1. when the default driver has no `beginTransaction`, the callback runs
//      with no transaction and no rollback;
//   2. the transaction covers the DEFAULT datasource only, so an object routed
//      elsewhere by `setDatasourceMapping` is written outside it.
//
// Declaring them is not the same as being able to observe them. Both used to be
// completely mute: a caller asking for atomicity and not getting it had no way
// to find out, and a multi-datasource "atomic" unit of work that partially
// committed reported nothing at all. These tests pin the diagnostics that make
// the two DISCOVERABLE.
//
// What they deliberately do NOT pin is any change of behaviour. Refusing the
// degrade (`opts.require`) or refusing the cross-driver write would tighten the
// declared contract in `packages/spec/src/contracts/objectql-engine.ts`; that
// half of #4619 is spec-lane work and is not done here. So every assertion
// below is of the form "the same thing happens, and now it is also said".

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';

interface Recorded {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  /**
   * Everything after the message. The engine's logger contract is
   * `(msg, Error | undefined, meta)` for `error` and `(msg, meta)` for `warn`,
   * so the recorder keeps the raw tail and each assertion says which slot it
   * means — same reasoning as `schema-sync-durability-log-level.test.ts`.
   */
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

/** Records that mention `needle` anywhere in the message. */
function matching(records: Recorded[], needle: string): Recorded[] {
  return records.filter((r) => r.message.includes(needle));
}

/** Meta object the engine passes in the trailing slot. */
function meta(r: Recorded): Record<string, unknown> {
  return (r.args.find((a) => a !== undefined && typeof a === 'object' && !(a instanceof Error)) ??
    {}) as Record<string, unknown>;
}

/**
 * A driver that records the writes it sees. `transactional: false` makes it a
 * driver WITHOUT `beginTransaction` — the shape the degrade path exists for
 * (test doubles and foreign engines; every in-tree driver implements it).
 */
function makeDriver(name: string, opts: { transactional?: boolean } = {}) {
  const writes: Array<{ object: string; op: 'create' | 'update' | 'delete'; transaction: unknown }> = [];
  const rows = new Map<string, Record<string, unknown>>();
  let nextId = 0;
  const driver: any = {
    name,
    version: '0.0.0',
    supports: {},
    writes,
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
  };
  if (opts.transactional !== false) {
    driver.beginTransaction = async () => ({ __trx: name });
    driver.commit = async () => {};
    driver.rollback = async () => {};
  }
  return driver;
}

// ---------------------------------------------------------------------------
// 1. Silent degrade → warn-once
// ---------------------------------------------------------------------------

describe('transaction() degrade with no beginTransaction warns once (#4619)', () => {
  async function engineWithoutTransactions() {
    const rec = recordingLogger();
    const engine = new ObjectQL({ logger: rec.logger } as any);
    const driver = makeDriver('memory', { transactional: false });
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject({ name: 'thing', fields: { name: { type: 'text' } } } as any);
    return { rec, engine, driver };
  }

  it('warns — naming the driver, the consequence, and the fix — and still runs the callback', async () => {
    const { rec, engine } = await engineWithoutTransactions();

    let ran = false;
    const result = await engine.transaction(async () => {
      ran = true;
      return 'value';
    });

    // BEHAVIOUR IS UNCHANGED: the callback still runs and still returns.
    // Tightening this into a throw is the spec half of #4619, not this PR.
    expect(ran).toBe(true);
    expect(result).toBe('value');

    const warns = matching(rec.at('warn'), 'has no beginTransaction');
    expect(warns).toHaveLength(1);
    // Names the driver it is talking about.
    expect(warns[0].message).toContain("driver 'memory'");
    // The consequence, concretely (AGENTS.md: an operator log owes both).
    expect(warns[0].message).toContain('WITHOUT transaction or rollback');
    expect(warns[0].message).toMatch(/PERSISTED/);
    // The fix / the deliberate opt-out.
    expect(warns[0].message).toContain('beginTransaction for this datasource');
    expect(warns[0].message).toContain('fail');
    expect(meta(warns[0])).toMatchObject({ datasource: 'memory' });
  });

  it('is a WARN, not an error — nothing has been lost at the moment it fires', async () => {
    const { rec, engine } = await engineWithoutTransactions();
    await engine.transaction(async () => undefined);
    // AGENTS.md "Degradation log levels": this is the `if (!capability)`
    // composition branch — the capability is absent and every write still
    // lands. Escalating it to `error` is the mirror-image failure the same
    // section names (it trains readers to skim `error`).
    expect(matching(rec.at('error'), 'beginTransaction')).toHaveLength(0);
    expect(matching(rec.at('warn'), 'has no beginTransaction')).toHaveLength(1);
  });

  it('does not repeat itself — five more calls add no further warnings', async () => {
    const { rec, engine } = await engineWithoutTransactions();

    for (let i = 0; i < 6; i += 1) {
      await engine.transaction(async () => {
        await engine.insert('thing', { name: `row_${i}` });
      });
    }

    // Six degrades, one line. The drivers that reach this path reach it on
    // EVERY call, so per-call would be unreadable — which is the #4420 `warn`
    // failure mode, not a fix for it.
    expect(matching(rec.at('warn'), 'has no beginTransaction')).toHaveLength(1);
  });

  it('says nothing when the driver DOES support transactions', async () => {
    const rec = recordingLogger();
    const engine = new ObjectQL({ logger: rec.logger } as any);
    engine.registerDriver(makeDriver('memory'), true);
    await engine.init();
    engine.registry.registerObject({ name: 'thing', fields: { name: { type: 'text' } } } as any);

    await engine.transaction(async () => {
      await engine.insert('thing', { name: 'A' });
    });

    expect(matching(rec.at('warn'), 'beginTransaction')).toHaveLength(0);
    expect(matching(rec.at('error'), 'beginTransaction')).toHaveLength(0);
  });

  it('shares one budget with ScopedContext.transaction (ctx.api.transaction) — said once, not once per surface', async () => {
    const { rec, engine } = await engineWithoutTransactions();

    // The sandbox surface (`ctx.api.transaction(fn)`) is a SECOND
    // implementation of the same degrade in the same file. It reports through
    // the same engine-side helper, so "say it once" holds across both.
    const scoped = (engine as any).createContext({ userId: 'u1' });
    let scopedRan = false;
    await scoped.transaction(async () => { scopedRan = true; });
    expect(scopedRan).toBe(true);
    expect(matching(rec.at('warn'), 'has no beginTransaction')).toHaveLength(1);

    await engine.transaction(async () => undefined);
    expect(matching(rec.at('warn'), 'has no beginTransaction')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Default-driver-only → loud cross-datasource routing diagnostic
// ---------------------------------------------------------------------------

describe('a write inside transaction() routed off the default datasource is reported at error (#4619)', () => {
  async function twoDatasourceEngine() {
    const rec = recordingLogger();
    const engine = new ObjectQL({ logger: rec.logger } as any);
    const primary = makeDriver('primary');
    const ledgerDs = makeDriver('ledger_db');
    const archiveDs = makeDriver('archive_db');
    engine.registerDriver(ledgerDs);
    engine.registerDriver(archiveDs);
    engine.registerDriver(primary, true); // default
    await engine.init();
    // `ledger` and `archive` live elsewhere; `thing` stays on the default.
    engine.setDatasourceMapping([
      { objectPattern: 'ledger', datasource: 'ledger_db' },
      { objectPattern: 'archive', datasource: 'archive_db' },
    ]);
    engine.registry.registerObject({ name: 'thing', fields: { name: { type: 'text' } } } as any);
    engine.registry.registerObject({ name: 'ledger', fields: { name: { type: 'text' } } } as any);
    engine.registry.registerObject({ name: 'archive', fields: { name: { type: 'text' } } } as any);
    const splits = () => matching(rec.at('error'), 'running OUTSIDE the transaction');
    return { rec, engine, primary, ledgerDs, archiveDs, splits };
  }

  it('reports the split — which object, which datasource, and that it is outside the transaction', async () => {
    const { engine, ledgerDs, splits } = await twoDatasourceEngine();

    await engine.transaction(async () => {
      await engine.insert('thing', { name: 'covered' });
      await engine.insert('ledger', { name: 'NOT covered' });
    });

    const found = splits();
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("insert of 'ledger'");
    expect(found[0].message).toContain("datasource 'ledger_db'");
    expect(found[0].message).toContain("default datasource 'primary'");
    // The consequence, concretely, and the fix — both owed by an `error`.
    expect(found[0].message).toContain('rolling the transaction back will NOT undo it');
    expect(found[0].message).toContain('datasourceMapping');
    expect(meta(found[0])).toMatchObject({
      object: 'ledger',
      operation: 'insert',
      datasource: 'ledger_db',
      transactionDatasource: 'primary',
    });

    // BEHAVIOUR IS UNCHANGED: the write still went to the mapped datasource,
    // exactly as before. This PR reports; refusing is the spec half.
    expect(ledgerDs.writes).toHaveLength(1);
    expect(ledgerDs.writes[0]).toMatchObject({ object: 'ledger', op: 'create' });

    // And it is worse than "written without a transaction", which is what the
    // contract's caveat says. `buildDriverOptions` reads the ambient handle
    // with no idea which driver is about to receive it, so `ledger_db`'s driver
    // is handed `primary`'s transaction object. Pinned here as OBSERVED, not
    // endorsed — it predates this change (nothing here touches
    // `buildDriverOptions`) and is filed separately; the assertion exists so
    // that whoever fixes it sees this test, rather than a silent shift under a
    // `toBeUndefined()` that was only ever a guess.
    expect(ledgerDs.writes[0].transaction).toEqual({ __trx: 'primary' });
  });

  it('does not fire for writes that stay on the default datasource', async () => {
    const { engine, primary, splits } = await twoDatasourceEngine();

    await engine.transaction(async () => {
      await engine.insert('thing', { name: 'A' });
      await engine.insert('thing', { name: 'B' });
    });

    expect(splits()).toHaveLength(0);
    // and those writes really did ride the transaction
    expect(primary.writes).toHaveLength(2);
    expect(primary.writes[0].transaction).toBeTruthy();
  });

  it('does not fire for a mapped write made OUTSIDE any transaction — no false positive', async () => {
    const { engine, splits } = await twoDatasourceEngine();

    // Routing an object to another datasource is a normal, supported thing to
    // do. It is only a problem while a transaction is open and claiming to
    // cover the work, so an ordinary write must stay silent.
    const seeded = await engine.insert('ledger', { name: 'plain write' });
    await engine.update('ledger', { id: seeded.id, name: 'renamed' });
    await engine.delete('ledger', { where: { id: seeded.id } } as any);

    expect(splits()).toHaveLength(0);
  });

  it('says it once per transaction per datasource, and separately for a second datasource', async () => {
    const { engine, splits } = await twoDatasourceEngine();

    await engine.transaction(async () => {
      await engine.insert('ledger', { name: 'a' });
      await engine.insert('ledger', { name: 'b' });
      await engine.insert('ledger', { name: 'c' });
      await engine.insert('archive', { name: 'd' });
      await engine.insert('archive', { name: 'e' });
    });

    // Three writes to `ledger_db` + two to `archive_db` = two splits, not five.
    // AGENTS.md: "say it once, at the first degradation, not once per failed
    // write" — a 500-row batch off the default datasource is ONE split.
    const found = splits();
    expect(found).toHaveLength(2);
    expect(found.map((r) => meta(r).datasource).sort()).toEqual(['archive_db', 'ledger_db']);
  });

  it('re-reports in a NEW transaction — the budget is per transaction, not per engine', async () => {
    const { engine, splits } = await twoDatasourceEngine();

    await engine.transaction(async () => { await engine.insert('ledger', { name: 'first' }); });
    await engine.transaction(async () => { await engine.insert('ledger', { name: 'second' }); });

    // Two units of work, two partial commits, two reports: each one is a
    // separate atomicity claim that did not hold.
    expect(splits()).toHaveLength(2);
  });

  it('covers update and delete, not just insert', async () => {
    const { engine, splits } = await twoDatasourceEngine();

    const seeded = await engine.insert('ledger', { name: 'seed' });

    await engine.transaction(async () => {
      await engine.update('ledger', { id: seeded.id, name: 'renamed' });
    });
    await engine.transaction(async () => {
      await engine.delete('ledger', { where: { id: seeded.id } } as any);
    });

    const found = splits();
    expect(found).toHaveLength(2);
    expect(found.map((r) => meta(r).operation)).toEqual(['update', 'delete']);
  });

  it('fires for a nested transaction() that JOINED the outer one (ADR-0067 D2)', async () => {
    const { engine, splits } = await twoDatasourceEngine();

    // A joined nested call does not open its own transaction — it runs inside
    // the outer one's ambient scope, so the outer owner is what the write is
    // measured against. The write is just as uncovered as at the top level.
    await engine.transaction(async () => {
      await engine.transaction(async () => {
        await engine.insert('ledger', { name: 'nested' });
      });
    });

    expect(splits()).toHaveLength(1);
    expect(meta(splits()[0])).toMatchObject({ transactionDatasource: 'primary' });
  });

  it('fires from ScopedContext.transaction too (ctx.api.transaction in a sandboxed hook body)', async () => {
    const { engine, splits } = await twoDatasourceEngine();

    const scoped = (engine as any).createContext({ userId: 'u1' });
    await scoped.transaction(async () => {
      await engine.insert('ledger', { name: 'from sandbox' });
    });

    expect(splits()).toHaveLength(1);
    expect(meta(splits()[0])).toMatchObject({ datasource: 'ledger_db', transactionDatasource: 'primary' });
  });

  it('stays silent after the transaction closes — the scope does not leak', async () => {
    const { engine, splits } = await twoDatasourceEngine();

    await engine.transaction(async () => {
      await engine.insert('thing', { name: 'covered' });
    });
    await engine.insert('ledger', { name: 'after' });

    expect(splits()).toHaveLength(0);
  });
});
