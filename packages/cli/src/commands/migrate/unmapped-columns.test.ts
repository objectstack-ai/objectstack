// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate unmapped-columns`, its two pure halves: which columns it reads,
 * and how it reads them.
 *
 * ## The column set is the plan's, by construction
 *
 * {@link unmappedColumnsOf} filters `detectManagedDrift()`'s findings; it never
 * diffs anything itself. So the cases here hold the FILTER: every
 * `unmapped_column` finding of the named table, in the differ's order, and
 * nothing else the differ reports (a type mismatch, an index op, another
 * table's orphan). What the differ leaves out, a built-in column or a
 * driver-owned hash shadow, never reaches this filter: that half is pinned on
 * a real database by `unmapped-columns.integration.test.ts`, beside
 * `os migrate plan`'s own answer for the same table.
 *
 * ## The read refuses rather than emit a partial set
 *
 * A conversion script run over part of a table, followed by the destructive
 * drop, loses the rest. So a cap that stops the walk, a row missing a
 * reported column (the SQL driver answers a projection naming a missing column
 * with the whole row, measured on SQLite and PostgreSQL) and an answer that is
 * not rows each REFUSE, and none of them returns records.
 */

import { describe, it, expect } from 'vitest';
import type { ManagedDriftEntry } from '@objectstack/driver-sql';
import {
  unmappedColumnsOf,
  readUnmappedColumnValues,
  type UnmappedColumnReader,
} from './unmapped-columns.js';

/** A drift finding in the differ's shape; only the fields the filter reads matter. */
function finding(partial: Partial<ManagedDriftEntry> & { kind: ManagedDriftEntry['kind']; table: string }): ManagedDriftEntry {
  return {
    remoteName: partial.table,
    expected: '(absent)',
    actual: 'text',
    severity: 'warning',
    category: 'destructive',
    op: { type: 'drop_column', table: partial.table, column: partial.column ?? '' },
    message: '',
    ...partial,
  } as ManagedDriftEntry;
}

/**
 * A reader over in-memory rows that honours what the keyset walk asks of a
 * driver: the `id > cursor` seek, ascending order, the page limit and the
 * projection. Every query it was asked is recorded.
 */
function rowsReader(rows: Array<Record<string, unknown>>): UnmappedColumnReader & { queries: Array<Record<string, any>> } {
  const queries: Array<Record<string, any>> = [];
  return {
    queries,
    async find(_object, query) {
      queries.push(query);
      const where = query.where as { id?: { $gt?: string } } | undefined;
      const after = where?.id?.$gt;
      const fields = query.fields as string[];
      return rows
        .filter((r) => after === undefined || String(r.id) > after)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .slice(0, query.limit as number)
        .map((r) => Object.fromEntries(fields.filter((f) => f in r).map((f) => [f, r[f]])));
    },
  };
}

describe('unmappedColumnsOf — the plan\'s unmapped_column findings for one table, and nothing else', () => {
  const drift: ManagedDriftEntry[] = [
    finding({ kind: 'unmapped_column', table: 'contact', column: 'mailing_city', actual: 'varchar(255)' }),
    finding({ kind: 'unmapped_column', table: 'contact', column: 'mailing_street', actual: 'text' }),
    finding({ kind: 'type_mismatch', table: 'contact', column: 'name', actual: 'varchar(80)' }),
    finding({ kind: 'unmapped_column', table: 'account', column: 'legacy_rank', actual: 'integer' }),
    // An orphaned generated INDEX over the same column: unmapped, but not a column.
    finding({ kind: 'unmapped_index', table: 'contact', column: 'mailing_street' }),
  ];

  it('picks every unmapped_column finding of the named table, in the differ\'s order, with its physical type', () => {
    expect(unmappedColumnsOf(drift, 'contact')).toEqual([
      { column: 'mailing_city', actual: 'varchar(255)' },
      { column: 'mailing_street', actual: 'text' },
    ]);
  });

  it('leaves out another table\'s orphan and every other kind of finding on this one', () => {
    expect(unmappedColumnsOf(drift, 'account')).toEqual([{ column: 'legacy_rank', actual: 'integer' }]);
    expect(unmappedColumnsOf(drift, 'lead')).toEqual([]);
  });

  it('answers empty work for a table the differ reported nothing unmapped on', () => {
    expect(unmappedColumnsOf([finding({ kind: 'type_mismatch', table: 'contact', column: 'name' })], 'contact')).toEqual([]);
    expect(unmappedColumnsOf([], 'contact')).toEqual([]);
  });
});

describe('readUnmappedColumnValues — every row, keyed by record id, values as the driver returned them', () => {
  it('asks the driver for id plus exactly the unmapped columns, and keys each record by its id', async () => {
    const reader = rowsReader([
      { id: 'c2', name: 'Bob', mailing_street: null, mailing_city: null },
      { id: 'c1', name: 'Ann', mailing_street: '1 Retired Way', mailing_city: 'Oldtown' },
    ]);
    const records = await readUnmappedColumnValues(reader, 'contact', ['mailing_city', 'mailing_street']);

    expect(reader.queries[0]?.fields).toEqual(['id', 'mailing_city', 'mailing_street']);
    expect(records).toEqual([
      { id: 'c1', values: { mailing_city: 'Oldtown', mailing_street: '1 Retired Way' } },
      // A NULL is a stored value: the row is emitted with it, never dropped.
      { id: 'c2', values: { mailing_city: null, mailing_street: null } },
    ]);
    // A declared field the reader happened to carry is not an unmapped value.
    expect(Object.keys(records[0]!.values)).not.toContain('name');
  });

  it('decodes nothing: a JSON-looking string, a 0/1 and a Buffer reach the record as the driver handed them', async () => {
    const blob = Buffer.from([1, 2, 255]);
    const reader = rowsReader([{ id: 'c1', legacy_flags: '{"a":[1,2]}', legacy_on: 1, legacy_blob: blob }]);
    const [record] = await readUnmappedColumnValues(reader, 'contact', ['legacy_flags', 'legacy_on', 'legacy_blob']);

    expect(record!.values.legacy_flags).toBe('{"a":[1,2]}');
    expect(record!.values.legacy_on).toBe(1);
    expect(record!.values.legacy_blob).toBe(blob);
  });

  it('walks past one page by seeking on id, and reads every row once', async () => {
    const rows = Array.from({ length: 1203 }, (_, i) => ({ id: `r${String(i).padStart(5, '0')}`, legacy: i }));
    const reader = rowsReader(rows);
    const records = await readUnmappedColumnValues(reader, 'contact', ['legacy']);

    expect(records).toHaveLength(1203);
    expect(new Set(records.map((r) => r.id)).size).toBe(1203);
    expect(reader.queries.length).toBeGreaterThan(1);
    expect(reader.queries[1]?.where).toEqual({ id: { $gt: 'r00499' } });
  });

  it('answers no records for an empty table', async () => {
    expect(await readUnmappedColumnValues(rowsReader([]), 'contact', ['legacy'])).toEqual([]);
  });

  it('REFUSES when the row cap stops the walk, rather than emit a partial set', async () => {
    const reader = rowsReader([{ id: 'a', legacy: 1 }, { id: 'b', legacy: 2 }, { id: 'c', legacy: 3 }]);
    await expect(readUnmappedColumnValues(reader, 'contact', ['legacy'], { max: 2 })).rejects.toThrow(
      /stopped at 2 row\(s\) without reaching the end of the table[\s\S]*--max-records/,
    );
  });

  it('reads a table that holds exactly the cap, without refusing', async () => {
    const reader = rowsReader([{ id: 'a', legacy: 1 }, { id: 'b', legacy: 2 }]);
    expect(await readUnmappedColumnValues(reader, 'contact', ['legacy'], { max: 2 })).toHaveLength(2);
  });

  it('REFUSES a row missing a reported column (the whole-row answer to a projection naming a missing column)', async () => {
    const reader: UnmappedColumnReader = {
      async find() {
        return [{ id: 'c1', name: 'Ann', created_at: '2026-01-01' }];
      },
    };
    await expect(readUnmappedColumnValues(reader, 'contact', ['mailing_street'])).rejects.toThrow(
      /returned record c1 without the column mailing_street/,
    );
  });

  it('REFUSES an answer that is not an array of rows, rather than read it as an empty table', async () => {
    const reader: UnmappedColumnReader = {
      async find() {
        return { records: [] };
      },
    };
    await expect(readUnmappedColumnValues(reader, 'contact', ['legacy'])).rejects.toThrow(/not an array of rows/);
  });
});
