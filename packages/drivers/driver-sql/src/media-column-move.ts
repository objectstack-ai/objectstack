// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15989] The ADR-0104 file-family COLUMN step — the per-dialect statements
 * that move a media column's stored form from the JSON-quoted id to the bare
 * `sys_file` id, and the pre-check that ABORTS instead of destroying a row the
 * backfill never converted.
 *
 * The ruling on #15041 gave this step one requirement in words — abort *"on
 * the first cell that is not a JSON string"* — and one sketch in SQL beside
 * it. **The sketch does not implement the requirement, and that was measured
 * rather than argued** (director ruling, decision batch #120 item 1): on live
 * PostgreSQL 16.13 the prescribed `ALTER … USING (col #>> '{}')` was ACCEPTED
 * over a row holding an inline metadata blob and flattened that object to the
 * literal text `{"url":"https://x/y.png"}` in a `varchar` column, because
 * `#>> '{}'` extracts **any** json type as text. Landing the sketch as written
 * would silently destroy exactly the rows the backfill has not converted.
 *
 * So every arm below is a PAIR — a pre-check that counts the cells the move
 * would not preserve, and the statement that moves them — and the caller must
 * run the first and abort on a non-zero count before it runs the second. The
 * pre-check is the clause the dev seat measured; the statement keeps the
 * ruling's shape.
 *
 * ## MySQL is deliberately absent
 *
 * ⛔ #17788 (`pm:on-hold`, `Restart-when: a MySQL 8.x instance is reachable
 * from the dispatch environment`) owns the MySQL leg, and it owns it for a
 * reason this module must not paper over: the addendum leaves MySQL's
 * statement ORDER unsettled, and settling it needs a real instance — the same
 * thing that turned the Postgres sketch from plausible into measured-wrong.
 * {@link mediaColumnMoveDialect} therefore answers `null` for MySQL, and the
 * caller reports a named refusal rather than inventing a third wording.
 */

import type { SqlDialectName } from './schema-drift.js';

/** The dialects whose column move is measured and executable today. */
export const MEDIA_COLUMN_MOVE_DIALECTS = ['postgres', 'sqlite'] as const;

export type MediaColumnMoveDialect = (typeof MEDIA_COLUMN_MOVE_DIALECTS)[number];

/**
 * Is this dialect's column move executable here, and under which name?
 *
 * Answers `null` for every dialect that is not in
 * {@link MEDIA_COLUMN_MOVE_DIALECTS} — today MySQL and `unknown`. ⛔ A caller
 * may not fall back to another dialect's statements on a `null`: the two forms
 * are not interchangeable, and guessing is what this module exists to stop.
 */
export function mediaColumnMoveDialect(dialect: SqlDialectName): MediaColumnMoveDialect | null {
  return (MEDIA_COLUMN_MOVE_DIALECTS as readonly string[]).includes(dialect)
    ? (dialect as MediaColumnMoveDialect)
    : null;
}

/**
 * Which shape of move a column needs — decided by the physical type it HAS,
 * never by the dialect alone.
 *
 * - `retype` — the column is a JSON column (only a server dialect can have
 *   one). The move changes the type and rewrites the values in one statement.
 * - `unquote` — the column is already a string column holding JSON-quoted ids.
 *   This population is real and measured: `os generate migration --format sql`
 *   emits `VARCHAR(2048)` for the family, and a driver on the JSON arm writes
 *   quoted ids into it (#15771, reproduced on live PostgreSQL 16.13). It is
 *   also the ONLY shape SQLite ever has, since SQLite has no json type and the
 *   JSON arm has always written JSON text into a `text` column.
 *
 * ⛔ Reading the shape off the dialect instead of off the column is the defect
 * that would leave a `varchar` full of `"file_…"` behind a `columns_moved_at`
 * stamp saying it had been converted.
 */
export type MediaColumnMoveKind = 'retype' | 'unquote';

/** One column's move: the abort pre-check, then the statement. */
export interface MediaColumnMovePlan {
  dialect: MediaColumnMoveDialect;
  kind: MediaColumnMoveKind;
  table: string;
  column: string;
  /**
   * Counts the cells this move would NOT preserve. The caller runs it first
   * and ABORTS on any non-zero answer — ⛔ it is not advisory, and it is not
   * something the statement below re-checks for itself.
   */
  precheck: string;
  /** What a non-zero pre-check count means, in one operator-facing sentence. */
  precheckMeaning: string;
  /** The move. Run ONLY after the pre-check answered zero. */
  statement: string;
}

/**
 * The width the move retypes to — the SQL generator's own
 * (`packages/cli/src/commands/generate.ts` emits `VARCHAR(2048)`), and the
 * same constant the driver's `varcharColumnChars` mirrors on the moved arm.
 * Transcribed rather than imported because this module builds text for a
 * server and must not depend on the driver class it is built for.
 */
export const MEDIA_ID_MOVE_WIDTH = 2048;

/** Is this physical column type a JSON column, as the server reports it? */
export function isJsonColumnType(physicalType: string | undefined | null): boolean {
  return typeof physicalType === 'string' && /json/i.test(physicalType);
}

/**
 * Build one column's move.
 *
 * @param dialect the dialect, already narrowed by {@link mediaColumnMoveDialect}
 * @param kind    read off the column's PHYSICAL type — see {@link MediaColumnMoveKind}
 */
export function mediaColumnMovePlan(
  dialect: MediaColumnMoveDialect,
  kind: MediaColumnMoveKind,
  table: string,
  column: string,
): MediaColumnMovePlan {
  const base = { dialect, kind, table, column } as const;

  if (dialect === 'sqlite') {
    // SQLite has one shape only: the column is `text` on both arms, so there
    // is nothing to retype and the whole move is the value rewrite.
    //
    // The discriminator is `json_type`, measured on the first step-3 rehearsal
    // anywhere: an un-backfilled inline-object cell answers `'object'`, a
    // converted one answers `'text'`, and a cell that is ALREADY bare is not
    // valid JSON at all, so `json_valid` excludes it. That exclusion is what
    // makes the move idempotent — re-running it leaves a bare cell untouched
    // rather than aborting on it, which a literal "not a JSON string" test
    // would have done on every already-converted row.
    return {
      ...base,
      precheck:
        `select count(*) as n from "${table}" ` +
        `where "${column}" is not null and json_valid("${column}") ` +
        `and json_type("${column}") <> 'text'`,
      precheckMeaning:
        'cell(s) hold a JSON value that is not a string — an inline metadata blob, an array, ' +
        'or a number. The unquote would turn each of them into something else, so the move ' +
        'is refused: run the backfill until it reports zero blocking rows first.',
      statement:
        `update "${table}" set "${column}" = json_extract("${column}", '$') ` +
        `where "${column}" is not null and json_valid("${column}") ` +
        `and json_type("${column}") = 'text'`,
    };
  }

  if (kind === 'retype') {
    // The ruling's own statement, kept — with the pre-check the ruling's text
    // lacked in front of it. `json_typeof` is total over a json column, so
    // `IS DISTINCT FROM 'string'` really is "every cell that is not a JSON
    // string", and it is the exact clause measured to answer 1 on the fixture
    // that `#>> '{}'` silently flattened.
    //
    // The `::json` cast makes the pre-check read a `jsonb` column too; the
    // `#>>` operator is defined on both, so only the pre-check needs it.
    return {
      ...base,
      precheck:
        `select count(*) as n from "${table}" ` +
        `where "${column}" is not null and json_typeof("${column}"::json) is distinct from 'string'`,
      precheckMeaning:
        'cell(s) hold a JSON value that is not a string — an inline metadata blob left by a ' +
        'backfill that has not converted them. `USING (col #>> \'{}\') ` does NOT refuse those: ' +
        'measured on live PostgreSQL 16.13, it flattens the object to its literal text and the ' +
        'original value is gone. The move is refused instead.',
      statement:
        `alter table "${table}" alter column "${column}" ` +
        `type varchar(${MEDIA_ID_MOVE_WIDTH}) using ("${column}" #>> '{}')`,
    };
  }

  // Postgres, column already a string type (#15771's population). Nothing to
  // retype; the quoted ids inside it still have to move.
  //
  // PostgreSQL has no `json_valid`, so the pre-check names the family that
  // matters rather than testing validity: a cell opening with `{` or `[` is an
  // unconverted blob, which is the same thing the two clauses above refuse. A
  // cell that opens with `"` but is not a well-formed JSON string raises on
  // the cast in the statement below and aborts it whole — loudly, and with the
  // column untouched, because a Postgres statement is atomic.
  return {
    ...base,
    precheck:
      `select count(*) as n from "${table}" ` +
      `where "${column}" is not null and left("${column}", 1) in ('{', '[')`,
    precheckMeaning:
      'cell(s) hold an inline metadata blob or an array rather than an id. Unquoting would ' +
      'leave the blob as its own literal text, so the move is refused: run the backfill until ' +
      'it reports zero blocking rows first.',
    statement:
      `update "${table}" set "${column}" = ("${column}"::json #>> '{}') ` +
      `where "${column}" is not null and left("${column}", 1) = '"'`,
  };
}

