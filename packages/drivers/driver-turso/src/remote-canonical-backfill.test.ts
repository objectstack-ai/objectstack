// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The REMOTE canonical temporal backfill (#5770, cloud#1005 方案 1).
 *
 * These are ROW-RESULT assertions over a real SQLite database wearing the
 * `@libsql/client` interface (`makeLibsqlSqliteStub`), not SQL-string
 * assertions. The whole claim under test is about what is ON DISK and what a
 * filter therefore matches, and a mis-built UPDATE leaves the SQL perfectly
 * valid while converting the wrong rows — the blind spot framework#4081 found
 * one layer up. libsql IS SQLite, so the stub gives the transport the real TEXT
 * affinity that produced 后果 B in the first place.
 *
 * ## The measured before-state (verified on origin/main @ d82b85fee)
 *
 * With a `Field.datetime` column `at` on a remote-mode driver:
 *
 * | Measured | Value |
 * |---|---|
 * | `canonicalDatetimeFields['probe']` | `undefined` — nothing ever marks it |
 * | `needsLegacyDatetimeRepair('probe','at')` | `true`, forever |
 * | `temporalFilterColumnSql('probe','at','"at"')` | the full `case when typeof("at") in ('integer','real') …` CASE — correct, unindexable |
 * | a raw `'1753660800000.0'` row (pre-#942 epoch under TEXT affinity) | MISSED by the Jul–Aug 2025 window it belongs to, and MATCHED by `$lte '2030-…'` which it does not |
 *
 * That last line is worth stating precisely, because it is sharper than
 * cloud#1005's summary of "matched by no filter": the row is compared as TEXT,
 * so `'1753660800000.0'` sorts before every `'2…'` spelling. It is not
 * invisible — it is in the wrong windows, both ways. Same cause, same fix.
 */

import { describe, it, expect } from 'vitest';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';
import {
  backfillRemoteCanonicalColumn,
  probeRemoteCanonicalColumns,
  REMOTE_BACKFILL_EPOCH_MS_MAX,
  REMOTE_BACKFILL_EPOCH_MS_MIN,
  type RemoteBackfillClient,
} from './remote-canonical-backfill.js';

const DATETIME_OBJECT = {
  name: 'probe',
  fields: { at: { type: 'datetime' }, why: { type: 'string' } },
};

const TIME_OBJECT = {
  name: 'tprobe',
  fields: { at: { type: 'time' }, why: { type: 'string' } },
};

/** 2025-07-28T00:00:00.000Z, the instant cloud#1005 measured on staging. */
const EPOCH_MS = 1_753_660_800_000;
const EPOCH_ISO = '2025-07-28T00:00:00.000Z';
/** How TEXT affinity actually stored that bound number, pre-#942. */
const EPOCH_TEXT = '1753660800000.0';

async function makeRemoteDriver(schema: Record<string, unknown>, stub?: LibsqlSqliteStub) {
  const client = stub ?? makeLibsqlSqliteStub();
  const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client: client as never });
  await driver.connect();
  expect(driver.transportMode).toBe('remote');
  await driver.syncSchema(schema.name as string, schema);
  return { driver, stub: client };
}

const rowsOf = (stub: LibsqlSqliteStub, table: string) =>
  stub.raw.prepare(`select id, at, typeof(at) as t from "${table}" order by id`).all() as Array<{
    id: string;
    at: unknown;
    t: string;
  }>;

const idsOf = (rows: unknown) => (rows as Array<{ id: string }>).map((r) => r.id).sort();

/** Un-mark a column, i.e. put the driver back in the pre-#5770 state. */
const unmark = (driver: TursoDriver, table: string, field: string, kind = 'datetime') => {
  const key = kind === 'datetime' ? 'canonicalDatetimeFields' : 'canonicalTimeFields';
  (driver as never as Record<string, Record<string, Set<string>>>)[key][table]?.delete(field);
};

const repairSql = (driver: TursoDriver, table: string, field: string) =>
  (
    driver as never as {
      temporalFilterColumnSql: (o: string, f: string, c: string) => string;
    }
  ).temporalFilterColumnSql(table, field, `"${field}"`);

