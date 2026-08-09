// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Calendar-day upper bounds on `Field.datetime` (#3777) — the acceptance gate.
 *
 * A bare `YYYY-MM-DD` comparand anchors to midnight UTC (#3912). That is right
 * for a LOWER bound and wrong for an UPPER one: the dashboard date-range
 * filter compiles `{ $gte: from, $lte: to }` with bare-day bounds, so on a
 * `datetime` column — and `created_at`, the filter's DEFAULT field, is a
 * system-injected `Field.datetime` — every row created after 00:00 of the
 * `to` day silently vanished. Seven of the thirteen presets end "today".
 *
 * The fix is operator-sensitive and half-open: `$lte`/`<=`/`between`-max with
 * a bare-day comparand on a datetime column compiles to `< next-day-midnight`
 * (`calendarDayUpperBoundRewrite`), the same `[gte, lt)` shape the analytics
 * drill ranges emit. Everything else — `date` columns, full-ISO comparands,
 * `$gte`/`$gt`/`$lt` — keeps its exact pre-fix behaviour, matching the
 * semantics table on the issue.
 *
 * These tests assert ROW RESULTS (the ADR-0053 D-A3 posture), on the two
 * storage states a SQLite deployment can be in: canonical text (#3912) and
 * the un-backfilled mixed INTEGER-epoch / ISO-TEXT legacy column.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseFilterAST } from '@objectstack/spec/data';
import { SqlDriver } from '../src/index.js';
import { LegacyStorageDriver } from '../src/legacy-datetime-storage.testkit.js';

const ids = (rows: any[]) => rows.map((r: any) => r.id).sort();

describe('bare-day $lte on Field.datetime — the #3777 repro', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      {
        name: 'task',
        fields: {
          title: { type: 'string' },
          created_at: { type: 'datetime' },
          created_on: { type: 'date' },
        },
      },
    ]);
    // The issue's probe, verbatim: "today" is 2026-07-28, the window is the
    // last_90_days preset's expansion. `created_on` mirrors each instant's
    // calendar day so every case below can run the same probe on a date column.
    for (const [id, at] of [
      ['t_midnight', '2026-07-28T00:00:00Z'],
      ['t_morning', '2026-07-28T09:15:00Z'],
      ['t_evening', '2026-07-28T21:40:00Z'],
      ['t_yesterday', '2026-07-27T14:00:00Z'],
      ['t_old', '2026-04-19T10:00:00Z'],
    ] as const) {
      await driver.create(
        'task',
        { id, title: id, created_at: new Date(at), created_on: at.slice(0, 10) },
        { bypassTenantAudit: true },
      );
    }
  });

  afterEach(async () => {
    await driver.disconnect?.();
  });

  it('keeps the whole final day — the dashboard default-config window', async () => {
    // Exactly the shape objectui's buildFilterCondition sends for last_90_days.
    const found = await driver.find('task', {
      where: { created_at: { $gte: '2026-04-29', $lte: '2026-07-28' } },
    } as any);
    // Pre-fix this returned only [t_midnight, t_yesterday]: the 09:15 and
    // 21:40 rows fell past the midnight-anchored upper bound.
    expect(ids(found)).toEqual(['t_evening', 't_midnight', 't_morning', 't_yesterday']);
  });

  it('the same probe on a Field.date column is unchanged (already whole-day)', async () => {
    const found = await driver.find('task', {
      where: { created_on: { $gte: '2026-04-29', $lte: '2026-07-28' } },
    } as any);
    expect(ids(found)).toEqual(['t_evening', 't_midnight', 't_morning', 't_yesterday']);
  });

  it('a full-ISO $lte keeps instant semantics — only the bare day is widened', async () => {
    const found = await driver.find('task', {
      where: { created_at: { $lte: '2026-07-28T12:00:00.000Z' } },
    } as any);
    expect(ids(found)).toEqual(['t_midnight', 't_morning', 't_old', 't_yesterday']);
  });

  it('a Date-object $lte keeps instant semantics too', async () => {
    const found = await driver.find('task', {
      where: { created_at: { $lte: new Date('2026-07-28T00:00:00Z') } },
    } as any);
    expect(ids(found)).toEqual(['t_midnight', 't_old', 't_yesterday']);
  });

  it('$gte / $gt / $lt keep their midnight anchoring (the issue-table rows marked correct)', async () => {
    const gte = await driver.find('task', { where: { created_at: { $gte: '2026-07-28' } } });
    expect(ids(gte)).toEqual(['t_evening', 't_midnight', 't_morning']);

    const gt = await driver.find('task', { where: { created_at: { $gt: '2026-07-28' } } });
    expect(ids(gt)).toEqual(['t_evening', 't_morning']); // excludes the exact-midnight row

    const lt = await driver.find('task', { where: { created_at: { $lt: '2026-07-28' } } });
    expect(ids(lt)).toEqual(['t_old', 't_yesterday']);
  });

  it('$between with a bare-day max covers the whole final day', async () => {
    const found = await driver.find('task', {
      where: { created_at: { $between: ['2026-04-29', '2026-07-28'] } },
    } as any);
    expect(ids(found)).toEqual(['t_evening', 't_midnight', 't_morning', 't_yesterday']);
  });

  it('$between on a Field.date column is unchanged', async () => {
    const found = await driver.find('task', {
      where: { created_on: { $between: ['2026-04-29', '2026-07-28'] } },
    } as any);
    expect(ids(found)).toEqual(['t_evening', 't_midnight', 't_morning', 't_yesterday']);
  });

  it('stays one grouped predicate inside an $or branch', async () => {
    const found = await driver.find('task', {
      where: {
        $or: [
          { created_at: { $gte: '2026-07-28', $lte: '2026-07-28' } }, // "today" preset
          { title: 't_old' },
        ],
      },
    } as any);
    expect(ids(found)).toEqual(['t_evening', 't_midnight', 't_morning', 't_old']);
  });

  it('applies to the authored array spelling, lowered the declared way (#5158)', async () => {
    // The array form used to be compiled by the driver itself. It is now
    // input-only sugar lowered at the engine/protocol doors through
    // `parseFilterAST`, so this asserts the same authored filter still reaches
    // the same rows — via the one route that exists. Note the INFIX join
    // (`[condA, 'and', condB]`) has no lowering at all and is refused at the
    // door; the declared spelling of "both bounds" is the prefix group.
    const found = await driver.find('task', {
      where: parseFilterAST(
        ['and', ['created_at', '<=', '2026-07-28'], ['created_at', '>=', '2026-04-29']],
      ) as any,
    } as any);
    expect(ids(found)).toEqual(['t_evening', 't_midnight', 't_morning', 't_yesterday']);

    const between = await driver.find('task', {
      where: parseFilterAST([['created_at', 'between', ['2026-04-29', '2026-07-28']]]) as any,
    } as any);
    expect(ids(between)).toEqual(['t_evening', 't_midnight', 't_morning', 't_yesterday']);
  });
});

