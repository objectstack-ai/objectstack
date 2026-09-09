// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13567] What the record read door materialises `updated_at` AS, per dialect
 * — the composed fact #13382 was a production bug about, pinned in the package
 * the live servers are attached to.
 *
 * ## The gap this closes, stated as a coverage fact
 *
 * The record-data optimistic-concurrency gate (`assertVersionOf` /
 * `assertVersionMatch` in `@objectstack/metadata-protocol`) compared a record's
 * `updated_at` against the caller's token with `String(v)` on both sides. On
 * Postgres — the production default driver — `updated_at` arrives as a JS
 * `Date`, so the comparison ran
 *
 * ```
 * Sun Aug 30 2026 18:19:25 GMT+0800 (China Standard Time)   ← the driver's value
 * 2026-08-30T10:19:25.947Z                                  ← the client's echo
 * ```
 *
 * One instant, two spellings, strict string compare: every guarded save
 * answered `409 CONCURRENT_UPDATE`, on records nobody had touched.
 *
 * It survived because EVERY existing OCC pin drives ISO text on both sides — a
 * memory or mocked engine, or SQLite, all of which round-trip canonical ISO
 * strings. Those pins were green the whole time the production default driver
 * refused every write. The discriminating input is the driver's `Date`, and
 * nothing in the repo ever produced it into that seam.
 *
 * `@objectstack/metadata-protocol` has no driver dependency and must not grow
 * one — the layering runs the other way — so the seam's own regression suite
 * necessarily drives a hand-made `Date`. That is correct and catches a revert
 * of the repair. What it cannot assert is the half that made the bug real:
 * what **this driver, on these dialects, hands out of its record read door.**
 * That half is asserted here, where a live Postgres and a live MySQL actually
 * exist (`Temporal Conformance (live PG + MySQL)`).
 *
 * ## What this file pinned, and what it pins now (#13973)
 *
 * As first landed, §B pinned the asymmetry as a coverage FACT: the two live
 * cells handed `updated_at` out as a `Date`, SQLite as canonical text, and the
 * driver's `withPostgresCalendarDayAsText` comment stated the `Date` side as
 * deliberate. The #13973 census then measured the cost of that fact — 43 of
 * the 44 packages that call a read door had only ever seen the text side, and
 * eight consumers were wrong under the `Date` side (#13382 in production,
 * #13993–#13999 by reading) — and the maintainer ruled B1 (narrow), 2026-09-02:
 * the read door presents the canonical ISO-Z text on EVERY dialect (ADR-0053
 * D-F1), folded at the driver's own read boundary with the client parsers
 * untouched (D-F2). §B now pins that contract; the SQLite cell's assertions
 * simply apply to all three. The composed fact this file was written about is
 * therefore inverted on purpose: `String(v)` of the driver's value IS the
 * client's echoed token, on every dialect, by construction and no longer by
 * accident. `sql-driver-13973-canonical-iso-read-door.test.ts` is the full
 * conformance cell (both column classes, every read door); this file keeps
 * the OCC-seam framing and the one column that seam reads.
 *
 * ## Which half rests on which evidence
 *
 * §A is pure JavaScript — `Date.prototype.toString` renders whole seconds in
 * the PROCESS's zone while `toISOString` renders milliseconds in UTC. It needs
 * no server, so it runs on every runner including Test Core, and it is the half
 * that can be measured anywhere. It is kept as the record of WHY a `Date`
 * leaving the door was a defect: the two spellings §A1 puts side by side are
 * the two sides of the comparison #13382 made.
 *
 * §B is the DIALECT fact and only a live server can answer it: what
 * `SqlDriver#findOne` puts in `updated_at`. The SQLite cell runs everywhere;
 * the two live cells are the reason this file lives in `driver-sql` rather
 * than next to the seam, and §B3 is what keeps them a measurement rather than
 * a restatement of the client library's behaviour — a raw knex read of the same
 * row still materialises the dialect's `Date`, so the fold is provably the
 * driver's.
 *
 * ## Why the audit column and not a declared `Field.datetime`
 *
 * `created_at` / `updated_at` are BUILTIN columns, so they are not in
 * `datetimeFields` and no declared-field coercion reaches them. Their read
 * presentation is `presentAuditTimestampOutput` over `AUDIT_TIMESTAMP_COLUMNS`
 * in `formatOutput` — SQLite-gated before #13973, which is precisely why the
 * two live dialects handed the raw client value through — and `updated_at`,
 * not some other datetime, is the value the OCC seam reads.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from './index.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

/** Driver options every write here uses — this fixture is not tenant-scoped. */
const OPTS = { bypassTenantAudit: true } as any;

const TABLE = 'os13567_stamp';

/**
 * How many create + read-back rounds each cell measures.
 *
 * Sized for §B4's non-vacuity guard rather than for coverage: the fold keeps
 * the milliseconds `String(Date)` would have dropped, which is only OBSERVABLE
 * on a stamp that carried some. Postgres' `CURRENT_TIMESTAMP` is
 * microsecond-precision and MySQL's `now(3)` is millisecond-precision, so a
 * stamp landing on an exact `.000` is ~1 in 1000 — rare, but not impossible,
 * and a run in which every stamp did would report a green that no truncation
 * could have perturbed. Six independent rounds put that at ~1e-18, the same
 * sizing `#11224` uses one file over.
 */
const ROUNDS = 6;

/** Canonical audit-timestamp text — the shape every read door presents (ADR-0053 D-F1). */
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The tail of `Date.prototype.toString` — `HH:mm:ss` with NO fractional digits,
 * followed by the zone offset it bakes in.
 *
 * Normative since ES2018 (`ToDateString` = DateString + TimeString +
 * TimeZoneString); only the trailing parenthesised zone NAME is
 * implementation-defined, so nothing here depends on it.
 */
const WHOLE_SECONDS_AND_ZONE = / \d{2}:\d{2}:\d{2} GMT[+-]\d{4}/;

/** The instant from the production report, kept verbatim. */
const REPORTED_INSTANT = '2026-08-30T10:19:25.947Z';

/**
 * Run `body` with the process pinned to `tz`, then restore.
 *
 * The zone is FORCED rather than required, so §A and §B3 are non-vacuous on any
 * runner: `Temporal Conformance` pins `TZ=America/New_York`, Test Core runs at
 * UTC, and a developer runs at whatever their laptop is set to. Restoring
 * rather than assuming matters because vitest reuses a worker across files — a
 * leaked `TZ` would silently re-zone whatever runs next in this process, which
 * is asserted below rather than trusted.
 *
 * The sibling copy in `sql-driver-11389-date-tz-skew.test.ts` is deliberately
 * left alone: this is a zone-scoping utility, not a guard that could weaken in
 * one copy and nowhere else.
 */
async function underProcessZone<T>(tz: string, body: () => Promise<T> | T): Promise<T> {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    return await body();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

/** Minutes east of UTC, read out of a `Date.prototype.toString` rendering. */
function offsetInSpelling(spelled: string): number {
  const m = /GMT([+-])(\d{2})(\d{2})/.exec(spelled);
  if (!m) throw new Error(`no GMT offset in ${JSON.stringify(spelled)}`);
  return collapseNegativeZero((m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])));
}