const isMarked = (driver: TursoDriver, table: string, field: string, kind = 'datetime') => {
  const key = kind === 'datetime' ? 'canonicalDatetimeFields' : 'canonicalTimeFields';
  return (
    (driver as never as Record<string, Record<string, Set<string>>>)[key][table]?.has(field) === true
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 后果 A — the unindexable repair now has an exit
// ─────────────────────────────────────────────────────────────────────────────

describe('#5770 后果 A — remote temporal columns can reach the indexable form', () => {
  it('marks a freshly created remote table canonical, so filters emit a plain column', async () => {
    const { driver } = await makeRemoteDriver(DATETIME_OBJECT);

    // The whole point: BEFORE this change `needsLegacyDatetimeRepair` was true
    // here forever and this returned the CASE expression.
    expect(isMarked(driver, 'probe', 'at')).toBe(true);
    expect(repairSql(driver, 'probe', 'at')).toBe('"at"');

    await driver.disconnect();
  });

  it('reverse-verification: un-marking restores the pre-#5770 unindexable CASE', async () => {
    const { driver } = await makeRemoteDriver(DATETIME_OBJECT);
    unmark(driver, 'probe', 'at');

    // This is the measured origin/main behaviour, reproduced by deleting the
    // one fact this PR adds. Direction is the ordinary one: remove the fix,
    // the diagnostic (the repair wrapper) comes back.
    const sql = repairSql(driver, 'probe', 'at');
    expect(sql).toContain(`typeof("at") in ('integer','real')`);
    expect(sql).toContain('strftime');
    expect(sql).not.toBe('"at"');

    await driver.disconnect();
  });

  it('converges pre-existing legacy rows at the next boot and marks the column', async () => {
    // Boot 1 creates the table.
    const { driver: first, stub } = await makeRemoteDriver(DATETIME_OBJECT);
    void first;

    // A pre-convention writer leaves rows the remote table can really hold:
    // zone-naive `datetime('now')` output and an offset-bearing ISO string.
    stub.raw
      .prepare(`insert into probe (id, at, why) values ('naive','2025-07-28 00:00:00','naive')`)
      .run();
    stub.raw
      .prepare(`insert into probe (id, at, why) values ('offset','2025-07-28T08:00:00+08:00','off')`)
      .run();
    stub.raw.prepare(`insert into probe (id, at, why) values ('ok', ?, 'canonical')`).run(EPOCH_ISO);

    // Boot 2 sees the existing table WITH legacy rows.
    const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client: stub as never });
    await driver.connect();
    await driver.syncSchema('probe', DATETIME_OBJECT);

    // Every row is now the one canonical spelling, on disk.
    expect(rowsOf(stub, 'probe').map((r) => r.at)).toEqual([EPOCH_ISO, EPOCH_ISO, EPOCH_ISO]);
    // …and only because that is TRUE is the repair dropped.
    expect(isMarked(driver, 'probe', 'at')).toBe(true);
    expect(repairSql(driver, 'probe', 'at')).toBe('"at"');

    // The filter answers the same thing it did through the repair — the
    // performance exit changed the plan, not the result.
    const hit = await driver.find('probe', {
      where: { at: { $gte: '2025-07-01T00:00:00.000Z', $lte: '2025-08-01T00:00:00.000Z' } },
    });
    expect(idsOf(hit)).toEqual(['naive', 'offset', 'ok']);

    await driver.disconnect();
    stub.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 后果 B — TEXT-affinity numeric epochs
// ─────────────────────────────────────────────────────────────────────────────

describe('#5770 后果 B — TEXT-affinity numeric epochs are recovered', () => {
  it('a raw epoch-text row is in the WRONG windows before, and the right ones after', async () => {
    const { driver: first, stub } = await makeRemoteDriver(DATETIME_OBJECT);
    void first;

    stub.raw.prepare(`insert into probe (id, at, why) values ('legacy', ?, 'epoch')`).run(EPOCH_TEXT);
    stub.raw.prepare(`insert into probe (id, at, why) values ('ok', ?, 'canonical')`).run(EPOCH_ISO);

    // BEFORE: a driver that has not run the backfill (the origin/main state).
    const before = new TursoDriver({ url: 'libsql://probe.turso.io', client: stub as never });
    await before.connect();
    await before.syncSchema('probe', DATETIME_OBJECT);
    unmark(before, 'probe', 'at');
    // Restore the pre-fix disk state the backfill just converged, so the
    // "before" half is measured against the real legacy row.
    stub.raw.prepare(`update probe set at = ? where id = 'legacy'`).run(EPOCH_TEXT);

    const beforeWindow = await before.find('probe', {
      where: { at: { $gte: '2025-07-01T00:00:00.000Z', $lte: '2025-08-01T00:00:00.000Z' } },
    });
    // Missed by the window it belongs to …
    expect(idsOf(beforeWindow)).toEqual(['ok']);
    const beforeWrong = await before.find('probe', {
      where: { at: { $lte: '2030-01-01T00:00:00.000Z' } },
    });
    // … and matched by one it does not, because it is compared as TEXT.
    expect(idsOf(beforeWrong)).toEqual(['legacy', 'ok']);
    // (not disconnected: `disconnect()` closes the shared stub)

    // AFTER: the backfill runs.
    const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client: stub as never });
    await driver.connect();
    await driver.syncSchema('probe', DATETIME_OBJECT);

    expect(rowsOf(stub, 'probe')).toEqual([
      { id: 'legacy', at: EPOCH_ISO, t: 'text' },
      { id: 'ok', at: EPOCH_ISO, t: 'text' },
    ]);
    const after = await driver.find('probe', {
      where: { at: { $gte: '2025-07-01T00:00:00.000Z', $lte: '2025-08-01T00:00:00.000Z' } },
    });
    expect(idsOf(after)).toEqual(['legacy', 'ok']);

    await driver.disconnect();
    stub.close();
  });

  it('recovers an epoch-text value in a Field.time column to a canonical wall clock', async () => {
    const { driver: first, stub } = await makeRemoteDriver(TIME_OBJECT);
    void first;
    stub.raw.prepare(`insert into tprobe (id, at, why) values ('legacy', ?, 'epoch')`).run(EPOCH_TEXT);
    // 2025-07-28T00:00:00Z folds to midnight — the same answer reads always gave.
    stub.raw.prepare(`insert into tprobe (id, at, why) values ('ok','00:00:00','canonical')`).run();

    const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client: stub as never });
    await driver.connect();
    await driver.syncSchema('tprobe', TIME_OBJECT);

    expect(rowsOf(stub, 'tprobe').map((r) => r.at)).toEqual(['00:00:00', '00:00:00']);
    expect(isMarked(driver, 'tprobe', 'at', 'time')).toBe(true);

    await driver.disconnect();
    stub.close();
  });

  it('leaves the genuinely-unresolvable remainder alone, counts it, and still marks', async () => {
    const { driver: first, stub } = await makeRemoteDriver(DATETIME_OBJECT);
    void first;
    // ABOVE the band — which is also far above SQLite's julian-day ceiling, so
    // `strftime` returns NULL for it and `coalesce` hands it back. This is the
    // half of the unresolvable remainder that really IS a fixpoint of the shared
    // repair and can therefore ride through the canonical mark. The other half
    // — a bare number small enough to read as a julian day — is #6009's, and it
    // has its own suite below.
    stub.raw
      .prepare(`insert into probe (id, at, why) values ('huge', ?, 'far-future')`)
      .run(String(REMOTE_BACKFILL_EPOCH_MS_MAX + 1));
    stub.raw.prepare(`insert into probe (id, at, why) values ('ok', ?, 'canonical')`).run(EPOCH_ISO);

    const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client: stub as never });
    await driver.connect();
    await driver.syncSchema('probe', DATETIME_OBJECT);
    // `syncSchema` already ran the pass and marked the column, so the driver
    // method would skip it (that is the cheap-re-entry rule). Re-probe the
    // converged column directly to read what it left behind — which also
    // exercises the fast path's reporting.
    const col = await backfillRemoteCanonicalColumn(
      instrument(stub),
      { table: 'probe', field: 'at', kind: 'datetime' },
      sqlRulesFor(driver),
    );
    expect(col.canonical).toBe(true);

    const disk = rowsOf(stub, 'probe');
    // Out of band for the epoch recovery AND a fixpoint of the shared repair, so
    // nothing touches it. Untouched on disk is the honest outcome: the backfill
    // does not guess.
    expect(disk.find((r) => r.id === 'huge')!.at).toBe(String(REMOTE_BACKFILL_EPOCH_MS_MAX + 1));

    // The "fixpoint" half of that sentence, taken from SQLite rather than
    // asserted — the control that makes the withheld ZERO below mean something.
    const parsed = (
      stub.raw
        .prepare(`select julianday(?) as jd`)
        .all(String(REMOTE_BACKFILL_EPOCH_MS_MAX + 1)) as Array<{ jd: number | null }>
    )[0].jd;
    expect(parsed).toBeNull();

    expect(col.unresolvedEpochTextRows).toBe(1);
    expect(col.pendingEpochTextRows).toBe(0);
    // The guard has no opinion about a value SQLite's date functions decline.
    expect(col.nonTemporalTextRowsWithheld).toBe(0);

    // Still marked: this row is a fixpoint of the shared repair, so reading it
    // with the repair and without it give the identical answer — dropping the
    // repair cannot change which rows it matches.
    expect(isMarked(driver, 'probe', 'at')).toBe(true);

    await driver.disconnect();
    stub.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Batching, resumability, and the completion marker
// ─────────────────────────────────────────────────────────────────────────────

/** Wrap a stub to count statements and (optionally) fail on the Nth write. */
function instrument(stub: LibsqlSqliteStub, failWriteAt?: number) {
  const executed: string[] = [];
  let writes = 0;
  const client: RemoteBackfillClient & { executed: string[] } = {
    executed,
    async execute(stmt) {
      const sql = typeof stmt === 'string' ? stmt : stmt.sql;
      executed.push(sql);
      if (/^\s*update/i.test(sql)) {
        writes++;
        if (failWriteAt !== undefined && writes === failWriteAt) {
          throw new Error('simulated remote failure mid-backfill');
        }
      }
      return stub.execute(stmt) as never;
    },
    async batch(stmts) {
      // The stub takes no mode argument — it is a local SQLite database, and
      // libsql's read/write batch mode is a wire-protocol concern.
      for (const s of stmts) executed.push(typeof s === 'string' ? s : s.sql);
      return stub.batch(stmts) as never;
    },
  };
  return client;
}

const canonicalFor = (driver: TursoDriver) => (kind: 'datetime' | 'time', columnSql: string) =>
  kind === 'datetime'
    ? (driver as never as { sqliteCanonicalDatetimeSql: (c: string) => string })
        .sqliteCanonicalDatetimeSql(columnSql)
    : (driver as never as { sqliteCanonicalTimeSql: (c: string) => string })
        .sqliteCanonicalTimeSql(columnSql);

/**
 * [#6009] The driver's own backfill-side guard, taken the same way
 * {@link canonicalFor} takes the repair expression — from the driver, never
 * retyped, so a test cannot pass against a predicate production does not use.
 */
const guardFor = (driver: TursoDriver) => (columnSql: string) =>
  (driver as never as { sqliteNonTemporalTextSql: (c: string) => string }).sqliteNonTemporalTextSql(
    columnSql,
  );

/** Both rules, the shape every entry point is meant to be called with. */
const sqlRulesFor = (driver: TursoDriver) => ({
  canonical: canonicalFor(driver),
  nonTemporalText: guardFor(driver),
});

async function seedLegacy(rows: number) {
  const { driver: first, stub } = await makeRemoteDriver(DATETIME_OBJECT);
  void first;
  const insert = stub.raw.prepare(`insert into probe (id, at, why) values (?, ?, 'legacy')`);
  for (let i = 0; i < rows; i++) insert.run(`r${String(i).padStart(4, '0')}`, EPOCH_TEXT);
  const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client: stub as never });
  await driver.connect();
  return { driver, stub };
}

