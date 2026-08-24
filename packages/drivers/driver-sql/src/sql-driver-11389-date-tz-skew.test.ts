// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11389 — a `Field.date` read back from PostgreSQL was one calendar day early
 * whenever the Node process ran EAST of UTC.
 *
 * `node-postgres` materialises OID 1082 (`date`) with `new Date(y, m - 1, d)`,
 * i.e. **local** midnight; `SqlDriver#toDateOnly` reads a `Date` with **UTC**
 * components. East of UTC local midnight is the previous day in UTC, so the two
 * disagreed by a day and the REST payload carried the wrong date — production
 * reported, on an app container running `TZ=Asia/Shanghai`.
 *
 * ## Why the existing live matrix never caught it
 *
 * `Temporal Conformance (live PG + MySQL)` runs the whole driver-sql suite at
 * `TZ=America/New_York`. That is WEST of UTC, where local midnight is later the
 * same day in UTC and the UTC components name the right day. **A timezone
 * matrix that never runs east of UTC cannot fail this**, which is why every
 * sweep below is over a zone list that is asserted to contain an east-of-UTC
 * cell before any of it is believed.
 *
 * ## What each part measures
 *
 *  - **The mechanism, serverless.** The real `pool.afterCreate` is driven out
 *    of the real knex config with a recording connection, so which OIDs get a
 *    parser — and what those parsers return — is pinned everywhere the suite
 *    runs, not only where a live Postgres is attached.
 *  - **The two-clock pin, serverless.** `toDateOnly` is shared by the read,
 *    write and filter paths, and the `Date`s they hand it are NOT on one clock.
 *    Measured: a caller's `new Date('2026-08-24')` is UTC midnight, so reading
 *    local components off it yields `2026-08-23` under `TZ=America/New_York` —
 *    the identical one-day error in the mirror direction, moved onto the write
 *    and filter paths. These cases go red if anyone ever "fixes" a residual
 *    skew by swapping the getters in `toDateOnly` for their local twins.
 *  - **The live matrix.** One connection, one set of rows, the process zone
 *    swept underneath them — the card's own end-to-end table, executed.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { SqlDriver } from './sql-driver.js';