/**
 * A media column this step declines to plan, and why. ⛔ Never dropped
 * silently: a column missing from a move that then reports success is the one
 * way the step can under-deliver and still look complete.
 */
export interface MediaColumnMoveRefusal {
  table: string;
  column: string;
  reason: 'dialect_not_supported' | 'introspection_failed' | 'column_absent';
  detail: string;
}

/** What `planMediaColumnMove()` found: every plan, and every refusal. */
export interface MediaColumnMoveScan {
  /** The dialect as the driver names it — including one this step cannot serve. */
  dialect: SqlDialectName;
  plans: MediaColumnMovePlan[];
  refusals: MediaColumnMoveRefusal[];
}

/**
 * What the operator does if it goes wrong — printed by the command.
 *
 * The first note is the load-bearing one, and it is the same shape as the one
 * `os migrate multi-value-columns` carries: the move is not information
 * preserving in the reverse direction, so there is no `--undo` and pretending
 * otherwise would be worse than saying so.
 */
export const MEDIA_COLUMN_MOVE_ROLLBACK_NOTES: readonly string[] = [
  'Restore the backup you took before the run. The move rewrites values in place; a type-only reversal puts the column back to json with BARE ids in it, which is not valid JSON and reads back as nothing on a server dialect.',
  'The pre-check runs before any statement, and a non-zero count stops the whole step with the column and its rows untouched. A refusal here is the mechanism working: convert the rows it names, then re-run.',
  'PostgreSQL runs one statement per column, and a statement there is atomic: if it fails, that column is exactly as it was. Columns already moved in the same run stay moved — re-running skips them, because the move only touches cells that still carry the legacy encoding.',
  'SQLite runs one UPDATE per column and it is idempotent: an already-bare cell is not valid JSON, so a re-run passes over it rather than converting it twice.',
  'The deployment is only recorded as moved (`sys_migration.columns_moved_at`) when every column succeeded. A partial run records nothing, so the driver stays on the JSON arm and keeps reading both encodings.',
];