describe('#5770 batching / resumability / completion marker', () => {
  it('splits a large table across several UPDATEs and converges all of it', async () => {
    const { driver, stub } = await seedLegacy(25);
    const client = instrument(stub);

    const report = await backfillRemoteCanonicalColumn(
      client,
      { table: 'probe', field: 'at', kind: 'datetime' },
      sqlRulesFor(driver),
      { batchSize: 10, maxBatches: 50 },
    );

    expect(report.epochTextRowsConverted).toBe(25);
    expect(report.residualRows).toBe(0);
    expect(report.canonical).toBe(true);
    expect(report.budgetExhausted).toBe(false);
    // 25 rows at 10 per statement cannot have been one UPDATE.
    const updates = client.executed.filter((s) => /^\s*update/i.test(s));
    expect(updates.length).toBeGreaterThanOrEqual(3);
    // Every statement carries the LIMIT that makes it a batch.
    for (const u of updates) expect(u).toContain('limit ?');

    expect(rowsOf(stub, 'probe').every((r) => r.at === EPOCH_ISO)).toBe(true);
    await driver.disconnect();
    stub.close();
  });

  it('a budget-stopped run withholds the mark, and a re-run finishes and marks it', async () => {
    const { driver, stub } = await seedLegacy(25);
    const client = instrument(stub);
    const column = { table: 'probe', field: 'at', kind: 'datetime' as const };

    const partial = await backfillRemoteCanonicalColumn(
      client,
      column,
      sqlRulesFor(driver),
      { batchSize: 10, maxBatches: 1 },
    );
    expect(partial.budgetExhausted).toBe(true);
    expect(partial.epochTextRowsConverted).toBe(10);
    // NOTE the count that is zero here, because it is the trap this design had
    // to be corrected for: an un-converted TEXT epoch is a FIXPOINT of the
    // shared repair, so `residualRows` reads 0 even with 15 rows still on the
    // legacy form. Gating the mark on `residual` alone would have declared the
    // column done and — since a marked column is skipped next run — stranded
    // those 15 rows permanently.
    expect(partial.residualRows).toBe(0);
    expect(partial.pendingEpochTextRows).toBe(15);
    // The load-bearing half: NOT marked, so the caller keeps the repair and the
    // 15 rows still on the legacy form keep answering correctly.
    expect(partial.canonical).toBe(false);

    const finish = await backfillRemoteCanonicalColumn(
      client,
      column,
      sqlRulesFor(driver),
      { batchSize: 10, maxBatches: 50 },
    );
    // Resumed exactly where it stopped — no checkpoint state, the WHERE guard IS
    // the checkpoint.
    expect(finish.epochTextRowsConverted).toBe(15);
    expect(finish.residualRows).toBe(0);
    expect(finish.canonical).toBe(true);
    expect(rowsOf(stub, 'probe').every((r) => r.at === EPOCH_ISO)).toBe(true);

    await driver.disconnect();
    stub.close();
  });

  it('a mid-run failure converts nothing further, reports, and never marks', async () => {
    const { driver, stub } = await seedLegacy(25);
    const client = instrument(stub, 2); // blow up on the second UPDATE

    const report = await backfillRemoteCanonicalColumn(
      client,
      { table: 'probe', field: 'at', kind: 'datetime' },
      sqlRulesFor(driver),
      { batchSize: 10, maxBatches: 50 },
    );

    expect(report.error).toMatch(/simulated remote failure/);
    expect(report.canonical).toBe(false);
    // The first batch's work survives — that is what makes the retry cheap.
    const converged = rowsOf(stub, 'probe').filter((r) => r.at === EPOCH_ISO);
    expect(converged).toHaveLength(10);

    await driver.disconnect();
    stub.close();
  });

  it('is idempotent: a converged column costs one statement and zero writes', async () => {
    const { driver, stub } = await makeRemoteDriver(DATETIME_OBJECT);
    stub.raw.prepare(`insert into probe (id, at, why) values ('ok', ?, 'canonical')`).run(EPOCH_ISO);
    const client = instrument(stub);

    const report = await backfillRemoteCanonicalColumn(
      client,
      { table: 'probe', field: 'at', kind: 'datetime' },
      sqlRulesFor(driver),
    );

    expect(report.canonical).toBe(true);
    expect(report.rowsConverted).toBe(0);
    expect(report.epochTextRowsConverted).toBe(0);
    expect(client.executed).toHaveLength(1);
    expect(client.executed[0]).toMatch(/^select /);

    await driver.disconnect();
    stub.close();
  });

  it('probes every column of a boot in ONE round-trip', async () => {
    const stub = makeLibsqlSqliteStub();
    const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client: stub as never });
    await driver.connect();
    await driver.initObjects([
      { name: 'a', fields: { at: { type: 'datetime' }, tod: { type: 'time' } } },
      { name: 'b', fields: { at: { type: 'datetime' } } },
    ]);

    // All three temporal columns marked, and a re-run finds nothing to do.
    expect(isMarked(driver, 'a', 'at')).toBe(true);
    expect(isMarked(driver, 'a', 'tod', 'time')).toBe(true);
    expect(isMarked(driver, 'b', 'at')).toBe(true);
    expect(await driver.backfillRemoteCanonicalTemporal()).toEqual({ columns: [] });

    await driver.disconnect();
    stub.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D-B3 — correctness never depends on this having run
// ─────────────────────────────────────────────────────────────────────────────

describe('#5770 D-B3 — the backfill is a performance exit, not a correctness prerequisite', () => {
  it('answers identically with the column marked and un-marked', async () => {
    const { driver: first, stub } = await makeRemoteDriver(DATETIME_OBJECT);
    void first;
    stub.raw
      .prepare(`insert into probe (id, at, why) values ('naive','2025-07-28 00:00:00','naive')`)
      .run();
    stub.raw
      .prepare(`insert into probe (id, at, why) values ('offset','2025-07-28T08:00:00+08:00','off')`)
      .run();

    const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client: stub as never });
    await driver.connect();
    await driver.syncSchema('probe', DATETIME_OBJECT);

    const window = { at: { $gte: '2025-07-01T00:00:00.000Z', $lte: '2025-08-01T00:00:00.000Z' } };
    const marked = idsOf(await driver.find('probe', { where: window }));

    unmark(driver, 'probe', 'at');
    const unmarked = idsOf(await driver.find('probe', { where: window }));

    expect(marked).toEqual(['naive', 'offset']);
    expect(unmarked).toEqual(marked);

    await driver.disconnect();
    stub.close();
  });

  it('an unreachable remote leaves the driver usable and every column un-marked', async () => {
    const stub = makeLibsqlSqliteStub();
    const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client: stub as never });
    await driver.connect();
    await driver.syncSchema('probe', DATETIME_OBJECT);
    unmark(driver, 'probe', 'at');

    // Every statement the backfill issues fails.
    const dead: RemoteBackfillClient = {
      async execute() {
        throw new Error('remote unreachable');
      },
      async batch() {
        throw new Error('remote unreachable');
      },
    };
    const report = await backfillRemoteCanonicalColumn(
      dead,
      { table: 'probe', field: 'at', kind: 'datetime' },
      sqlRulesFor(driver),
    );

    expect(report.error).toMatch(/remote unreachable/);
    expect(report.canonical).toBe(false);
    // The repair is still there, so reads are still correct.
    expect(repairSql(driver, 'probe', 'at')).toContain('strftime');

    await driver.disconnect();
    stub.close();
  });

  it('never marks a column whose rows it could not converge', async () => {
    const { driver: first, stub } = await makeRemoteDriver(DATETIME_OBJECT);
    void first;
    for (let i = 0; i < 5; i++) {
      stub.raw
        .prepare(`insert into probe (id, at, why) values (?, '2025-07-28 00:00:00','naive')`)
        .run(`r${i}`);
    }
    const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client: stub as never });
    await driver.connect();
    await driver.syncSchema('probe', DATETIME_OBJECT);
    unmark(driver, 'probe', 'at');
    // Undo the automatic pass so there is genuinely work left.
    stub.raw.prepare(`update probe set at = '2025-07-28 00:00:00'`).run();

    const report = await backfillRemoteCanonicalColumn(
      instrument(stub),
      { table: 'probe', field: 'at', kind: 'datetime' },
      sqlRulesFor(driver),
      { batchSize: 2, maxBatches: 1 },
    );
    expect(report.canonical).toBe(false);
    expect(report.residualRows).toBe(3);

    await driver.disconnect();
    stub.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Identifier safety — identifiers are inlined, so they are checked