/**
 * The PROCESS's current offset for `at`, in minutes east of UTC.
 *
 * `getTimezoneOffset()` reports minutes WEST, so it is flipped here to match
 * the sign every `GMT+hhmm` spelling carries — and the flip is the reason
 * {@link collapseNegativeZero} exists.
 */
function processOffsetEastOfUtc(at: Date): number {
  return collapseNegativeZero(0 - at.getTimezoneOffset());
}

/**
 * Collapse `-0` onto `+0`.
 *
 * Not cosmetic, and measured on this file's own first run: `expect(x).toBe(y)`
 * is `Object.is`, and `Object.is(-0, 0)` is FALSE. At UTC the spelling parses
 * to `+0` while negating a zero `getTimezoneOffset()` produces `-0`, so §A2's
 * UTC cell went red on two values that denote the same offset. The matrix
 * testkit's own `eastOfUtc` makes the same collapse for the same reason (there
 * it was found by sabotage, here by running).
 */
function collapseNegativeZero(minutes: number): number {
  return minutes === 0 ? 0 : minutes;
}

// ── §A The JavaScript half — measurable on any runner, no server ────────────

describe('#13567 §A — what `String(Date)` spells, and what it drops', () => {
  it('§A1 spells the reported instant exactly as the incident recorded it', async () => {
    const value = new Date(REPORTED_INSTANT);
    // The prefix only: the trailing `(China Standard Time)` is the one
    // implementation-defined part of `toString`, and pinning an ICU display
    // name would make this file fail on a tzdata refresh rather than on a
    // regression.
    const spelled = await underProcessZone('Asia/Shanghai', () => String(value));
    expect(spelled.startsWith('Sun Aug 30 2026 18:19:25 GMT+0800')).toBe(true);
    // The two sides of the comparison the seam used to make, verbatim.
    expect(value.toISOString()).toBe(REPORTED_INSTANT);
    expect(spelled).not.toBe(REPORTED_INSTANT);
  });

  it('§A2 renders whole seconds in the PROCESS zone, whatever that zone is', async () => {
    const value = new Date(REPORTED_INSTANT);
    expect(value.getMilliseconds(), 'the fixture is vacuous without sub-second digits').toBe(947);

    const spellings = new Map<string, string>();
    for (const tz of ['Asia/Shanghai', 'America/New_York', 'UTC', 'Pacific/Chatham']) {
      await underProcessZone(tz, () => {
        const spelled = String(value);
        spellings.set(tz, spelled);
        expect(spelled, `${tz}: no whole-second + offset tail`).toMatch(WHOLE_SECONDS_AND_ZONE);
        // The offset baked into the spelling IS the process's, not UTC's.
        expect(offsetInSpelling(spelled), `${tz}: spelled offset`).toBe(processOffsetEastOfUtc(value));
        // The milliseconds are gone: the rendering names an instant `getMilliseconds()`
        // earlier than the value it was rendered from.
        expect(Date.parse(spelled), `${tz}: parsed back`).toBe(value.getTime() - value.getMilliseconds());
      });
    }

    // One instant, one `Date`, four process zones, four different spellings —
    // which is what "carries the process zone" means, asserted without
    // depending on any particular offset being what tzdata says today.
    expect(new Set(spellings.values()).size, `${JSON.stringify([...spellings])}`).toBe(spellings.size);
  });

  it('§A3 restores the ambient process zone', async () => {
    const before = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await underProcessZone('Pacific/Kiritimati', () => {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Pacific/Kiritimati');
    });
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(before);
  });
});

