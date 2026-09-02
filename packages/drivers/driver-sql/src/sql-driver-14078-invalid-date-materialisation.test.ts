// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14078] What each dialect's driver materialises for a datetime JS cannot
 * represent — the measurement the shared canonical-ISO normaliser's open
 * decision is waiting on.
 *
 * ## The question, and why it is a driver question
 *
 * Four landed copies of one spelling turn a driver's timestamp value into the
 * `string` a contract declares, and every one of them renders a `Date` with a
 * bare `value.toISOString()`:
 *
 * ```
 * packages/metadata-protocol/src/sys-metadata-repository.ts:120   canonicalIsoInstant
 * packages/metadata/src/loaders/database-loader.ts:63             canonicalIsoInstant
 * packages/rest/src/rest-server.ts:570                            canonicalIsoStamp
 * packages/rest/src/rest-server.ts:626                            formatCsvCell
 * packages/metadata-protocol/src/protocol.ts:8082                 auditMetaItem.occurredAt
 * ```
 *
 * On an **Invalid `Date`** — a `Date` whose time value is `NaN` — that call
 * raises `RangeError: Invalid time value`. The spelling each copy replaced was
 * `String(value)`, which for the same input serves the text `'Invalid Date'`.
 * So for that one input shape the repair trades a visibly-wrong field for an
 * uncaught throw at a serialisation seam.
 *
 * Whether to guard the shared spelling is a maintainer decision about four
 * packages, and ⛔ nothing here changes any of them. What was missing was the
 * fact the decision rests on: **is an Invalid `Date` something a driver
 * actually hands out of a read door, or only something the type system
 * admits?** That is a per-dialect question about the client library's parser,
 * so it is measured here, in the package the live servers are attached to.
 *
 * ## Which half rests on which evidence
 *
 * §A is the WIRE-FORM half. Every client library named below materialises its
 * datetimes in pure JavaScript, so the arithmetic that decides `Date` vs
 * Invalid `Date` can be reproduced exactly, on any runner, with no server —
 * and it is reproduced rather than cited, so a JS engine or a doc page that
 * disagreed would show up here. Each case names the library file it mirrors.
 *
 * §B is the DIALECT half and only a live server can answer it: whether the
 * server ACCEPTS such a value into a column at all, and what the driver's own
 * `findOne` door then hands back. It runs under `Temporal Conformance (live PG
 * + MySQL)` and is a named skip anywhere else, exactly like its siblings.
 *
 * ## The column, and why the write door is bypassed
 *
 * `updated_at` — the same builtin audit column `#13567` measures one file over,
 * for the same reason: it is a BUILTIN, so it is not in `datetimeFields`, no
 * declared-field coercion reaches it, and `formatOutput`'s audit repair
 * (`repairNaiveUtcAuditTimestamp`) sits inside `if (this.isSqlite)`. On the two
 * live dialects the read door therefore hands back whatever the client library
 * produced, unmodified — which is precisely what is being measured.
 *
 * The value is written with **raw knex**, not through `create`/`update`. That
 * is deliberate and is stated rather than hidden: the ObjectQL write door
 * coerces and may refuse these values, and the question is not what the write
 * door admits — it is what a row that is ALREADY on disk (a legacy import, a
 * hand-run migration, another application sharing the database) materialises
 * as on the way out.
 *
 * ## Pinned as OBSERVED, not as desired
 *
 * These assertions describe what the drivers do today. They are not a claim
 * that it is correct, and they take no side on the shared spelling. A client
 * upgrade that changed a materialisation would redden this file — which is the
 * point: the decision, whichever way it goes, is being made against a reading
 * that must stay true.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from './index.js';