// ─────────────────────────────────────────────────────────────────────────────

describe('#5770 identifier safety', () => {
  it.each([
    ['probe"; drop table probe; --', 'at'],
    ['probe', 'at"; drop table probe; --'],
    ['1probe', 'at'],
  ])('refuses an unsafe identifier (%s.%s)', async (table, field) => {
    const stub = makeLibsqlSqliteStub();
    const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client: stub as never });
    await driver.connect();

    const report = await backfillRemoteCanonicalColumn(
      instrument(stub),
      { table, field, kind: 'datetime' },
      sqlRulesFor(driver),
    );
    // Reported, not thrown — the caller treats it as "leave the repair on".
    expect(report.error).toMatch(/unsafe identifier rejected/);
    expect(report.canonical).toBe(false);

    await driver.disconnect();
    stub.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The non-remote guard
// ─────────────────────────────────────────────────────────────────────────────

describe('#5770 local mode is untouched', () => {
  it('backfillRemoteCanonicalTemporal is a no-op outside remote mode', async () => {
    const driver = new TursoDriver({ url: ':memory:' });
    await driver.connect();
    expect(driver.transportMode).toBe('local');
    // Local reaches the same state through the INHERITED Knex backfill; this
    // method must not double up on it.
    expect(await driver.backfillRemoteCanonicalTemporal()).toEqual({ columns: [] });
    await driver.disconnect();
  });

  it('local mode still marks its own columns via the inherited Knex backfill', async () => {
    const driver = new TursoDriver({ url: ':memory:' });
    await driver.connect();
    await driver.initObjects([DATETIME_OBJECT]);
    // Proves the two transports converge on the same consumption point.
    expect(isMarked(driver, 'probe', 'at')).toBe(true);
    await driver.disconnect();
  });
});

it('EPOCH_MS constants describe the band the recovery documents', () => {
  expect(new Date(EPOCH_MS).toISOString()).toBe(EPOCH_ISO);
  expect(Number(EPOCH_TEXT)).toBe(EPOCH_MS);
});

// ─────────────────────────────────────────────────────────────────────────────
// #6009 — the julian-day limb: withheld from the SET side, and holding the mark
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A bare-number TEXT cell. SQLite's time-value grammar accepts it as a JULIAN
 * DAY, so `strftime` answers CONFIDENTLY instead of returning NULL and the
 * `coalesce` that is supposed to preserve unparseable values never fires. On a
 * read that is a temporary misreading; on the backfill's SET side it is the one
 * shape that would overwrite the stored bytes with a date nobody wrote.
 */
const JULIAN_TEXT = '2026';
/** What the shared repair reads `'2026'` as — measured from SQLite below. */
const JULIAN_AS_READ = '-4707-06-11T12:00:00.000Z';
/** SQLite's julian-day ceiling for a bare number, measured below. */
const JULIAN_DAY_CEILING = 5_373_484.5;

/** What the shared datetime repair would have written over `raw`. */
const repairReads = (stub: LibsqlSqliteStub, raw: string): unknown =>
  (
    stub.raw
      .prepare(`select coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', ?), ?) as v`)
      .all(raw, raw) as Array<{ v: unknown }>
  )[0].v;

/** `julianday()` on a literal, straight from the engine under test. */
const julianDayOf = (stub: LibsqlSqliteStub, raw: string): number | null =>
  (stub.raw.prepare(`select julianday(?) as jd`).all(raw) as Array<{ jd: number | null }>)[0].jd;

describe('#6009 remote — a cell SQLite only reads as a julian day is never overwritten', () => {
  it('datetime: the stored bytes survive, are counted, and the mark is refused', async () => {
    const { driver: first, stub } = await makeRemoteDriver(DATETIME_OBJECT);
    void first;
    stub.raw
      .prepare(`insert into probe (id, at, why) values ('julian', ?, 'bare number')`)
      .run(JULIAN_TEXT);
    // The deliberate POSITIVE CONTROL, in the same column and the same run: an
    // ordinary legacy row the pass must still converge. Without it a guard that
    // withheld EVERYTHING would sail through this test.
    stub.raw
      .prepare(`insert into probe (id, at, why) values ('naive','2025-07-28 00:00:00','naive')`)
      .run();

    const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client: stub as never });
    await driver.connect();
    await driver.syncSchema('probe', DATETIME_OBJECT);

    // What the repair reads it as — i.e. exactly what the UPDATE would have
    // written over it. Taken from SQLite so the claim is measured, not recalled.
    expect(repairReads(stub, JULIAN_TEXT)).toBe(JULIAN_AS_READ);

    const disk = rowsOf(stub, 'probe');
    expect(disk.find((r) => r.id === 'julian')!.at).toBe(JULIAN_TEXT);
    expect(disk.find((r) => r.id === 'naive')!.at).toBe(EPOCH_ISO);

    // ⭐ The half that keeps every answer identical — withholding alone would
    // not. A marked column drops the read-side repair, and the raw `'2026'`
    // would then compare as TEXT instead of as the instant it reads as.
    expect(isMarked(driver, 'probe', 'at')).toBe(false);
    expect(repairSql(driver, 'probe', 'at')).toContain('strftime');

    const report = await driver.backfillRemoteCanonicalTemporal();
    const col = report.columns.find((c) => c.table === 'probe' && c.field === 'at');
    expect(col?.nonTemporalTextRowsWithheld).toBe(1);
    // It stays inside `residual`, which is the count the mark actually reads.
    expect(col?.residualRows).toBe(1);
    expect(col?.canonical).toBe(false);
    // Nothing further was written: the re-run found only the withheld row.
    expect(col?.rowsConverted).toBe(0);

    await driver.disconnect();
    stub.close();
  });

  it('time: the same, on a Field.time column', async () => {
    const { driver: first, stub } = await makeRemoteDriver(TIME_OBJECT);
    void first;
    stub.raw
      .prepare(`insert into tprobe (id, at, why) values ('julian', ?, 'bare number')`)
      .run(JULIAN_TEXT);
    // Positive control for the time kind: a legacy wall clock that converges.
    stub.raw
      .prepare(`insert into tprobe (id, at, why) values ('legacy','08:30:00.000','legacy')`)
      .run();

    const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client: stub as never });
    await driver.connect();
    await driver.syncSchema('tprobe', TIME_OBJECT);

    const disk = rowsOf(stub, 'tprobe');
    expect(disk.find((r) => r.id === 'julian')!.at).toBe(JULIAN_TEXT);
    expect(disk.find((r) => r.id === 'legacy')!.at).toBe('08:30:00');

    expect(isMarked(driver, 'tprobe', 'at', 'time')).toBe(false);

    const report = await driver.backfillRemoteCanonicalTemporal();
    const col = report.columns.find((c) => c.table === 'tprobe' && c.field === 'at');
    expect(col?.nonTemporalTextRowsWithheld).toBe(1);
    expect(col?.residualRows).toBe(1);
    expect(col?.canonical).toBe(false);

    await driver.disconnect();
    stub.close();
  });

  it('withholds the `now` keyword too — the other limb that answers without being a literal', async () => {
    const { driver: first, stub } = await makeRemoteDriver(DATETIME_OBJECT);
    void first;
    stub.raw.prepare(`insert into probe (id, at, why) values ('kw','now','keyword')`).run();

    const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client: stub as never });
    await driver.connect();
    await driver.syncSchema('probe', DATETIME_OBJECT);

    // The engine really does answer for it — that is what makes it dangerous.
    expect(julianDayOf(stub, 'now')).not.toBeNull();
    // Untouched: canonicalising it would stamp the migration's own wall clock
    // onto a row nobody wrote a time into.
    expect(rowsOf(stub, 'probe').find((r) => r.id === 'kw')!.at).toBe('now');
    expect(isMarked(driver, 'probe', 'at')).toBe(false);

    await driver.disconnect();
    stub.close();
  });

  it('the probe promises exactly the rows an apply rewrites', async () => {
    const { driver: first, stub } = await makeRemoteDriver(DATETIME_OBJECT);
    void first;
    stub.raw
      .prepare(`insert into probe (id, at, why) values ('julian', ?, 'bare number')`)
      .run(JULIAN_TEXT);
    for (let i = 0; i < 3; i++) {
      stub.raw
        .prepare(`insert into probe (id, at, why) values (?, '2025-07-28 00:00:00','naive')`)
        .run(`naive${i}`);
    }

    const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client: stub as never });
    await driver.connect();
    await driver.syncSchema('probe', DATETIME_OBJECT);
    unmark(driver, 'probe', 'at');
    // Undo the automatic pass so there is genuinely work left to promise.
    stub.raw.prepare(`update probe set at = '2025-07-28 00:00:00' where id like 'naive%'`).run();

    const column = { table: 'probe', field: 'at', kind: 'datetime' as const };
    const client = instrument(stub);
    const probes = await probeRemoteCanonicalColumns(
      client,
      [column],
      sqlRulesFor(driver),
    );
    const plan = probes[0] as { residual: number; nonTemporalText: number };
    // Four rows are not fixpoints of the repair; one of them will not be touched.
    expect(plan.residual).toBe(4);
    expect(plan.nonTemporalText).toBe(1);

    const report = await backfillRemoteCanonicalColumn(
      client,
      column,
      sqlRulesFor(driver),
    );
    // The plan promised `residual - nonTemporalText`; the apply did exactly that.
    expect(report.rowsConverted).toBe(plan.residual - plan.nonTemporalText);
    expect(report.nonTemporalTextRowsWithheld).toBe(1);
    expect(report.canonical).toBe(false);

    await driver.disconnect();
    stub.close();
  });

  it('the guard is not over-broad: ordinary legacy, canonical and junk rows are untouched by it', async () => {
    const { driver: first, stub } = await makeRemoteDriver(DATETIME_OBJECT);
    void first;
    stub.raw
      .prepare(`insert into probe (id, at, why) values ('naive','2025-07-28 00:00:00','naive')`)
      .run();
    stub.raw
      .prepare(`insert into probe (id, at, why) values ('offset','2025-07-28T08:00:00+08:00','off')`)
      .run();
    stub.raw.prepare(`insert into probe (id, at, why) values ('ok', ?, 'canonical')`).run(EPOCH_ISO);
    // Junk the date functions genuinely decline — a `coalesce` fixpoint, not a
    // withheld row. If the guard claimed this one, the zero below would move.
    stub.raw.prepare(`insert into probe (id, at, why) values ('junk','not a date','junk')`).run();

    const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client: stub as never });
    await driver.connect();
    await driver.syncSchema('probe', DATETIME_OBJECT);

    const disk = rowsOf(stub, 'probe');
    expect(disk.find((r) => r.id === 'naive')!.at).toBe(EPOCH_ISO);
    expect(disk.find((r) => r.id === 'offset')!.at).toBe(EPOCH_ISO);
    expect(disk.find((r) => r.id === 'junk')!.at).toBe('not a date');

    const report = await driver.backfillRemoteCanonicalTemporal();
    // Marked, so the column reached the indexable form: the guard cost nothing
    // on a table that holds none of the shape it is about.
    expect(report).toEqual({ columns: [] });
    expect(isMarked(driver, 'probe', 'at')).toBe(true);
    expect(repairSql(driver, 'probe', 'at')).toBe('"at"');

    await driver.disconnect();
    stub.close();
  });
});