// ── §B The dialect half — what the read door actually hands back ────────────

function measure(cell: DialectCell): void {
  describe(`#13567 §B — \`updated_at\` as the record read door materialises it (${cell.label})`, () => {
    let driver: SqlDriver;
    const rows: any[] = [];

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      // The DDL path, so the audit columns are the ones
      // `createAuditTimestampColumn` produces: `timestamptz` on Postgres,
      // `DATETIME(3)` on MySQL, TEXT on SQLite. That pairing is the whole
      // subject — the column type is what decides the materialised JS type.
      await driver.initObjects([
        { name: TABLE, fields: { id: { type: 'text' }, title: { type: 'string' } } },
      ] as any);
      for (let i = 0; i < ROUNDS; i++) {
        const id = `r${i}`;
        await driver.create(TABLE, { id, title: 'one' }, OPTS);
        // `findOne` deliberately, and NOT a raw knex read: this is the door the
        // OCC seam probes through (`probeRecord` → `engine.findOne`), so a
        // read-side coercion that normalised the value would be IN scope here
        // and must be visible to the assertions below.
        rows.push(await driver.findOne(TABLE, { where: { id } }, OPTS));
      }
    }, 60_000);

    afterAll(async () => {
      await driver?.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver?.disconnect();
    });

    it('§B0 the read door returned a row per round, carrying `updated_at`', () => {
      // Guards the vacuous pass: every assertion below reads `updated_at` off
      // these rows, so a door that did not select the column at all would let
      // them all pass having checked nothing.
      expect(rows).toHaveLength(ROUNDS);
      for (const row of rows) {
        expect(row, 'findOne returned nothing').toBeTruthy();
        expect(
          row.updated_at,
          'the record read door did not return `updated_at` — the OCC seam reads this exact key',
        ).toBeDefined();
        expect(row.updated_at).not.toBeNull();
      }
    });

    it('§B1 hands `updated_at` back as canonical ISO-8601-Z TEXT — on every dialect (ADR-0053 D-F1)', () => {
      // The ruled shape (#13973 B1). Before it, this cell asserted the exact
      // opposite for the two live dialects: `timestamptz` (Postgres, via
      // node-pg's stock OID 1184 parser) and `DATETIME(3)` (MySQL, via mysql2's
      // `parseDateTime` under the `timezone: 'Z'` pin) both materialise as a
      // `Date`, and `formatOutput`'s audit-column presentation was SQLite-gated,
      // so nothing downstream converted it. The fold is now unconditional and
      // carries a `Date` arm, so the client's `Date` never leaves the door.
      for (const row of rows) {
        expect(
          row.updated_at instanceof Date,
          `${cell.label} returned updated_at as a JS Date ` +
            `(${JSON.stringify(String(row.updated_at))}) — the read door is ruled to present the ` +
            `canonical text on every dialect (ADR-0053 D-F1)`,
        ).toBe(false);
        expect(typeof row.updated_at, `updated_at type for ${row.id}`).toBe('string');
        expect(row.updated_at).toMatch(ISO_Z);
      }
    });

    it('§B2 `String()` of it IS the token a client echoes — by construction now, not by accident', () => {
      // This used to be the SQLite-only control, and the reason this file
      // exists: on the dialect every OCC pin was written against, the naive
      // `String(v)` comparison matched BY ACCIDENT, because the stored value
      // already was the canonical spelling the client was served. Under D-F1 it
      // holds on every dialect, which is what makes the seam's text compare
      // correct rather than lucky.
      for (const row of rows) {
        const value = row.updated_at as string;
        expect(String(value)).toBe(value);
        expect(new Date(value).toISOString()).toBe(value);
      }
    });

    it('§B3 the presented text names the instant the CLIENT materialised — the fold changed the type and nothing else', async () => {
      // Past every read-side presentation: what the client library hands the
      // driver for the same row. On a live cell that is still a `Date` — the
      // client parsers are untouched (D-F2) — so the fold is provably the
      // driver's, and this cell is a measurement of the driver rather than of
      // node-pg / mysql2. On SQLite the stored TEXT already is the presented
      // text, the side of the old asymmetry every consumer was tested against.
      const raw: any = await (driver as any).knex(TABLE).where('id', rows[0].id).first();
      expect(raw, 'raw read returned nothing').toBeTruthy();
      const presented = rows[0].updated_at as string;
      if (cell.live) {
        expect(
          raw.updated_at instanceof Date,
          `${cell.label} raw updated_at is ${typeof raw.updated_at} — the client parser was changed, ` +
            `which the #13973 ruling forbids`,
        ).toBe(true);
        const value = raw.updated_at as Date;
        expect(Number.isFinite(value.getTime())).toBe(true);
        expect(value.toISOString()).toBe(presented);

        // And the two spellings #13382 compared are still two spellings: the
        // client's `Date`, rendered through `String()`, follows the process
        // zone and is NOT the token — which is exactly why it must never
        // leave the door.
        const shanghai = await underProcessZone('Asia/Shanghai', () => String(value));
        const newYork = await underProcessZone('America/New_York', () => String(value));
        for (const [tz, spelled] of [['Asia/Shanghai', shanghai], ['America/New_York', newYork]] as const) {
          expect(spelled, `${tz}: shape`).toMatch(WHOLE_SECONDS_AND_ZONE);
          expect(spelled === presented, `${tz}: ${JSON.stringify(spelled)} vs ${JSON.stringify(presented)}`).toBe(false);
        }
        expect(shanghai).not.toBe(newYork);
        expect(offsetInSpelling(shanghai)).not.toBe(offsetInSpelling(newYork));
      } else {
        expect(typeof raw.updated_at).toBe('string');
        expect(raw.updated_at).toBe(presented);
      }
    });

    it('§B4 the presented text keeps the milliseconds `String(Date)` would have dropped', () => {
      const withMillis = rows.filter((row) => !/\.000Z$/.test(row.updated_at as string));
      expect(
        withMillis.length,
        `none of the ${ROUNDS} stamps in this run carried sub-second digits, so nothing here ` +
          `could have observed a millisecond loss — the cell measured nothing`,
      ).toBeGreaterThan(0);

      for (const row of withMillis) {
        const presented = row.updated_at as string;
        // The presented token names the instant exactly, sub-second digits
        // included …
        expect(presented, `${row.id}: presented token`).toMatch(/\.\d{3}Z$/);
        const instant = Date.parse(presented);
        expect(Number.isFinite(instant)).toBe(true);
        // … while the spelling the OCC seam used to compare against names one
        // `getMilliseconds()` earlier. Read in the ambient zone the suite is
        // running under, which is the zone the seam's `String(v)` would have
        // used had a `Date` reached it.
        const spelledAsDateWouldHaveBeen = String(new Date(instant));
        expect(Date.parse(spelledAsDateWouldHaveBeen), `${row.id}: spelled instant`).toBe(
          instant - new Date(instant).getMilliseconds(),
        );
        expect(Date.parse(spelledAsDateWouldHaveBeen)).not.toBe(instant);
      }
    });
  });
}

// A matrix that silently finds zero cells reports OK — every cell is declared
// EITHER WAY, measured when it is provisioned and a named skip when it is not
// (a named RED under `OS_EXPECT_LIVE_DIALECT_MATRIX=1`).
for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'audit stamp materialisation (#13567)', measure);
}