import {
  DIALECT_CELLS,
  MYSQL_CELL,
  declareDialectCell,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

/** Driver options every write here uses — this fixture is not tenant-scoped. */
const OPTS = { bypassTenantAudit: true } as any;

const TABLE = 'os14078_invalid_date';

/**
 * The `Date` arm the four landed copies share, reproduced.
 *
 * `driver-sql` must not import `@objectstack/rest` or
 * `@objectstack/metadata-protocol` — the layering runs the other way, and
 * `#13567` states the same constraint for the same reason. So the spelling is
 * restated here as the two lines that matter. It is compared against the real
 * copies by the census in the PR, not by an import.
 */
function sharedSpellingDateArm(value: Date): string {
  return value.toISOString();
}

/** The spelling all four copies replaced, kept for the contrast §A1 measures. */
function previousSpelling(value: unknown): string {
  return String(value);
}

/** Did rendering `value` through the shared spelling throw, and with what? */
function renderThroughSharedSpelling(value: Date): { threw: boolean; name?: string; text?: string } {
  try {
    return { threw: false, text: sharedSpellingDateArm(value) };
  } catch (err: any) {
    return { threw: true, name: err?.constructor?.name, text: String(err?.message ?? err) };
  }
}

// ── §A The wire-form half — reproducible on any runner, no server ───────────

describe('#14078 §A — an Invalid `Date` at the shared spelling', () => {
  it('§A1 is `instanceof Date`, throws through the new spelling, served text through the old', () => {
    const value = new Date(NaN);

    // It passes the arm's own test: nothing upstream of `toISOString()` can
    // reject it, which is why a guard would have to be inside the arm.
    expect(value instanceof Date).toBe(true);
    expect(Number.isNaN(value.getTime())).toBe(true);

    const rendered = renderThroughSharedSpelling(value);
    expect(rendered.threw, `toISOString() returned ${JSON.stringify(rendered.text)}`).toBe(true);
    expect(rendered.name).toBe('RangeError');
    expect(rendered.text).toContain('Invalid time value');

    // The whole trade, in one line: the replaced spelling serves a visibly
    // wrong field where the current one raises at the seam.
    expect(previousSpelling(value)).toBe('Invalid Date');
  });

  it('§A2 the driver pins mysql2 to `timezone: Z`, which selects the parse §A3 measures', () => {
    // Read off the REAL config rather than assumed: `withUtcSession` (#3942)
    // sets it, and mysql2 branches on this exact value when it turns a DATETIME
    // into a JS value. Nothing connects — knex builds its client eagerly and
    // opens a pool connection only on the first query.
    const driver: any = new SqlDriver({
      client: 'mysql2',
      connection: 'mysql://u:p@127.0.0.1:13306/os14078_unconnected',
    } as any);
    expect(driver.knex.client.config.connection.timezone).toBe('Z');
  });

  it('§A3 mysql2 TEXT protocol: a zero DATETIME parses to an Invalid `Date`', () => {
    // `Packet#parseDateTime(timezone)` — the path `connection.query()` takes —
    // is `new Date(`${str}${timezone}`)` for any timezone other than `local`.
    // With the `Z` §A2 just measured, the zero datetime MySQL stores outside
    // strict / NO_ZERO_DATE mode composes the string below.
    const parseDateTime = (str: string, timezone: string): Date => new Date(`${str}${timezone}`);

    for (const wire of ['0000-00-00 00:00:00', '0000-00-00 00:00:00.000', '0000-00-00']) {
      const value = parseDateTime(wire, 'Z');
      expect(value instanceof Date, `${wire}: not a Date`).toBe(true);
      expect(Number.isNaN(value.getTime()), `${wire}: parsed to ${String(value)}`).toBe(true);
    }

    // Non-vacuity: the same expression on a real stored instant yields a real
    // instant, so the NaN above is the zero date and not the expression.
    const ok = parseDateTime('2026-08-30 10:19:25.947', 'Z');
    expect(Number.isNaN(ok.getTime())).toBe(false);
    expect(ok.toISOString()).toBe('2026-08-30T10:19:25.947Z');
  });

  it('§A4 mysql2 BINARY protocol: an all-zero DATETIME returns its `new Date(NaN)` constant', () => {
    // `Packet#readDateTime(timezone)` reads the components off the wire and,
    // before constructing anything, short-circuits:
    //   `if (y + m + d + H + M + S + ms === 0) return INVALID_DATE;`
    // where `INVALID_DATE` is a module-level `new Date(NaN)`. So on this path
    // the Invalid `Date` is not an arithmetic accident — the library returns
    // one by name, deliberately, for the zero datetime.
    const readDateTime = (p: { y: number; m: number; d: number; H: number; M: number; S: number; ms: number }): Date => {
      if (p.y + p.m + p.d + p.H + p.M + p.S + p.ms === 0) return new Date(NaN);
      return new Date(Date.UTC(p.y, p.m - 1, p.d, p.H, p.M, p.S, p.ms));
    };

    const zero = readDateTime({ y: 0, m: 0, d: 0, H: 0, M: 0, S: 0, ms: 0 });
    expect(zero instanceof Date).toBe(true);
    expect(Number.isNaN(zero.getTime())).toBe(true);

    const real = readDateTime({ y: 2026, m: 8, d: 30, H: 10, M: 19, S: 25, ms: 947 });
    expect(Number.isNaN(real.getTime())).toBe(false);
  });

  it('§A5 pg: the timestamp range Postgres accepts is wider than the one JS can hold', () => {
    // `postgres-date` (what `pg-types` installs for OID 1114 / 1184) builds the
    // value as `new Date(Date.UTC(year, month, day, …))`. `Date.UTC` answers
    // `NaN` outside ±8.64e15 ms, and `new Date(NaN)` is an Invalid `Date` —
    // there is no throw and no null anywhere on that path.
    const viaPostgresDate = (y: number, mo: number, d: number): Date =>
      new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));

    // The exact edge of what a JS `Date` can hold.
    expect(viaPostgresDate(275760, 9, 13).getTime()).toBe(8_640_000_000_000_000);
    expect(Number.isNaN(viaPostgresDate(275760, 9, 14).getTime())).toBe(true);

    // Postgres' own documented `timestamp` / `timestamptz` ceiling is
    // `294276-12-31 AD`, so every year from 275760 to 294276 is a value the
    // SERVER stores and the CLIENT materialises as an Invalid `Date`.
    for (const year of [275761, 294276]) {
      const value = viaPostgresDate(year, 1, 1);
      expect(value instanceof Date, `${year}: not a Date`).toBe(true);
      expect(Number.isNaN(value.getTime()), `${year}: ${String(value)}`).toBe(true);
    }

    // The low end is NOT a hazard, and saying so is half the reading: Postgres
    // reaches back to 4713 BC and every one of those lands inside JS's range.
    expect(Number.isNaN(viaPostgresDate(-4712, 1, 1).getTime())).toBe(false);
    expect(Number.isNaN(viaPostgresDate(1, 1, 1).getTime())).toBe(false);
  });

  it('§A6 pg: `infinity` leaves the parser as a NUMBER, so it never reaches the `Date` arm', () => {
    // The one candidate that turns out NOT to be one. `postgres-date` tests
    // `/^-?infinity$/` first and returns `Number('Infinity')` — a JS number.
    // It therefore falls past `value instanceof Date` into the copies' final
    // `String(value)` arm and is SERVED, as the text below.
    const viaPostgresDate = (wire: string): unknown =>
      /^-?infinity$/.test(wire) ? Number(wire.replace('i', 'I')) : new Date(wire);

    for (const [wire, spelled] of [['infinity', 'Infinity'], ['-infinity', '-Infinity']] as const) {
      const value = viaPostgresDate(wire);
      expect(typeof value, `${wire}: type`).toBe('number');
      expect(value instanceof Date, `${wire}: reached the Date arm`).toBe(false);
      expect(previousSpelling(value)).toBe(spelled);
    }
  });
});