describe('#6009 the epoch-text UPDATE is structurally out of the guard reach', () => {
  it('the julian range and the epoch-recovery band do not meet', async () => {
    const stub = makeLibsqlSqliteStub();

    // Measured, from the engine: a bare number is read as a julian day only
    // below 5373484.5 — `'5373484.4'` parses, `'5373484.5'` does not.
    expect(julianDayOf(stub, '5373484.4')).toBeCloseTo(5_373_484.4, 5);
    expect(julianDayOf(stub, String(JULIAN_DAY_CEILING))).toBeNull();
    // Positive control on the instrument: it does answer for a small number.
    expect(julianDayOf(stub, JULIAN_TEXT)).toBe(2026);

    // The 后果 B band sits five orders of magnitude above that ceiling, so no
    // row the epoch recovery converts can be one the guard withholds.
    expect(REMOTE_BACKFILL_EPOCH_MS_MIN).toBeGreaterThan(JULIAN_DAY_CEILING);
    expect(julianDayOf(stub, String(REMOTE_BACKFILL_EPOCH_MS_MIN))).toBeNull();
    expect(julianDayOf(stub, String(REMOTE_BACKFILL_EPOCH_MS_MAX - 1))).toBeNull();

    stub.close();
  });

  it('an in-band epoch-text row still converts in a column that also holds a withheld row', async () => {
    const { driver: first, stub } = await makeRemoteDriver(DATETIME_OBJECT);
    void first;
    stub.raw.prepare(`insert into probe (id, at, why) values ('legacy', ?, 'epoch')`).run(EPOCH_TEXT);
    stub.raw
      .prepare(`insert into probe (id, at, why) values ('julian', ?, 'bare number')`)
      .run(JULIAN_TEXT);

    const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client: stub as never });
    await driver.connect();
    await driver.syncSchema('probe', DATETIME_OBJECT);

    const disk = rowsOf(stub, 'probe');
    // The 后果 B recovery is untouched by #6009 — it still runs, on the same pass.
    expect(disk.find((r) => r.id === 'legacy')!.at).toBe(EPOCH_ISO);
    // …and the withheld row is still withheld.
    expect(disk.find((r) => r.id === 'julian')!.at).toBe(JULIAN_TEXT);

    const report = await driver.backfillRemoteCanonicalTemporal();
    const col = report.columns.find((c) => c.table === 'probe' && c.field === 'at');
    expect(col?.nonTemporalTextRowsWithheld).toBe(1);
    expect(col?.pendingEpochTextRows).toBe(0);
    expect(col?.canonical).toBe(false);

    await driver.disconnect();
    stub.close();
  });
});

