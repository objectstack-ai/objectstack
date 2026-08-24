// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11733] The command runs the ENGINE's statement, and works out WHICH dialect
 * it is running by reading the engine's own finding.
 *
 * ## What this file used to be, and why it is smaller
 *
 * It began as a fidelity suite: `manualJsonConversionSql` was not on
 * `@objectstack/driver-sql`'s public surface, so the command carried a copy of
 * the statement and this suite held the copy to the engine's, byte for byte.
 * The one-line re-export landed with this card, the copy is gone, and with it
 * every assertion whose only job was to compare two spellings of one statement.
 * Three cases were deleted rather than left behind:
 *
 *   - "identifiers are the finding's own table and column" — it tested the
 *     CLI's builder handling its arguments. There is no CLI builder now; the
 *     call site's argument passing is covered by the plan cases below, which
 *     compare a real plan against `manualJsonConversionSql(dialect, …)`.
 *   - "postgres keeps both corrections measurement forced" and the content half
 *     of the MySQL case (`JSON_ARRAY` present, `json_build_array` absent). Both
 *     now assert `driver-sql`'s CONTENT from a consumer's suite. They are not
 *     vacuous — the engine could change that text — but that is precisely the
 *     problem: they could only ever fail for a reason that has nothing to do
 *     with this package, turning a deliberate engine correction into a red CLI
 *     suite. `driver-sql` owns those, and pins them in
 *     `schema-drift.base-type-mismatch.test.ts`, where they are also EXECUTED
 *     against live Postgres 16.13 and MySQL 8.0.46.
 *
 * ## What is left is not fidelity, and can still fail
 *
 * Two claims, both about this package:
 *
 *   1. **the coupling the dialect probe reads** — the finding's message still
 *      EMBEDS the remedy. Nothing in the CLI can keep that true, and everything
 *      in the CLI depends on it: the probe decides Postgres from MySQL by which
 *      dialect's statement the message contains, because a `ManagedDriftEntry`
 *      carries no dialect and a client-spelling table copied out of the driver
 *      could only disagree with it. If the engine ever stops interpolating the
 *      statement, these go red here — where the consumer that would silently
 *      lose its dialect lives.
 *   2. **the split, and the refusal** — how this command turns one engine
 *      statement into the statements a seam takes, and what it does with a
 *      finding it cannot read a dialect from.
 */

import { describe, it, expect } from 'vitest';
import {
  diffManagedTable,
  manualJsonConversionSql,
  type ManagedDriftEntry,
  type PhysicalColumn,
} from '@objectstack/driver-sql';
import { splitRemedyStatements, planStaleColumnTargets, CORRUPTING_DIALECTS } from './multi-value-columns.js';

const TABLE = 'proj_task';
const COLUMN = 'tags';

/** Exactly what the command hands the planner in `run()`. */
const SQL = { sql: manualJsonConversionSql };

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
  // Non-vacuity: if the engine stopped reporting this shape, every assertion
  // below would pass against nothing.
  expect(out).toHaveLength(1);
  expect(out[0].op.type).toBe('manual_column_type_change');
  return out[0];
};

describe('the coupling the dialect probe depends on (#11733)', () => {
  for (const dialect of CORRUPTING_DIALECTS) {
    it(`${dialect}: the finding's message still EMBEDS the remedy, which is what the probe matches on`, () => {
      // Not "the CLI agrees with the engine" — there is one function now, so
      // that could not fail. This is the engine's MESSAGE against the engine's
      // FUNCTION: it fails the day the message stops carrying the statement,
      // which is the day this command can no longer tell Postgres from MySQL.
      expect(engineFinding(dialect).message).toContain(manualJsonConversionSql(dialect, TABLE, COLUMN));
    });
  }

  it('the two dialect forms are distinguishable — a probe reading one cannot match the other', () => {
    // The premise of reading the dialect off the message. If the forms were
    // substrings of one another the probe would resolve the wrong dialect and
    // run the wrong DDL, so this is asserted rather than assumed.
    const pg = manualJsonConversionSql('postgres', TABLE, COLUMN);
    const my = manualJsonConversionSql('mysql', TABLE, COLUMN);
    expect(pg).not.toBe(my);
    expect(engineFinding('postgres').message).not.toContain(my);
    expect(engineFinding('mysql').message).not.toContain(pg);
  });
});

