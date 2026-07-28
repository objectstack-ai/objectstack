// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Dialect-correctness of `temporalFilterValue` (the hook the analytics layer
 * uses). The datetime → epoch-ms coercion is SQLite-ONLY: SQLite stores
 * `Field.datetime` as an INTEGER epoch, but Postgres/MySQL map it to a native
 * TIMESTAMP where an ISO string / Date binds correctly. Coercing to an epoch
 * integer on a native-timestamp dialect would compare INTEGER vs TIMESTAMP and
 * break the query — the exact Postgres regression we must NOT introduce.
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
}

function makeDriver(client: string): ProbeDriver {
  // Connection is never opened — we only call the synchronous coercion path.
  return new ProbeDriver({ client, connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
}

const ISO = '2025-06-18';
const EPOCH = Date.parse('2025-06-18T00:00:00.000Z');

describe('temporalFilterValue dialect gating', () => {
  it('SQLite: datetime ISO comparand → epoch ms', () => {
    const d = makeDriver('better-sqlite3');
    d.seedDatetime('t', 'at');
    expect(d.temporalFilterValue('t', 'at', ISO)).toBe(EPOCH);
  });

  it('Postgres: datetime ISO comparand is LEFT UNCHANGED (no epoch coercion → no regression)', () => {
    const d = makeDriver('pg');
    d.seedDatetime('t', 'at');
    expect(d.temporalFilterValue('t', 'at', ISO)).toBe(ISO);
  });

  it('MySQL: datetime ISO comparand is left unchanged', () => {
    const d = makeDriver('mysql2');
    d.seedDatetime('t', 'at');
    expect(d.temporalFilterValue('t', 'at', ISO)).toBe(ISO);
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
 * `isEpochStoredDatetime` with the filter coercion above, so the two can only be
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

  it('SQLite: a declared Field.datetime is normalised from epoch ms', () => {
    const d = makeDriver('better-sqlite3');
    d.seedDatetime('t', 'at');
    for (const g of GRANULARITIES) {
      const e = expr(d, 'at', g, 't')!;
      expect(e.sql).toContain(`julianday(??/1000.0, 'unixepoch')`);
      // Real division, not integer: `-1 / 1000` truncates to 0 and moves a
      // pre-1970 instant forward a day.
      expect(e.sql).not.toContain('/1000,');
    }
  });

  it('SQLite: Field.date and undeclared columns keep the plain column form', () => {
    const d = makeDriver('better-sqlite3');
    d.seedDate('t', 'on');
    for (const g of GRANULARITIES) {
      expect(expr(d, 'on', g, 't')!.sql).not.toContain('julianday');
      expect(expr(d, 'anything', g, 't')!.sql).not.toContain('julianday');
      // No table key at all (a caller outside the aggregate path) → plain form.
      expect(expr(d, 'at', g)!.sql).not.toContain('julianday');
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