// ── §B The dialect half — what the read door actually hands back ────────────

/** One stored value, and what came back out of `findOne` for it. */
interface Probe {
  /** Human label used in every message. */
  readonly label: string;
  /** Did the SERVER accept the value into the column? */
  stored: boolean;
  /** The server's refusal, when it refused — a reading in its own right. */
  refusal?: string;
  /** What `findOne` returned for `updated_at`, when the value stored. */
  readBack?: unknown;
}

/**
 * MySQL only: the same cell config with strict / `NO_ZERO_DATE` lifted, so a
 * zero datetime can be put on disk at all.
 *
 * ## Why `pool.afterCreate` rather than a `SET SESSION` statement
 *
 * `sql_mode` is a SESSION variable and `knex.raw` takes whichever connection
 * the pool hands it, so issuing the `SET` through the pool and the write
 * through the pool can set the mode on one connection and write on another — a
 * no-op that looks exactly like a fix. `sql-driver.ts` documents that same trap
 * for `lock_wait_timeout` and solves it with connection affinity; here the
 * stronger form is available, because `afterCreate` runs on EVERY connection
 * the pool opens and there is no affinity left to get wrong.
 *
 * `withUtcSession` CHAINS a host `afterCreate` after its own
 * `SET time_zone = '+00:00'` rather than replacing it — a documented knex
 * extension point — so the UTC pin this measurement depends on is untouched.
 *
 * ⚠️ Scope: the relaxation lives on this suite's own connections to this file's
 * own isolated database, and is what makes the row exist. It is not a claim
 * that any deployment runs this way — the reachability claim is the opposite
 * one, that such rows arrive from imports, migrations and other applications.
 */
function mysqlConfigAdmittingZeroDates(): any {
  const base: any = MYSQL_CELL.config();
  return {
    ...base,
    pool: {
      ...(base.pool ?? {}),
      afterCreate(connection: any, done: (err?: unknown) => void): void {
        connection.query(`SET SESSION sql_mode = ''`, (err: unknown) => done(err));
      },
    },
  };
}

