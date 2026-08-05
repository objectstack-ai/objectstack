// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Dialect-correctness of `temporalFilterValue` (the hook the analytics layer
 * uses).
 *
 * Since #3912 a `Field.datetime` comparand takes ONE rule on every dialect:
 * canonical UTC ISO — the same form `formatInput` now writes. It replaced a
 * SQLite-only coercion to epoch ms, which assumed a storage form the write path
 * never actually guaranteed.
 *
 * Making it uniform is a FIX on Postgres/MySQL too, not just a simplification.
 * The comparand used to be passed through untouched there, so a bare
 * `YYYY-MM-DD` from a `{30_days_ago}` token meant midnight in the SERVER's
 * timezone — measured against a real PostgreSQL 16 on `Asia/Shanghai`, the same
 * instant landed on a different calendar day than it did on SQLite. Stating the
 * `Z` removes the server's timezone from the comparison.
 *
 * What must NOT come back is the epoch integer: binding one against a native
 * TIMESTAMP compares INTEGER vs TIMESTAMP and breaks the query outright.
 *
 * No DB connection is needed: we seed the field-type maps the way `initObjects`
 * would and exercise the pure coercion logic across dialects.
 */

import { describe, it, expect } from 'vitest';
import { SqlDriver } from '../src/index.js';

/** Test double that injects the field-type metadata without a live connection. */
class ProbeDriver extends SqlDriver {
  seedDatetime(table: string, field: string): void {
    (this.datetimeFields[table] ??= new Set()).add(field);
  }
  seedDate(table: string, field: string): void {
    (this.dateFields[table] ??= new Set()).add(field);
  }
  /** Mark a column as backfilled, the way `backfillCanonicalDatetimes` does. */
  markCanonical(table: string, field: string): void {
    (this.canonicalDatetimeFields[table] ??= new Set()).add(field);
  }
}

