// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9160] The instrument #8823 did not have: raise each candidate diagnostic
 * family against a LIVE server and record what the server actually printed.
 *
 * ## Why this file exists
 *
 * `redactStatementFromMessage` (`@objectstack/objectql`) keeps the database's
 * diagnostic after the statement cut, on the premise that a diagnostic names
 * IDENTIFIERS. #8823 found one family where that is false — MySQL's
 * `ER_DUP_ENTRY` inlines the conflicting VALUE — and redacted that one slot.
 *
 * The list it introduced had exactly one entry and **no way to notice a second
 * was missing**. Nothing measured whether a diagnostic a driver produced carried
 * a value; the single entry got there because a human read one template closely,
 * and the next one would have needed the same accident. The standing rule
 * (`packages/types/src/unique-violation.ts`) says a dialect's spelling may be
 * added only once measured off a THROWN error, never from a reading of the
 * manual — which is correct, and which is exactly why the list could not grow.
 *
 * This file closes that loop. It plants a canary value, provokes each family
 * through the driver's own bind path, and records **where the canary lands**:
 * `error.message` (which `ObjectLogger.write` serializes — an exposure) or
 * `error.detail` (which it does not — not an exposure, and only by coincidence).
 *
 * ## The zero is not a measurement without a positive control
 *
 * {@link POSITIVE_CONTROL} raises `ER_DUP_ENTRY` (1062) FIRST — the one family
 * already known value-bearing and already encoded. If the known-present
 * neighbour does not answer, the instrument is broken and every other verdict
 * here is uninterpretable, so its failure message says so rather than reading as
 * an ordinary red.
 *
 * ## What a failure here means
 *
 * Each case declares the placement it was measured at. A red means the server
 * changed its mind — either a family that named only identifiers has started
 * inlining a value (**a new leak; add it to `VALUE_BEARING_TEMPLATES` in
 * `driver-fault-redaction.ts`, and cite this probe's output as the warrant**),
 * or a template's phrasing drifted and the entry that matched it no longer does.
 * Both are the notification #9160 asked for.
 *
 * ⛔ This probe deliberately does NOT import the redactor. `driver-sql` does not
 * depend on `@objectstack/objectql`, and widening that package's public surface
 * to reach an internal function is a contract change this card does not carry.
 * The division is: this file establishes WHAT THE SERVER SAYS; the redactor's own
 * suite (`packages/objectql/src/driver-fault-redaction.test.ts`) drives these
 * exact recorded strings through the function. The recorded literals below are
 * duplicated there on purpose, with this file named as their warrant.
 *
 * Runs in `Temporal Conformance (live PG + MySQL)`, the one job that stands up
 * `postgres:16` and `mysql:8.0`. Without the URLs each cell is a named skip.
 */

import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import knex, { type Knex } from 'knex';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

/** The matrix name this cell list belongs to, for the un-provisioned declaration. */
const MATRIX = 'value-bearing diagnostic';

/** Planted so a leak is unmistakable in the recorded output. */
const CANARY = 'SENSITIVE-CANARY-9160';

/** Where a caller's value landed on the thrown error. */
type Placement =
  /** On `error.message` — the field `ObjectLogger.write` serializes. An exposure. */
  | 'message'
  /** On `error.detail` only — not serialized, so not an exposure. Coincidence, not a defence. */
  | 'detail'
  /** Nowhere: the diagnostic named identifiers only. */
  | 'absent';

interface ProbeCase {
  /** The server's own error code, as it identifies the family. */
  readonly family: string;
  /**
   * The caller value this case plants, as it would appear in the diagnostic.
   * Defaults to {@link CANARY}; a family that can only be provoked by a value of
   * a particular SHAPE (an out-of-range number cannot also be a canary string)
   * declares its own, so "did the caller's value survive?" stays answerable.
   */
  readonly canary?: string;
  /** Where the canary was MEASURED to land. A change here is the notification. */
  readonly placement: Placement;
  /**
   * The diagnostic tail exactly as the server printed it, with the canary and
   * any generated identifiers folded out. Asserted as a SUBSTRING of the tail so
   * a phrasing drift is a named red.
   */
  readonly phrasing: string;
  /** Provoke the family. Must reject. */
  readonly raise: (db: Knex) => Promise<unknown>;
}

/** knex joins the bound statement to the server's own words with this. */
const SEPARATOR = ' - ';

/** The database's own half of a knex driver message — everything after the LAST separator. */
function diagnosticOf(message: string): string {
  const cut = message.lastIndexOf(SEPARATOR);
  return cut === -1 ? message : message.slice(cut + SEPARATOR.length).trim();
}

// ---------------------------------------------------------------------------
// MySQL
// ---------------------------------------------------------------------------

const MYSQL_TABLE = 'probe_9160_mysql';

/**
 * ⛔ The positive control. Known value-bearing, already encoded, and asserted
 * first — a probe that cannot reproduce it is not measuring anything.
 */
const POSITIVE_CONTROL: ProbeCase = {
  family: 'ER_DUP_ENTRY (1062)',
  placement: 'message',
  phrasing: 'Duplicate entry',
  raise: async (db) => {
    await db(MYSQL_TABLE).insert({ email: CANARY });
    return db(MYSQL_TABLE).insert({ email: CANARY });
  },
};

const MYSQL_CASES: readonly ProbeCase[] = [
  POSITIVE_CONTROL,
  {
    // The card's first named candidate. Measured: matches the manual exactly.
    family: 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD (1366)',
    placement: 'message',
    phrasing: 'Incorrect integer value:',
    raise: (db) => db(MYSQL_TABLE).insert({ age: CANARY }),
  },
  {
    family: 'ER_TRUNCATED_WRONG_VALUE (1292), datetime spelling',
    placement: 'message',
    phrasing: 'Incorrect datetime value:',
    raise: (db) => db(MYSQL_TABLE).insert({ when_at: CANARY }),
  },
  {
    // Identifier-only NEIGHBOURS. These are the cases that make a zero readable:
    // the probe raises them too, so "no value here" is a measurement rather than
    // an absence of one.
    family: 'ER_WARN_DATA_OUT_OF_RANGE (1264)',
    canary: '999999999999',
    placement: 'absent',
    phrasing: "Out of range value for column 'age' at row 1",
    raise: (db) => db(MYSQL_TABLE).insert({ age: 999999999999 }),
  },
  {
    family: 'ER_DATA_TOO_LONG (1406)',
    placement: 'absent',
    phrasing: "Data too long for column 'label' at row 1",
    raise: (db) => db(MYSQL_TABLE).insert({ label: `${CANARY}${'z'.repeat(300)}` }),
  },
  {
    family: 'ER_BAD_FIELD_ERROR (1054)',
    placement: 'absent',
    phrasing: "in 'field list'",
    raise: (db) => db(MYSQL_TABLE).insert({ zzz_nonexistent_field: CANARY }),
  },
];

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

const PG_TABLE = 'probe_9160_pg';

const PG_CASES: readonly ProbeCase[] = [
  {
    // The card's second named candidate, and the one whose answer matters most:
    // unlike 23505 below, this puts the caller's value on `message`.
    family: 'invalid_text_representation (22P02)',
    placement: 'message',
    phrasing: 'invalid input syntax for type integer:',
    raise: (db) => db(PG_TABLE).insert({ age: CANARY }),
  },
  {
    family: 'invalid_datetime_format (22007)',
    placement: 'message',
    phrasing: 'invalid input syntax for type timestamp with time zone:',
    raise: (db) => db(PG_TABLE).insert({ when_at: CANARY }),
  },
  {
    family: 'numeric_value_out_of_range (22003)',
    canary: '99999999999',
    placement: 'message',
    phrasing: 'is out of range for type integer',
    raise: (db) => db(PG_TABLE).insert({ age: 99999999999 }),
  },
  {
    // #8823's coincidence, re-measured. The value is on `detail`, which
    // `ObjectLogger.write` does not serialize — so Postgres is saved here by a
    // fact about our Logger, not by the cut.
    family: 'unique_violation (23505)',
    placement: 'detail',
    phrasing: 'duplicate key value violates unique constraint',
    raise: async (db) => {
      await db(PG_TABLE).insert({ email: CANARY });
      return db(PG_TABLE).insert({ email: CANARY });
    },
  },
  {
    family: 'not_null_violation (23502)',
    placement: 'detail',
    phrasing: 'violates not-null constraint',
    raise: (db) => db.raw(`insert into ${PG_TABLE} (id, email) values (null, ?)`, [CANARY]),
  },
  {
    family: 'string_data_right_truncation (22001)',
    placement: 'absent',
    phrasing: 'value too long for type character varying(20)',
    raise: (db) => db(PG_TABLE).insert({ label: `${CANARY}${'z'.repeat(50)}` }),
  },
];

// ---------------------------------------------------------------------------

const SCHEMAS: Record<string, { table: string; ddl: (db: Knex) => Promise<unknown>; cases: readonly ProbeCase[] }> = {
  mysql: {
    table: MYSQL_TABLE,
    cases: MYSQL_CASES,
    ddl: (db) =>
      db.raw(
        `create table ${MYSQL_TABLE} (`
        + ' id int primary key auto_increment,'
        + ' email varchar(191), age int, when_at datetime, label varchar(20),'
        + ` unique key uq_${MYSQL_TABLE}_email (email))`,
      ),
  },
  pg: {
    table: PG_TABLE,
    cases: PG_CASES,
    ddl: (db) =>
      db.raw(
        `create table ${PG_TABLE} (`
        + ' id serial primary key,'
        + ' email text unique, age int, when_at timestamptz, label varchar(20))',
      ),
  },
};

for (const cell of DIALECT_CELLS) {
  // SQLite has no server to interrogate and none of these families; the driver
  // axis still reports it rather than omitting it.
  if (!cell.live) continue;

  declareDialectCell(cell, MATRIX, (live: DialectCell) => {
    const plan = SCHEMAS[live.id];

    describe(`sql-driver — ${MATRIX} probe (${live.label})`, () => {
      let db: Knex;
      /** family → the thrown error, captured once in `beforeAll`. */
      const raised = new Map<string, any>();

      beforeAll(async () => {
        db = knex(live.config() as Knex.Config);
        await db.raw(`drop table if exists ${plan.table}`);
        await plan.ddl(db);

        for (const probe of plan.cases) {
          try {
            await probe.raise(db);
            raised.set(probe.family, undefined);
          } catch (err) {
            raised.set(probe.family, err);
          }
        }
      }, 60_000);

      afterAll(async () => {
        if (!db) return;
        await db.raw(`drop table if exists ${plan.table}`).catch(() => {});
        await db.destroy();
      });

      if (live.id === 'mysql') {
        it('POSITIVE CONTROL — ER_DUP_ENTRY still answers, and still inlines the value', () => {
          const err = raised.get(POSITIVE_CONTROL.family);

          expect(
            err,
            'the positive control raised NO error: this probe is not measuring anything, and every '
              + 'other verdict in this file is uninterpretable. Fix the instrument before reading them.',
          ).toBeInstanceOf(Error);

          const diagnostic = diagnosticOf(String(err.message));
          // The phrasing the single encoded entry matches, reproduced off a live
          // server rather than off this repo's recorded strings.
          expect(diagnostic).toContain('Duplicate entry');
          expect(diagnostic).toContain(CANARY);
          expect(diagnostic).toMatch(/for key '[^']+'/);
        });
      }

      for (const probe of plan.cases) {
        it(`${probe.family} — canary lands on \`${probe.placement}\``, () => {
          const err = raised.get(probe.family);

          expect(
            err,
            `${probe.family} could not be raised through the driver's bind path. An unraisable `
              + 'family is a documented negative result, not a silent pass — record it here rather '
              + 'than deleting the case.',
          ).toBeInstanceOf(Error);

          const message = String(err.message);
          const diagnostic = diagnosticOf(message);
          const detail = typeof err.detail === 'string' ? err.detail : '';

          // 1. The server still prints what it was measured to print.
          expect(
            diagnostic,
            `${probe.family} changed its phrasing. Whatever entry in VALUE_BEARING_TEMPLATES `
              + '(objectql/src/driver-fault-redaction.ts) was written against it no longer matches. '
              + `Server said: ${JSON.stringify(diagnostic)}`,
          ).toContain(probe.phrasing);

          // 2. …and the caller's value is still where it was measured to be.
          //    This is the assertion that notices a NEW value-bearing family.
          const planted = probe.canary ?? CANARY;
          const actual: Placement = diagnostic.includes(planted)
            ? 'message'
            : detail.includes(planted)
              ? 'detail'
              : 'absent';

          expect(
            actual,
            `${probe.family} moved the caller's value from \`${probe.placement}\` to \`${actual}\`. `
              + (actual === 'message'
                ? 'It now inlines a caller value into the diagnostic `ObjectLogger.write` SERIALIZES — '
                  + 'this is a new leak. Add the template to VALUE_BEARING_TEMPLATES in '
                  + 'objectql/src/driver-fault-redaction.ts and cite this output as the warrant. '
                : 'The exposure changed shape; re-read the redactor before relaxing this. ')
              + `Server said: ${JSON.stringify(diagnostic)}`,
          ).toBe(probe.placement);
        });
      }
    });
  });
}