/** The values each dialect is probed with, and what the server is asked to store. */
function probeValuesFor(cell: DialectCell): { label: string; write: (knex: any) => any }[] {
  if (cell.id === 'pg') {
    return [
      // The control: an instant both sides can hold.
      { label: 'year 0001', write: (k) => k.raw(`timestamptz '0001-01-01 00:00:00+00'`) },
      // PM assumption under test: `infinity` is a special value Postgres
      // stores, and §A6 says the parser hands it back as a number.
      { label: 'infinity', write: (k) => k.raw(`timestamptz 'infinity'`) },
      // The candidate §A5 derives: inside Postgres' range, outside JS's.
      { label: 'year 294276', write: (k) => k.raw(`timestamptz '294276-01-01 00:00:00+00'`) },
    ];
  }
  if (cell.id === 'mysql') {
    return [
      // The control: MySQL's own DATETIME floor, which is a real instant.
      { label: 'year 1000', write: () => '1000-01-01 00:00:00.000' },
      // The classic legacy row: storable whenever NO_ZERO_DATE is not in force.
      { label: 'zero datetime', write: () => '0000-00-00 00:00:00.000' },
    ];
  }
  // SQLite has no temporal type; the column is TEXT and the value round-trips.
  return [
    { label: 'canonical ISO text', write: () => '2026-08-30T10:19:25.947Z' },
    { label: 'the literal text `Invalid Date`', write: () => 'Invalid Date' },
  ];
}