describe('bare-day $lte on an un-backfilled legacy column (mixed storage)', () => {
  let driver: LegacyStorageDriver;

  beforeEach(async () => {
    driver = new LegacyStorageDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      { name: 'task', fields: { title: { type: 'string' }, created_at: { type: 'datetime' } } },
    ]);
    // Both pre-#3912 storage forms of the same calendar day, in ONE column:
    // an INTEGER epoch (a bound JS Date) and zone-naive TEXT (CURRENT_TIMESTAMP).
    // The half-open bound must keep both — via the CASE-normalised column
    // expression, the applyNormalizedComparison arm of the rewrite.
    await driver.seedLegacyRows('task', 'created_at', [
      { id: 'epoch_morning', title: 'epoch', created_at: Date.parse('2026-07-28T09:15:00Z') },
      { id: 'text_evening', title: 'text', created_at: '2026-07-28 21:40:00' },
      { id: 'epoch_next_day', title: 'next', created_at: Date.parse('2026-07-29T00:00:00Z') },
      { id: 'text_old', title: 'old', created_at: '2026-04-19 10:00:00' },
    ]);
  });

  afterEach(async () => {
    await driver.disconnect?.();
  });

  it('keeps both stored forms of the final day and excludes the next midnight', async () => {
    const found = await driver.find('task', {
      where: { created_at: { $gte: '2026-04-29', $lte: '2026-07-28' } },
    } as any);
    expect(ids(found)).toEqual(['epoch_morning', 'text_evening']);
  });

  it('$between decomposes against the normalised column the same way', async () => {
    const found = await driver.find('task', {
      where: { created_at: { $between: ['2026-04-29', '2026-07-28'] } },
    } as any);
    expect(ids(found)).toEqual(['epoch_morning', 'text_evening']);
  });
});