import {
  MYSQL_CELL,
  PG_CELL,
  declareDialectCell,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

/** The day under test, and the year boundary where a one-day skew changes the YEAR. */
const DAY = '2026-08-24';
const NEW_YEAR = '2026-01-01';

/**
 * The process-zone axis.
 *
 * `Asia/Shanghai` is the load-bearing cell: it is the only one where the
 * pre-fix read is wrong, and the reason this list is not just "UTC and the zone
 * CI already uses". `Asia/Kolkata` adds a half-hour offset, the shape that
 * breaks arithmetic written for whole-hour zones.
 */
const ZONE_MATRIX = ['UTC', 'Asia/Shanghai', 'America/New_York', 'Asia/Kolkata'] as const;

/** Minutes EAST of UTC for `when`, as the zone currently installed sees it. */
const offsetEastOfUtc = (when: Date): number => 0 - when.getTimezoneOffset();

/** Run `body` with the process timezone set to `tz`, restoring it afterwards. */
async function underProcessZone<T>(tz: string, body: () => Promise<T> | T): Promise<T> {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    return await body();
  } finally {
    // Restore rather than assume: vitest reuses a worker across files, so a
    // leaked TZ would silently re-zone whatever runs next in this process.
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

describe('#11389 — the process-zone axis is non-vacuous', () => {
  it('sweeps a zone EAST of UTC, a zone WEST of UTC, and UTC itself', async () => {
    const offsets = new Map<string, number>();
    for (const tz of ZONE_MATRIX) {
      await underProcessZone(tz, () => {
        offsets.set(tz, offsetEastOfUtc(new Date(`${DAY}T00:00:00Z`)));
      });
    }
    const seen = JSON.stringify(Object.fromEntries(offsets));

    expect(
      [...offsets.values()].some((o) => o > 0),
      `no cell of ZONE_MATRIX is east of UTC (${seen}). West of UTC the pre-fix UTC-component ` +
        'read names the RIGHT day, so a matrix without an east cell passes on broken source — ' +
        'which is exactly why the America/New_York-pinned CI job never caught #11389.',
    ).toBe(true);

    expect(
      [...offsets.values()].some((o) => o < 0),
      `no cell of ZONE_MATRIX is west of UTC (${seen}) — the mirror direction (a UTC-midnight ` +
        'comparand read with local components) only misbehaves west of UTC.',
    ).toBe(true);

    expect([...offsets.values()].some((o) => o === 0), seen).toBe(true);
  });

  it('restores the ambient zone after a sweep', async () => {
    const before = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await underProcessZone('Pacific/Kiritimati', () => {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Pacific/Kiritimati');
    });
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(before);
  });
});

// ── The mechanism, without a server ─────────────────────────────────────────

/**
 * A stand-in for the `pg.Client` knex hands `pool.afterCreate`, recording what
 * the hook registers instead of parsing anything.
 *
 * `getTypeParser` returns a per-OID sentinel so the assertion that the `date[]`
 * parser IS the connection's own `text[]` parser can be made by identity —
 * without this file importing `pg`, which is an optional peer dependency of the
 * package under test and must not become a test-time requirement.
 */
function recordingPgConnection() {
  const registered = new Map<number, (text: string) => unknown>();
  const sentinels = new Map<number, (text: string) => unknown>();
  return {
    registered,
    /** The sentinel this connection would hand back for `oid`. */
    sentinelFor(oid: number) {
      if (!sentinels.has(oid)) sentinels.set(oid, () => `built-in parser for ${oid}`);
      return sentinels.get(oid)!;
    },
    connection: {
      getTypeParser(oid: number, _format?: string) {
        if (!sentinels.has(oid)) sentinels.set(oid, () => `built-in parser for ${oid}`);
        return sentinels.get(oid)!;
      },
      setTypeParser(oid: number, parse: (text: string) => unknown) {
        registered.set(oid, parse);
      },
    },
  };
}

/** Drive the hook the driver really installed, and report what it registered. */
async function runAfterCreate(driver: SqlDriver, connection: unknown): Promise<void> {
  const hook = (driver as any).knex.client.config.pool?.afterCreate as
    | ((conn: unknown, done: (err?: unknown, conn?: unknown) => void) => void)
    | undefined;
  expect(typeof hook, 'the driver installed no pool.afterCreate for this dialect').toBe('function');
  await new Promise<void>((resolve, reject) => {
    hook!(connection, (err?: unknown) => (err ? reject(err) : resolve()));
  });
}

describe('#11389 — a Postgres `date` never becomes a JS Date', () => {
  const OID_DATE = 1082;
  const OID_DATE_ARRAY = 1182;
  const OID_TEXT_ARRAY = 1009;

  const drivers: SqlDriver[] = [];
  const make = (cfg: any): SqlDriver => {
    const d = new SqlDriver(cfg);
    drivers.push(d);
    return d;
  };

  afterEach(async () => {
    await Promise.all(drivers.splice(0).map((d) => d.disconnect().catch(() => {})));
  });

  it('registers a text parser for `date` and `date[]`, and for nothing else', async () => {
    const rec = recordingPgConnection();
    await runAfterCreate(make({ client: 'pg', connection: 'postgres://u:p@host:5432/d' }), rec.connection);

    expect([...rec.registered.keys()].sort((a, b) => a - b)).toEqual([OID_DATE, OID_DATE_ARRAY]);
  });

  it('hands a `date` back as its wire text, byte for byte', async () => {
    const rec = recordingPgConnection();
    await runAfterCreate(make({ client: 'pg', connection: 'postgres://u:p@host:5432/d' }), rec.connection);

    const parseDate = rec.registered.get(OID_DATE)!;
    expect(parseDate(DAY)).toBe(DAY);
    expect(parseDate(NEW_YEAR)).toBe(NEW_YEAR);
    // Whatever the wire says, including shapes a calendar day never takes — the
    // parser is deliberately not a validator.
    expect(parseDate('infinity')).toBe('infinity');
  });

  it("reuses the connection's own `text[]` parser for `date[]`", async () => {
    // Identity, not behaviour: pg's `text[]` parser IS its array-literal
    // splitter with an identity element transform, so borrowing it is what
    // keeps a `date[]` element a string — with no hand-rolled array parsing in
    // this driver, and no import of `pg`.
    const rec = recordingPgConnection();
    await runAfterCreate(make({ client: 'pg', connection: 'postgres://u:p@host:5432/d' }), rec.connection);

    expect(rec.registered.get(OID_DATE_ARRAY)).toBe(rec.sentinelFor(OID_TEXT_ARRAY));
  });

  it('applies to every knex client that speaks the pg wire protocol', async () => {
    for (const client of ['pg', 'postgres', 'postgresql', 'cockroachdb', 'redshift']) {
      const rec = recordingPgConnection();
      await runAfterCreate(make({ client, connection: 'postgres://u:p@host:5432/d' }), rec.connection);
      expect([...rec.registered.keys()].sort((a, b) => a - b), `client=${client}`)
        .toEqual([OID_DATE, OID_DATE_ARRAY]);
    }
  });

  it('is not gated on the connect-timeout table — the two lists are not the same list', async () => {
    // `redshift` speaks the pg wire protocol but has no connect-timeout knob,
    // so it is absent from DIALECT_CONNECT_TIMEOUT. Measured while fixing
    // #11389: with the session pins reached only through that table's early
    // return, redshift silently opted out of a fix it needs. This asserts the
    // two concerns really are independent — no timeout injected, pin applied.
    const rec = recordingPgConnection();
    const driver = make({ client: 'redshift', connection: 'postgres://u:p@host:5439/d' });
    // knex parses a URL connection into its own object either way, so the
    // readable signal is that no timeout key was injected into it.
    expect((driver as any).knex.client.config.connection.connectionTimeoutMillis).toBeUndefined();
    await runAfterCreate(driver, rec.connection);
    expect([...rec.registered.keys()].sort((a, b) => a - b)).toEqual([OID_DATE, OID_DATE_ARRAY]);
  });

  it('chains a host-supplied afterCreate rather than replacing it', async () => {
    const seen: string[] = [];
    const rec = recordingPgConnection();
    const driver = make({
      client: 'pg',
      connection: 'postgres://u:p@host:5432/d',
      pool: { min: 0, max: 5, afterCreate: (_c: unknown, done: (e?: unknown) => void) => { seen.push('host'); done(); } },
    });
    await runAfterCreate(driver, rec.connection);

    expect(seen).toEqual(['host']);
    expect(rec.registered.size).toBe(2);
    // …and the host's own pool sizing survives the wrapping.
    expect((driver as any).knex.client.config.pool).toMatchObject({ min: 0, max: 5 });
  });

  it("surfaces a host afterCreate's error instead of swallowing it", async () => {
    const rec = recordingPgConnection();
    const driver = make({
      client: 'pg',
      connection: 'postgres://u:p@host:5432/d',
      pool: { afterCreate: (_c: unknown, done: (e?: unknown) => void) => done(new Error('host said no')) },
    });
    await expect(runAfterCreate(driver, rec.connection)).rejects.toThrow('host said no');
  });

  it('degrades to a no-op on a connection that is not a pg.Client', async () => {
    // A stub, or a future knex shape: leaving the connection alone is right,
    // failing the pool acquire is not.
    const notAClient = { query: () => {} };
    await expect(
      runAfterCreate(make({ client: 'pg', connection: 'postgres://u:p@host:5432/d' }), notAClient),
    ).resolves.toBeUndefined();
  });

  it('leaves the other dialects alone', () => {
    const sqlite = make({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    expect((sqlite as any).knex.client.config.pool?.afterCreate).toBeUndefined();

    // MySQL keeps exactly the UTC-session hook of #3942 — the date fix must not
    // have displaced it, and mysql2 needs no parser override (its DATE arrives
    // at UTC midnight because `withUtcSession` pins `connection.timezone: 'Z'`).
    const mysql = make({ client: 'mysql2', connection: 'mysql://u:p@host:3306/d' });
    expect(typeof (mysql as any).knex.client.config.pool?.afterCreate).toBe('function');
    expect((mysql as any).knex.client.config.connection.timezone).toBe('Z');
  });
});

// ── The two-clock pin: what `toDateOnly` must keep doing ────────────────────

describe('#11389 — the write and filter paths keep reading a Date on the UTC clock', () => {
  let driver: SqlDriver | undefined;

  afterEach(async () => {
    await driver?.disconnect().catch(() => {});
    driver = undefined;
  });

  /**
   * A caller's `Date` for a `Field.date` is read on the UTC clock — the same
   * clock every other temporal canon in this driver folds through. Swapping
   * `toDateOnly` to local components would make each of these name the day
   * before or after, depending on which side of UTC the process sits, which is
   * why fixing #11389 there was rejected.
   */
  const CALLER_DATES: readonly [label: string, value: string, expected: string][] = [
    ['ISO date-only (UTC midnight)', `${DAY}T00:00:00.000Z`, DAY],
    // Late-UTC-evening: local components read this as the NEXT day east of UTC.
    ['late UTC evening', `${DAY}T23:30:00.000Z`, DAY],
    // Early-UTC-morning: local components read this as the PREVIOUS day west of UTC.
    ['early UTC morning', `${DAY}T00:30:00.000Z`, DAY],
    ['year boundary', `${NEW_YEAR}T00:00:00.000Z`, NEW_YEAR],
  ];

  for (const tz of ZONE_MATRIX) {
    for (const [label, iso, expected] of CALLER_DATES) {
      it(`stores and reads back ${expected} for a ${label} Date under TZ=${tz}`, async () => {
        await underProcessZone(tz, async () => {
          driver = new SqlDriver({
            client: 'better-sqlite3',
            connection: { filename: ':memory:' },
            useNullAsDefault: true,
          });
          await driver.initObjects([
            { name: 'deal', fields: { close_date: { type: 'date' } } },
          ] as any);

          await driver.create('deal', { id: 'd1', close_date: new Date(iso) }, { bypassTenantAudit: true });

          const row = await driver.findOne('deal', { where: { id: 'd1' } }, { bypassTenantAudit: true });
          expect(row.close_date).toBe(expected);

          // The filter path takes the same helper, so it has to agree — a
          // comparand read on a different clock than the stored value is the
          // silent-empty-result shape ADR-0053 Phase 1 already paid for once.
          const byDate = await driver.find(
            'deal',
            { where: { close_date: new Date(iso) } },
            { bypassTenantAudit: true },
          );
          expect(byDate.map((r: any) => r.id)).toEqual(['d1']);
        });
      });
    }
  }
});

// ── The live matrix: one connection, one row set, the zone swept underneath ──

/**
 * The card's end-to-end table, executed: the SAME rows read back under each
 * process zone. Writes use plain `YYYY-MM-DD` strings on purpose — an
 * unambiguous write isolates the READ path, which is where #11389 lived.
 */
function declareZoneSweep(cell: DialectCell): void {
  describe(`#11389 — Field.date is process-zone invariant on ${cell.label}`, () => {
    const TABLE = 'os11389_date_zone';
    let driver: SqlDriver | undefined;

    const connect = async (): Promise<SqlDriver> => {
      if (driver) return driver;
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.initObjects([
        { name: TABLE, fields: { label: { type: 'string' }, close_date: { type: 'date' } } },
      ] as any);
      await driver.create(TABLE, { id: 'r1', label: 'day', close_date: DAY }, { bypassTenantAudit: true });
      await driver.create(TABLE, { id: 'r2', label: 'ny', close_date: NEW_YEAR }, { bypassTenantAudit: true });
      return driver;
    };

    // Torn down once, after the last case — the sweep deliberately shares ONE
    // connection so the only variable across cells is the process zone.
    afterAll(async () => {
      await driver?.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver?.disconnect().catch(() => {});
      driver = undefined;
    });

    it('stored what the assertions read back — the control for the whole sweep', async () => {
      const d = await connect();
      const raw: any = await d.execute(`select id, close_date from ${TABLE} order by id`);
      const rows = raw?.rows ?? (Array.isArray(raw?.[0]) ? raw[0] : raw);
      expect(rows.length, 'fixture is vacuous unless both rows are really there').toBe(2);
    });

    for (const tz of ZONE_MATRIX) {
      it(`reads ${DAY} and ${NEW_YEAR} back unchanged under TZ=${tz}`, async () => {
        const d = await connect();
        await underProcessZone(tz, async () => {
          const day = await d.findOne(TABLE, { where: { id: 'r1' } }, { bypassTenantAudit: true });
          const ny = await d.findOne(TABLE, { where: { id: 'r2' } }, { bypassTenantAudit: true });

          expect(day.close_date, `${cell.label} read the wrong calendar day under TZ=${tz}`).toBe(DAY);
          // A one-day skew here changes the YEAR, which is the most legible
          // form of the production report.
          expect(ny.close_date, `${cell.label} read the wrong calendar day under TZ=${tz}`).toBe(NEW_YEAR);

          // `distinct()` returns raw builder output through `presentReadValue`
          // rather than `formatOutput` — the second of `toDateOnly`'s two read
          // consumers, and it must agree.
          expect((await d.distinct(TABLE, 'close_date')).slice().sort()).toEqual([NEW_YEAR, DAY]);

          // The filter path against a stored calendar day.
          const found = await d.find(TABLE, { where: { close_date: DAY } }, { bypassTenantAudit: true });
          expect(found.map((r: any) => r.id)).toEqual(['r1']);
        });
      });
    }
  });
}

declareDialectCell(PG_CELL, 'date calendar-day zone invariance (#11389)', declareZoneSweep);
// MySQL is in the matrix because it is the dialect that PROVES the asymmetry:
// mysql2 materialises a DATE at local midnight too, exactly like pg, and is
// nevertheless correct today because `withUtcSession` already pins
// `connection.timezone: 'Z'` (#3942). Losing that pin would reproduce #11389
// one dialect over, and this cell is what would say so.
declareDialectCell(MYSQL_CELL, 'date calendar-day zone invariance (#11389)', declareZoneSweep);

// ── The raw wire form, on a live server ─────────────────────────────────────

declareDialectCell(PG_CELL, 'date wire form (#11389)', (cell) => {
  describe(`#11389 — what a ${cell.label} date column materialises as`, () => {
    let driver: SqlDriver | undefined;

    afterEach(async () => {
      await driver?.disconnect().catch(() => {});
      driver = undefined;
    });

    it('hands back strings for `date` and `date[]`, and keeps `timestamptz` an instant', async () => {
      driver = new SqlDriver(cell.config());
      await underProcessZone('Asia/Shanghai', async () => {
        const raw: any = await driver!.execute(
          `select date '${DAY}' as d,
                  array[date '${DAY}', NULL, date '${NEW_YEAR}'] as ds,
                  timestamptz '${DAY}T00:00:00Z' as ts`,
        );
        const row = (raw?.rows ?? raw)[0];

        expect(typeof row.d, 'a pg `date` must not arrive as a JS Date').toBe('string');
        expect(row.d).toBe(DAY);
        // SQL NULL survives as null; the year-boundary element is where a
        // pre-fix skew changed the year.
        expect(row.ds).toEqual([DAY, null, NEW_YEAR]);
        // Untouched on purpose: an instant is exactly what a Date is for, and
        // `Field.datetime` depends on it.
        expect(row.ts instanceof Date).toBe(true);
        expect((row.ts as Date).toISOString()).toBe(`${DAY}T00:00:00.000Z`);
      });
    });
  });
});