describe('splitting the engine statement into what a seam can run (#11733)', () => {
  it('mysql is three statements, in the order that makes the ALTER survivable', () => {
    const statements = splitRemedyStatements(manualJsonConversionSql('mysql', TABLE, COLUMN));
    expect(statements).toHaveLength(3);
    expect(statements[0]).toMatch(/^UPDATE .* JSON_ARRAY/);
    expect(statements[1]).toMatch(/^UPDATE .*= NULL WHERE/);
    expect(statements[2]).toMatch(/^ALTER TABLE .*MODIFY .*json$/);
  });

  it('postgres is ONE statement — which is why a failed conversion leaves the column untouched', () => {
    // The rollback notes state this as a fact about Postgres; it is a fact
    // about the STATEMENT, so it is read off the statement.
    expect(splitRemedyStatements(manualJsonConversionSql('postgres', TABLE, COLUMN))).toHaveLength(1);
  });

  it('the semicolon split loses nothing — neither form carries a semicolon inside a literal', () => {
    // The split is the one #11720's live suite executes the remedy with. It is
    // safe because of a property of THESE statements, so the property is pinned
    // rather than assumed: re-joining the parts reproduces the original.
    for (const dialect of CORRUPTING_DIALECTS) {
      const sql = manualJsonConversionSql(dialect, TABLE, COLUMN);
      expect(`${splitRemedyStatements(sql).join('; ')};`).toBe(sql.trim());
    }
  });
});

describe('planning refuses anything it cannot read a dialect from (#11733)', () => {
  for (const dialect of CORRUPTING_DIALECTS) {
    it(`${dialect}: a real finding plans the engine's statements and names the dialect`, () => {
      const plan = planStaleColumnTargets([engineFinding(dialect)], SQL);
      expect(plan.refusals).toEqual([]);
      expect(plan.targets).toHaveLength(1);
      expect(plan.targets[0]).toMatchObject({ table: TABLE, column: COLUMN, to: 'json', dialect });
      // Also the call site's argument passing: these are the statements for
      // THIS table and column, not for a pair fixed anywhere in the command.
      expect(plan.targets[0].statements).toEqual(
        splitRemedyStatements(manualJsonConversionSql(dialect, TABLE, COLUMN)),
      );
      expect(plan.targets[0].from).toBe(dialect === 'postgres' ? 'character varying' : 'varchar');
    });
  }

  it('a finding whose message carries no statement we can read a dialect from is REFUSED', () => {
    // The failure this closes: the engine rewords the message, the probe can no
    // longer tell Postgres from MySQL, and the command picks one anyway and
    // runs the wrong dialect's DDL against a customer's table. It refuses
    // instead — and says what to do by hand.
    const entry = engineFinding('postgres');
    const mutated = { ...entry, message: entry.message.replace('json_build_array', 'to_json') };

    const plan = planStaleColumnTargets([mutated], SQL);
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
    expect(planStaleColumnTargets(others, SQL)).toEqual({ targets: [], refusals: [] });
  });

  it('--table narrows to the tables named, and drops the rest silently', () => {
    const a = engineFinding('postgres');
    const b = { ...a, table: 'crm_case', op: { ...(a.op as any), table: 'crm_case' } } as ManagedDriftEntry;
    // `b`'s message still carries `proj_task`'s statement, so it can only be
    // planned if the filter lets it through — which it must not.
    expect(planStaleColumnTargets([a, b], { ...SQL, tables: [TABLE] }).targets.map((t) => t.table)).toEqual([TABLE]);
    expect(planStaleColumnTargets([a, b], { ...SQL, tables: ['nothing_here'] }).targets).toEqual([]);
  });
});
