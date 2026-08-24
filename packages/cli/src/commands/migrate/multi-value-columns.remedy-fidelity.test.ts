// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11733] The statement `os migrate multi-value-columns` runs must be the
 * statement `@objectstack/driver-sql` printed — byte for byte, per dialect.
 *
 * ## Why this suite is the load-bearing one
 *
 * The remedy was corrected TWICE by measurement while #11720 was written, and
 * neither correction is recoverable by reasoning about SQL:
 *
 *   - `to_json(col)` makes a JSON **scalar** out of a legacy single value, so
 *     `Array.isArray` reads `false` under a field the metadata declares
 *     multi-value. Measured on live Postgres 16.13; `json_build_array` is what
 *     makes Postgres agree with MySQL's `JSON_ARRAY`.
 *   - `json_build_array(NULL)` is `[null]`, a one-element array. The explicit
 *     `IS NULL` arm was added AFTER the version without it was run on a live
 *     server and observed giving every NULL row a value.
 *
 * The CLI carries a copy of that statement (`manualJsonConversionSql` is not on
 * `@objectstack/driver-sql`'s public surface, and this card's file surface is
 * read-only over that package). A copy that can drift silently would lose both
 * corrections the first time the engine improves the statement, so it is held
 * to the engine's own output HERE: every case below builds the finding with
 * `diffManagedTable()` — the package-root export that produces the message an
 * operator actually sees — and requires the CLI's statement inside it.
 *
 * Deleting this suite deletes the only thing keeping the copy honest.
 */

import { describe, it, expect } from 'vitest';
import { diffManagedTable, type ManagedDriftEntry, type PhysicalColumn } from '@objectstack/driver-sql';
import {
  multiValueJsonMigrationSql,
  splitRemedyStatements,
  planStaleColumnTargets,
  CORRUPTING_DIALECTS,
} from './multi-value-columns.js';

const TABLE = 'proj_task';
const COLUMN = 'tags';

/** The stale column, in each dialect's own type spelling (#11720's fixtures). */
const STALE: Record<'postgres' | 'mysql', PhysicalColumn[]> = {
  postgres: [{ name: COLUMN, type: 'character varying', nullable: true, maxLength: 255 }],
  mysql: [{ name: COLUMN, type: 'varchar', nullable: true, maxLength: 255 }],
};

const engineFinding = (dialect: 'postgres' | 'mysql'): ManagedDriftEntry => {
  const out = diffManagedTable({
    table: TABLE,
    fields: { [COLUMN]: { type: 'lookup', multiple: true } as any },
    columns: STALE[dialect],
    dialect,
  });
  // Non-vacuity: if the engine stopped reporting this shape, every containment
  // assertion below would pass against nothing.
  expect(out).toHaveLength(1);
  expect(out[0].op.type).toBe('manual_column_type_change');
  return out[0];
};