function makeDriver(client: string): ProbeDriver {
  // Connection is never opened — we only call the synchronous coercion path.
  return new ProbeDriver({ client, connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
}

const ISO = '2025-06-18';
const CANONICAL = '2025-06-18T00:00:00.000Z';
/** The same UTC wall clock, spelled the only way MySQL parses it (#3942). */
const MYSQL_LITERAL = '2025-06-18 00:00:00.000';

/** What each dialect physically binds for one canonical instant. */
const PHYSICAL: Record<string, string> = {
  'better-sqlite3': CANONICAL,
  pg: CANONICAL,
  mysql2: MYSQL_LITERAL,
};

describe('temporalFilterValue dialect gating', () => {
  it('every dialect anchors a bare calendar day to UTC midnight (#3912)', () => {
    // The SEMANTICS are uniform — one instant, midnight UTC — even though MySQL
    // spells it differently. On Postgres this is the fix for the measured
    // cross-dialect divergence: an un-anchored '2025-06-18' was read as midnight
    // in the server's timezone, so a window put the same instant on a different
    // day than SQLite did.
    for (const [client, expected] of Object.entries(PHYSICAL)) {
      const d = makeDriver(client);
      d.seedDatetime('t', 'at');
      expect(d.temporalFilterValue('t', 'at', ISO), client).toBe(expected);
    }
  });

  it('MySQL gets the same instant in a MySQL-parseable literal (#3942)', () => {
    // MySQL rejects both the `T` separator and the `Z` suffix — an ISO-8601
    // comparand fails the statement outright with *Incorrect datetime value*
    // (measured on MariaDB 10.11), so the canonical form has to be respelled for
    // the bind. It is the SAME UTC wall clock: the column is `DATETIME(3)`, which
    // does no timezone conversion, and the connection is pinned to UTC.
    const d = makeDriver('mysql2');
    d.seedDatetime('t', 'at');
    expect(d.temporalFilterValue('t', 'at', ISO)).toBe(MYSQL_LITERAL);
    expect(d.temporalFilterValue('t', 'at', '2025-06-18T08:00:00+08:00')).toBe(MYSQL_LITERAL);
    expect(d.temporalFilterValue('t', 'at', new Date(CANONICAL))).toBe(MYSQL_LITERAL);
    // Never ISO — that is precisely what MySQL cannot parse.
    expect(String(d.temporalFilterValue('t', 'at', CANONICAL))).not.toMatch(/[TZ]/);
  });

  it('never binds an epoch integer — that would break a native TIMESTAMP compare', () => {
    for (const client of ['better-sqlite3', 'pg', 'mysql2']) {
      const d = makeDriver(client);
      d.seedDatetime('t', 'at');
      for (const input of [ISO, new Date(CANONICAL), Date.parse(CANONICAL), CANONICAL]) {
        expect(typeof d.temporalFilterValue('t', 'at', input)).toBe('string');
      }
    }
  });

  it('folds every accepted input shape onto the same canonical instant', () => {
    const d = makeDriver('better-sqlite3');
    d.seedDatetime('t', 'at');
    for (const input of [
      new Date(CANONICAL),                 // JS Date
      Date.parse(CANONICAL),               // epoch ms number
      String(Date.parse(CANONICAL)),       // epoch ms as text
      '2025-06-18',                        // bare calendar day
      '2025-06-18 00:00:00',               // zone-naive wall clock (CURRENT_TIMESTAMP)
      '2025-06-18T00:00:00Z',              // zone-explicit, no millis
      '2025-06-18T08:00:00+08:00',         // same instant, offset form
    ]) {
      expect(d.temporalFilterValue('t', 'at', input)).toBe(CANONICAL);
    }
  });

  it('leaves an uninterpretable comparand alone rather than inventing an instant', () => {
    const d = makeDriver('better-sqlite3');
    d.seedDatetime('t', 'at');
    expect(d.temporalFilterValue('t', 'at', 'not-a-date')).toBe('not-a-date');
    expect(d.temporalFilterValue('t', 'at', '')).toBe('');
  });

  it('Field.date normalises to YYYY-MM-DD text on every dialect', () => {
    for (const client of ['better-sqlite3', 'pg', 'mysql2']) {
      const d = makeDriver(client);
      d.seedDate('t', 'on');
      expect(d.temporalFilterValue('t', 'on', '2025-06-18T12:00:00Z')).toBe('2025-06-18');
    }
  });

  it('non-temporal fields pass through unchanged on every dialect', () => {
    for (const client of ['better-sqlite3', 'pg', 'mysql2']) {
      const d = makeDriver(client);
      expect(d.temporalFilterValue('t', 'name', 'hello')).toBe('hello');
    }
  });
});

/**
 * The same dialect gating for the aggregate BUCKET expression (#3773). It shares
 * `needsLegacyDatetimeRepair` with the filter path above, so the two can only be
 * wrong together — which is the point: a window and a bucket that disagree about
 * storage is how the epoch column ended up correctly filtered and then entirely
 * bucketed as NULL.
 *
 * Postgres and MySQL need no normalization because `defineColumn` maps
 * `Field.datetime` to a native timestamp there (`table.timestamp`), which is
 * also why `temporalFilterValue` leaves their comparands alone. If a column ever
 * WERE an integer on those dialects (an external table declaring `datetime` over
 * a `bigint`), Postgres refuses the `::timestamptz` cast outright rather than
 * bucketing silently — the loud failure SQLite did not give us.
 */
describe('buildDateBucketExpr dialect gating (#3773)', () => {
  const GRANULARITIES = ['day', 'month', 'quarter', 'year'] as const;
  const expr = (d: ProbeDriver, field: string, g: string, table?: string) =>
    (d as any).buildDateBucketExpr(field, g, table) as { sql: string; bindings: any[] } | null;

  it('SQLite: an UN-BACKFILLED Field.datetime is repaired to canonical text', () => {
    // `seedDatetime` mimics `initObjects` declaring the column WITHOUT the
    // backfill having marked it canonical — an un-migrated database.
    const d = makeDriver('better-sqlite3');
    d.seedDatetime('t', 'at');
    for (const g of GRANULARITIES) {
      const e = expr(d, 'at', g, 't')!;
      expect(e.sql).toContain(`strftime('%Y-%m-%dT%H:%M:%fZ', ??/1000.0, 'unixepoch')`);
      // Real division, not integer: `-1 / 1000` truncates to 0 and moves a
      // pre-1970 instant forward a day.
      expect(e.sql).not.toContain('/1000,');
    }
  });

  it('SQLite: a BACKFILLED Field.datetime drops the repair entirely (#3912)', () => {
    // The payoff of canonicalising storage: once a column is known clean the
    // bucket expression is a bare column again, so it can use an index.
    const d = makeDriver('better-sqlite3');
    d.seedDatetime('t', 'at');
    d.markCanonical('t', 'at');
    for (const g of GRANULARITIES) {
      const e = expr(d, 'at', g, 't')!;
      expect(e.sql).not.toContain('unixepoch');
      expect(e.sql).not.toContain('typeof');
      expect(e.bindings).toEqual(expect.arrayContaining(['at']));
    }
  });

  it('SQLite: Field.date and undeclared columns keep the plain column form', () => {
    const d = makeDriver('better-sqlite3');
    d.seedDate('t', 'on');
    for (const g of GRANULARITIES) {
      expect(expr(d, 'on', g, 't')!.sql).not.toContain('unixepoch');
      expect(expr(d, 'anything', g, 't')!.sql).not.toContain('unixepoch');
      // No table key at all (a caller outside the aggregate path) → plain form.
      expect(expr(d, 'at', g)!.sql).not.toContain('unixepoch');
    }
  });

  it('Postgres keeps the native timestamptz cast even for a declared datetime', () => {
    const d = makeDriver('pg');
    d.seedDatetime('t', 'at');
    for (const g of GRANULARITIES) {
      const e = expr(d, 'at', g, 't')!;
      expect(e.sql).toContain(`(??)::timestamptz`);
      expect(e.sql).not.toContain('unixepoch');
      expect(e.sql).not.toContain('/1000');
    }
  });

  it('MySQL keeps convert_tz even for a declared datetime', () => {
    const d = makeDriver('mysql2');
    d.seedDatetime('t', 'at');
    for (const g of GRANULARITIES) {
      const e = expr(d, 'at', g, 't')!;
      expect(e.sql).toContain('convert_tz(??');
      expect(e.sql).not.toContain('unixepoch');
      expect(e.sql).not.toContain('/1000');
    }
  });

  it('every emitted expression binds exactly as many identifiers as it references', () => {
    // The quarter expression references the column twice; an epoch-normalised
    // one references it six times. A mismatch here is knex silently shifting
    // bindings into the wrong slots.
    for (const client of ['better-sqlite3', 'pg', 'mysql2']) {
      const d = makeDriver(client);
      d.seedDatetime('t', 'at');
      d.seedDate('t', 'on');
      for (const field of ['at', 'on']) {
        for (const g of GRANULARITIES) {
          const e = expr(d, field, g, 't');
          if (!e) continue;
          expect(e.bindings.length).toBe((e.sql.match(/\?\?/g) ?? []).length);
          expect(new Set(e.bindings)).toEqual(new Set([field]));
        }
      }
    }
  });
});
