// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Temporal conformance for TursoDriver's REMOTE transport (#937, framework#4191).
 *
 * The local-mode twin of this suite passes by INHERITANCE: `TursoDriver extends
 * SqlDriver`, so the whole temporal seam comes along. Remote mode inherits
 * nothing — `RemoteTransport` builds its own SQL (`buildSelectSQL`,
 * `buildWhereSQL`, `serializeValue`) via `@libsql/client` — which is precisely
 * the surface ADR-0053 D-A1 legislates about, and it failed the shared table on
 * every axis before this change:
 *
 * | Case | Measured, pre-fix |
 * |---|---|
 * | bare-day `$lte` window (framework#3777's default dashboard shape) | kept ONE row of four — worse than pre-fix local, since even the midnight row went |
 * | `$between` | **zero rows** — no arm in `buildWhereSQL`, so it fell through `default:` to an equality against a JSON-stringified array |
 * | `date` equality (framework#1874's shape) | dropped the `Date`-written rows: no `formatInput`, so `serializeValue` stored full ISO for one writer and `YYYY-MM-DD` for the other |
 *
 * The point of running the SHARED table rather than bespoke cases is that
 * remote and local must answer identically. A Turso deployment can be either,
 * chosen by URL alone; a filter whose result depends on that choice is the
 * dialect-divergence the matrix exists to prevent.
 *
 * ## Four sweeps, like the local twin
 *
 * The local suite runs the matrix twice over canonical storage (`datetime`/
 * `date`, then `Field.time`) and twice more over UN-BACKFILLED legacy storage,
 * because a Turso database is exactly the long-lived cloud database whose
 * backfill may never have run (D-B3 lets it fail without taking boot down).
 * Remote mode needs those legacy sweeps MORE, not less: `backfillCanonical-
 * Datetimes` is a Knex path, so in remote mode it never runs at all and the
 * pre-convention rows stay pre-convention forever.
 *
 * The legacy sweeps below therefore seed rows RAW — straight into SQLite,
 * under the transport, so no write path can converge them — and require the
 * same expected row-id sets. Making them pass is the COLUMN half of the seam
 * (`temporalFilterColumnSql`, wired in `TursoDriver`'s constructor): coercing
 * only the comparand matches whichever storage form the writer happened to
 * produce, which its own contract calls "necessary but NOT sufficient … or it
 * keeps half the bug".
 *
 * ### Why the legacy forms differ from the local suite's
 *
 * They are the forms this transport's own tables can hold. `RemoteTransport`
 * declares every temporal column `TEXT` (`mapFieldTypeToSQL`), so TEXT affinity
 * converts a bound epoch INTEGER to text on the way in and a remote column
 * simply cannot hold the INTEGER population the local sweep injects into its
 * NUMERIC-affinity column. What it CAN hold — and what a pre-convention writer
 * actually left there — is text: the zone-naive `datetime('now')` output this
 * transport still uses as its own column default, offset-bearing ISO from a
 * non-UTC writer, and (for `Field.time`) the full timestamp the pre-#937 write
 * path produced from a bound `Date`. Those are what get seeded.
 *
 * ## Why a SQLite-backed client stub
 *
 * These are row-result assertions, and a dropped predicate is invisible to the
 * SQL-string assertions the other remote suites make — the SQL stays valid,
 * just wider (the same blind spot framework#4081 found one layer up). libsql is
 * SQLite, so `makeLibsqlSqliteStub` gives the transport real affinity and
 * ordering semantics. The network is out of scope here and stays covered by the
 * mocked-`execute` suites.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  TEMPORAL_CASES,
  TEMPORAL_NOW,
  TEMPORAL_ROWS,
  TEMPORAL_TIME_CASES,
  TEMPORAL_TIME_ROWS,
} from '@objectstack/spec/data';
import { resolveFilterTokens } from '@objectstack/core';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

const resolveTokens = <T,>(filter: T): T =>
  resolveFilterTokens(filter, { now: new Date(TEMPORAL_NOW) });

const CONFORMANCE_OBJECT = {
  name: 'conformance',
  fields: {
    at: { type: 'datetime' },
    on: { type: 'date' },
    why: { type: 'string' },
  },
};

const TIME_CONFORMANCE_OBJECT = {
  name: 'time_conformance',
  fields: { at: { type: 'time' }, why: { type: 'string' } },
};

async function makeRemoteDriver(schema: Record<string, unknown>) {
  const stub = makeLibsqlSqliteStub();
  const driver = new TursoDriver({ url: 'libsql://conformance.turso.io', client: stub as never });
  await driver.connect();
  expect(driver.transportMode).toBe('remote');
  // `syncSchema` is what registers the field-type metadata in remote mode
  // (`registerRemoteFieldMetadata`) — and therefore what makes the temporal
  // seam know `at` is an instant and `on` a calendar day.
  await driver.syncSchema(schema.name as string, schema);
  return { driver, stub };
}

describe('TursoDriver remote — temporal conformance', () => {
  let driver: TursoDriver;
  let stub: LibsqlSqliteStub;

  beforeAll(async () => {
    ({ driver, stub } = await makeRemoteDriver(CONFORMANCE_OBJECT));
    for (const r of TEMPORAL_ROWS) {
      await driver.create('conformance', {
        id: r.id,
        // The mixed-writer axis (D-E4): a `Date` write and a wire-text write
        // of the same instant must converge. Both `at` AND `on` are seeded
        // natively for the `native` rows — a `Field.date` handed a `Date` is
        // exactly what stored full ISO before this change.
        at: r.writerForm === 'native' ? new Date(r.at) : r.at,
        on: r.writerForm === 'native' ? new Date(r.on) : r.on,
        why: r.why,
      });
    }
  });

  afterAll(async () => {
    await driver.disconnect();
    stub.close();
  });

  it('converged both writer populations to one storage form per column (the premise)', () => {
    const rows = stub.raw.prepare('select id, at, "on" from conformance order by id').all() as Array<{
      id: string;
      at: string;
      on: string;
    }>;
    expect(rows).toHaveLength(TEMPORAL_ROWS.length);
    for (const row of rows) {
      const expected = TEMPORAL_ROWS.find((r) => r.id === row.id)!;
      // Canonical UTC ISO text for `datetime`, bare-day text for `date` —
      // identical to what local mode writes, which is the claim that makes the
      // two transports one backend rather than two.
      expect(row.at, `${row.id}.at`).toBe(expected.at);
      expect(row.on, `${row.id}.on`).toBe(expected.on);
    }
  });

  for (const c of TEMPORAL_CASES) {
    it(c.name, async () => {
      const rows = await driver.find('conformance', { where: c.filter });
      const got = (rows as any[]).map((r) => r.id).sort();
      expect(got, c.note).toEqual([...c.expected].sort());
    });

    if (c.tokenFilter) {
      it(`${c.name} — via relative tokens`, async () => {
        const rows = await driver.find('conformance', { where: resolveTokens(c.tokenFilter) });
        const got = (rows as any[]).map((r) => r.id).sort();
        expect(got, c.note).toEqual([...c.expected].sort());
      });
    }
  }

  it('count() answers the same window find() does', async () => {
    const window = { at: { $gte: '2026-04-29', $lte: '2026-07-28' } };
    expect(await driver.count('conformance', { where: window })).toBe(4);
  });

  it('refuses a malformed $between instead of widening the query', async () => {
    await expect(
      driver.find('conformance', { where: { at: { $between: ['2026-04-29'] } } }),
    ).rejects.toThrow(/\$between/);
  });
});

describe('TursoDriver remote — Field.time conformance', () => {
  let driver: TursoDriver;
  let stub: LibsqlSqliteStub;

  beforeAll(async () => {
    ({ driver, stub } = await makeRemoteDriver(TIME_CONFORMANCE_OBJECT));
    for (const r of TEMPORAL_TIME_ROWS) {
      await driver.create('time_conformance', {
        id: r.id,
        // A wall clock handed a `Date` used to be serialised as a full
        // timestamp here — the mixed column framework#3994 measured on SQL.
        at: r.writerForm === 'native' ? new Date(`1970-01-01T${r.at}Z`) : r.at,
        why: r.why,
      });
    }
  });

  afterAll(async () => {
    await driver.disconnect();
    stub.close();
  });

  it('converged both writer populations to canonical wall-clock text (the premise)', () => {
    const rows = stub.raw.prepare('select id, at from time_conformance order by id').all() as Array<{
      id: string;
      at: string;
    }>;
    for (const row of rows) {
      expect(row.at, `${row.id}.at`).toBe(TEMPORAL_TIME_ROWS.find((r) => r.id === row.id)!.at);
    }
  });

  for (const c of TEMPORAL_TIME_CASES) {
    it(c.name, async () => {
      const rows = await driver.find('time_conformance', { where: c.filter });
      const got = (rows as any[]).map((r) => r.id).sort();
      expect(got, c.note).toEqual([...c.expected].sort());
    });
  }
});

/**
 * Sweep 3 — the same matrix over un-backfilled legacy `datetime` storage.
 *
 * Seeded through the stub's raw handle: BELOW the transport, so no write path
 * can converge the forms (the remote twin of the local suite's
 * `LegacyStorageTursoDriver`, which inserts through Knex for the same reason).
 * Nothing needs un-marking afterwards the way local does — remote mode has no
 * backfill to mark a column canonical in the first place, which is exactly why
 * this sweep is not hypothetical here.
 */
describe('TursoDriver remote — temporal conformance on un-backfilled legacy storage', () => {
  let driver: TursoDriver;
  let stub: LibsqlSqliteStub;

  beforeAll(async () => {
    ({ driver, stub } = await makeRemoteDriver(CONFORMANCE_OBJECT));
    const insert = stub.raw.prepare(
      'insert into conformance (id, at, "on", why) values (?, ?, ?, ?)',
    );
    for (const r of TEMPORAL_ROWS) {
      // Two pre-convention TEXT populations, split by the writer-form tag:
      //   native → offset-bearing ISO, what a writer in a non-UTC zone left
      //            behind (+08:00 here, so the repair has to normalise the
      //            zone and not merely reformat the characters);
      //   wire   → the zone-naive, space-separated spelling `datetime('now')`
      //            produces — the default this transport's own DDL still puts
      //            on `created_at`/`updated_at`.
      // `on` stays canonical, as in the local legacy sweep: the axis under
      // test is `datetime` storage, and a `date` column has one form.
      const at =
        r.writerForm === 'native'
          ? new Date(new Date(r.at).getTime() + 8 * 3600_000)
              .toISOString()
              .replace('Z', '+08:00')
          : r.at.replace('T', ' ').replace('Z', '');
      insert.run(r.id, at, r.on, r.why);
    }
  });

  afterAll(async () => {
    await driver.disconnect();
    stub.close();
  });

  it('holds the mixed legacy forms it claims to (the premise, so the sweep cannot pass vacuously)', () => {
    const rows = stub.raw.prepare('select id, at from conformance order by id').all() as Array<{
      id: string;
      at: string;
    }>;
    expect(rows).toHaveLength(TEMPORAL_ROWS.length);
    for (const row of rows) {
      const r = TEMPORAL_ROWS.find((x) => x.id === row.id)!;
      // Neither population is canonical, and no row is stored in the form the
      // canonical sweep asserts — otherwise this would be sweep 1 again.
      expect(row.at, `${row.id}.at`).not.toBe(r.at);
      expect(row.at, `${row.id}.at`).toMatch(r.writerForm === 'native' ? /\+08:00$/ : / /);
    }
  });

  // Literal spellings only, as in the local legacy sweep: the token axis is
  // orthogonal to storage form and already swept above.
  for (const c of TEMPORAL_CASES) {
    it(c.name, async () => {
      const rows = await driver.find('conformance', { where: c.filter });
      const got = (rows as any[]).map((r) => r.id).sort();
      expect(got, c.note).toEqual([...c.expected].sort());
    });
  }
});

/** Sweep 4 — the same, for un-backfilled legacy `Field.time` storage. */
describe('TursoDriver remote — Field.time conformance on un-backfilled legacy storage', () => {
  let driver: TursoDriver;
  let stub: LibsqlSqliteStub;

  beforeAll(async () => {
    ({ driver, stub } = await makeRemoteDriver(TIME_CONFORMANCE_OBJECT));
    const insert = stub.raw.prepare('insert into time_conformance (id, at, why) values (?, ?, ?)');
    for (const r of TEMPORAL_TIME_ROWS) {
      // native → the full ISO timestamp the pre-#937 remote write path itself
      //          produced from a bound `Date` (`serializeValue` → toISOString),
      //          i.e. the mixed column this issue measured, still on disk;
      // wire   → the same wall clock as a zone-naive timestamp, the other
      //          pre-#3994 spelling.
      const at =
        r.writerForm === 'native' ? `2026-07-28T${r.at}Z` : `2026-07-28 ${r.at}`;
      insert.run(r.id, at, r.why);
    }
  });

  afterAll(async () => {
    await driver.disconnect();
    stub.close();
  });

  it('holds the mixed legacy forms it claims to (the premise, so the sweep cannot pass vacuously)', () => {
    const rows = stub.raw.prepare('select id, at from time_conformance order by id').all() as Array<{
      id: string;
      at: string;
    }>;
    expect(rows).toHaveLength(TEMPORAL_TIME_ROWS.length);
    for (const row of rows) {
      // Every row carries a whole date it has no business carrying — the
      // defect this axis is about — so none of them is canonical wall clock.
      expect(row.at, `${row.id}.at`).toMatch(/^2026-07-28[T ]/);
    }
  });

  for (const c of TEMPORAL_TIME_CASES) {
    it(c.name, async () => {
      const rows = await driver.find('time_conformance', { where: c.filter });
      const got = (rows as any[]).map((r) => r.id).sort();
      expect(got, c.note).toEqual([...c.expected].sort());
    });
  }
});