describe('#6009 the pre-#6009 call shape is FAIL-CLOSED, not a fallback', () => {
  it('refuses to converge when handed a bare canonical expression, and writes nothing', async () => {
    const { driver: first, stub } = await makeRemoteDriver(DATETIME_OBJECT);
    void first;
    stub.raw
      .prepare(`insert into probe (id, at, why) values ('naive','2025-07-28 00:00:00','naive')`)
      .run();
    stub.raw.prepare(`insert into probe (id, at, why) values ('legacy', ?, 'epoch')`).run(EPOCH_TEXT);

    const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client: stub as never });
    await driver.connect();
    await driver.syncSchema('probe', DATETIME_OBJECT);
    unmark(driver, 'probe', 'at');
    // Undo the automatic (guarded) pass so the bare arm meets real work.
    stub.raw.prepare(`update probe set at = '2025-07-28 00:00:00' where id = 'naive'`).run();
    stub.raw.prepare(`update probe set at = ? where id = 'legacy'`).run(EPOCH_TEXT);

    // The pre-#6009 spelling: a bare `CanonicalSqlFor`, still compiling.
    const report = await backfillRemoteCanonicalColumn(
      instrument(stub),
      { table: 'probe', field: 'at', kind: 'datetime' },
      canonicalFor(driver),
    );

    expect(report.error).toMatch(/refusing to converge without the non-temporal-text guard/);
    expect(report.canonical).toBe(false);
    // NOT MEASURED, and said so — a zero here would be a claim about an
    // instrument that never ran.
    expect(report.nonTemporalTextRowsWithheld).toBeNull();

    const disk = rowsOf(stub, 'probe');
    // The convergence phase never ran, so the legacy row is exactly as it was.
    expect(disk.find((r) => r.id === 'naive')!.at).toBe('2025-07-28 00:00:00');
    // POSITIVE CONTROL: the 后果 B limb is out of the guard's reach in both
    // directions, so it still ran on the same call. Without this the test would
    // also pass for a module that simply did nothing at all.
    expect(disk.find((r) => r.id === 'legacy')!.at).toBe(EPOCH_ISO);
    expect(report.epochTextRowsConverted).toBe(1);

    await driver.disconnect();
    stub.close();
  });

  it('has nothing to refuse on a converged column, and still reports it canonical', async () => {
    const { driver, stub } = await makeRemoteDriver(DATETIME_OBJECT);
    stub.raw.prepare(`insert into probe (id, at, why) values ('ok', ?, 'canonical')`).run(EPOCH_ISO);

    const report = await backfillRemoteCanonicalColumn(
      instrument(stub),
      { table: 'probe', field: 'at', kind: 'datetime' },
      canonicalFor(driver),
    );

    expect(report.error).toBeUndefined();
    expect(report.canonical).toBe(true);
    expect(report.nonTemporalTextRowsWithheld).toBeNull();

    await driver.disconnect();
    stub.close();
  });
});