describe('the CLI remedy is the engine remedy (#11733 / #11720)', () => {
  for (const dialect of CORRUPTING_DIALECTS) {
    it(`${dialect}: the statement the command would run appears verbatim in the engine's own finding`, () => {
      const entry = engineFinding(dialect);
      const cliSql = multiValueJsonMigrationSql(dialect, TABLE, COLUMN);

      // The whole point: not "looks similar", not "contains an ALTER" — the
      // engine's message CONTAINS the CLI's statement, character for character.
      expect(entry.message).toContain(cliSql);
    });
  }

  it('postgres keeps both corrections measurement forced — json_build_array, and the explicit IS NULL arm', () => {
    const sql = multiValueJsonMigrationSql('postgres', TABLE, COLUMN);
    expect(sql).toContain('json_build_array');
    // `to_json` is the reporter's original and the wrong answer here: it yields
    // a JSON scalar, not a one-element array.
    expect(sql).not.toContain('to_json');
    // Without this arm every NULL row gains `[null]`.
    expect(sql).toContain(`WHEN "${COLUMN}" IS NULL THEN NULL`);
    expect(sql).toContain(`WHEN "${COLUMN}" = '' THEN NULL`);
  });

  it('mysql is MySQL’s own statement, not the Postgres one with different quotes', () => {
    const sql = multiValueJsonMigrationSql('mysql', TABLE, COLUMN);
    expect(sql).toContain('JSON_ARRAY');
    expect(sql).not.toContain('json_build_array');
    // MySQL will not cast text to json implicitly — the rows have to be moved
    // BEFORE the ALTER or it dies on the first legacy value.
    const statements = splitRemedyStatements(sql);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toMatch(/^UPDATE .* JSON_ARRAY/);
    expect(statements[1]).toMatch(/^UPDATE .*= NULL WHERE/);
    expect(statements[2]).toMatch(/^ALTER TABLE .*MODIFY .*json$/);
  });

  it('postgres is ONE statement — which is why a failed conversion leaves the column untouched', () => {
    expect(splitRemedyStatements(multiValueJsonMigrationSql('postgres', TABLE, COLUMN))).toHaveLength(1);
  });

  it('the semicolon split loses nothing — neither form carries a semicolon inside a literal', () => {
    // The split is the one #11720's live suite executes the remedy with. It is
    // safe because of a property of THESE statements, so the property is pinned
    // rather than assumed: re-joining the parts reproduces the original.
    for (const dialect of CORRUPTING_DIALECTS) {
      const sql = multiValueJsonMigrationSql(dialect, TABLE, COLUMN);
      const rejoined = `${splitRemedyStatements(sql).join('; ')};`;
      expect(rejoined).toBe(sql.trim());
    }
  });

  it('identifiers are the finding’s own table and column, not a fixed pair', () => {
    // A builder that ignored its arguments would still pass every containment
    // check above if the fixture happened to use the same names.
    const other = multiValueJsonMigrationSql('postgres', 'crm_case', 'watchers');
    expect(other).toContain('"crm_case"');
    expect(other).toContain('"watchers"');
    expect(other).not.toContain(TABLE);
  });
});

describe('planning refuses anything it cannot match to the engine (#11733)', () => {
  for (const dialect of CORRUPTING_DIALECTS) {
    it(`${dialect}: a real finding plans the engine's statements and names the dialect`, () => {
      const plan = planStaleColumnTargets([engineFinding(dialect)]);
      expect(plan.refusals).toEqual([]);
      expect(plan.targets).toHaveLength(1);
      expect(plan.targets[0]).toMatchObject({ table: TABLE, column: COLUMN, to: 'json', dialect });
      expect(plan.targets[0].statements).toEqual(
        splitRemedyStatements(multiValueJsonMigrationSql(dialect, TABLE, COLUMN)),
      );
      // The dialect is READ OFF the finding, never off a client-name table this
      // package would have to keep in step with the driver's.
      expect(plan.targets[0].from).toBe(dialect === 'postgres' ? 'character varying' : 'varchar');
    });
  }

  it('a finding whose message no longer carries a statement we recognise is REFUSED, not guessed at', () => {
    // The failure this closes: the engine improves the remedy, the CLI copy
    // goes stale, and the command runs its own outdated SQL against a customer
    // database. It refuses instead — and says what to do by hand.
    const entry = engineFinding('postgres');
    const mutated = { ...entry, message: entry.message.replace('json_build_array', 'to_json') };

    const plan = planStaleColumnTargets([mutated]);
    expect(plan.targets).toEqual([]);
    expect(plan.refusals).toHaveLength(1);
    expect(plan.refusals[0]).toMatchObject({ table: TABLE, column: COLUMN, reason: 'remedy_not_recognized' });
    expect(plan.refusals[0].detail).toContain('os migrate plan');
  });

  it('ignores every drift op that is not this one', () => {
    const others = diffManagedTable({
      table: TABLE,
      fields: { [COLUMN]: { type: 'string', maxLength: 50 } as any },
      columns: STALE.postgres,
      dialect: 'postgres',
    });
    expect(others.map((d) => d.op.type)).toEqual(['narrow_varchar']); // the instrument found something
    expect(planStaleColumnTargets(others)).toEqual({ targets: [], refusals: [] });
  });

  it('--table narrows to the tables named, and drops the rest silently', () => {
    const a = engineFinding('postgres');
    const b = { ...a, table: 'crm_case', op: { ...(a.op as any), table: 'crm_case' } } as ManagedDriftEntry;
    // `b`'s message still carries `proj_task`'s statement, so it can only be
    // planned if the filter lets it through — which it must not.
    expect(planStaleColumnTargets([a, b], { tables: [TABLE] }).targets.map((t) => t.table)).toEqual([TABLE]);
    expect(planStaleColumnTargets([a, b], { tables: ['nothing_here'] }).targets).toEqual([]);
  });
});
