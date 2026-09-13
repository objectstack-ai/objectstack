// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15989] The ADR-0104 column step's STATEMENTS, pinned without a server.
 *
 * The live behaviour is `sql-driver-15989-file-column-move.test.ts`, which
 * executes these against every provisioned dialect. This file pins what they
 * SAY — the part a reader of the ruling has to be able to check by eye, and the
 * part that a careless edit could change while every live cell still passes
 * because the fixture happens not to contain the row the clause stopped
 * refusing.
 *
 * ⛔ The single most load-bearing assertion here is that the PostgreSQL retype
 * arm's pre-check exists at all. The #15041 addendum prescribed the retype with
 * NO pre-check, and that form was measured on live PostgreSQL 16.13 to accept a
 * row holding an inline metadata blob and flatten it to its own literal text.
 * The director ruling (decision batch #120 item 1) replaced the clause; a pin
 * that only checked the `ALTER … USING` half would pass on the superseded form.
 */

import { describe, it, expect } from 'vitest';
import {
  MEDIA_COLUMN_MOVE_DIALECTS,
  MEDIA_COLUMN_MOVE_ROLLBACK_NOTES,
  MEDIA_ID_MOVE_WIDTH,
  isJsonColumnType,
  mediaColumnMoveDialect,
  mediaColumnMovePlan,
} from './media-column-move.js';

describe('#15989 — which dialects the column step serves', () => {
  it('serves PostgreSQL and SQLite, and ⛔ refuses MySQL by NAME', () => {
    expect([...MEDIA_COLUMN_MOVE_DIALECTS]).toEqual(['postgres', 'sqlite']);
    expect(mediaColumnMoveDialect('postgres')).toBe('postgres');
    expect(mediaColumnMoveDialect('sqlite')).toBe('sqlite');
    // ⛔ #17788 owns the MySQL leg, on a real instance, because the addendum
    // leaves its statement ORDER unsettled. A `null` here is the refusal; a
    // fallback to another dialect's statements is what it prevents.
    expect(mediaColumnMoveDialect('mysql')).toBeNull();
    expect(mediaColumnMoveDialect('unknown' as never)).toBeNull();
  });
});

describe('#15989 — the PostgreSQL RETYPE arm (a json column)', () => {
  const plan = mediaColumnMovePlan('postgres', 'retype', 'crm_case', 'cover');

  it('⛔ carries the measured ABORT pre-check, not the ruling text\'s bare statement', () => {
    // The exact clause recorded in 5556979386 / 5618311630 and adopted by the
    // director ruling. `#>> '{}'` extracts ANY json type as text, so without
    // this the statement below converts an unconverted blob instead of
    // refusing it — measured, on live PostgreSQL 16.13.
    expect(plan.precheck).toContain("json_typeof(\"cover\"::json) is distinct from 'string'");
    expect(plan.precheck).toContain('count(*)');
    expect(plan.precheck).toContain('"crm_case"');
    // The pre-check must not itself change anything.
    expect(plan.precheck.toLowerCase()).not.toMatch(/\b(update|alter|delete|insert)\b/);
  });

  it('keeps the ruling\'s own retype statement, at the generator\'s width', () => {
    expect(plan.statement).toBe(
      'alter table "crm_case" alter column "cover" ' +
        `type varchar(${MEDIA_ID_MOVE_WIDTH}) using ("cover" #>> '{}')`,
    );
    // The width is the SQL generator's, which the ruling names as the
    // end-state and which `varcharColumnChars` mirrors on the moved arm.
    expect(MEDIA_ID_MOVE_WIDTH).toBe(2048);
  });

  it('states what a non-zero pre-check MEANS, in the operator\'s terms', () => {
    // Anti-vacuity for the report: a count with no sentence beside it is a
    // number an operator cannot act on, and this step's whole value on a
    // blocked deployment is the sentence.
    expect(plan.precheckMeaning).toMatch(/not a string/i);
    expect(plan.precheckMeaning.length).toBeGreaterThan(40);
  });
});

describe('#15989 — the PostgreSQL UNQUOTE arm (a column already varchar)', () => {
  const plan = mediaColumnMovePlan('postgres', 'unquote', 'crm_case', 'cover');

  it('⛔ does NOT retype — this population is #15771\'s, already at the target type', () => {
    // `os generate migration --format sql` emits VARCHAR(2048) for the family,
    // and a JSON-arm driver fills it with quoted ids (reproduced on live PG
    // 16.13). Retyping it would be a no-op that reports as a move; the values
    // are what have to change.
    expect(plan.statement.toLowerCase()).not.toContain('alter table');
    expect(plan.statement).toContain('update "crm_case"');
    expect(plan.statement).toContain(`"cover"::json #>> '{}'`);
  });

  it('only touches a cell that OPENS with a double quote, so a bare id is left alone', () => {
    expect(plan.statement).toContain(`left("cover", 1) = '"'`);
  });

  it('aborts on the same family the retype arm does — an unconverted blob', () => {
    expect(plan.precheck).toContain(`left("cover", 1) in ('{', '[')`);
    expect(plan.precheck.toLowerCase()).not.toMatch(/\b(update|alter|delete|insert)\b/);
  });
});

describe('#15989 — the SQLite arm', () => {
  const plan = mediaColumnMovePlan('sqlite', 'unquote', 'crm_case', 'cover');

  it('gates on json_valid AND json_type, which is what makes a re-run idempotent', () => {
    // MEASURED (the first step-3 rehearsal, 5556979386): a bare id is not
    // valid JSON at all, so `json_valid` excludes it and a re-run passes over
    // it. A literal "not a JSON string" test would abort on every
    // already-converted row instead.
    expect(plan.statement).toContain(`json_extract("cover", '$')`);
    expect(plan.statement).toContain('json_valid("cover")');
    expect(plan.statement).toContain(`json_type("cover") = 'text'`);
  });

  it("aborts on a json value whose type is not 'text'", () => {
    expect(plan.precheck).toContain(`json_type("cover") <> 'text'`);
    expect(plan.precheck).toContain('json_valid("cover")');
  });

  it('⛔ ignores the `kind` for its SQL — SQLite has no json type to retype', () => {
    // Both spellings must produce the identical STATEMENTS: SQLite's column is
    // `text` on both arms, so a caller that classified it either way is right
    // about what has to happen. The `kind` itself is carried through unchanged
    // rather than normalised, so a report says what the planner actually saw —
    // asserted here so neither half can quietly become the other.
    const asRetype = mediaColumnMovePlan('sqlite', 'retype', 'crm_case', 'cover');
    expect(asRetype.statement).toBe(plan.statement);
    expect(asRetype.precheck).toBe(plan.precheck);
    expect(asRetype.kind).toBe('retype');
    expect(plan.kind).toBe('unquote');
    // …and the control that this is a SQLite property and not a general one:
    // on Postgres the two kinds really do differ.
    expect(mediaColumnMovePlan('postgres', 'retype', 'crm_case', 'cover').statement).not.toBe(
      mediaColumnMovePlan('postgres', 'unquote', 'crm_case', 'cover').statement,
    );
  });
});

describe('#15989 — the shape is read off the COLUMN, never off the dialect', () => {
  it('recognises every spelling a server uses for a json column', () => {
    for (const type of ['json', 'jsonb', 'JSON', 'JSONB']) {
      expect(isJsonColumnType(type), type).toBe(true);
    }
    // The control, in the same run: the target type and the generator's own
    // must NOT read as json, or every moved column would be planned as a
    // retype forever.
    for (const type of ['character varying', 'varchar', 'text', 'TEXT', undefined, null, '']) {
      expect(isJsonColumnType(type), String(type)).toBe(false);
    }
  });
});

describe('#15989 — the rollback notes', () => {
  it('say there is no reverse statement, and that a refusal is the mechanism working', () => {
    const all = MEDIA_COLUMN_MOVE_ROLLBACK_NOTES.join('\n');
    expect(all).toMatch(/backup/i);
    // ⛔ The step must never advertise an `--undo` it does not have.
    expect(all).toMatch(/pre-check runs before any statement/i);
    // …and that a partial run records nothing, which is what keeps a
    // half-moved datastore off the bare arm.
    expect(all).toMatch(/columns_moved_at/);
  });
});
