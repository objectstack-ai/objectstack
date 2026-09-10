// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16318] The NUMERIC family's column comes from `packages/spec`'s stated
 * physical representation, and the SQLite consequence of that move is pinned
 * per type — the constraint the card itself raised:
 *
 * > SQLite affinity is what put `rating`/`slider`/`progress` in the driver's
 * > float arm in the first place, so any move has to be judged there too.
 *
 * `createColumn`'s float arm records the leak it was written to defeat: without
 * an explicit case these types fell to `table.string`, the column took TEXT
 * affinity, and SQLite stored `'4'` rather than `4`. This file pins that the
 * leak stays defeated, in the only terms that decide it — the storage class
 * SQLite actually records.
 *
 * ## What the move does on SQLite, per type — measured, not argued
 *
 * knex compiles `table.decimal(name, p, s)` and `table.float(name)` to the
 * IDENTICAL `float` column on SQLite (`ColumnCompiler_SQLite3.prototype.decimal`
 * is the literal `'float'`), so:
 *
 *   - the six exact-decimal members emit BYTE-IDENTICAL SQLite DDL to the float
 *     arm they leave and keep REAL affinity;
 *   - `rating` moves to INTEGER affinity, where `4` is stored as the integer
 *     `4` rather than the real `4.0`, and `4.5` is still accepted as a REAL —
 *     SQLite refuses no fractional value, so nothing this dialect accepts today
 *     stops being accepted.
 *
 * The exactness the move buys is a PostgreSQL/MySQL property; SQLite applies no
 * precision and no scale and behaves exactly as it does today.
 *
 * ## The read half, which is what makes the move safe on the server dialects
 *
 * node-postgres parses `real` to a JS number and `numeric` to a STRING, and
 * mysql2 does the same for `DECIMAL`. `formatOutput`'s `numericFields` pass was
 * SQLite-only on the premise that string-valued numerics come only from legacy
 * TEXT-affinity columns; #16318 falsified that premise and moved the pass to
 * every dialect. Pinned here through the driver's own read door.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NUMERIC_VALUE_TYPES, numericColumnFor } from '@objectstack/spec/data';
import { SqlDriver } from './index.js';

const NUMERIC_TYPES = [...NUMERIC_VALUE_TYPES].sort();

class Probe extends SqlDriver {
  public async declaredColumns(table: string): Promise<Map<string, string>> {
    const rows = (await this.knex.raw(`PRAGMA table_info("${table}")`)) as Array<{
      name: string;
      type: string;
    }>;
    return new Map(rows.map((r) => [r.name, r.type.toLowerCase()]));
  }

  public async storageClass(table: string, column: string): Promise<Array<{ t: string; v: unknown }>> {
    return (await this.knex.raw(
      `select typeof("${column}") as t, "${column}" as v from "${table}" where "${column}" is not null`,
    )) as Array<{ t: string; v: unknown }>;
  }
}

describe('#16318 — the numeric family on SQLite', () => {
  let driver: Probe;

  beforeEach(async () => {
    driver = new Probe({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    const fields: Record<string, unknown> = { name: { type: 'text' } };
    for (const t of NUMERIC_TYPES) fields[`f_${t}`] = { type: t };
    await driver.initObjects([{ name: 'zoo', fields } as never]);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('declares the arm the spec states, and the two arms have not collapsed into one', async () => {
    const cols = await driver.declaredColumns('zoo');
    // Non-vacuity: without this an empty PRAGMA read would pass every loop.
    expect(NUMERIC_TYPES.length).toBeGreaterThanOrEqual(7);
    for (const t of NUMERIC_TYPES) expect(cols.has(`f_${t}`), `f_${t}`).toBe(true);

    for (const t of NUMERIC_TYPES) {
      const answer = numericColumnFor(t);
      expect(answer, t).toBeDefined();
      // The whole SQLite claim: the exact-decimal members declare `float` —
      // the same string the float arm they left declared.
      expect(cols.get(`f_${t}`), t).toBe(answer!.kind === 'integer' ? 'integer' : 'float');
    }
    expect(new Set(NUMERIC_TYPES.map((t) => cols.get(`f_${t}`))).size).toBe(2);
    // ⛔ The fossil's own leak: nothing in this family may declare a character
    // column, which is what put three of these types in the float arm.
    for (const t of NUMERIC_TYPES) expect(cols.get(`f_${t}`), t).not.toMatch(/char|text|clob/);
  });

  it('keeps every member out of TEXT storage, and rating takes INTEGER storage', async () => {
    const row: Record<string, unknown> = { name: 'r' };
    for (const t of NUMERIC_TYPES) row[`f_${t}`] = 4;
    await driver.create('zoo', row);

    for (const t of NUMERIC_TYPES) {
      const [cell] = await driver.storageClass('zoo', `f_${t}`);
      // The fossil's leak, pinned as the storage class rather than the type name.
      expect(cell.t, t).not.toBe('text');
      const answer = numericColumnFor(t)!;
      expect(cell.t, t).toBe(answer.kind === 'integer' ? 'integer' : 'real');
    }
  });

  it('rating still accepts a fractional value on SQLite — the refusal it gains is server-side', async () => {
    await driver.create('zoo', { name: 'half', f_rating: 4.5 });
    const [cell] = await driver.storageClass('zoo', 'f_rating');
    expect(cell.t).toBe('real');
    expect(cell.v).toBe(4.5);
  });

  it('reads every member back as a JS number', async () => {
    const written: Record<string, number> = {};
    for (const t of NUMERIC_TYPES) written[`f_${t}`] = t === 'rating' ? 4 : 33.333;
    await driver.create('zoo', { name: 'rt', ...written });
    const [back] = await driver.find('zoo', { filters: ['name', '=', 'rt'] } as never);
    for (const [k, v] of Object.entries(written)) {
      expect(typeof back[k], k).toBe('number');
      expect(back[k], k).toBe(v);
    }
  });
});