// ── Dialect physical form of the rewritten bound (no DB connection) ─────────

/** Test double that injects field-type metadata without a live connection. */
class ProbeDriver extends SqlDriver {
  seedDatetime(table: string, field: string): void {
    (this.datetimeFields[table] ??= new Set()).add(field);
  }
  seedDate(table: string, field: string): void {
    (this.dateFields[table] ??= new Set()).add(field);
  }
  rewrite(table: string, field: string, op: string, value: unknown) {
    return this.calendarDayUpperBoundRewrite(table, field, op, value);
  }
  betweenRewrite(table: string, field: string, value: unknown) {
    return this.calendarDayBetweenRewrite(table, field, value);
  }
}

function makeProbe(client: string): ProbeDriver {
  return new ProbeDriver({ client, connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
}

describe('calendarDayUpperBoundRewrite — dialect and boundary matrix', () => {
  it('binds next-day midnight in each dialect physical spelling', () => {
    const expected: Record<string, string> = {
      'better-sqlite3': '2026-07-29T00:00:00.000Z',
      pg: '2026-07-29T00:00:00.000Z',
      mysql2: '2026-07-29 00:00:00.000', // #3942: MySQL parses neither T nor Z
    };
    for (const [client, value] of Object.entries(expected)) {
      const d = makeProbe(client);
      d.seedDatetime('t', 'at');
      expect(d.rewrite('t', 'at', '$lte', '2026-07-28'), client).toEqual({ op: '$lt', value });
      expect(d.rewrite('t', 'at', '<=', '2026-07-28'), client).toEqual({ op: '<', value });
    }
  });

  it('rolls month, year and leap-day boundaries as calendar arithmetic', () => {
    const d = makeProbe('better-sqlite3');
    d.seedDatetime('t', 'at');
    const upper = (day: string) => (d.rewrite('t', 'at', '$lte', day) as any)?.value;
    expect(upper('2026-07-31')).toBe('2026-08-01T00:00:00.000Z');
    expect(upper('2026-12-31')).toBe('2027-01-01T00:00:00.000Z');
    expect(upper('2024-02-28')).toBe('2024-02-29T00:00:00.000Z'); // leap year
    expect(upper('2025-02-28')).toBe('2025-03-01T00:00:00.000Z');
  });

  it('declines everything outside the calendar-day-on-datetime cell', () => {
    const d = makeProbe('better-sqlite3');
    d.seedDatetime('t', 'at');
    d.seedDate('t', 'on');
    // date column — `<=` is already whole-day-correct there.
    expect(d.rewrite('t', 'on', '$lte', '2026-07-28')).toBeNull();
    // lower bounds and strict-less keep their midnight anchor.
    expect(d.rewrite('t', 'at', '$gte', '2026-07-28')).toBeNull();
    expect(d.rewrite('t', 'at', '$lt', '2026-07-28')).toBeNull();
    // instant comparands keep instant semantics.
    expect(d.rewrite('t', 'at', '$lte', '2026-07-28T12:00:00Z')).toBeNull();
    expect(d.rewrite('t', 'at', '$lte', new Date('2026-07-28T00:00:00Z'))).toBeNull();
    // an impossible day is rejected, not rolled into an invented bound.
    expect(d.rewrite('t', 'at', '$lte', '2026-02-30')).toBeNull();
    // non-temporal column.
    expect(d.rewrite('t', 'title', '$lte', '2026-07-28')).toBeNull();
  });

  it('between: only a [min, max] with a bare-day max on datetime decomposes', () => {
    const d = makeProbe('better-sqlite3');
    d.seedDatetime('t', 'at');
    d.seedDate('t', 'on');
    expect(d.betweenRewrite('t', 'at', ['2026-04-29', '2026-07-28'])).toEqual({
      lower: '2026-04-29T00:00:00.000Z',
      upper: '2026-07-29T00:00:00.000Z',
    });
    expect(d.betweenRewrite('t', 'on', ['2026-04-29', '2026-07-28'])).toBeNull();
    expect(d.betweenRewrite('t', 'at', ['2026-04-29', '2026-07-28T12:00:00Z'])).toBeNull();
    expect(d.betweenRewrite('t', 'at', ['2026-04-29'])).toBeNull(); // malformed → caller's error
  });
});