function measure(cell: DialectCell): void {
  describe(`#14078 §B — what \`updated_at\` materialises as (${cell.label})`, () => {
    let driver: SqlDriver;
    const probes = new Map<string, Probe>();

    beforeAll(async () => {
      driver = new SqlDriver(cell.id === 'mysql' ? mysqlConfigAdmittingZeroDates() : cell.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      // The DDL path, so `updated_at` is what `createAuditTimestampColumn`
      // produces: `timestamptz` on Postgres, `DATETIME(3)` on MySQL, TEXT on
      // SQLite. The column type is what decides the materialised JS type.
      await driver.initObjects([
        { name: TABLE, fields: { id: { type: 'text' }, title: { type: 'string' } } },
      ] as any);

      const knex = (driver as any).knex;
      for (const [index, value] of probeValuesFor(cell).entries()) {
        const id = `p${index}`;
        const probe: Probe = { label: value.label, stored: false };
        probes.set(value.label, probe);
        await driver.create(TABLE, { id, title: value.label }, OPTS);
        try {
          // Raw knex, deliberately: this asks what an EXISTING row does on the
          // way out, not what the write door admits on the way in.
          await knex(TABLE).where('id', id).update({ updated_at: value.write(knex) });
          probe.stored = true;
        } catch (err: any) {
          probe.refusal = String(err?.message ?? err);
          continue;
        }
        // `findOne`, not a raw read: this is the door every consumer of the
        // shared spelling reads through.
        const row: any = await driver.findOne(TABLE, { where: { id } }, OPTS);
        probe.readBack = row?.updated_at;
      }
    }, 60_000);

    afterAll(async () => {
      await driver?.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver?.disconnect();
    });

    it('§B0 every probe ran, and the read door returned the column', () => {
      // Guards the vacuous pass: every assertion below reads a probe out of
      // this map, so a setup that stored nothing would let them all pass
      // having measured nothing.
      const expected = probeValuesFor(cell).map((v) => v.label);
      expect([...probes.keys()]).toEqual(expected);
      for (const probe of probes.values()) {
        if (!probe.stored) continue;
        expect(
          probe.readBack,
          `${probe.label}: the read door returned no \`updated_at\` — every assertion in this ` +
            `suite reads that key, so a door that did not select it measures nothing`,
        ).toBeDefined();
      }
      // At least one probe must have reached disk, or this cell measured nothing.
      expect(
        [...probes.values()].filter((p) => p.stored).length,
        `${cell.label} refused every probe: ${[...probes.values()]
          .map((p) => `${p.label}: ${p.refusal}`)
          .join(' | ')}`,
      ).toBeGreaterThan(0);
    });

    if (cell.id === 'sqlite') {
      it('§B1 the negative control: SQLite never hands a `Date` out of the read door', () => {
        // The text side of the asymmetry #13567 pins, restated for this
        // question: with no temporal type there is no client-side parse, so no
        // Invalid `Date` can be constructed on the way out — whatever the
        // column holds, including the literal text `Invalid Date`.
        for (const probe of probes.values()) {
          expect(probe.stored, `${probe.label}: ${probe.refusal}`).toBe(true);
          expect(typeof probe.readBack, `${probe.label}: type`).toBe('string');
          expect(probe.readBack instanceof Date).toBe(false);
        }
        // And so the shared spelling's `Date` arm is never entered at all: the
        // string arm above it returns first.
        expect(probes.get('the literal text `Invalid Date`')?.readBack).toBe('Invalid Date');
      });
      return;
    }

    it('§B1 the control value materialises as a REAL instant', () => {
      const label = cell.id === 'pg' ? 'year 0001' : 'year 1000';
      const probe = probes.get(label)!;
      expect(probe.stored, `${label} was refused: ${probe.refusal}`).toBe(true);
      expect(probe.readBack instanceof Date, `${label}: got ${typeof probe.readBack}`).toBe(true);
      const value = probe.readBack as Date;
      expect(Number.isNaN(value.getTime()), `${label}: ${String(value)}`).toBe(false);
      // The control's whole job: the shared spelling renders this one fine, so
      // anything §B2 finds is about the value, not about the door.
      expect(renderThroughSharedSpelling(value).threw).toBe(false);
    });

    if (cell.id === 'pg') {
      it('§B2 `infinity` comes back as a NUMBER, and the shared spelling serves it as text', () => {
        const probe = probes.get('infinity')!;
        if (!probe.stored) {
          // A server that refuses `infinity` is a reading too — recorded here
          // rather than skipped, so it cannot pass as an unrun cell.
          expect(probe.refusal, 'refused with no message recorded').toBeTruthy();
          return;
        }
        expect(
          probe.readBack instanceof Date,
          `infinity materialised as a Date (${String(probe.readBack)}) — §A6 reads the parser ` +
            `as returning a number for it, so the copies' \`Date\` arm is now reachable this way too`,
        ).toBe(false);
        expect(typeof probe.readBack).toBe('number');
        expect(probe.readBack).toBe(Number.POSITIVE_INFINITY);
        // It falls to the copies' final `String(value)` arm, which serves it.
        expect(previousSpelling(probe.readBack)).toBe('Infinity');
      });

      it('§B3 a year Postgres holds and JS cannot comes back as an Invalid `Date`', () => {
        const probe = probes.get('year 294276')!;
        if (!probe.stored) {
          expect(probe.refusal, 'refused with no message recorded').toBeTruthy();
          return;
        }
        expect(
          probe.readBack instanceof Date,
          `year 294276 materialised as ${typeof probe.readBack} (${String(probe.readBack)})`,
        ).toBe(true);
        const value = probe.readBack as Date;
        expect(Number.isNaN(value.getTime()), `year 294276: ${String(value)}`).toBe(true);
        // The composed fact the decision is about: this value, out of this
        // door, through the spelling those four files share.
        const rendered = renderThroughSharedSpelling(value);
        expect(rendered.threw, `rendered as ${JSON.stringify(rendered.text)}`).toBe(true);
        expect(rendered.name).toBe('RangeError');
        expect(previousSpelling(value)).toBe('Invalid Date');
      });
      return;
    }

    it('§B2 a zero DATETIME comes back as an Invalid `Date`', () => {
      const probe = probes.get('zero datetime')!;
      if (!probe.stored) {
        // A server that refuses `0000-00-00` even with `sql_mode` cleared —
        // a build with NO_ZERO_DATE compiled in, or a successor that removed
        // the mode — is a reading, not a skip.
        expect(probe.refusal, 'refused with no message recorded').toBeTruthy();
        return;
      }
      expect(
        probe.readBack instanceof Date,
        `the zero datetime materialised as ${typeof probe.readBack} (${String(probe.readBack)})`,
      ).toBe(true);
      const value = probe.readBack as Date;
      expect(Number.isNaN(value.getTime()), `zero datetime: ${String(value)}`).toBe(true);
      const rendered = renderThroughSharedSpelling(value);
      expect(rendered.threw, `rendered as ${JSON.stringify(rendered.text)}`).toBe(true);
      expect(rendered.name).toBe('RangeError');
      expect(previousSpelling(value)).toBe('Invalid Date');
    });
  });
}

// A matrix that silently finds zero cells reports OK — every cell is declared
// EITHER WAY, measured when it is provisioned and a named skip when it is not
// (a named RED under `OS_EXPECT_LIVE_DIALECT_MATRIX=1`).
for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'invalid-date materialisation (#14078)', measure);
}
